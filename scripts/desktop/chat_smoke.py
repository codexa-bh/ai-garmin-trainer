"""Finite authored ordinary-chat lookup/terrain/dashboard/text proof; no private inputs or real services."""
import argparse
import contextlib
import http.client
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import signal
import sqlite3
import threading
import uuid
import smoke_resources as resources
from native_smoke import REPO, Observer, canonical, fingerprint, private_json, readonly, source_identity
from ordinary_identity import ordinary_preparation
from ordinary_smoke import OrdinaryRun, private_directory
from release_smoke import audit
from smoke_input import prepare

ANSWER = 'Authored weekday hike: 6543 m in 4321 s, 321 m ascent, mean HR 123. The elevation section averages 10% across 1000 m. Keep weekday climbing practice manageable; surface and technicality remain unknown.'
FOLLOWUP = 'Continue with short weekday practice and adjust to recovery; this is authored coaching, not live-provider validation.'
PROMPT = 'Authored weekday hike numerical dashboard feedback.'
MODEL = 'qwen3.5:4b'


def response(index, body, expected_zones=None):
    if body.get('model') != MODEL or body.get('stream') is True or not isinstance(body.get('messages'), list):
        raise ValueError('Fixed authored model/protocol required')
    names = [tool.get('function', {}).get('name') for tool in body.get('tools', [])]
    if 'completeTrainerTurn' in names or index >= 9:
        raise ValueError('Unexpected certificate or extra provider call')
    if index == 8:
        return {'role': 'assistant', 'content': FOLLOWUP}
    phase = index % 4
    if phase < 3:
        name = ['verifyActivityReference', 'analyzeActivityTerrain', 'getActivityDashboard'][phase]
        if name not in names:
            raise ValueError('Actual action schema missing')
        args = {'garminId': 'weekdayHike'}
        if phase == 1:
            args['resultName'] = 'weekdayHike'
        return {'role': 'assistant', 'content': None, 'tool_calls': [{'id': 'authored-' + str(index), 'type': 'function', 'function': {'name': name, 'arguments': json.dumps(args)}}]}
    # Observe production-rendered evidence, not a synthetic completion ledger.
    evidence = json.dumps(body['messages'])
    if not all(value in evidence for value in ['6543', '4321', '321', '123', 'weekdayHike', 'analyzeActivityTerrain succeeded', 'getActivityDashboard succeeded', 'available']):
        raise ValueError('Successful actual lookup/terrain/dashboard evidence missing')
    outputs = [json.loads(message['content']) for message in body['messages'] if message.get('role') == 'tool']
    dashboards = [json.loads(output['evidence'].split('Dashboard values and explicit limits: ')[1]) for output in outputs if 'Dashboard values and explicit limits: ' in output.get('evidence', '')]
    if len(dashboards) != 1:
        raise ValueError('Exactly one actual numerical dashboard result required')
    dashboard = dashboards[0]
    zones = dashboard['heartRateZones']
    if zones['status'] != 'available' or zones['timeSource'] != 'garmin_activity' or zones['sourceTotalSeconds'] != 999 or zones['activityDurationSec'] != 4321 or zones['classifiedSeconds'] != 900 or [bucket['seconds'] for bucket in zones['buckets']] != [0, 90, 180, 270, 360]:
        raise ValueError('Actual HR-zone numerical evidence mismatch')
    if expected_zones is not None and zones != expected_zones:
        raise ValueError('Dashboard API/model HR-zone parity mismatch')
    if dashboard['terrain']['status'] != 'available' or dashboard['terrain']['sections'][0]['meanGradePct'] != 10 or any(field in dashboard for field in ['route', 'charts', 'stream']):
        raise ValueError('Numerical projection terrain/privacy mismatch')
    return {'role': 'assistant', 'content': ANSWER}


