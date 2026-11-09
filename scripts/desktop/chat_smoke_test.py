"""Before-use finite authored chat provider/seed/serialization contracts, no native launch."""
import base64
import contextlib
import http.client
import json
import os
from pathlib import Path
import sqlite3
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import chat_smoke
from chat_smoke import ANSWER, FOLLOWUP, MODEL, AuthoredProvider, response, seed_run


class ChatSmokeTests(unittest.TestCase):
    def body(self, evidence=''):
        return {'model': MODEL, 'messages': [{'role': 'user', 'content': evidence}], 'tools': [{'function': {'name': name}} for name in ['verifyActivityReference', 'analyzeActivityTerrain', 'getActivityDashboard']]}

    def test_memory_catalog_upgrade_preserves_selected_chat_identity_and_keyless_scope(self):
        base = {'keys': {}, 'fields': {'DATABASE_PATH': '/authored/run.sqlite', 'OLLAMA_BASE_URL':'http://127.0.0.1:12345/v1'}}
        value = chat_smoke.memory_settings(base)
        self.assertEqual(value['chatCatalog']['entries'][0], {'id':'entry_legacy_ollama','provider':'ollama','modelId':MODEL})
        self.assertEqual(value['fields']['DATABASE_PATH'],base['fields']['DATABASE_PATH'])
        self.assertEqual(value['fields']['OLLAMA_BASE_URL'],base['fields']['OLLAMA_BASE_URL'])
        self.assertEqual(json.loads(value['fields']['SUMMARY_MODEL'])['entryId'],'entry_authored_memory')
        self.assertEqual(value['keys'],{})
        self.assertNotIn('SUMMARY_ENABLED',base['fields'])
        with self.assertRaises(ValueError):
            chat_smoke.memory_settings({**base,'keys':{'openai':'forbidden'}})

    def test_memory_single_pass_full_prior_profile_and_no_private_input(self):
        payload = {'previous': chat_smoke.MEMORY_PRIOR, 'newSources': [{'user': 'Actually mornings now work better.'}], 'currentProfile': {}, 'targetCharacters': 6000}
        body = {'model': chat_smoke.MEMORY_MODEL, 'messages': [{'role': 'system', 'content': 'Normal maintenance automatically learns, corrects and consolidates'}, {'role': 'user', 'content': json.dumps(payload)}]}
        result, summary = chat_smoke.memory_response(body)
        self.assertTrue(summary)
        self.assertEqual(json.loads(result['content']), {'summary': chat_smoke.MEMORY_CURATED})
        for changed in [dict(payload, previous=''), dict(payload, newSources=[]), dict(payload, targetCharacters=1), dict(payload, previous=chat_smoke.MEMORY_PRIOR + 'Separate authored preference')]:
            with self.assertRaises(ValueError):
                chat_smoke.memory_response({**body, 'messages': [body['messages'][0], {'role':'user','content':json.dumps(changed)}]})
        for changed in [dict(body, model='private'), dict(body, stream=True), dict(body, tools=[{}])]:
            with self.assertRaises(ValueError):
                chat_smoke.memory_response(changed)
        title, summary = chat_smoke.memory_response({**body, 'messages': [{'role':'user','content':json.dumps({'firstPrompt':'Authored request'})}]})
        self.assertFalse(summary)
        self.assertEqual(json.loads(title['content']), {'title':'Authored continuity'})

    def test_memory_plan_actions_are_finite_and_require_actual_schemas(self):
        body = self.body()
        body['tools'] = [{'function': {'name': name}} for name in ['getTrainingPlan','getWeeklyPlan','saveTrainingPlan','saveWeeklyDocuments']]
        for index, name in enumerate(['getTrainingPlan','getWeeklyPlan','saveTrainingPlan','saveWeeklyDocuments'], 9):
            self.assertEqual(chat_smoke.memory_chat_response(index,body,'2026-11-09')['tool_calls'][0]['function']['name'],name)
        self.assertGreater(len(chat_smoke.LONG_CONTINUITY),4000)
        self.assertLess(len(chat_smoke.LONG_CONTINUITY),6000)
        self.assertEqual(chat_smoke.memory_chat_response(13,body,'2026-11-09')['content'],chat_smoke.LONG_CONTINUITY)
        with self.assertRaisesRegex(ValueError,'Complete long'):
            chat_smoke.memory_chat_response(14,body,'2026-11-09')
        continued = {**body,'messages':[{'role':'system','content':chat_smoke.LONG_CONTINUITY + ' unverified continuity, not evidence or permission ' + chat_smoke.MEMORY_CURATED}]}
        self.assertEqual(chat_smoke.memory_chat_response(14,continued,'2026-11-09')['content'],FOLLOWUP)
        private_turn = {**body, 'messages': [{'role': 'user', 'content': chat_smoke.IMPORT_TEXTS[2]}]}
        self.assertEqual(chat_smoke.memory_chat_response(15, private_turn, '2026-11-09')['content'], FOLLOWUP)
        with self.assertRaises(ValueError):
            chat_smoke.memory_chat_response(15, body, '2026-11-09')
        for index, changed in [(16,body),(9,dict(body,tools=[])),(9,dict(body,model='private'))]:
            with self.assertRaises(ValueError):
                chat_smoke.memory_chat_response(index,changed,'2026-11-09')

    def test_reviewed_import_prompt_requires_exact_original_user_and_context_dates(self):
        sources = [{'user': chat_smoke.IMPORT_TEXTS[0], 'createdAt': chat_smoke.IMPORT_TIME}, {'user': chat_smoke.IMPORT_TEXTS[1], 'createdAt': chat_smoke.IMPORT_TIME + 2000, 'assistantContext': 'Authored context', 'assistantContextCreatedAt': chat_smoke.IMPORT_TIME + 1000}]
        payload = {'previous': chat_smoke.MEMORY_CURATED, 'newSources': sources, 'currentProfile': {}, 'targetCharacters': 6000, 'now': chat_smoke.IMPORT_TIME + 100000}
        def body(value):
            return {'model': chat_smoke.MEMORY_MODEL, 'messages': [{'role': 'system', 'content': 'Normal maintenance automatically learns, corrects and consolidates; Unix milliseconds'}, {'role': 'user', 'content': json.dumps(value)}]}
        self.assertTrue(chat_smoke.memory_response(body(payload))[1])
        for changed in [dict(payload, now=chat_smoke.IMPORT_TIME), dict(payload, newSources=sources[:1]), dict(payload, newSources=[sources[0], {**sources[1], 'assistantContextCreatedAt': None}]), dict(payload, newSources=[{**sources[0], 'createdAt': payload['now']}, sources[1]]), dict(payload, newSources=[*sources, {'user': chat_smoke.IMPORT_TEXTS[2]}])]:
            with self.assertRaisesRegex(ValueError, 'original user/context date'):
                chat_smoke.memory_response(body(changed))

    def test_import_seed_requires_stopped_exclusive_off_copy_and_preserves_originals(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            database = root / 'trainer.sqlite'
            with contextlib.closing(sqlite3.connect(database)) as db:
                db.executescript('create table summary_control(id,enabled); insert into summary_control values(1,0); create table conversation_history_control(id,privacy_generation); insert into conversation_history_control values(1,0); create table conversation(id,title,created_at,updated_at); create table message(id,conversation_id,role,content,created_at); create table conversation_turn(turn_id,conversation_id,user_id,assistant_id,source_version,summary_eligible,status,boot_id,privacy_generation); create table conversation_completion(turn_id);')
                db.execute("insert into message values('original','original','user','Original bytes',100)")
                db.commit()
            run = SimpleNamespace(root=root, database=database, child=None)
            ids = chat_smoke.seed_import_dates(run)
            self.assertEqual(len(set(ids)), 3)
            with contextlib.closing(sqlite3.connect(database)) as db:
                self.assertEqual(db.execute("select content,created_at from message where id='original'").fetchone(), ('Original bytes',100))
                self.assertEqual(db.execute('select count(*) from conversation_completion').fetchone(), (3,))
                self.assertEqual(db.execute("select created_at from message where role='assistant' order by created_at").fetchall(), [(chat_smoke.IMPORT_TIME + n,) for n in [1000,3000,5000]])
                db.execute('update summary_control set enabled=1'); db.commit()
            with self.assertRaisesRegex(ValueError, 'memory Off'):
                chat_smoke.seed_import_dates(run)
            run.child = object()
            with self.assertRaisesRegex(ValueError, 'Stopped exclusive'):
                chat_smoke.seed_import_dates(run)
            run.child = None
            run.root = root / 'other'
            with self.assertRaisesRegex(ValueError, 'Stopped exclusive'):
                chat_smoke.seed_import_dates(run)

    def test_fixed_order_plain_text_and_extra_call_refusal(self):
        for index in [0, 4]:
            call = response(index, self.body())['tool_calls'][0]['function']
            self.assertEqual(call['name'], 'verifyActivityReference')
            self.assertEqual(json.loads(call['arguments']), {'garminId': 'weekdayHike'})
        for index in [1, 5]:
            self.assertEqual(response(index, self.body())['tool_calls'][0]['function']['name'], 'analyzeActivityTerrain')
        for index in [2, 6]:
            self.assertEqual(response(index, self.body())['tool_calls'][0]['function']['name'], 'getActivityDashboard')
        for index in [3, 7]:
            self.assertEqual(response(index, self.valid_body()), {'role': 'assistant', 'content': ANSWER})
        self.assertEqual(response(8, self.body()), {'role': 'assistant', 'content': FOLLOWUP})
        for index, body in [(9, self.body()), (3, self.body()), (0, {**self.body(), 'model': 'private'}), (0, {**self.body(), 'stream': True}), (0, {**self.body(), 'tools': [{'function': {'name': 'completeTrainerTurn'}}]})]:
            with self.assertRaises(ValueError):
                response(index, body)

    def valid_body(self):
        body = self.body('6543 4321 321 123 weekdayHike analyzeActivityTerrain succeeded getActivityDashboard succeeded available')
        dashboard = {'heartRateZones': {'status': 'available', 'timeSource': 'garmin_activity', 'sourceTotalSeconds': 999, 'activityDurationSec': 4321, 'classifiedSeconds': 900, 'buckets': [{'seconds': n} for n in [0, 90, 180, 270, 360]]}, 'terrain': {'status': 'available', 'sections': [{'meanGradePct': 10}]}}
        body['messages'].append({'role': 'tool', 'content': json.dumps({'evidence': 'Dashboard values and explicit limits: ' + json.dumps(dashboard)})})
        return body

    def test_legacy_text_and_native_single_carrier_both_preserve_values(self):
        body = self.valid_body()
        evidence = json.loads(body['messages'].pop()['content'])['evidence']
        body['messages'].append({'role': 'system', 'content': evidence + '\nTrailing ordinary policy remains independent.'})
        self.assertEqual(response(3, body)['content'], ANSWER)
        body['messages'].append({'role': 'tool', 'content': json.dumps({'evidence': evidence})})
        with self.assertRaisesRegex(ValueError, 'Exactly one'):
            response(3, body)

    def test_requires_actual_zone_values_complete_parity_and_no_route(self):
        body = self.valid_body()
        self.assertEqual(response(3, body)['content'], ANSWER)
        with self.assertRaisesRegex(ValueError, 'parity mismatch'):
            response(3, body, {'status': 'available'})
        for change in ['missing-zone', 'bad-value', 'route']:
            body = self.valid_body()
            output = json.loads(body['messages'][-1]['content'])
            dashboard = json.loads(output['evidence'].split('Dashboard values and explicit limits: ')[1])
            if change == 'missing-zone':
                dashboard['heartRateZones']['buckets'].pop()
            elif change == 'bad-value':
                dashboard['heartRateZones']['sourceTotalSeconds'] = 4321
            else:
                dashboard['route'] = {}
            output['evidence'] = 'Dashboard values and explicit limits: ' + json.dumps(dashboard)
            body['messages'][-1]['content'] = json.dumps(output)
            with self.assertRaises(ValueError):
                response(3, body)

    def test_finite_selected_image_wire_and_no_later_replay(self):
        body = self.valid_body()
        body['model'] = chat_smoke.VISION_MODEL
        call = response(2, self.body() | {'model': chat_smoke.VISION_MODEL}, activity_images=True)['tool_calls'][0]['function']
        self.assertEqual(json.loads(call['arguments'])['panels'], chat_smoke.PANELS)
        # Header-only unit fixture is serialization validation, never renderer proof.
        raw = b'\x89PNG\r\n\x1a\n' + bytes(8) + (960).to_bytes(4, 'big') + (540).to_bytes(4, 'big') + bytes(9)
        parts = []
        for panel in chat_smoke.PANELS:
            parts += [{'type': 'text', 'text': 'Current-turn ' + panel + ' image for activity weekdayHike, call authored-2'}, {'type': 'image_url', 'image_url': {'url': 'data:image/png;base64,' + base64.b64encode(raw).decode()}}]
        body['messages'].append({'role': 'user', 'content': parts})
        self.assertEqual(response(3, body, activity_images=True)['content'], ANSWER)
        for index in [0, 2, 8]:
            with self.assertRaisesRegex(ValueError, 'outside admitted'):
                response(index, body, activity_images=True)
        body['messages'][-1]['content'][0]['text'] = 'Current-turn route image for activity other, call authored-2'
        with self.assertRaisesRegex(ValueError, 'binding'):
            response(3, body, activity_images=True)
        body['messages'].pop()
        with self.assertRaisesRegex(ValueError, 'four'):
            response(3, body, activity_images=True)

    def test_actual_loopback_protocol_and_owned_shutdown(self):
        provider = AuthoredProvider()
        client = http.client.HTTPConnection('127.0.0.1', provider.server.server_address[1], timeout=2)
        try:
            client.request('POST', '/private', '{}')
            reply = client.getresponse()
            self.assertEqual(reply.status, 400)
            reply.read()
            client.request('POST', '/v1/chat/completions', json.dumps(self.body()), {'Content-Type': 'application/json'})
            reply = client.getresponse()
            self.assertEqual(reply.status, 200)
            self.assertEqual(json.loads(reply.read())['choices'][0]['finish_reason'], 'tool_calls')
            self.assertEqual(provider.calls, [{'tool': 'verifyActivityReference', 'ordinaryText': False}])
        finally:
            client.close()
            provider.stop()
        self.assertFalse(provider.thread.is_alive())

    def test_runner_binds_existing_preparation_signature_before_native_use(self):
        self.addCleanup(os.umask, os.umask(0o077))
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            observed = []
            def preparation(repo, bundle, source, scratch):
                observed.append((repo, bundle, source, scratch))
                raise ValueError('stop before native')
            def prepare(scratch, args, scenario):
                self.assertEqual((args.input_file, args.grant_file, args.provenance_file, args.anchor), (None, None, None, None))
                self.assertEqual(scenario, 'ordinary')
                return object()
            with patch('sys.argv', ['chat_smoke.py', '--scratch', str(root), '--bundle', str(root)]), patch.object(chat_smoke.resources, 'configure', side_effect=lambda path: path), patch.object(chat_smoke, 'prepare', side_effect=prepare), patch.object(chat_smoke, 'source_identity', return_value='authored-source'), patch.object(chat_smoke, 'ordinary_preparation', side_effect=preparation):
                with self.assertRaisesRegex(ValueError, 'stop before native'):
                    chat_smoke.main.__wrapped__()
            self.assertEqual(observed[0][1:], (root, 'authored-source', root))

    def test_seed_only_stopped_run_copy_and_preserve_keyless_settings(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'config').mkdir()
            settings = root / 'config/settings-v2.json'
            settings.write_text(json.dumps({'version': 2, 'keys': {}, 'fields': {}}))
            database = root / 'trainer.sqlite'
            with contextlib.closing(sqlite3.connect(database)) as db:
                db.execute('create table activity(id,garmin_id,name,sport,started_at,duration_sec,distance_meters,elevation_gain_meters,avg_heart_rate)')
                db.execute('create table activity_stream_point(garmin_id,elapsed_sec,timestamp,distance_meters,altitude_meters,heart_rate)')
                db.execute('create table activity_hr_zone_time(garmin_id,zone,fetched_at,source,status,seconds,source_lower_bpm,source_total_seconds)')
            run = SimpleNamespace(root=root, database=database, child=None)
            provider = SimpleNamespace(server=SimpleNamespace(server_address=('127.0.0.1', 12345)))
            seed_run(run, provider)
            self.assertTrue((root / 'prepared-keyless-settings.json').exists())
            self.assertEqual(json.loads(settings.read_text())['fields']['OLLAMA_BASE_URL'], 'http://127.0.0.1:12345/v1')
            with contextlib.closing(sqlite3.connect(database)) as db:
                self.assertEqual(db.execute('select count(*) from activity_stream_point').fetchone()[0], 101)
                self.assertEqual(db.execute('select duration_sec,distance_meters from activity').fetchone(), (4321, 6543))
                self.assertEqual(db.execute('select seconds from activity_hr_zone_time order by zone').fetchall(), [(0,), (90,), (180,), (270,), (360,)])
            run.child = object()
            with self.assertRaises(ValueError):
                seed_run(run, provider)


if __name__ == '__main__':
    unittest.main()
