import hashlib
import json
import os
from pathlib import Path
import tempfile
import unittest
from history_smoke import HistoryRun, copy_tokens, selected_tokens, tokens_unchanged
from native_smoke import private_json


class HistoryTokenContracts(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name).resolve()
        self.root.chmod(0o700)
        self.source = self.root / 'selected'
        self.source.mkdir(mode=0o700)
        self.token = self.source / 'garmin_tokens.json'
        self.token.write_bytes(b'synthetic unit data, not credentials')
        self.token.chmod(0o600)
        self.destination = self.root / 'owned-run'
        self.destination.mkdir(mode=0o700)
        self.selection = self.root / 'selection.json'
        private_json(self.selection, {'tokenDirectory': str(self.source), 'tokenFiles': ['garmin_tokens.json'],
                                     'purpose': 'T0238 private copied-token smoke only'})

    def tearDown(self):
        self.temporary.cleanup()

    def test_only_explicit_known_private_files_are_copied_without_original_mutation(self):
        directory, hashes = copy_tokens(self.selection, self.destination)
        target = self.destination / 'tokens/garmin_tokens.json'
        self.assertEqual(target.read_bytes(), self.token.read_bytes())
        self.assertEqual(target.stat().st_mode & 0o777, 0o600)
        self.assertEqual(target.stat().st_nlink, 1)
        self.assertEqual((self.destination / 'tokens').stat().st_mode & 0o777, 0o700)
        self.assertEqual(hashes['garmin_tokens.json'], hashlib.sha256(self.token.read_bytes()).hexdigest())
        self.assertTrue(tokens_unchanged(directory, hashes))
        target.write_bytes(b'copy-only token refresh simulation')
        self.assertTrue(tokens_unchanged(directory, hashes))

    def test_data_capture_follows_the_actual_existing_selection(self):
        from types import SimpleNamespace
        from unittest.mock import Mock, call
        run = SimpleNamespace(root=self.destination, descriptor={'historySetup':'use-existing'},
                              config={'source':'unit-only'}, boot='unit-only', binary=Path('/unit-only'),
                              setup_start=Mock(), settings_action=Mock(return_value={'ok':True}),
                              wait_settings=Mock(), wait_backend=Mock(), stop=Mock(), start=Mock())
        HistoryRun.onboarding(run)
        self.assertEqual(run.settings_action.call_args_list[:2], [call('useExisting'), call('capture')])
        run.wait_backend.assert_called_once()

    def test_failed_continuation_retains_cancel_and_captures_without_another_start(self):
        from types import SimpleNamespace
        from unittest.mock import Mock
        summary = {'active':False, 'outcome':'failed', 'operations':0, 'failureClass':'auth'}
        cancelled = {'failed':False, 'paused':True, 'running':False}
        failed = {'failed':True, 'paused':False, 'running':False}
        run = SimpleNamespace(root=self.destination, config={'source':'unit-only'}, boot='unit-only',
                              command=Mock(return_value={'ok':True, 'capture':'unit-only.png'}),
                              wait=Mock(), summary=Mock(return_value=summary), settle_claim=Mock(),
                              wait_sync=Mock(side_effect=[{'running':True}, cancelled,
                                                          {'startEnabled':True}, {'running':True, 'failed':False}, failed]))
        with self.assertRaisesRegex(ValueError, 'continuation failed'):
            HistoryRun.real_sync(run)
        commands = [call.args[0] for call in run.command.call_args_list]
        self.assertEqual(sum(c.get('action') == 'start' for c in commands), 1)
        self.assertEqual(sum(c.get('action') == 'continue' for c in commands), 1)
        self.assertEqual(len(run.sync_captures), 2)
        for name in ['real-sync-progress.json', 'real-sync-cancelled.json', 'real-sync-failure.json']:
            evidence = json.loads((self.destination/name).read_text())
            self.assertTrue(evidence['captures'])
        evidence = json.loads((self.destination/'real-sync-failure.json').read_text())
        self.assertEqual(evidence['cancelled'], cancelled)
        self.assertEqual(evidence['settled'][0]['summary']['failureClass'], 'auth')

    def test_selected_checkpoint_continuation_is_exactly_one_invocation(self):
        from types import SimpleNamespace
        from unittest.mock import Mock
        before = {'active':False, 'outcome':'failed', 'operations':50}
        after = {'active':False, 'outcome':'budget-limited', 'operations':96}
        run = SimpleNamespace(root=self.destination, config={'source':'unit-only'}, boot='unit-only',
                              command=Mock(return_value={'ok':True, 'capture':'unit-only.png'}), wait=Mock(),
                              summary=Mock(side_effect=[before, after]), settle_claim=Mock(),
                              wait_sync=Mock(side_effect=[{'startEnabled':True}, {'running':True,'failed':False},
                                                          {'running':False,'paused':True,'completed':False,'failed':False}]))
        HistoryRun.continue_once(run)
        actions = [call.args[0].get('action') for call in run.command.call_args_list]
        self.assertEqual(actions.count('continue'), 1)
        self.assertNotIn('start', actions)
        self.assertNotIn('cancel', actions)
        evidence=json.loads((self.destination/'single-continuation.json').read_text())
        self.assertEqual(evidence['maxInvocations'], 1)
        self.assertEqual(evidence['after'], after)
        self.assertEqual(len(evidence['captures']), 2)

    def test_active_or_missing_checkpoint_refuses_single_continuation(self):
        from types import SimpleNamespace
        from unittest.mock import Mock
        for summary in [{'active':True,'outcome':'failed'}, {'active':False,'outcome':None}]:
            run=SimpleNamespace(command=Mock(), wait=Mock(), summary=Mock(return_value=summary))
            with self.assertRaisesRegex(ValueError, 'prior discovery checkpoint'):
                HistoryRun.continue_once(run)
            self.assertFalse(any(call.args[0].get('action') == 'continue' for call in run.command.call_args_list))

    def test_native_setup_failure_is_retained_without_finish_replay(self):
        from types import SimpleNamespace
        from unittest.mock import Mock, call
        failure = 'Settings filename/version conflict; preserve originals and use a compatible build.'
        run = SimpleNamespace(root=self.destination, child=SimpleNamespace(poll=lambda:None),
                              http=Mock(return_value={'origin':None}), accept_identity=Mock(return_value=True),
                              settings_action=Mock(return_value={'setupFailure':failure}))
        with self.assertRaisesRegex(RuntimeError, 'filename/version conflict'):
            HistoryRun.wait_backend(run)
        self.assertEqual(run.settings_action.call_args_list, [call('observe')])
        evidence = json.loads((self.destination/'native-setup-failure.json').read_text())
        self.assertEqual(evidence['nativeStaticFailure'], failure)

    def test_backend_origin_alone_does_not_authorize_renderer_dispatch(self):
        from types import SimpleNamespace
        from unittest.mock import Mock
        origin = 'http://127.0.0.1:12346'
        run = SimpleNamespace(root=self.destination, child=SimpleNamespace(poll=lambda:None),
                              config={'port':12345}, launches=1,
                              http=Mock(side_effect=[{'origin':origin,'runtimeReady':False,'rendererDiagnostic':{'dashboard':True,'bootstrap':True,'ipc':True}},
                                                     {'origin':origin,'runtimeReady':True,'rendererDiagnostic':{'dashboard':True,'bootstrap':True,'ipc':True}}]),
                              accept_identity=Mock(return_value=True), settings_action=Mock(),
                              command=Mock(return_value={'dashboard':True,'hydrated':True}))
        HistoryRun.wait_backend(run)
        run.command.assert_called_once_with({'type':'observe'})
        run.settings_action.assert_not_called()
        self.assertTrue(json.loads((self.destination/'readiness-1.json').read_text())['rendererRoundTrip'])

    def test_insecure_alias_and_unknown_selections_are_refused(self):
        self.selection.chmod(0o644)
        with self.assertRaises(ValueError):
            selected_tokens(self.selection)
        self.selection.chmod(0o600)
        alias = self.root / 'alias.json'
        alias.symlink_to(self.selection)
        with self.assertRaises(ValueError):
            selected_tokens(alias)
        value = json.loads(self.selection.read_text())
        value['tokenFiles'].append('other-private-file')
        self.selection.write_text(json.dumps(value))
        with self.assertRaises(ValueError):
            selected_tokens(self.selection)

    def test_token_alias_hardlink_or_insecure_source_refuses_before_read(self):
        original = self.token.read_bytes()
        self.token.chmod(0o644)
        with self.assertRaises(ValueError):
            copy_tokens(self.selection, self.destination)
        self.assertEqual(self.token.read_bytes(), original)
        (self.destination / 'tokens').rmdir()
        self.token.chmod(0o600)
        os.link(self.token, self.source / 'linked')
        with self.assertRaises(ValueError):
            copy_tokens(self.selection, self.destination)
        self.assertEqual(self.token.read_bytes(), original)
