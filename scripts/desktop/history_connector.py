#!/usr/bin/env python3
"""Finite authored stdio connector for isolated history evidence; no service access.

Only the explicit history runner selects this script in its stopped keyless copy.
It is not bundled, enabled by default, a real Garmin adapter or an auth mechanism.
"""
import datetime
import json
import os
from pathlib import Path
import stat
import sys
import time

DATA_START_DAYS = 80
SENTINEL = b'{"syntheticHistoryOnly":true}'
REVIEWED_ARGS = ['--from', 'git+https://github.com/Taxuspt/garmin_mcp.git@3610be6feed93088d85b0f35aba9d7d07c2505a7', '--with', 'mcp==1.28.1', 'garmin-mcp']
TOOLS = frozenset(('get_stats', 'get_sleep_summary', 'get_body_battery',
                   'get_weekly_steps', 'get_activities_by_date', 'get_user_profile',
                   'get_cycling_ftp', 'get_body_composition', 'get_weigh_ins',
                   'get_activity_fit_data', 'get_activity', 'get_activity_hr_in_timezones', 'get_devices',
                   'get_device_last_used'))
PRESETS = frozenset(('known', 'delayed', 'unknown', 'new-activity', 'last-used'))


def enabled(name):
    # Mirrors the pinned server: when GARMIN_ENABLED_TOOLS is set, only those
    # tools are registered (case-insensitive); unset registers every tool.
    allowed = {item.strip().lower() for item in os.environ.get('GARMIN_ENABLED_TOOLS', '').split(',') if item.strip()}
    return not allowed or name.lower() in allowed


