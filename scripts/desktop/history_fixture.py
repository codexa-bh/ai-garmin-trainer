#!/usr/bin/env python3
"""Finite authored Personal API stand-in for isolated history evidence; no service access.

Only the explicit history runner starts this, on 127.0.0.1, for one stopped owned
synthetic run. Native admits its origin solely through that run's private
``launch.json`` ``garminFixture`` (never saved settings), so ordinary
configuration cannot select it. Every request must carry the run's fixture
capability. It serves fixed authored data for the documented official paths the
product reader uses, and records only closed per-endpoint aggregates.
"""

from datetime import date, datetime, timedelta, timezone
import base64
import http.server
import json
import os
from pathlib import Path
import stat
import struct
import threading
import time
import urllib.parse
import zlib

SYNTHETIC_KEY = 'synthetic-history-personal-api-key'
# Long enough that explicit discovery needs several range batches (cancel and
# Continue are observable) yet finite: earlier dates are source-empty.
DATA_START_DAYS = 300
PRESETS = frozenset(('known', 'partial-today', 'new-activity', 'rejected-key', 'rate-limited'))
ENDPOINTS = frozenset(
    (
        'token',
        'daily-summaries',
        'sleep',
        'hrv',
        'body-battery',
        'activity-list',
        'activity-summary',
        'activity-file',
        'profile-settings',
        'heart-rate-zones',
        'weigh-ins',
        'body-history',
    )
)
TOKEN_PATH = '/personalapitoken-service/personal-api/personal-api-key/token'
CALL_LIMIT = 2000
# Matches the retired authored connector's per-call latency so actual Sync
# progress/cancel windows stay observable; not Garmin latency.
LATENCY_SECONDS = 0.4


def _today():
    return datetime.now(timezone.utc).date()


def _days(start, end):
    first, last = date.fromisoformat(start), date.fromisoformat(end)
    if last < first or (last - first).days > 366:
        raise ValueError('Closed authored range bound')
    return [
        (first + timedelta(days=offset)).isoformat() for offset in range((last - first).days + 1)
    ]


def _covered(day, preset):
    """Authored account: data from DATA_START_DAYS ago; today is partial."""
    value = date.fromisoformat(day)
    today = _today()
    if value > today or value < today - timedelta(days=DATA_START_DAYS):
        return 0
    if value == today:
        return 12 if preset != 'partial-today' else 6
    return 24


def _wall(moment):
    return moment.strftime('%Y-%m-%dT%H:%M:%S.0')


def summary_row(day, preset):
    hours = _covered(day, preset)
    start = datetime.fromisoformat(day + 'T00:00:00')
    covered = hours > 0
    return {
        'calendarDate': day,
        'includesWellnessData': covered,
        'includesActivityData': False,
        'wellnessChronology': {
            'startTimestampGmt': _wall(start),
            'startTimestampLocal': _wall(start),
            'endTimestampGmt': _wall(start + timedelta(hours=hours)),
            'endTimestampLocal': _wall(start + timedelta(hours=hours)),
            'totalDurationInMillis': hours * 3600000,
        }
        if covered
        else None,
        'movement': {'steps': {'value': 7000 if covered else None}},
        'calories': {'burnedResting': 1700, 'burnedActive': 400, 'burnedTotal': 2100}
        if covered
        else None,
        'heartRate': {'restingValue': 54} if covered else None,
        'intensityMinutes': {'moderate': 20, 'vigorous': 5} if covered else None,
        'stress': {'avgLevel': 28} if covered else None,
        'bodyBattery': {'latestValue': 40, 'maxValue': 88} if covered else None,
    }


def activity_ids(preset):
    """Three stable authored activities in the last week (four with new-activity)."""
    today = _today()
    rows = [
        (
            f'8309{index}',
            today - timedelta(days=2 + index * 2),
            'running' if index % 2 else 'cycling',
        )
        for index in range(3)
    ]
    if preset == 'new-activity':
        rows.insert(0, ('83380', today, 'running'))
    return rows


