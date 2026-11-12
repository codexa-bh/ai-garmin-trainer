"""Cheap finite live Settings runner contract tests; no native launch/provider use."""
import json
import pathlib
import tempfile
import unittest
from unittest.mock import patch
import settings_smoke


class Run:
    def __init__(self, root, fault=None):
        self.root = pathlib.Path(root)
        (self.root / 'config').mkdir()
        self.origin = 'http://127.0.0.1:19324'
        self.selected = None
        self.action = None
        self.fault = fault
        self.backend = 12345

    def http(self, path):
        if path != '/identity':
            raise AssertionError('Only fixed identity route')
        return {'pid': 54321, 'backendPid': self.backend, 'origin': self.origin, 'database': 'owned-copy'}

    def command(self, command):
        action = command['action']
        if action.startswith('live'):
            self.action = action
        if action == 'stopBackend':
            self.backend = None
        if action == 'save' and self.backend:
            suffix = 'one' if self.action == 'liveCatalog' else 'two'
            keys = {slot: 'T0257-synthetic-' + slot + '-' + suffix for slot in ['OPENAI_API_KEY', 'DEEPSEEK_API_KEY', 'OPENROUTER_API_KEY']} if self.action in ['liveCatalog', 'liveRotate'] else {}
            if self.fault == 'retained-key' and self.action == 'liveClear':
                keys['OPENAI_API_KEY'] = 'old-key'
            (self.root / 'config/settings-v3.json').write_text(json.dumps({'keys': keys, 'fields': {'MEMORY_EMBEDDING_DIMS': '2048'}, 'chatCatalog': {'defaultEntryId': None, 'entries': self.metadata(self)['options']}}))
            if self.fault == 'restart':
                self.backend += 1
        return {'ok': True}

    def metadata(self, _run, model_id=None, write=False):
        if write:
            self.selected = model_id
        entries = [{'id': 'entry_legacy_' + provider, 'provider': provider, 'modelId': 'Synthetic/Live:one' if provider == 'openai' else 'fixed-model', 'available': True} for provider in ['openai', 'deepseek', 'ollama', 'openrouter']]
        if self.action == 'liveClear':
            entries = [entry for entry in entries if entry['provider'] != 'openai']
            for entry in entries:
                entry['available'] = entry['provider'] == 'ollama'
        if self.action == 'liveEmpty':
            entries = []
        for entry in entries:
            entry['displayName'] = 'Synthetic model' if self.fault != 'lost-name' else 'changed'
            entry['label'] = entry['provider'] + ' / ' + entry['modelId']
            if self.fault == 'alias-label':
                entry['label'] = 'Synthetic model — ' + entry['label']
        selected = 'entry_legacy_deepseek' if self.fault == 'remap' else self.selected
        return {'version': 3, 'options': entries, 'selected': selected, 'status': 'selected', 'available': any(entry['id'] == selected and entry['available'] for entry in entries)}


class LiveRunnerTests(unittest.TestCase):
    def scenario(self, fault=None):
        with tempfile.TemporaryDirectory() as root:
            run = Run(root, fault)
            captures = []
            with patch.object(settings_smoke, 'dismiss_restart'), patch.object(settings_smoke, 'model_settings', side_effect=run.metadata), patch.object(settings_smoke, 'wait_settings', side_effect=lambda *_args: {'saved': True, 'restartVisible': fault == 'false-modal', 'liveApplied': True, 'pendingRestart': run.action != 'liveCatalog' or fault == 'false-restart', 'savedUnapplied': True}):
                result = settings_smoke.live_scenario(run, captures)
            self.assertEqual(len(result), 4)
            self.assertEqual(len(captures), 4)
            self.assertIsNone(run.backend)
            self.assertTrue(all(item['compiledNextUptake'] for item in result))

    def test_finite_positive_without_provider_or_arbitrary_route(self):
        self.scenario()

    def test_rejects_restart_retained_key_and_preference_remap(self):
        for fault in ['restart', 'retained-key', 'remap', 'false-restart', 'false-modal', 'lost-name', 'alias-label']:
            with self.subTest(fault=fault), self.assertRaises(ValueError):
                self.scenario(fault)


from unittest.mock import Mock
from settings_smoke import capture_garmin, verify_choice_catalog, wait_settings


