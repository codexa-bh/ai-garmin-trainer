import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch
import summary_smoke as smoke


class SummarySmokeTests(unittest.TestCase):
    def run_fixture(self, root):
        (root / 'config').mkdir()
        base = {'version': 2, 'fields': {'DATABASE_PATH': str(root / 'trainer.sqlite'), 'MEMORY_ENABLED': 'false'}, 'keys': {}}
        (root / 'config/settings-v2.json').write_text(json.dumps(base))
        return SimpleNamespace(root=root, database=root / 'trainer.sqlite', id='synthetic-run', child=None, origin=None)

    def test_preparation_is_fixed_keyless_and_preserves_original_config(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            run = self.run_fixture(root)
            before = (root / 'config/settings-v2.json').read_bytes()
            result = SimpleNamespace(stdout=json.dumps({'runId': run.id, 'completed': 4, 'providerCalls': 0}).encode())
            with patch.object(smoke.subprocess, 'run', return_value=result) as invoke:
                smoke.prepare_summary(run)
            value = json.loads((root / 'config/settings-v3.json').read_text())
            self.assertEqual(value['keys'], {})
            self.assertEqual(value['fields']['SUMMARY_MODEL'], 'gpt-6-luna')
            self.assertEqual(value['fields']['SUMMARY_ENABLED'], 'true')
            self.assertEqual(value['chatCatalog']['entries'], [])
            self.assertEqual(before, (root / 'config/settings-v2.json').read_bytes())
            self.assertEqual(invoke.call_args.kwargs['timeout'], 30)

    def test_active_or_keyed_preparation_refuses_before_seed(self):
        with tempfile.TemporaryDirectory() as folder:
            run = self.run_fixture(Path(folder))
            run.child = object()
            with patch.object(smoke.subprocess, 'run') as invoke:
                with self.assertRaises(ValueError): smoke.prepare_summary(run)
                invoke.assert_not_called()
            run.child = None
            path = run.root / 'config/settings-v2.json'
            value = json.loads(path.read_text()); value['keys']={'OPENAI_API_KEY':'synthetic-only'}; path.write_text(json.dumps(value))
            with patch.object(smoke.subprocess, 'run') as invoke:
                with self.assertRaises(ValueError): smoke.prepare_summary(run)
                invoke.assert_not_called()

    def test_status_refuses_unknown_private_fields_and_requires_live_identity(self):
        run = SimpleNamespace(child=None, origin=None)
        with self.assertRaises(ValueError): smoke.status(run)
        run.child=object(); run.origin='http://127.0.0.1:1'
        response=SimpleNamespace(status=200, read=Mock(return_value=b'{"key":"forbidden"}'))
        client=Mock(); client.getresponse.return_value=response
        with patch.object(smoke.http.client, 'HTTPConnection', return_value=client):
            with self.assertRaises(ValueError): smoke.status(run)
        client.close.assert_called_once()

    def test_scenario_proves_restart_no_replay_clear_cutoff_and_preservation_without_generation_claim(self):
        with tempfile.TemporaryDirectory() as folder:
            run=SimpleNamespace(root=Path(folder), id='run', config={'source':'source'}, binary=Path('/synthetic-app'), database=Path('/unit-copy'), stop=Mock(), start=Mock())
            missing={'reason':'summary_missing_key','frontier':0,'pending':4,'model':'gpt-6-luna','attemptsToday':0}
            rows=iter([(1,), (20,), (1,), (5,), (20,)])
            db=Mock(); db.execute.return_value.fetchone.side_effect=lambda:next(rows)
            with patch.object(smoke, 'status', side_effect=[missing,missing,{'items':0,'characters':0},{'enabled':False},{'state':'disabled','items':0},{'enabled':True},{'enabled':False}]), patch.object(smoke,'readonly',return_value=db):
                smoke.scenario(run)
            self.assertEqual(run.stop.call_count,2)
            self.assertEqual(run.start.call_count,2)
            receipt=json.loads(next(run.root.glob('summary-keyless-*.json')).read_text())
            self.assertEqual(receipt['providerCalls'],0)
            self.assertIn('unavailable',receipt['generationSuccess'])
