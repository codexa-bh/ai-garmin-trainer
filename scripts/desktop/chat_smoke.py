"""Finite authored ordinary-chat lookup/terrain/dashboard/text proof; no private inputs or real services."""
import argparse
import base64
import contextlib
import datetime
import time
import hashlib
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
VISION_MODEL = 'llava'
PANELS = ['heartRate', 'elevation', 'speed', 'route']
MEMORY_MODEL = 'authored-memory'
MEMORY_PRIOR = 'Short weekdays because caregiving limits time; long weekday plans failed. Equipment remains undecided, not rejected. ' * 130
MEMORY_CURATED = 'Current mornings; short weekdays because caregiving limits time, and long weekday plans failed. Equipment remains undecided. Watercolor on Sundays because the studio is quiet.'
LONG_CONTINUITY = 'Assistant option one: long weekdays, rejected because caregiving limits time. Option two: short weekdays remains preferred. ' + ('Unverified continuity. ' * 200)
IMPORT_TIME = 1577923200000  # 2020-01-02, original authored message time, not review time.
IMPORT_TEXTS = [
    'Today I want you to know I prefer short weekdays because caregiving limits time until my child is older.',
    "Don't save this week's plan yet; I prefer short weekdays because caregiving limits time.",
    'Do not remember this private note.',
]
DOCUMENT_EXAMPLE = 'Example reference: /Users/example/plan.md; fictional OPENAI_API_KEY=example and access_token: example. Keep the caregiving rationale.'


def memory_chat_response(index, body, week):
    if body.get('model') != MODEL or body.get('stream') is True or not isinstance(body.get('messages'), list):
        raise ValueError('Fixed memory chat model/protocol required')
    calls = [('getTrainingPlan', {}), ('getWeeklyPlan', {'weekStart': week}),
             ('saveTrainingPlan', {'contentMarkdown': DOCUMENT_EXAMPLE}),
             ('saveWeeklyDocuments', {'changes': [{'kind': 'plan', 'weekStart': week, 'title': 'Authored example', 'contentMarkdown': DOCUMENT_EXAMPLE}]})]
    if index == 13:
        return {'role': 'assistant', 'content': LONG_CONTINUITY}
    if index == 15:
        if IMPORT_TEXTS[2] not in json.dumps(body['messages']):
            raise ValueError('Exact authored privacy turn required')
        return {'role': 'assistant', 'content': FOLLOWUP}
    if index == 14:
        rendered = json.dumps(body['messages'])
        if LONG_CONTINUITY not in rendered or 'unverified continuity, not evidence or permission' not in rendered or MEMORY_CURATED not in rendered:
            raise ValueError('Complete long assistant continuity/current memory missing from actual fallback request')
        return {'role': 'assistant', 'content': FOLLOWUP}
    if not 9 <= index <= 12:
        raise ValueError('Unexpected memory chat call')
    name, args = calls[index - 9]
    if name not in [tool.get('function', {}).get('name') for tool in body.get('tools', [])]:
        raise ValueError('Actual memory-plan action schema missing')
    return {'role': 'assistant', 'content': None, 'tool_calls': [{'id': 'memory-' + str(index), 'type': 'function', 'function': {'name': name, 'arguments': json.dumps(args)}}]}


def memory_response(body):
    if body.get('model') != MEMORY_MODEL or body.get('stream') is True or body.get('tools'):
        raise ValueError('Fixed single-pass memory protocol required')
    messages = body.get('messages', [])
    payload = json.loads(messages[-1]['content'])
    if set(payload) == {'firstPrompt'}:
        return {'role': 'assistant', 'content': json.dumps({'title': 'Authored continuity'})}, False
    if payload.get('previous') not in (MEMORY_PRIOR, MEMORY_CURATED) or not payload.get('newSources') or 'automatically learns, corrects and consolidates' not in json.dumps(messages) or 'Separate authored preference' in json.dumps(payload):
        raise ValueError('Complete prior/new-source automatic curation contract missing')
    if 'currentProfile' not in payload or payload['targetCharacters'] != 6000:
        raise ValueError('Current Profile/advisory target missing')
    sources = payload['newSources']
    if any(source.get('user') in IMPORT_TEXTS[:2] for source in sources):
        if [source.get('user') for source in sources] != IMPORT_TEXTS or [source.get('createdAt') for source in sources] != [IMPORT_TIME, IMPORT_TIME + 2000, IMPORT_TIME + 4000] or sources[1].get('assistantContextCreatedAt') != IMPORT_TIME + 1000 or not sources[1].get('assistantContext') or payload.get('now', 0) <= IMPORT_TIME + 3000 or 'Unix milliseconds' not in json.dumps(messages):
            raise ValueError('Actual reviewed import original user/context date contract missing')
    excluded = [index for index, source in enumerate(sources) if source.get('user') == IMPORT_TEXTS[2]]
    return {'role': 'assistant', 'content': json.dumps({'summary': MEMORY_CURATED, 'exclude': excluded})}, True