class SettingsCaptureTests(unittest.TestCase):
    def test_chatgpt_presentation_uses_only_fixed_draft_and_capture_actions(self):
        run = Mock()
        run.http.return_value = {'pid': 1, 'origin': 'owned', 'database': 'copy'}
        run.command.side_effect = lambda command: {'ok': True, 'capture': 'unit-only.png', 'chatgptReady': True, 'chatgptExercised': command['action'] == 'chatgptExercise', 'privateActionsDenied': True}
        captures = []
        with patch.object(settings_smoke, 'wait_settings', return_value={'chatgptReady': True, 'chatgptExercised': False, 'privateActionsDenied': True}):
            result = settings_smoke.chatgpt_presentation(run, captures)
        self.assertTrue(result['fictionalMetadataOnly'])
        self.assertTrue(result['batchAddition'])
        self.assertTrue(result['duplicatePairsDisabled'])
        self.assertEqual(len(captures), 5)
        self.assertEqual([call.args[0] for call in run.command.call_args_list], [
            {'type': 'settings', 'action': 'captureChatgptWide'}, {'type': 'settings', 'action': 'captureChatgptNarrow'},
            {'type': 'settings', 'action': 'chatgptExercise'},
            {'type': 'settings', 'action': 'captureChatgptWide'}, {'type': 'settings', 'action': 'captureChatgptNarrow'},
            {'type': 'settings', 'action': 'captureChatgptRowsNarrow'},
            {'type': 'settings', 'action': 'chatgptReset'}])

    def test_chatgpt_presentation_refuses_privilege_capture_and_draft_failures_without_retry(self):
        run = Mock()
        run.http.return_value = {'pid': 1, 'origin': 'owned', 'database': 'copy'}
        with patch.object(settings_smoke, 'wait_settings', return_value={'privateActionsDenied': False}), self.assertRaises(ValueError):
            settings_smoke.chatgpt_presentation(run, [])
        run.command.assert_not_called()
        run.command.side_effect = RuntimeError('capture refused')
        with patch.object(settings_smoke, 'wait_settings', return_value={'privateActionsDenied': True}), self.assertRaises(RuntimeError):
            settings_smoke.chatgpt_presentation(run, [])
        self.assertEqual(run.command.call_count, 1)
        run.command.reset_mock()
        run.command.side_effect = lambda command: {'capture': 'unit-only.png', 'chatgptReady': True, 'chatgptExercised': False, 'privateActionsDenied': True}
        with patch.object(settings_smoke, 'wait_settings', return_value={'privateActionsDenied': True}), self.assertRaises(ValueError):
            settings_smoke.chatgpt_presentation(run, [])
        self.assertEqual(run.command.call_count, 3)

    def test_dependency_settings_uses_live_owner_state_not_cached_renderer_origin(self):
        origin = 'http://127.0.0.1:19324'
        run = Mock()
        run.command.return_value = {'ok':True, 'capture':'unit-only.png'}
        run.http.side_effect = [{'origin':origin}, {'origin':origin}, {'origin':origin,'runtimeReady':False,'backendPid':None}]
        captures = []
        with patch.object(settings_smoke, 'wait_settings'), patch.object(settings_smoke, 'listening', return_value=False):
            settings_smoke.dependency_settings(run, captures, 'unit-only-binary')
        self.assertEqual(len(captures), 3)
        self.assertEqual(sum(call.args[0]['action'] == 'stopBackend' for call in run.command.call_args_list), 1)
        self.assertFalse(any(call.args[0]['action'] in ('start_auth','submit_mfa') for call in run.command.call_args_list))

    def test_restart_scenario_waits_for_exact_cancel_completion_before_next_edit(self):
        with tempfile.TemporaryDirectory() as root:
            run = Mock()
            run.root = pathlib.Path(root)
            (run.root / 'config').mkdir()
            (run.root / 'config/settings-v3.json').write_text('{}')
            run.http.return_value = {'pid': 1, 'backendPid': 2, 'origin': 'owned', 'database': 'copy'}
            run.command.return_value = {'ok': True}
            labels = []
            def settled(_run, label, predicate=None):
                labels.append(label)
                if label.startswith('cancel '):
                    self.assertFalse(predicate({'saved': False, 'editsCancelled': False}))
                    self.assertTrue(predicate({'saved': False, 'editsCancelled': True}))
                return {'liveApplied': True, 'restartVisible': False}
            with patch.object(settings_smoke, 'no_restart', side_effect=settled), patch.object(settings_smoke, 'dismiss_restart'):
                self.assertTrue(settings_smoke.restart_scenario(run, [])['staleRefused'])
            self.assertIn('cancel startup draft', labels)
            self.assertIn('cancel stale startup draft', labels)

    def test_modal_fixed_capture_and_dismiss_never_replays_save(self):
        for escape in [False, True]:
            run = Mock()
            run.command.side_effect = [{'restartFocused': True}, {'capture': 'wide.png'}, {'capture': 'narrow.png'}, {'restartVisible': False, 'saveFocused': True}]
            captures = []
            with patch.object(settings_smoke, 'wait_settings', return_value={'saved': True}):
                settings_smoke.dismiss_restart(run, captures, 'startup', escape=escape)
            self.assertEqual([call.args[0]['action'] for call in run.command.call_args_list], ['restartTab', 'captureRestartWide', 'captureRestartNarrow', 'restartEscape' if escape else 'restartDismiss'])
            self.assertEqual(len(captures), 2)

    def test_modal_refusal_and_capture_failure_do_not_retry(self):
        run = Mock()
        with patch.object(settings_smoke, 'wait_settings', return_value={'saved': False}), self.assertRaises(ValueError):
            settings_smoke.dismiss_restart(run, [], 'invalid')
        run.command.assert_not_called()
        run.command.side_effect = [{'restartFocused': True}, RuntimeError('mask refused')]
        with patch.object(settings_smoke, 'wait_settings', return_value={'saved': True}), self.assertRaises(RuntimeError):
            settings_smoke.dismiss_restart(run, [], 'refused')
        self.assertEqual(run.command.call_count, 2)
        with patch.object(settings_smoke, 'wait_settings', return_value={'restartVisible': True}), self.assertRaises(ValueError):
            settings_smoke.no_restart(run, 'live-only')

    def test_named_input_is_fixed_exclusive_and_preserves_original_v2(self):
        with tempfile.TemporaryDirectory() as root:
            run = Run(root)
            original = {'version': 2, 'fields': {'AI_PROVIDER': 'ollama'}, 'keys': {}}
            before = json.dumps(original).encode()
            (run.root / 'config/settings-v2.json').write_bytes(before)
            result = settings_smoke.prepare_named_settings(run)
            named = json.loads(result)
            self.assertEqual((run.root / 'config/settings-v2.json').read_bytes(), before)
            self.assertEqual(named['version'], 3)
            self.assertEqual(named['fields'], original['fields'])
            self.assertEqual(named['chatCatalog']['defaultEntryId'], 'entry_legacy_ollama')
            self.assertEqual([entry['displayName'] for entry in named['chatCatalog']['entries']], ['Synthetic model'] * 4)
            with self.assertRaises(FileExistsError):
                settings_smoke.prepare_named_settings(run)

    def test_live_empty_restart_observes_without_replaying_eight_row_mutation(self):
        run = Mock()
        state = {'version': 3, 'selected': 'entry_legacy_openai', 'available': False, 'options': []}
        with patch.object(settings_smoke, 'wait_settings'), patch.object(settings_smoke, 'model_settings', return_value=state):
            settings_smoke.verify_empty_restart(run, [], 'unused-live-binary', True)
        run.command.assert_not_called()
        run.stop.assert_not_called()
        run.start.assert_not_called()
        state['selected'] = 'entry_legacy_ollama'
        with patch.object(settings_smoke, 'wait_settings'), patch.object(settings_smoke, 'model_settings', return_value=state), self.assertRaises(ValueError):
            settings_smoke.verify_empty_restart(run, [], 'unused-live-binary', True)

    def test_partial_not_ready_document_never_calls_state_predicate(self):
        run = Mock()
        run.command.side_effect = [{'ok': True, 'ready': False}, {'ok': True, 'ready': True, 'emptyCatalog': True}]
        result = wait_settings(run, lambda state: state['emptyCatalog'], 'empty after restart')
        self.assertTrue(result['emptyCatalog'])
        self.assertEqual(run.command.call_count, 2)
        self.assertTrue(all(call.args == ({'type': 'settings', 'action': 'observe'},) for call in run.command.call_args_list))

    def test_only_fixed_wide_and_narrow_presets(self):
        run = Mock()
        run.command.side_effect = [
            {'ok': True, 'capture': 'wide.png'},
            {'ok': True, 'capture': 'narrow.png'},
        ]
        captures = []
        capture_garmin(run, captures, 'connect-no-login')
        self.assertEqual(run.command.call_args_list[0].args,
                         ({'type': 'settings', 'action': 'captureWide'},))
        self.assertEqual(run.command.call_args_list[1].args,
                         ({'type': 'settings', 'action': 'captureNarrow'},))
        self.assertEqual([c['scenario'] for c in captures],
                         ['connect-no-login-wide', 'connect-no-login-narrow'])

    def test_only_exact_no_default_catalog_and_retained_prior_intent_pass(self):
        import copy
        import uuid
        providers = ['openai', 'deepseek', 'ollama', 'openrouter']
        entries = [dict(id='entry_legacy_' + p, provider=p, modelId=f'synthetic/{p}:Case', displayName='Synthetic model') for p in providers]
        entries += [dict(id='entry_' + str(uuid.uuid4()), provider=p, modelId=f'synthetic/{p}:Second') for p in providers]
        saved = {'chatCatalog': {'version': 1, 'defaultEntryId': None, 'entries': entries}, 'selectionCompatibility': {'catalog': {'defaultEntryId': 'entry_legacy_ollama'}}}
        verify_choice_catalog(saved)
        for kind in ['new-default', 'substitution', 'lost-original']:
            changed = copy.deepcopy(saved)
            if kind == 'new-default':
                changed['chatCatalog']['defaultEntryId'] = 'entry_other'
            elif kind == 'substitution':
                changed['chatCatalog']['entries'][0]['modelId'] = 'another-model'
            else:
                changed['selectionCompatibility']['catalog']['defaultEntryId'] = None
            with self.assertRaises(ValueError):
                verify_choice_catalog(changed)

    def test_capture_refusal_never_retries_or_advances(self):
        run = Mock()
        run.command.side_effect = RuntimeError('mask refused')
        with self.assertRaises(RuntimeError):
            capture_garmin(run, [], 'connect')
        self.assertEqual(run.command.call_count, 1)


if __name__ == '__main__':
    unittest.main()
