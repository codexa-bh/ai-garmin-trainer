"""Finite Garmin geometry runner contract, no native launches."""
import unittest
from unittest.mock import Mock
from settings_smoke import capture_garmin, verify_choice_catalog, wait_settings


class SettingsCaptureTests(unittest.TestCase):
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
