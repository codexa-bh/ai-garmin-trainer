"""Finite Garmin geometry runner contract, no native launches."""
import unittest
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