def preset(root):
    path = Path(root) / 'synthetic-latest-preset.json'
    if not os.path.lexists(path):
        return 'known'
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, 'rb') as source:
        info = os.fstat(source.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o777 != 0o600 or info.st_nlink != 1 or info.st_size > 64:
            raise ValueError('Private finite preset required')
        value = json.loads(source.read(65))
    if not isinstance(value, dict) or set(value) != {'preset'} or value['preset'] not in PRESETS:
        raise ValueError('Finite latest preset refused')
    return value['preset']


def record_call(root, message):
    params = message['params']
    records = params['arguments'].get('include_records')
    if params['name'] not in TOOLS or (records is not None and type(records) is not bool):
        raise ValueError('Closed synthetic call evidence required')
    entry = {'name': params['name'], 'records': records}
    fd = os.open(Path(root) / 'synthetic-calls.jsonl', os.O_WRONLY | os.O_CREAT | os.O_APPEND | os.O_NOFOLLOW | os.O_NONBLOCK, 0o600)
    with os.fdopen(fd, 'ab') as output:
        info = os.fstat(output.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o777 != 0o600 or info.st_nlink != 1 or info.st_size > 262144:
            raise ValueError('Bounded owned call aggregates required')
        output.write(json.dumps(entry).encode() + b'\n')


def admitted(root):
    root = Path(root)
    if not root.is_absolute() or root.resolve() != root:
        return False
    info = root.stat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o777 != 0o700:
        return False
    directory = root / 'tokens'
    if directory.resolve() != directory:
        return False
    parent = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        info = os.fstat(parent)
        if info.st_uid != os.getuid() or info.st_mode & 0o777 != 0o700:
            return False
        fd = os.open('garmin_tokens.json', os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
        with os.fdopen(fd, 'rb') as source:
            info = os.fstat(source.fileno())
            return (stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid() and
                    info.st_mode & 0o777 == 0o600 and info.st_nlink == 1 and
                    info.st_size == len(SENTINEL) and source.read(len(SENTINEL) + 1) == SENTINEL)
    finally:
        os.close(parent)


def reply(message, scenario='known'):
    if message.get('method') == 'initialize':
        return {'protocolVersion': '2024-11-05', 'capabilities': {}, 'serverInfo': {'name': 'authored-history-only', 'version': '1'}}
    params = message.get('params') or {}
    if message.get('method') != 'tools/call' or set(params) != {'name', 'arguments'} or params['name'] not in TOOLS or not isinstance(params['arguments'], dict):
        raise ValueError('Finite synthetic operation refused')
    name, args = params['name'], params['arguments']
    fields = {'get_stats': {'date'}, 'get_sleep_summary': {'date'}, 'get_body_battery': {'start_date', 'end_date'},
              'get_weekly_steps': {'end_date', 'weeks'}, 'get_activities_by_date': {'start_date', 'end_date', 'page', 'page_size'},
              'get_activity': {'activity_id'}, 'get_activity_fit_data': {'activity_id', 'include_records'},
              'get_activity_hr_in_timezones': {'activity_id'}, 'get_body_composition': {'start_date', 'end_date'},
              'get_weigh_ins': {'start_date', 'end_date'}, 'get_user_profile': set(), 'get_cycling_ftp': set(), 'get_devices': set(),
              'get_device_last_used': set()}
    if not enabled(name) or set(args) != fields[name]:
        raise ValueError('Synthetic argument shape refused')
    if scenario not in PRESETS:
        raise ValueError('Finite latest preset refused')
    if name == 'get_devices':
        upload = datetime.datetime.now().astimezone() - datetime.timedelta(seconds=1)
        if scenario == 'delayed':
            upload -= datetime.timedelta(days=5)
        value = [{'device_id': 8338, 'is_primary': True, 'last_sync_time': None if scenario in ('unknown', 'last-used') else upload.isoformat(timespec='milliseconds')},
                 {'device_id': 2, 'is_primary': False, 'last_sync_time': '2020-01-01T00:00:00Z'}]
    elif name == 'get_device_last_used':
        # Pinned curation: offset-free whole seconds in this process's local
        # zone. Only 'last-used' names the selected watch; otherwise the newer
        # upload belongs to the non-primary device and must never finalize.
        upload_ms = int((time.time() - 1) * 1000)
        rendered = datetime.datetime.fromtimestamp(upload_ms / 1000.0).strftime('%Y-%m-%d %H:%M:%S')
        value = {'user_device_id': 8338 if scenario == 'last-used' else 2, 'device_name': 'Authored device',
                 'last_upload_time': rendered}
    elif name == 'get_stats':
        value = {'date': args['date'], 'total_steps': 0}
    elif name == 'get_sleep_summary':
        value = {'sleep_seconds': 3600}
    elif name == 'get_body_battery':
        value = []
    elif name == 'get_activities_by_date':
        # Three stable authored IDs per selected window, including windows only
        # discovered later in the same historical operation. Never private input.
        value = {'activities': [
            {'activityId': ('8338' if scenario == 'new-activity' else '8309') + args['start_date'].replace('-', '') + str(index),
             'activityType': 'running', 'startTimeLocal': (args['end_date'] if scenario == 'new-activity' else args['start_date']) + 'T12:00:00Z'}
            for index in range(3)] if args['page'] == 0 else [], 'has_more': False}
    elif name == 'get_activity':
        value = []
    elif name == 'get_activity_fit_data':
        # Supply every FIT supplement field; the baseline's records=False path
        # supplies applicable zones. No real FIT helper/service can be needed.
        value = {'zones_target': {'max_heart_rate': 190}, 'records': [
            {'timestamp': '2026-01-01T12:00:00Z', 'heart_rate_bpm': 140,
             'altitude_meters': 10, 'distance_meters': 0, 'speed_mps': 2}
        ] if args['include_records'] else []}
    elif name == 'get_weekly_steps':
        # Authored account whose data starts DATA_START_DAYS before today (UTC):
        # positive weeks from that start to end_date, nothing earlier, so
        # automatic discovery can find and stop at the start.
        end = datetime.date.fromisoformat(args['end_date'])
        start = datetime.datetime.now(datetime.timezone.utc).date() - datetime.timedelta(days=DATA_START_DAYS)
        weeks = []
        week = end
        while week >= start and len(weeks) < args['weeks']:
            weeks.append({'week_start': week.isoformat(), 'days_with_data': 7})
            week -= datetime.timedelta(days=7)
        value = {'end_date': args['end_date'], 'weeks_requested': args['weeks'], 'weeks_returned': len(weeks), 'weekly_data': weeks}
    else:
        value = {}
    return {'content': [{'type': 'text', 'text': json.dumps(value)}]}


def main():
    if sys.argv[1:] != REVIEWED_ARGS or not admitted(Path(__file__).resolve().parent):
        raise SystemExit('Explicit private synthetic run required')
    attempts = 0
    while True:
        line = sys.stdin.buffer.readline(16385)
        if not line:
            return
        if len(line) > 16384 or not line.endswith(b'\n'):
            raise SystemExit('Synthetic frame bound')
        message = json.loads(line)
        if not isinstance(message, dict) or message.get('jsonrpc') != '2.0':
            raise SystemExit('Synthetic protocol refused')
        if 'id' not in message:
            if message.get('method') != 'notifications/initialized':
                raise SystemExit('Synthetic notification refused')
            continue
        if message.get('method') == 'tools/call':
            attempts += 1
            if attempts > 480:
                raise SystemExit('Synthetic attempt bound')
        try:
            result = {'jsonrpc': '2.0', 'id': message['id'], 'result': reply(message, preset(Path(__file__).resolve().parent))}
            if message.get('method') == 'tools/call':
                record_call(Path(__file__).resolve().parent, message)
                # Authored service latency only: retain observable actual UI
                # ownership/capture windows without restoring product pacing.
                time.sleep(.4)
        except (ValueError, KeyError, TypeError):
            result = {'jsonrpc': '2.0', 'id': message['id'], 'error': {'code': -32602, 'message': 'Finite synthetic operation refused'}}
        print(json.dumps(result), flush=True)


if __name__ == '__main__':
    main()