class AuthoredProvider:
    def __init__(self):
        self.calls = []
        self.expected_zones = None
        owner = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_args):
                pass

            def do_POST(self):
                self.connection.settimeout(5)
                length = self.headers.get('Content-Length', '')
                if self.path != '/v1/chat/completions' or not length.isdigit() or not 0 < int(length) <= 256 * 1024 or self.headers.get('Transfer-Encoding'):
                    self.send_error(400)
                    return
                try:
                    message = response(len(owner.calls), json.loads(self.rfile.read(int(length))), owner.expected_zones)
                except (ValueError, TypeError, AttributeError, KeyError):
                    self.send_error(400)
                    return
                owner.calls.append({'tool': message.get('tool_calls', [{}])[0].get('function', {}).get('name'), 'ordinaryText': isinstance(message.get('content'), str)})
                raw = json.dumps({'id': 'authored-response', 'object': 'chat.completion', 'created': 1, 'model': MODEL, 'choices': [{'index': 0, 'finish_reason': 'tool_calls' if 'tool_calls' in message else 'stop', 'message': message}], 'usage': {'prompt_tokens': 1, 'completion_tokens': 1, 'total_tokens': 2}}).encode()
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)

        self.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        self.server.daemon_threads = True
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def stop(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(2)
        if self.thread.is_alive():
            raise RuntimeError('Owned authored provider did not settle')


def seed_run(run, provider):
    # Only the newly exclusive online run copy; never the prepared/original input.
    if run.child is not None or run.database.parent != run.root or run.database.is_symlink():
        raise ValueError('Stopped exclusive run copy required')
    with contextlib.closing(sqlite3.connect(run.database)) as db:
        db.execute("insert into activity(id,garmin_id,name,sport,started_at,duration_sec,distance_meters,elevation_gain_meters,avg_heart_rate) values (?,?,?,?,?,?,?,?,?)", ('t0296-authored', 'weekdayHike', 'Authored weekday hike', 'hiking', 1793520000, 4321, 6543, 321, 123))
        db.executemany('insert into activity_stream_point(garmin_id,elapsed_sec,timestamp,distance_meters,altitude_meters,heart_rate) values (?,?,?,?,?,?)', [('weekdayHike', i * 10, '2026-11-01T00:%02d:%02dZ' % ((i * 10) // 60, (i * 10) % 60), i * 10, 100 + i, 123) for i in range(101)])
        db.executemany('insert into activity_hr_zone_time(garmin_id,zone,fetched_at,source,status,seconds,source_lower_bpm,source_total_seconds) values (?,?,?,?,?,?,?,?)', [('weekdayHike', zone, 1793520000, 'garmin_mcp', 'available', (zone - 1) * 90, 70 + zone * 20, 999) for zone in range(1, 6)])
        db.commit()
        if db.execute('pragma integrity_check').fetchone()[0] != 'ok' or db.execute('pragma foreign_key_check').fetchone():
            raise ValueError('Authored copy integrity failed')
    config = json.loads((run.root / 'config/settings-v2.json').read_text())
    config['fields']['OLLAMA_BASE_URL'] = 'http://127.0.0.1:%d/v1' % provider.server.server_address[1]
    (run.root / 'config/settings-v2.json').rename(run.root / 'prepared-keyless-settings.json')
    private_json(run.root / 'config/settings-v2.json', config)


def api(run, method, path, body=None):
    if run.child is None or run.child.poll() is not None or not run.origin:
        raise ValueError('Verified live owned backend required')
    client = http.client.HTTPConnection('127.0.0.1', int(run.origin.rsplit(':', 1)[1]), timeout=30)
    try:
        client.request(method, path, None if body is None else json.dumps(body), {'Content-Type': 'application/json'})
        reply = client.getresponse()
        raw = reply.read(256 * 1024 + 1)
        if reply.status != 200 or len(raw) > 256 * 1024:
            raise ValueError('Owned chat API failed or exceeded bound: ' + str(reply.status))
        return raw
    finally:
        client.close()


def exercise(run, provider):
    dashboard = json.loads(api(run, 'GET', '/api/activities/weekdayHike/dashboard'))
    provider.expected_zones = dashboard['heartRateZones']
    ids = []
    for stream in [False, True]:
        conversation = 't0296-authored-' + str(uuid.uuid4())
        ids.append(conversation)
        raw = api(run, 'POST', '/api/chat', {'conversationId': conversation, 'message': PROMPT, 'stream': stream})
        if stream:
            events = [json.loads(line) for line in raw.splitlines() if line]
            if ''.join(e.get('textDelta', '') for e in events if e.get('type') == 'delta') != ANSWER or any(e.get('type') == 'error' for e in events) or not any(e.get('type') == 'done' for e in events):
                raise ValueError('NDJSON authored answer mismatch')
        else:
            value = json.loads(raw)
            if value['assistant']['content'] != ANSWER or [(s['tool'], s['status']) for s in value['toolSteps']] != [('verifyActivityReference', 'succeeded'), ('analyzeActivityTerrain', 'succeeded'), ('getActivityDashboard', 'succeeded')]:
                raise ValueError('JSON authored answer/tool sequence mismatch')
        with contextlib.closing(readonly(run.database)) as db:
            rows = db.execute("select content from message where conversation_id=? and role='assistant'", (conversation,)).fetchall()
            if rows != [(ANSWER,)]:
                raise ValueError('Exactly-one assistant persistence failed')
    continued = json.loads(api(run, 'POST', '/api/chat', {'conversationId': ids[0], 'message': 'Continue that weekday advice.'}))
    if continued['assistant']['content'] != FOLLOWUP or len(provider.calls) != 9:
        raise ValueError('Continued conversation/call accounting mismatch')
    api(run, 'PUT', '/api/conversations/selection', {'conversationId': ids[0]})
    return ids


@resources.invocation
def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--scratch', required=True)
    parser.add_argument('--bundle', required=True)
    parser.add_argument('--task-id', default='T0296')
    parser.set_defaults(input_file=None, grant_file=None, provenance_file=None, anchor=None)
    args = parser.parse_args()
    os.umask(0o077)
    scratch = private_directory(resources.configure(canonical(args.scratch)))
    prepared = prepare(scratch, args, 'ordinary')
    bundle = canonical(args.bundle)
    run = observer = provider = None
    receipt = {'scenario': 'authored ordinary lookup-terrain-dashboard-text', 'passed': False, 'privateInputs': 'none', 'realServices': 'not exercised', 'cleanup': 'Run-copy chats/summary/streams only; preserve compact evidence and defer any retained bulk to normal scratch expiry; no copy-back.'}
    source = source_identity()
    with ordinary_preparation(REPO, bundle, source, scratch) as (verified, inventory):
        try:
            run = OrdinaryRun(scratch, prepared.database, source, bundle, inventory, verified=verified)
            run.before_start = prepared.verify_current
            provider = AuthoredProvider()
            seed_run(run, provider)
            observer = Observer(scratch, preparation_locked=True)
            run.observer = observer
            run.start(run.binary)
            ids = exercise(run, provider)
            old_boot = run.boot
            run.stop()
            run.start(run.binary)
            if run.boot == old_boot:
                raise ValueError('Restart reused boot')
            captures = []
            for preset in ['wide', 'narrow']:
                run.command({'type': 'setViewport', 'preset': preset})
                # Read-only fixed capture can wait for selected history hydration.
                # No mutation retry: capture is attempted only after bounded history checks.
                run.wait(lambda value: value['view'] == 'Trainer' and value['hydrated'], 'Trainer history after restart')
                captures.append(run.command({'type': 'captureView', 'view': 'ordinary-chat', 'preset': preset}))
            with contextlib.closing(readonly(run.database)) as db:
                if db.execute("select content from message where conversation_id=? and role='assistant' order by created_at", (ids[0],)).fetchall() != [(ANSWER,), (FOLLOWUP,)]:
                    raise ValueError('Restart history mismatch')
            if source_identity() != source or audit(bundle) != inventory or audit(run.bundle) != inventory:
                raise ValueError('Source/artifact changed')
            receipt.update({'source': source, 'runId': run.id, 'conversations': ids, 'calls': provider.calls, 'captures': captures, 'jsonNdjsonPersistenceContinuationRestart': True, 'passed': True})
        finally:
            with resources.preserve_failure():
                errors = []
                for owner in [run, provider]:
                    if owner:
                        try:
                            owner.stop()
                        except Exception as error:
                            errors.append(type(error).__name__ + ': owned shutdown failed')
                if observer:
                    receipt['noninterference'] = observer.stop(run.pids)
                prepared.verify_current()
                receipt['inputUnchanged'] = True
                receipt['shutdownErrors'] = errors
                receipt['passed'] = receipt['passed'] and not errors
                path = scratch / ('chat-receipt-' + str(uuid.uuid4()) + '.json')
                private_json(path, receipt)
                print(json.dumps({'passed': receipt['passed'], 'receipt': str(path)}))
                if not receipt['passed']:
                    raise RuntimeError('Authored chat smoke incomplete; original evidence retained')


if __name__ == '__main__':
    def interrupted(_signal, _frame):
        raise KeyboardInterrupt('Owned chat smoke interrupted')
    signal.signal(signal.SIGTERM, interrupted)
    main()
