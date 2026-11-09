import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch
import summary_smoke as smoke


class SummarySmokeTests(unittest.TestCase):
    @staticmethod
    def command_result(value):
        if value.get('action') == 'native-copy':
            return {'ok': True, 'nativeResponder': True, 'exactAuthoredCopy': True, 'hardwareInput': False}
        return {'ok': True}

    def status_sequence(self):
        chars=6578  # Fixed authored whole-summary draft above the6000 target.
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
            run.command.side_effect = self.command_result
            with patch.object(smoke,'memory_wait'), patch.object(smoke,'memory_presentations',return_value=[]), patch.object(smoke,'status',side_effect=self.status_sequence()):
                smoke.memory_controls(run, native_copy=True)
            actions=[call.args[0]['action'] for call in run.command.call_args_list if call.args[0]['type']=='memory']
            self.assertEqual(actions,['open','rebuild-preflight','rebuild-preflight','rebuild-preflight','back','add','draft','save','summary-edit','draft-update','native-copy','editor-check','editor-check','save','summary-collapsed','summary-show','summary-expanded','close','open','summary-expanded','edit','draft-update','save','close','open','summary-collapsed','forget','confirm','disable','enable','confirm','manage','clear','confirm','back','close'])
            run.stop.assert_called_once();run.start.assert_called_once_with(run.binary)
            receipt=json.loads((run.root/'integrated-memory-controls.json').read_text())
            self.assertEqual(len(receipt['captures']),8)
            self.assertEqual(json.loads((run.root/'summary-native-copy.json').read_text()), self.command_result({'action':'native-copy'}))
            self.assertTrue(receipt['wholeSummaryEditSaveRestart'])
            self.assertTrue(receipt['preferencesSeparateFromGeneratedAllowance'])
            self.assertEqual(len(receipt['rebuildCaptures']),2)
            self.assertTrue(receipt['rebuildPreflightKeylessRefusal'])
            self.assertIn('unavailable',receipt['rebuildSuccess'])
            self.assertIn('not trusted OS input',receipt['input'])

    def test_native_copy_failure_is_not_replayed_or_followed_by_save(self):
        with tempfile.TemporaryDirectory() as folder:
            run=SimpleNamespace(root=Path(folder), id='unit', config={'source':'source'}, binary=Path('/unit-app'), command=Mock(return_value={'ok': True}), chat_hash=Mock(return_value='same'))
            with patch.object(smoke,'memory_wait'), patch.object(smoke,'status',side_effect=self.status_sequence()):
                with self.assertRaisesRegex(ValueError, 'Native authored summary copy equality missing'):
                    smoke.memory_controls(run, native_copy=True)
            actions=[call.args[0].get('action') for call in run.command.call_args_list]
            self.assertEqual(actions.count('native-copy'), 1)
            self.assertEqual(actions.count('save'), 1)  # Earlier preference only, not summary.
            self.assertNotIn('editor-check', actions)

    def test_failed_control_preserves_closed_observation_and_capture_without_replay(self):
        with tempfile.TemporaryDirectory() as folder:
            def command(value):
                if value.get('action') == 'forget':
                    raise RuntimeError('closed failure')
                return self.command_result(value)
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
            self.assertEqual(len(images), 42)
            for name in ('densify-ready', 'densify-review', 'densify-accepted', 'densify-no-reduction', 'densify-busy'):
                self.assertEqual(len([image for image in images if image['state'] == name]), 2)
            self.assertEqual(actions.count('densify'), 1)
            self.assertEqual(actions.count('densify-accept'), 1)
            self.assertEqual(actions.count('densify-cancel'), 1)
            self.assertEqual(actions.count('densify-discard'), 1)
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

    def test_lifecycle_only_keeps_real_controls_without_fixed_presentations(self):
        with tempfile.TemporaryDirectory() as folder:
            run=SimpleNamespace(root=Path(folder),id='unit',config={'source':'source'},binary=Path('/unit-app'),command=Mock(return_value={'ok':True}),chat_hash=Mock(return_value='same'),stop=Mock(),start=Mock())
            run.command.side_effect = self.command_result
            with patch.object(smoke,'memory_wait'), patch.object(smoke,'memory_presentations') as presentations, patch.object(smoke,'status',side_effect=self.status_sequence()):
                smoke.memory_controls(run, presentation_families=())
            presentations.assert_not_called()
            actions=[call.args[0]['action'] for call in run.command.call_args_list if call.args[0]['type']=='memory']
            for action in ('summary-edit', 'save', 'forget', 'clear', 'enable', 'disable'):
                self.assertIn(action, actions)
            self.assertFalse(any(action.startswith('fixture-') for action in actions))
            self.assertNotIn('native-copy', actions)
            self.assertFalse((run.root / 'summary-native-copy.json').exists())
            receipt=json.loads((run.root/'integrated-memory-controls.json').read_text())
            self.assertEqual(receipt['presentationCaptures'], [])
            run.start.assert_called_once()

    def test_selected_families_have_local_prerequisites_and_reset_before_next_family(self):
        expected = {'densify': (10, 'fixture-densify-ready'), 'overview': (13, 'fixture-populated'), 'history': (19, 'fixture-history')}
        for family, (count, first) in expected.items():
            with self.subTest(family=family), tempfile.TemporaryDirectory() as folder:
                run=SimpleNamespace(root=Path(folder),id='unit',config={'source':'source'},command=Mock(return_value={'ok':True}))
                with patch.object(smoke,'memory_wait') as waits:
                    images=smoke.presentation_scenario(run, (family,))
                close_waits = [call.args[1] for call in waits.call_args_list if call.args[2].startswith('closed sheet')]
                self.assertEqual(len(close_waits), 2)
                for predicate in close_waits:
                    self.assertFalse(predicate({'visible': True}))
                    self.assertTrue(predicate({'visible': False}))
                actions=[call.args[0]['action'] for call in run.command.call_args_list if call.args[0]['type']=='memory']
                self.assertEqual(actions[:2], ['open', first])
                # Family entry must restore wide geometry before the real desktop
                # Memory button; narrow has only the separately closed mobile menu.
                self.assertEqual(run.command.call_args_list[0].args[0], {'type':'setViewport', 'preset':'wide'})
                self.assertEqual(run.command.call_args_list[1].args[0], {'type':'memory', 'action':'open'})
                self.assertEqual(actions[-2:], ['fixture-reset', 'close'])
                self.assertEqual(len(images), count)
                self.assertNotIn('confirm', actions); self.assertNotIn('save', actions)
                other_firsts = {value[1] for name, value in expected.items() if name != family}
                self.assertFalse(other_firsts.intersection(actions))
                receipt=json.loads(next(run.root.glob('summary-presentation-*.json')).read_text())
                self.assertIn('not engine progression', receipt['evidenceClass'])
        with tempfile.TemporaryDirectory() as folder:
            run=SimpleNamespace(root=Path(folder),id='unit',config={'source':'source'},command=Mock(return_value={'ok':True}))
            with patch.object(smoke,'memory_wait'):
                smoke.memory_presentations(run)
            actions=[call.args[0]['action'] for call in run.command.call_args_list if call.args[0]['type']=='memory']
            self.assertEqual(actions.count('fixture-reset'), 3)
            self.assertLess(actions.index('fixture-reset'), actions.index('fixture-populated'))

    def test_presentation_failure_resets_and_closes_without_mutation_retry_or_false_receipt(self):
        with tempfile.TemporaryDirectory() as folder:
            def command(value):
                if value.get('action') == 'densify':
                    raise RuntimeError('unknown effect retained')
                return {'ok':True}
            run=SimpleNamespace(root=Path(folder),id='unit',config={'source':'source'},command=Mock(side_effect=command))
            with patch.object(smoke,'memory_wait'), self.assertRaisesRegex(RuntimeError,'unknown effect retained'):
                smoke.presentation_scenario(run, ('densify',))
            actions=[call.args[0]['action'] for call in run.command.call_args_list if call.args[0]['type']=='memory']
            self.assertEqual(actions.count('densify'),1)
            self.assertEqual(actions[-2:], ['fixture-reset', 'close'])
            self.assertEqual(list(run.root.glob('summary-presentation-*.json')), [])

    def test_partial_presentation_setup_closes_and_preserves_primary_failure(self):
        with tempfile.TemporaryDirectory() as folder:
            def command(value):
                if value.get('action') == 'close':
                    raise RuntimeError('secondary close failed')
                return {'ok': True}
            run = SimpleNamespace(root=Path(folder), command=Mock(side_effect=command))
            def wait(_run, _predicate, label):
                if label == 'actual inspection before presentation':
                    raise TimeoutError('initial inspection unknown')
            with patch.object(smoke, 'memory_wait', side_effect=wait), self.assertRaisesRegex(TimeoutError, 'initial inspection unknown'):
                smoke.presentation_scenario(run, ('densify',))
            actions = [call.args[0].get('action') for call in run.command.call_args_list]
            self.assertEqual(actions, [None, 'open', 'close'])
            self.assertEqual(list(run.root.glob('summary-presentation-*.json')), [])

    def test_unknown_or_duplicate_family_refuses_before_any_fixture(self):
        run=SimpleNamespace(command=Mock())
        for families in [('unknown',), ('densify','densify')]:
            with self.assertRaises(ValueError):
                smoke.memory_presentations(run, families)
        run.command.assert_not_called()

    def test_scenario_proves_restart_no_replay_clear_cutoff_and_preservation_without_generation_claim(self):
        with tempfile.TemporaryDirectory() as folder:
            run=SimpleNamespace(root=Path(folder), id='run', config={'source':'source'}, binary=Path('/synthetic-app'), database=Path('/unit-copy'), stop=Mock(), start=Mock())
            missing={'reason':'summary_missing_key','frontier':0,'pending':4,'model':'gpt-6-luna','attemptsToday':0}
            rows=iter([(1,), (20,), (1,), (5,), (20,)])
            db=Mock(); db.execute.return_value.fetchone.side_effect=lambda:next(rows)
            with patch.object(smoke, 'status', side_effect=[missing,missing,{'items':0,'characters':0},{'enabled':False},{'state':'disabled','items':0},{'enabled':True},{'enabled':False}]), patch.object(smoke,'readonly',return_value=db), patch.object(smoke,'memory_controls') as controls:
                smoke.scenario(run)
            controls.assert_called_once_with(run, native_copy=False)
            self.assertEqual(run.stop.call_count,2)
            self.assertEqual(run.start.call_count,2)
            receipt=json.loads(next(run.root.glob('summary-keyless-*.json')).read_text())
            self.assertEqual(receipt['providerCalls'],0)
            self.assertIn('unavailable',receipt['generationSuccess'])
