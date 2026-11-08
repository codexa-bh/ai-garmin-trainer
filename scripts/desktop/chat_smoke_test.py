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
