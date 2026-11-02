import ast
import json
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch
from history_connector import SENTINEL, admitted, reply
from history_smoke import HistoryRun, prepare_synthetic_history
from native_smoke import private_json


class SyntheticHistoryContracts(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name).resolve()
        self.root.chmod(0o700)
        (self.root / 'config').mkdir(mode=0o700)
        private_json(self.root / 'config/settings-v3.json', {'version':3, 'fields':{}, 'keys':{}})
        self.run = SimpleNamespace(root=self.root, child=None, config={'port':1})

    def tearDown(self):
        self.temporary.cleanup()

    def prepare(self):
        with patch('history_smoke.listening', return_value=False):
            prepare_synthetic_history(self.run)

    def test_only_stopped_keyless_owned_settings_select_the_authored_connector(self):
        original = json.loads((self.root / 'config/settings-v3.json').read_text())
        self.prepare()
        saved = json.loads((self.root / 'config/settings-v3.json').read_text())
        self.assertEqual(saved['keys'], {})
        self.assertEqual(saved['fields']['GARMIN_MCP_TOKEN_DIR'], str(self.root / 'tokens'))
        self.assertTrue(admitted(self.root))
        self.assertEqual((self.root / 'tokens/garmin_tokens.json').read_bytes(), SENTINEL)
        self.assertEqual(original['fields'], {})
        with self.assertRaises(ValueError):
            self.prepare()
        tree = ast.parse((self.root / 'synthetic_history_connector.py').read_text())
        imports = {node.names[0].name for node in ast.walk(tree) if isinstance(node, ast.Import)}
        self.assertEqual(imports, {'json', 'os', 'stat', 'sys'})
        self.assertFalse(any(isinstance(node, ast.ImportFrom) and node.module not in ('pathlib',) for node in ast.walk(tree)))

    def test_preconfigured_secret_or_live_child_refuses_without_outputs(self):
        for saved in [{'keys':{'OPENAI_API_KEY':'never-open'}, 'fields':{}}, {'keys':{}, 'fields':{'GARMIN_MCP_TOKEN_DIR':'never-open'}}]:
            path = self.root / 'config/settings-v3.json'
            path.write_text(json.dumps(saved))
            with self.assertRaises(ValueError):
                self.prepare()
            self.assertFalse((self.root / 'tokens').exists())
        self.run.child = object()
        with self.assertRaises(ValueError):
            self.prepare()

    def test_alias_insecure_or_changed_sentinel_cannot_be_used_as_real_tokens(self):
        self.prepare()
        token = self.root / 'tokens/garmin_tokens.json'
        token.chmod(0o644)
        self.assertFalse(admitted(self.root))
        token.chmod(0o600)
        token.write_bytes(b'not the authored sentinel')
        self.assertFalse(admitted(self.root))
        token.write_bytes(SENTINEL)
        os.link(token, self.root / 'hardlink')
        self.assertFalse(admitted(self.root))

    def test_closed_protocol_and_fit_reply_cannot_trigger_real_supplements(self):
        def tool(name, args):
            return reply({'method':'tools/call', 'params':{'name':name, 'arguments':args}})
        fit = json.loads(tool('get_activity_fit_data', {'activity_id':'synthetic', 'include_records':False})['content'][0]['text'])
        self.assertIn('zones_target', fit)
        self.assertEqual(fit['records'], [])
        weekly = json.loads(tool('get_weekly_steps', {'end_date':'2026-09-07', 'weeks':52})['content'][0]['text'])
        self.assertEqual(weekly['weekly_data'], [])
        for name in ('login', 'set_weight', 'fetch', 'private'):
            with self.assertRaises(ValueError):
                tool(name, {})
        with self.assertRaises(ValueError):
            reply({'method':'tools/call', 'params':{'name':'get_stats', 'arguments':{}, 'extra':'private'}})

    def test_two_explicit_operations_cancel_and_restart_without_passive_replay(self):
        active, checks = False, 0
        commands = []
        def command(value):
            nonlocal active, checks
            commands.append(value)
            if value.get('action') in ('start', 'continue'):
                self.assertFalse(active)
                active = True
            elif value.get('action') == 'cancel':
                active = False
                checks += 12
            return {'ok':True, 'capture':'unit-only.png'}
        def summary():
            return {'active':active, 'outcome':'running' if active else 'cancelled', 'healthChecks':checks, 'batches':2 if active else 0, 'operationAttempts':90}
        run = SimpleNamespace(root=self.root, config={'source':'unit'}, boot='unit', binary=Path('/unit'), command=command,
                              wait=Mock(), wait_sync=Mock(), summary=summary, settle_claim=Mock(), stop=Mock(), start=Mock())
        HistoryRun.synthetic_sync(run)
        self.assertEqual(sum(value.get('action') == 'start' for value in commands), 1)
        self.assertEqual(sum(value.get('action') == 'continue' for value in commands), 1)
        self.assertEqual(sum(value.get('action') == 'cancel' for value in commands), 2)
        self.assertEqual(run.stop.call_count, 2)
        evidence = json.loads((self.root / 'synthetic-sync.json').read_text())
        self.assertFalse(evidence['realGarminCertified'])
        self.assertEqual(len(evidence['captures']), 6)
        self.assertEqual(evidence['settled'][-1]['after']['healthChecks'], 24)


if __name__ == '__main__':
    unittest.main()
