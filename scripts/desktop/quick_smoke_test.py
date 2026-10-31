import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

from native_smoke import Run, verify_resources
from quick_smoke import require_platform


class QuickTests(unittest.TestCase):
    def test_wrong_platform_refuses_before_any_launch(self):
        for system, machine in [('Linux', 'aarch64'), ('Darwin', 'x86_64')]:
            with patch('quick_smoke.platform.system', return_value=system), patch('quick_smoke.platform.machine', return_value=machine):
                with self.assertRaises(ValueError):
                    require_platform()

    def test_profile_only_scenario_uses_real_actions_no_navigation_or_capture(self):
        run = Run.__new__(Run)
        run.id = 'unit-uuid'
        run.root = Path('/not-written')
        run.commands = []
        run.other_profile_fields = Mock(return_value='unchanged')
        run.command = Mock(return_value={})
        run.wait = Mock()
        with patch('native_smoke.private_json') as receipt:
            sentinel = run.profile_scenario()
            self.assertEqual(sentinel, 'T0231-smoke-unit-uuid')
            self.assertEqual([call.args[0] for call in run.command.call_args_list], [
                {'type': 'click', 'target': 'Data & settings'},
                {'type': 'input', 'target': 'Goals', 'value': sentinel},
                {'type': 'click', 'target': 'Save Profile'},
                {'type': 'assert', 'target': 'Goals', 'value': sentinel},
            ])
            self.assertIsNone(receipt.call_args.args[1]['capture'])
        run.command.side_effect = RuntimeError('save failed')
        with self.assertRaises(RuntimeError):
            run.profile_scenario()

    def test_prepared_resource_source_inventory_and_alias_refuse(self):
        with tempfile.TemporaryDirectory() as directory:
            repo = Path(directory).resolve()
            resources = repo / 'src-tauri/resources'
            resources.mkdir(parents=True)
            file = resources / 'node'
            file.write_bytes(b'unit inventory fixture')
            provenance = resources / 'provenance.json'
            record = {'sourceFingerprint': 'a' * 64, 'files': [{'path': 'node', 'sha256': hashlib.sha256(file.read_bytes()).hexdigest()}]}
            provenance.write_text(json.dumps(record))
            with patch('native_smoke.REPO', repo):
                verify_resources('a' * 64)
                with self.assertRaises(ValueError):
                    verify_resources('b' * 64)
                file.write_bytes(b'changed')
                with self.assertRaises(ValueError):
                    verify_resources('a' * 64)
                alias = resources / 'alias'
                alias.symlink_to(file)
                with self.assertRaises(ValueError):
                    verify_resources('a' * 64)


if __name__ == '__main__':
    unittest.main()