def image_parts(body):
    parts = []
    for message in body.get('messages', []):
        content = message.get('content')
        if isinstance(content, list):
            for index, part in enumerate(content):
                if part.get('type') == 'image_url':
                    label = content[index - 1].get('text', '') if index else ''
                    url = part.get('image_url', {}).get('url', '')
                    if not url.startswith('data:image/png;base64,'):
                        raise ValueError('Real PNG image part required')
                    raw = base64.b64decode(url.split(',', 1)[1], validate=True)
                    if not 33 <= len(raw) <= 1024 * 1024 or raw[:8] != b'\x89PNG\r\n\x1a\n' or int.from_bytes(raw[16:20], 'big') != 960 or int.from_bytes(raw[20:24], 'big') != 540:
                        raise ValueError('Bounded rendered image required')
                    panel = PANELS[len(parts)] if len(parts) < 4 else ''
                    if not panel or ('Current-turn ' + panel + ' image for activity weekdayHike, call ') not in label:
                        raise ValueError('Selected panel/activity/native-call binding required')
                    parts.append((panel, raw))
    return parts


def response(index, body, expected_zones=None, activity_images=False):
    if body.get('model') != (VISION_MODEL if activity_images else MODEL) or body.get('stream') is True or not isinstance(body.get('messages'), list):
        raise ValueError('Fixed authored model/protocol required')
    names = [tool.get('function', {}).get('name') for tool in body.get('tools', [])]
    if 'completeTrainerTurn' in names or index >= 9:
        raise ValueError('Unexpected certificate or extra provider call')
    images = image_parts(body)
    if images and (not activity_images or index not in (3, 7)):
        raise ValueError('Images outside admitted selected current turn')
    if activity_images and index in (3, 7) and len(images) != 4:
        raise ValueError('All four genuinely rendered selected images required')
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
        if phase == 2 and activity_images:
            args['panels'] = PANELS
        return {'role': 'assistant', 'content': None, 'tool_calls': [{'id': 'authored-' + str(index), 'type': 'function', 'function': {'name': name, 'arguments': json.dumps(args)}}]}
    # Observe production-rendered evidence, not a synthetic completion ledger.
    evidence = json.dumps(body['messages'])
    if not all(value in evidence for value in ['6543', '4321', '321', '123', 'weekdayHike', 'analyzeActivityTerrain succeeded', 'getActivityDashboard succeeded', 'available']):
        raise ValueError('Successful actual lookup/terrain/dashboard evidence missing')
    # Keyless summary-Off ordinary chat uses legacy context; configured-memory
    # routes use paired native outputs. Both must carry exactly one full result.
    carriers = [json.loads(message['content']).get('evidence', '') if message.get('role') == 'tool' else message.get('content', '') for message in body['messages']]
    marker = 'Dashboard values and explicit limits: '
    dashboards = [json.JSONDecoder().raw_decode(carrier.split(marker, 1)[1].lstrip())[0] for carrier in carriers if isinstance(carrier, str) and marker in carrier]
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
    def __init__(self, *, activity_images=False, memory_curation=False, scratch=None):
        self.calls = []
        self.memory_curation = memory_curation
        self.summary_calls = []
        self.title_calls = 0
        today = datetime.date.today()
        self.week = (today - datetime.timedelta(days=today.weekday())).isoformat()
        self.expected_zones = None
        self.activity_images = activity_images
        self.captures = []
        self.screenshots = None
        if activity_images and scratch:
            screenshots = scratch / 'screenshots'
            if not screenshots.exists():
                resources.directory(screenshots)
            private_directory(screenshots)
            self.screenshots = resources.directory(screenshots / ('activity-images-' + str(uuid.uuid4())))
        owner = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_args):
                pass

            def do_POST(self):
                self.connection.settimeout(5)
                length = self.headers.get('Content-Length', '')
                if self.path != '/v1/chat/completions' or not length.isdigit() or not 0 < int(length) <= (6 * 1024 * 1024 if owner.activity_images else 256 * 1024) or self.headers.get('Transfer-Encoding'):
                    self.send_error(400)
                    return
                try:
                    body = json.loads(self.rfile.read(int(length)))
                    memory = owner.memory_curation and body.get('model') == MEMORY_MODEL
                    if memory:
                        message, summary = memory_response(body)
                    elif owner.memory_curation and len(owner.calls) >= 9:
                        message = memory_chat_response(len(owner.calls), body, owner.week)
                    else:
                        message = response(len(owner.calls), body, owner.expected_zones, owner.activity_images)
                    if owner.screenshots and len(owner.calls) == 3:
                        for panel, raw_image in image_parts(body):
                            path = owner.screenshots / (panel + '.png')
                            with path.open('xb') as output:
                                output.write(raw_image)
                            resources.file_created(path)
                            owner.captures.append({'panel': panel, 'path': str(path), 'sha256': hashlib.sha256(raw_image).hexdigest(), 'captureMethod': 'actual native-owned backend rasterizer; bytes decoded from SDK chat wire, not native compositor'})
                except (ValueError, TypeError, AttributeError, KeyError):
                    self.send_error(400)
                    return
                if memory:
                    if summary:
                        owner.summary_calls.append({'fullPrior': True, 'newEligibleSources': True, 'currentProfile': True, 'singleCompleteOutput': True, 'excludedInputs': len(json.loads(message['content'])['exclude'])})
                    else:
                        owner.title_calls += 1
                else:
                    owner.calls.append({'tool': message.get('tool_calls', [{}])[0].get('function', {}).get('name'), 'ordinaryText': isinstance(message.get('content'), str)})
                raw = json.dumps({'id': 'authored-response', 'object': 'chat.completion', 'created': 1, 'model': body['model'], 'choices': [{'index': 0, 'finish_reason': 'tool_calls' if 'tool_calls' in message else 'stop', 'message': message}], 'usage': {'prompt_tokens': 1, 'completion_tokens': 1, 'total_tokens': 2}}).encode()
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
    if getattr(provider, 'activity_images', False):
        with contextlib.closing(sqlite3.connect(run.database)) as db:
            db.execute('update activity_stream_point set lat=45+elapsed_sec/100000.0,lon=8+elapsed_sec/200000.0 where garmin_id=?', ('weekdayHike',))
            db.commit()
        config['fields']['OLLAMA_MODEL'] = VISION_MODEL
    config['fields']['OLLAMA_BASE_URL'] = 'http://127.0.0.1:%d/v1' % provider.server.server_address[1]
    (run.root / 'config/settings-v2.json').rename(run.root / 'prepared-keyless-settings.json')
    private_json(run.root / 'config/settings-v2.json', config)


