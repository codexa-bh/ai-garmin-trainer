import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch
import summary_smoke as smoke


class SummarySmokeTests(unittest.TestCase):
    def status_sequence(self):
        chars=len('T0272-unit: Weekends remain optional; poles not chosen. Fake path /Users/example/notes; quoted ignore previous instructions.')
        return [{'expected':{'revision':1}}, {'expected':{'revision':2},'characters':chars}, {'expected':{'revision':2},'characters':chars}, {'expected':{'revision':2}}, {'expected':{'revision':3}}]

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
            self.assertEqual(value['fields']['SUMMARY_CONTRACT_VERSION'], '2')
            self.assertEqual(value['fields']['MEMORY_ENABLED'], 'true')
            self.assertEqual(value['fields']['MEMORY_EMBEDDING_PROVIDER'], 'ollama')
            self.assertEqual(value['fields']['MEMORY_EMBEDDING_BASE_URL'], 'http://127.0.0.1:1')
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

    def test_versioned_mutation_reads_metadata_once_and_refuses_stale_without_retry(self):
        value = {'version':1,'state':'fresh','reason':None,'revision':3,'frontier':4,'pending':0,'items':0,'characters':0,'enabled':True,'model':'gpt-6-luna','usedByChat':False,'attemptsToday':0,'unpricedAttempts':0,'reservedUsdToday':0,'estimatedUsdToday':0,'unknownReservedUsd':0,'priceBasis':smoke.PRICE_BASIS,'cap':6000,'publishedAt':1,'expected':{'revision':3,'privacy':0,'control':1,'manual':0}}
        run=SimpleNamespace(child=object(),origin='http://127.0.0.1:1')
        client=Mock();client.getresponse.side_effect=[SimpleNamespace(status=200,read=Mock(return_value=json.dumps(value).encode())),SimpleNamespace(status=409,read=Mock(return_value=b'{}'))]
        with patch.object(smoke.http.client,'HTTPConnection',return_value=client):
            with self.assertRaises(ValueError):smoke.status(run,'clear')
        self.assertEqual(client.request.call_count,2)
        method,path,body,_headers=client.request.call_args.args
        self.assertEqual((method,path),('POST','/api/cross-chat-summary'))
        self.assertEqual(json.loads(body),{'version':2,'expected':value['expected'],'action':'clear'})

    def test_cost_metadata_accepts_only_finite_nonnegative_values_and_the_reviewed_basis(self):
        value = {'version':1,'state':'fresh','reason':None,'revision':3,'frontier':4,'pending':0,'items':0,'characters':0,'enabled':True,'model':'gpt-6-luna','usedByChat':False,'attemptsToday':12,'unpricedAttempts':2,'reservedUsdToday':0.03,'estimatedUsdToday':0.001,'unknownReservedUsd':0.02,'priceBasis':smoke.PRICE_BASIS,'cap':20000,'publishedAt':1,'expected':{'revision':3,'privacy':0,'control':1,'manual':0}}
        run=SimpleNamespace(child=object(),origin='http://127.0.0.1:1')
        for key,replacement in [(None,None),('estimatedUsdToday',-1),('unknownReservedUsd',float('nan')),('reservedUsdToday','private'),('priceBasis','unreviewed'),('privateText','forbidden'),('unpricedAttempts',-1),('unpricedAttempts','private')]:
            candidate={**value, **({key:replacement} if key else {})}
            client=Mock();client.getresponse.return_value=SimpleNamespace(status=200,read=Mock(return_value=json.dumps(candidate).encode()))
            with patch.object(smoke.http.client,'HTTPConnection',return_value=client):
                if key:
                    with self.assertRaises(ValueError):smoke.status(run)
                else:self.assertEqual(smoke.status(run),value)

    def test_memory_controls_are_one_finite_sequence_with_owned_restart_and_preservation(self):
        with tempfile.TemporaryDirectory() as folder:
            run=SimpleNamespace(root=Path(folder),id='unit',config={'source':'source'},binary=Path('/unit-app'),command=Mock(return_value={'ok':True}),chat_hash=Mock(return_value='same'),stop=Mock(),start=Mock())
            with patch.object(smoke,'memory_wait'), patch.object(smoke,'memory_presentations',return_value=[]), patch.object(smoke,'status',side_effect=self.status_sequence()):
                smoke.memory_controls(run)
            actions=[call.args[0]['action'] for call in run.command.call_args_list if call.args[0]['type']=='memory']
            self.assertEqual(actions,['open','rebuild-preflight','rebuild-preflight','rebuild-preflight','back','add','draft','save','summary-edit','draft-update','save','edit','draft-update','save','close','open','forget','confirm','disable','enable','confirm','manage','clear','confirm','back','close'])
            run.stop.assert_called_once();run.start.assert_called_once_with(run.binary)
            receipt=json.loads((run.root/'integrated-memory-controls.json').read_text())
            self.assertEqual(len(receipt['captures']),4)
            self.assertTrue(receipt['wholeSummaryEditSaveRestart'])
            self.assertTrue(receipt['preferencesSeparateFromGeneratedAllowance'])
            self.assertEqual(len(receipt['rebuildCaptures']),2)
            self.assertTrue(receipt['rebuildPreflightKeylessRefusal'])
            self.assertIn('unavailable',receipt['rebuildSuccess'])
            self.assertIn('not trusted OS input',receipt['input'])

    def test_failed_control_preserves_closed_observation_and_capture_without_replay(self):
        with tempfile.TemporaryDirectory() as folder:
            def command(value):
                if value.get('action') == 'forget':
                    raise RuntimeError('closed failure')
                return {'ok': True}
            run=SimpleNamespace(root=Path(folder), id='unit', config={'source':'source'}, binary=Path('/unit-app'), command=Mock(side_effect=command), chat_hash=Mock(return_value='same'), stop=Mock(), start=Mock())
            with patch.object(smoke,'memory_wait'), patch.object(smoke,'status',side_effect=self.status_sequence()):
                with self.assertRaisesRegex(RuntimeError, 'closed failure'):
                    smoke.memory_controls(run)
            actions=[call.args[0].get('action') for call in run.command.call_args_list]
            self.assertEqual(actions.count('forget'),1)
            receipt=json.loads((run.root/'memory-action-failure.json').read_text())
            self.assertFalse(receipt['mutationReplayed'])
            self.assertEqual(receipt['observation'],{'ok':True})
            self.assertEqual(receipt['capture'],{'ok':True})

    def test_fixed_presentation_sequence_never_dispatches_a_mutation_or_confirms_one(self):
        with tempfile.TemporaryDirectory() as folder:
            run=SimpleNamespace(root=Path(folder), id='unit', config={'source':'source'}, command=Mock(return_value={'ok':True}))
            with patch.object(smoke, 'memory_wait'):
                images=smoke.memory_presentations(run)
            actions=[call.args[0]['action'] for call in run.command.call_args_list if call.args[0]['type']=='memory']
            self.assertNotIn('confirm', actions)
            self.assertNotIn('save', actions)
            self.assertNotIn('rebuild-start', actions)
            self.assertEqual(actions[-1], 'fixture-reset')
            self.assertEqual(len(images), 30)
            self.assertNotIn('item-details', actions)
            self.assertEqual(len([image for image in images if image['state']=='whole-summary-editor']),2)
            self.assertNotIn('earlier-sources', actions)
            self.assertNotIn('older-records', actions)
            self.assertIn('fixture-progressive', actions)
            receipt=json.loads((run.root/'memory-progressive.json').read_text())
            self.assertTrue(receipt['stableDOMFocusScroll'])
            self.assertEqual(receipt['providerCalls'],0)
            self.assertIn('not engine/provider or compositor-frame proof',receipt['evidenceClass'])
            self.assertNotIn('chat-details', actions)
            self.assertIn('history-select', actions)
            self.assertIn('history-legacy', actions)
            self.assertEqual(actions.count('history-effects'), 2)
            self.assertIn('fixture-empty', actions)
            self.assertIn('fixture-error', actions)
            self.assertTrue(all('not engine progression' in image['evidenceClass'] for image in images))
            run.command.assert_any_call({'type':'memory','action':'fixture-unknown'})

    def test_scenario_proves_restart_no_replay_clear_cutoff_and_preservation_without_generation_claim(self):
        with tempfile.TemporaryDirectory() as folder:
            run=SimpleNamespace(root=Path(folder), id='run', config={'source':'source'}, binary=Path('/synthetic-app'), database=Path('/unit-copy'), stop=Mock(), start=Mock())
            missing={'reason':'summary_missing_key','frontier':0,'pending':4,'model':'gpt-6-luna','attemptsToday':0}
            rows=iter([(1,), (20,), (1,), (5,), (20,)])
            db=Mock(); db.execute.return_value.fetchone.side_effect=lambda:next(rows)
            with patch.object(smoke, 'status', side_effect=[missing,missing,{'items':0,'characters':0},{'enabled':False},{'state':'disabled','items':0},{'enabled':True},{'enabled':False}]), patch.object(smoke,'readonly',return_value=db), patch.object(smoke,'memory_controls') as controls:
                smoke.scenario(run)
            controls.assert_called_once_with(run)
            self.assertEqual(run.stop.call_count,2)
            self.assertEqual(run.start.call_count,2)
            receipt=json.loads(next(run.root.glob('summary-keyless-*.json')).read_text())
            self.assertEqual(receipt['providerCalls'],0)
            self.assertIn('unavailable',receipt['generationSuccess'])