def activity_row(garmin_id, day, sport):
    return {
        'activityId': int(garmin_id),
        'activityName': f'Authored {sport} {garmin_id}',
        'activityType': {'typeKey': sport},
        'startTimeLocal': day.isoformat() + ' 07:00:00',
        'startTimeGMT': day.isoformat() + ' 07:00:00',
        'duration': 1800,
        'distance': 5000,
        'averageHR': 140,
        'maxHR': 168,
        'hrTimeInZone_1': 60,
        'hrTimeInZone_2': 300,
        'hrTimeInZone_3': 900,
        'hrTimeInZone_4': 420,
        'hrTimeInZone_5': 120,
    }


# ---- Minimal FIT + single-entry ZIP builder (authored records only) ----
def _crc16(data):
    table = [
        0x0000, 0xCC01, 0xD801, 0x1400, 0xF001, 0x3C00, 0x2800, 0xE401,
        0xA001, 0x6C00, 0x7800, 0xB401, 0x5000, 0x9C01, 0x8801, 0x4400,
    ]  # fmt: skip
    crc = 0
    for byte in data:
        for nibble in (byte & 0xF, byte >> 4):
            tmp = table[crc & 0xF]
            crc = (crc >> 4) & 0x0FFF
            crc = crc ^ tmp ^ table[nibble]
    return crc


def _message(local, number, fields):
    """Definition + data record. fields: list of (field_number, base_type, fmt, value)."""
    definition = struct.pack('<BBBHB', 0x40 | local, 0, 0, number, len(fields))
    for field_number, base_type, fmt, _ in fields:
        definition += struct.pack('<BBB', field_number, struct.calcsize('<' + fmt), base_type)
    data = struct.pack('<B', local) + b''.join(
        struct.pack('<' + fmt, *(value if isinstance(value, tuple) else (value,)))
        for _, _, fmt, value in fields
    )
    return definition + data


def fit_file(sport_code):
    base = 1_000_000_000
    body = _message(0, 0, [(0, 0x00, 'B', 4), (4, 0x86, 'I', base)])
    for index, heart in enumerate((120, 135, 150, 160)):
        body += _message(
            1,
            20,
            [
                (253, 0x86, 'I', base + index),
                (5, 0x86, 'I', index * 300),
                (78, 0x86, 'I', (1000 + index) * 5),
                (73, 0x86, 'I', 3000 + index),
                (3, 0x02, 'B', heart),
            ],
        )
    end = base + 4
    body += _message(
        2,
        19,
        [(253, 0x86, 'I', end), (254, 0x84, 'H', 0), (2, 0x86, 'I', base), (7, 0x86, 'I', 5000)],
    )
    body += _message(
        3,
        18,
        [
            (253, 0x86, 'I', end),
            (254, 0x84, 'H', 0),
            (2, 0x86, 'I', base),
            (7, 0x86, 'I', 5000),
            (5, 0x00, 'B', sport_code),
            (16, 0x02, 'B', 145),
        ],
    )
    body += _message(4, 7, [(253, 0x86, 'I', base), (1, 0x02, 'B', 188)])
    zones = tuple(seconds * 1000 for seconds in (0, 60, 300, 900, 420, 120))
    body += _message(
        5,
        216,
        [
            (253, 0x86, 'I', end),
            (0, 0x84, 'H', 18),
            (1, 0x84, 'H', 0),
            (2, 0x86, '6I', zones),
            (6, 0x02, '6B', (100, 120, 140, 155, 170, 190)),
        ],
    )
    header = struct.pack('<BBHI4s', 14, 0x20, 2193, len(body), b'.FIT')
    header += struct.pack('<H', _crc16(header))
    content = header + body
    return content + struct.pack('<H', _crc16(content))


def zipped(fit, name=b'100_ACTIVITY.fit'):
    compressor = zlib.compressobj(9, zlib.DEFLATED, -15)
    data = compressor.compress(fit) + compressor.flush()
    crc = zlib.crc32(fit) & 0xFFFFFFFF
    local = struct.pack(
        '<IHHHHHIIIHH', 0x04034B50, 20, 0, 8, 0, 0, crc, len(data), len(fit), len(name), 0
    )
    entry = local + name + data
    central = struct.pack(
        '<IHHHHHHIIIHHHHHII',
        0x02014B50, 20, 20, 0, 8, 0, 0, crc, len(data), len(fit), len(name), 0, 0, 0, 0, 0, 0,
    )  # fmt: skip
    directory = central + name
    end = struct.pack('<IHHHHIIH', 0x06054B50, 0, 0, 1, 1, len(directory), len(entry), 0)
    return entry + directory + end


