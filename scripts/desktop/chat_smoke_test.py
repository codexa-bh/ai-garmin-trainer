"""Before-use finite authored chat provider/seed/serialization contracts, no native launch."""
import contextlib
import http.client
import json
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
        return {'model': MODEL, 'messages': [{'role': 'user', 'content': evidence}], 'tools': [{'function': {'name': name}} for name in ['verifyActivityReference', 'analyzeActivityTerrain']]}

    def test_fixed_order_plain_text_and_extra_call_refusal(self):
        for index in [0, 3]:
            call = response(index, self.body())['tool_calls'][0]['function']
            self.assertEqual(call['name'], 'verifyActivityReference')
            self.assertEqual(json.loads(call['arguments']), {'garminId': 'weekdayHike'})
        for index in [1, 4]:
            self.assertEqual(response(index, self.body())['tool_calls'][0]['function']['name'], 'analyzeActivityTerrain')
        evidence = '6543 4321 321 123 weekdayHike analyzeActivityTerrain succeeded available'
        for index in [2, 5]:
            self.assertEqual(response(index, self.body(evidence)), {'role': 'assistant', 'content': ANSWER})
        self.assertEqual(response(6, self.body()), {'role': 'assistant', 'content': FOLLOWUP})
        for index, body in [(7, self.body()), (2, self.body()), (0, {**self.body(), 'model': 'private'}), (0, {**self.body(), 'stream': True}), (0, {**self.body(), 'tools': [{'function': {'name': 'completeTrainerTurn'}}]})]:
            with self.assertRaises(ValueError):
                response(index, body)

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
            run = SimpleNamespace(root=root, database=database, child=None)
            provider = SimpleNamespace(server=SimpleNamespace(server_address=('127.0.0.1', 12345)))
            seed_run(run, provider)
            self.assertTrue((root / 'prepared-keyless-settings.json').exists())
            self.assertEqual(json.loads(settings.read_text())['fields']['OLLAMA_BASE_URL'], 'http://127.0.0.1:12345/v1')
            with contextlib.closing(sqlite3.connect(database)) as db:
                self.assertEqual(db.execute('select count(*) from activity_stream_point').fetchone()[0], 101)
                self.assertEqual(db.execute('select duration_sec,distance_meters from activity').fetchone(), (4321, 6543))
            run.child = object()
            with self.assertRaises(ValueError):
                seed_run(run, provider)


if __name__ == '__main__':
    unittest.main()