def api(run, method, path, body=None, expected_status=200):
    if run.child is None or run.child.poll() is not None or not run.origin:
        raise ValueError('Verified live owned backend required')
    client = http.client.HTTPConnection('127.0.0.1', int(run.origin.rsplit(':', 1)[1]), timeout=30)
    try:
        client.request(method, path, None if body is None else json.dumps(body), {'Content-Type': 'application/json'})
        reply = client.getresponse()
        raw = reply.read(256 * 1024 + 1)
        if reply.status != expected_status or len(raw) > 256 * 1024:
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
    with contextlib.closing(readonly(run.database)) as db:
        dump = '\n'.join(db.iterdump())
        if 'data:image/' in dump or 'iVBORw0KGgo' in dump or '"bytes":' in dump:
            raise ValueError('Transient images leaked into durable chat/debug state')
    api(run, 'PUT', '/api/conversations/selection', {'conversationId': ids[0]})
    return ids


def memory_settings(base):
    if base.get('keys'):
        raise ValueError('Only authored keyless run configuration is allowed')
    # Preserve the selected ordinary chat identity across the catalog upgrade.
    entries = [{'id': 'entry_legacy_ollama', 'provider': 'ollama', 'modelId': MODEL}, {'id': 'entry_authored_memory', 'provider': 'ollama', 'modelId': MEMORY_MODEL}]
    catalog = {'version': 1, 'entries': entries, 'defaultEntryId': entries[0]['id']}
    fields = {**base['fields'], 'SUMMARY_ENABLED': 'true', 'SUMMARY_MODEL': json.dumps({'version': 1, 'entryId': entries[1]['id'], 'provider': 'ollama', 'modelId': MEMORY_MODEL}), 'SUMMARY_CHAR_LIMIT': '6000', 'SUMMARY_CONTRACT_VERSION': '2'}
    return {'version': 3, 'fields': fields, 'keys': {}, 'chatCatalog': catalog, 'selectionCompatibility': {'database': None, 'catalog': catalog}}