def bearer():
    header = base64.urlsafe_b64encode(b'{"alg":"none"}').rstrip(b'=').decode()
    payload = (
        base64.urlsafe_b64encode(
            json.dumps({'exp': int(time.time()) + 86400, 'syntheticHistoryOnly': True}).encode()
        )
        .rstrip(b'=')
        .decode()
    )
    return f'{header}.{payload}.syntheticsignature'


class Fixture:
    """One owned loopback server bound to a stopped synthetic run root."""

    def __init__(self, root, capability):
        root = Path(root)
        info = root.stat()
        if (
            not root.is_absolute()
            or root.resolve() != root
            or not stat.S_ISDIR(info.st_mode)
            or info.st_uid != os.getuid()
            or info.st_mode & 0o777 != 0o700
        ):
            raise ValueError('Owned private run root required')
        if len(capability) != 64 or any(c not in '0123456789abcdef' for c in capability):
            raise ValueError('Fixture capability required')
        self.root, self.capability = root, capability
        self.preset = 'known'
        self.calls = {}
        self.total = 0
        self.lock = threading.Lock()
        self.token = bearer()
        fixture = self

        class Handler(http.server.BaseHTTPRequestHandler):
            protocol_version = 'HTTP/1.1'

            def log_message(self, *_args):
                pass  # No request text, key or path ever reaches logs.

            def do_POST(self):
                fixture.handle(self, 'POST')

            def do_GET(self):
                fixture.handle(self, 'GET')

        self.server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        self.server.daemon_threads = True
        self.port = self.server.server_address[1]
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)

    def start(self):
        self.thread.start()
        return self

    def stop(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=5)
        if self.thread.is_alive():
            raise RuntimeError('Fixture server did not settle')

    def set_preset(self, preset):
        if preset not in PRESETS:
            raise ValueError('Finite fixture preset refused')
        with self.lock:
            self.preset = preset

    def counts(self):
        with self.lock:
            return dict(self.calls)

    def _send(self, handler, status, body=b'', content_type='application/json'):
        handler.send_response(status)
        handler.send_header('Content-Type', content_type)
        handler.send_header('Content-Length', str(len(body)))
        handler.send_header('Connection', 'close')
        handler.end_headers()
        handler.wfile.write(body)

    def _json(self, handler, value, status=200):
        self._send(handler, status, json.dumps(value).encode())

    def handle(self, handler, method):
        if handler.headers.get('x-trainer-fixture') != self.capability:
            return self._send(handler, 403)
        url = urllib.parse.urlsplit(handler.path)
        query = dict(urllib.parse.parse_qsl(url.query))
        with self.lock:
            if self.total >= CALL_LIMIT:
                return self._send(handler, 503)
            self.total += 1
            preset = self.preset
        time.sleep(LATENCY_SECONDS)  # Authored latency: keeps actual UI windows observable.
        try:
            endpoint, reply = self.route(method, url.path, query, handler.headers, preset)
        except (ValueError, KeyError):
            return self._send(handler, 400)
        with self.lock:
            self.calls[endpoint] = self.calls.get(endpoint, 0) + 1
        status, body, content_type = reply
        self._send(handler, status, body, content_type)

    def route(self, method, path, query, headers, preset):
        def ok(value):
            return 200, json.dumps(value).encode(), 'application/json'

        if method == 'POST' and path == TOKEN_PATH:
            if (
                headers.get('Authorization') != 'ApiKey ' + SYNTHETIC_KEY
                or preset == 'rejected-key'
            ):
                return 'token', (401, b'{}', 'application/json')
            return 'token', (200, self.token.encode(), 'text/plain')
        if method != 'GET' or headers.get('Authorization') != 'Bearer ' + self.token:
            return 'token', (401, b'{}', 'application/json')
        if preset == 'rate-limited':
            return 'daily-summaries', (429, b'{}', 'application/json')
        if path == '/usersummary-service/v2/dailysummaries':
            days = _days(query['startDate'], query['endDate'])
            return 'daily-summaries', ok({'data': [summary_row(day, preset) for day in days]})
        if path == '/sleep-service/sleep/dailySleepSummariesByDate':
            days = _days(query['startDate'], query['endDate'])
            return 'sleep', ok(
                [
                    {
                        'calendarDate': day,
                        'sleepTimeSeconds': 27000,
                        'deepSleepSeconds': 5400,
                        'lightSleepSeconds': 14400,
                        'remSleepSeconds': 5400,
                        'awakeSleepSeconds': 1800,
                        'napTimeSeconds': 0,
                        'sleepScores': {'overall': {'value': 80}},
                    }
                    for day in days
                    if _covered(day, preset)
                ]
            )
        if path.startswith('/hrv-service/hrv/daily/'):
            _, _, _, _, start, end = path.split('/')
            return 'hrv', ok(
                {
                    'hrvSummaries': [
                        {'calendarDate': day, 'lastNightAvg': 52, 'status': 'BALANCED'}
                        for day in _days(start, end)
                        if _covered(day, preset)
                    ]
                }
            )
        if path == '/wellness-service/wellness/bodyBattery/reports/daily':
            days = _days(query['startDate'], query['endDate'])
            return 'body-battery', ok(
                [
                    {
                        'date': day,
                        'bodyBatteryValueDescriptorDTOList': [
                            {
                                'bodyBatteryValueDescriptorIndex': 0,
                                'bodyBatteryValueDescriptorKey': 'timestamp',
                            },
                            {
                                'bodyBatteryValueDescriptorIndex': 1,
                                'bodyBatteryValueDescriptorKey': 'bodyBatteryLevel',
                            },
                        ],
                        'bodyBatteryValuesArray': [[1, 80], [2, 30]],
                    }
                    for day in days
                    if _covered(day, preset)
                ]
            )
        if path == '/activitylist-service/activities/search/activities':
            start, limit = int(query['start']), int(query['limit'])
            rows = [
                activity_row(garmin_id, day, sport)
                for garmin_id, day, sport in activity_ids(preset)
                if query['startDate'] <= day.isoformat() <= query['endDate']
            ]
            return 'activity-list', ok(rows[start : start + limit])
        if path.startswith('/activity-service/activity/'):
            garmin_id = path.rsplit('/', 1)[1]
            for candidate, day, sport in activity_ids(preset):
                if candidate == garmin_id:
                    return 'activity-summary', ok(activity_row(candidate, day, sport))
            return 'activity-summary', (404, b'{}', 'application/json')
        if path.startswith('/download-service/files/activity/'):
            garmin_id = path.rsplit('/', 1)[1]
            for candidate, _day, sport in activity_ids(preset):
                if candidate == garmin_id:
                    content = zipped(fit_file(2 if sport == 'cycling' else 1))
                    return 'activity-file', (200, content, 'application/octet-stream')
            return 'activity-file', (404, b'{}', 'application/json')
        if path == '/userprofile-service/userprofile/settings':
            return 'profile-settings', ok({'availableTrainingDays': ['monday', 'thursday']})
        if path == '/biometric-service/heartRateZones/v2':
            return 'heart-rate-zones', ok(
                [
                    {
                        'sport': 'DEFAULT',
                        'trainingMethod': 'PERCENT_MAX_HR',
                        'maxHeartRateUsed': 188,
                        'zone1Floor': 94,
                        'zone2Floor': 113,
                        'zone3Floor': 132,
                        'zone4Floor': 150,
                        'zone5Floor': 169,
                    }
                ]
            )
        if path.startswith('/weight-service/weight/range/'):
            return 'weigh-ins', ok({'dailyWeightSummaries': []})
        if path.startswith('/weight-service/weight/all/'):
            return 'body-history', ok([])
        raise ValueError('Unknown authored path')
