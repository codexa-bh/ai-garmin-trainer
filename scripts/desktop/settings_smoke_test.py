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
            (self.root / 'config/settings-v3.json').write_text(json.dumps({'keys': keys, 'fields': {'MEMORY_EMBEDDING_DIMS': '2048'}}))
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
        default = None if self.action in ['liveClear', 'liveEmpty'] else 'entry_legacy_openai'
        selected = 'entry_legacy_deepseek' if self.fault == 'remap' else self.selected
        return {'version': 2, 'options': entries, 'selected': selected, 'defaultEntryId': default, 'effective': {'entryId': selected, 'available': any(entry['id'] == selected and entry['available'] for entry in entries)}}


class LiveRunnerTests(unittest.TestCase):
    def scenario(self, fault=None):
        with tempfile.TemporaryDirectory() as root:
            run = Run(root, fault)
            captures = []
            with patch.object(settings_smoke, 'model_settings', side_effect=run.metadata), patch.object(settings_smoke, 'wait_settings', side_effect=lambda *_args: {'liveApplied': True, 'pendingRestart': run.action != 'liveCatalog' or fault == 'false-restart', 'savedUnapplied': True}):
                result = settings_smoke.live_scenario(run, captures)
            self.assertEqual(len(result), 4)
            self.assertEqual(len(captures), 4)
            self.assertIsNone(run.backend)
            self.assertTrue(all(item['compiledNextUptake'] for item in result))

    def test_finite_positive_without_provider_or_arbitrary_route(self):
        self.scenario()

    def test_rejects_restart_retained_key_and_preference_remap(self):
        for fault in ['restart', 'retained-key', 'remap', 'false-restart']:
            with self.subTest(fault=fault), self.assertRaises(ValueError):
                self.scenario(fault)


from unittest.mock import Mock
from settings_smoke import capture_garmin


class SettingsCaptureTests(unittest.TestCase):
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

    def test_capture_refusal_never_retries_or_advances(self):
        run = Mock()
        run.command.side_effect = RuntimeError('mask refused')
        with self.assertRaises(RuntimeError):
            capture_garmin(run, [], 'connect')
        self.assertEqual(run.command.call_count, 1)


if __name__ == '__main__':
    unittest.main()