def seed_import_dates(run):
    # Finite synthetic completed-Off inputs on the already-exclusive stopped copy.
    # Never rewrite original messages: their update trigger rightly aborts sources.
    if run.child is not None or run.database.parent != run.root or run.database.is_symlink():
        raise ValueError('Stopped exclusive authored run required')
    chat = 't0305-import-' + str(uuid.uuid4())
    ids = []
    with contextlib.closing(sqlite3.connect(run.database)) as db:
        if db.execute('select enabled from summary_control where id=1').fetchone() != (0,):
            raise ValueError('Authored import seed requires memory Off')
        privacy = db.execute('select privacy_generation from conversation_history_control where id=1').fetchone()[0]
        db.execute('insert into conversation(id,title,created_at,updated_at) values(?,?,?,?)', (chat, 'Authored date/privacy import', IMPORT_TIME, IMPORT_TIME + 6000))
        for index, text in enumerate(IMPORT_TEXTS):
            turn, user, assistant = [str(uuid.uuid4()) for _ in range(3)]
            db.execute("insert into message(id,conversation_id,role,content,created_at) values(?,?,'user',?,?)", (user, chat, text, IMPORT_TIME + index * 2000))
            db.execute("insert into message(id,conversation_id,role,content,created_at) values(?,?,'assistant',?,?)", (assistant, chat, 'Authored preceding context, not endorsement.', IMPORT_TIME + index * 2000 + 1000))
            db.execute("insert into conversation_turn(turn_id,conversation_id,user_id,assistant_id,source_version,summary_eligible,status,boot_id,privacy_generation) values(?,?,?,?,1,0,'completed','authored-import',?)", (turn, chat, user, assistant, privacy))
            db.execute('insert into conversation_completion(turn_id) values(?)', (turn,))
            ids.append(turn + ':1')
        db.commit()
        if db.execute('pragma integrity_check').fetchone()[0] != 'ok' or db.execute('pragma foreign_key_check').fetchone():
            raise ValueError('Authored import copy integrity failed')
    return ids


def memory_curation(run, provider):
    def inspection():
        return json.loads(api(run, 'GET', '/api/cross-chat-summary?view=content'))
    def command(action, **fields):
        value = inspection()
        return json.loads(api(run, 'POST', '/api/cross-chat-summary', {'version': 2, 'expected': value['expected'], 'action': action, **fields}))
    run.stop()
    import_ids = seed_import_dates(run)
    run.start(run.binary)
    command('edit-summary', text=MEMORY_PRIOR)
    command('edit', id=None, text='Separate authored preference')
    # This is only the stopped exclusive run configuration, never normal settings.
    run.stop()
    base = json.loads((run.root / 'config/settings-v2.json').read_text())
    private_json(run.root / 'config/settings-v3.json', memory_settings(base))
    run.start(run.binary)
    profile = json.loads(api(run, 'GET', '/api/profile'))
    api(run, 'POST', '/api/profile', profile)
    api(run, 'POST', '/api/profile', {**profile, 'constraints': ['Authored mornings; caregiving limits weekdays.']})
    if inspection()['stored']['text'] != MEMORY_PRIOR:
        raise ValueError('Profile erased substantive prior')
    api(run, 'PUT', '/api/training-plan', {'contentMarkdown': DOCUMENT_EXAMPLE})
    chat = 't0304-memory-' + str(uuid.uuid4())
    result = json.loads(api(run, 'POST', '/api/chat', {'conversationId': chat, 'message': 'Actually mornings now work better. Watercolor on Sundays because the studio is quiet. Save the fictional examples in my General Plan and current weekly plan.'}))
    if [(step['tool'], step['status']) for step in result['toolSteps']] != [(name, 'succeeded') for name in ['getTrainingPlan', 'getWeeklyPlan', 'saveTrainingPlan', 'saveWeeklyDocuments']]:
        raise ValueError('Complete native plan/weekly example flow failed')
    def settled():
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            value = inspection()
            if value['pending'] == 0 and value['stored']['text'] == MEMORY_CURATED:
                return value
            if value['reason']:
                raise ValueError('Automatic memory maintenance failed: ' + value['reason'])
            time.sleep(0.2)
        raise ValueError('Automatic memory maintenance did not settle')
    first = settled()
    json.loads(api(run, 'POST', '/api/chat', {'conversationId': chat, 'message': "Don't save my weekly review; weekends suit me because of childcare"}))
    final = settled()
    if len(provider.summary_calls) != 2 or len(final['preferences']) != 1 or final['preferences'][0]['text'] != 'Separate authored preference' or final['frontier'] <= first['frontier']:
        raise ValueError('Repeated automatic curation/preferences/source progress failed')
    if json.loads(api(run, 'GET', '/api/training-plan'))['plan']['contentMarkdown'] != DOCUMENT_EXAMPLE:
        raise ValueError('Document refusal changed stored plan')
    json.loads(api(run, 'POST', '/api/chat', {'conversationId': chat, 'message': IMPORT_TEXTS[2]}))
    settled()
    # Unknown natural-language privacy must reach the one normal request.
    # Review only these fixed authored Off IDs; native applies the returned
    # exclusion atomically with publication, without erasing unrelated prior.
    if len(provider.summary_calls) != 3 or provider.summary_calls[-1]['excludedInputs'] != 1:
        raise ValueError('Actual routine privacy decision/request missing')
    command('import-create', sourceIds=import_ids)
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        final = inspection()
        if final['historical']['manifests'][0]['state'] == 'complete':
            break
        if final['reason']:
            raise ValueError('Authored import failed: ' + final['reason'])
        time.sleep(0.2)
    else:
        raise ValueError('Reviewed authored import did not settle')
    if len(provider.summary_calls) != 4 or final['historical']['manifests'][0]['position'] != 3 or provider.summary_calls[-1]['excludedInputs'] != 1:
        raise ValueError('Exact selected import generation/disposition count failed')
    with contextlib.closing(readonly(run.database)) as db:
        if db.execute('select reason from summary_import_disposition order by rowid').fetchall() != [('processed',), ('processed',), ('privacy-excluded',)] or db.execute("select count(*) from conversation_turn where conversation_id=?", (chat,)).fetchone()[0] != 3:
            raise ValueError('Import processing or privacy original preservation failed')
        if db.execute('select count(*) from summary_suppression where source_id=?', (import_ids[2],)).fetchone() != (1,) or db.execute("select count(*) from summary_suppression where source_id like 'original-message:%'").fetchone() != (2,):
            raise ValueError('Durable routine/import native privacy mapping missing')
    run.stop(); run.start(run.binary)
    persisted = inspection()
    if persisted['stored']['text'] != MEMORY_CURATED or persisted['preferences'] != final['preferences'] or persisted['pending'] != 0 or len(provider.summary_calls) != 4:
        raise ValueError('Curation restart persistence/no-replay failed')
    api(run, 'POST', '/api/cross-chat-summary', {'version': 2, 'expected': persisted['expected'], 'action': 'import-create', 'sourceIds': [import_ids[2]]}, expected_status=503)
    return {'conversation': chat, 'profileNoOpAndChangedPreservedPrior': True, 'completePlanWeeklyExamples': True, 'automaticConsolidation': True, 'planNoSaveIndependentMeaningProcessed': True, 'preferencesPreserved': True, 'restartNoReplay': True, 'summaryCalls': len(provider.summary_calls), 'reviewedImport': {'sources': import_ids, 'excludedPrivate': import_ids[2], 'sameCallExclusion': True, 'durableRestrictions': True, 'originalUserAndContextDates': True, 'noAutomaticReplay': True, 'processed': 2}, 'liveModelQuality': 'not exercised; deterministic loopback supplied generation'}


@resources.invocation
def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--scratch', required=True)
    parser.add_argument('--bundle', required=True)
    parser.add_argument('--task-id', default='T0296')
    parser.add_argument('--activity-images', action='store_true', help='Four finite authored panels through the exact loopback llava image adapter; no live model')
    parser.add_argument('--memory-curation', action='store_true', help='Finite authored Profile/correction/plan/weekly/automatic-memory proof; no private or real provider input')
    parser.set_defaults(input_file=None, grant_file=None, provenance_file=None, anchor=None)
    args = parser.parse_args()
    if args.memory_curation and args.activity_images:
        parser.error('Memory curation and image fixtures are separate scenarios')
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
            provider = AuthoredProvider(activity_images=args.activity_images, memory_curation=args.memory_curation, scratch=scratch)
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
            memory_evidence = memory_curation(run, provider) if args.memory_curation else None
            if source_identity() != source or audit(bundle) != inventory or audit(run.bundle) != inventory:
                raise ValueError('Source/artifact changed')
            receipt.update({'source': source, 'runId': run.id, 'conversations': ids, 'calls': provider.calls, 'captures': captures, 'jsonNdjsonPersistenceContinuationRestart': True, 'memoryCuration': memory_evidence, 'activityImageCaptures': provider.captures, 'selectedPanels': PANELS if args.activity_images else [], 'backSync': 'Authored current-schema run copies only; memory/Profile/plan changes persist only in owned copies. Original prepared input unchanged; schema24-to25 rehearsal is separately covered by SQLite regressions.', 'passed': True})
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
