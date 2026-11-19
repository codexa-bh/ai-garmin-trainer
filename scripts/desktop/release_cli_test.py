"""Executable CLI parsing/orchestration with fake native admission/provider only."""

import contextlib
import copy
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

import release
import release_set
from release_set_test import NOTES, write_platform
from release_test import FakeGitHub


class CliTests(unittest.TestCase):
    def setUp(self):
        # CLI deliberately sets a private process umask; in-process fixtures must
        # restore it so unrelated permission-refusal tests see their own inputs.
        mask = os.umask(0o077)
        os.umask(mask)
        self.addCleanup(os.umask, mask)
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.mac = write_platform(self.root / 'mac', 'macos-arm64')
        self.win = write_platform(self.root / 'win', 'windows-x64')
        self.set_path = release_set.assemble([self.mac, self.win], NOTES, self.root)
        self.record = release_set.load(self.mac)
        self.gh = FakeGitHub()
        self.native = Mock()
        self.foreign = Mock()

    def cli(self, action, *extra, use_set=True):
        @contextlib.contextmanager
        def native(*_args):
            self.native()
            yield {}, {}

        @contextlib.contextmanager
        def transported(*_args):
            yield self.mac, Mock(), self.record

        argv = [
            'release',
            action,
            '--repository',
            self.record['repository'],
            '--commit',
            self.record['commit'],
            '--version',
            '1.2.3',
            '--scratch',
            str(self.root),
            '--bundle',
            str(self.root / 'producer'),
            '--record',
            str(self.mac),
            '--prerelease',
            'no',
            '--latest',
            'yes',
        ]
        if use_set:
            argv += [
                '--release-set',
                str(self.set_path),
                '--platform-record',
                str(self.mac),
                '--platform-record',
                str(self.win),
            ]
        with contextlib.ExitStack() as stack:
            for target, kwargs in [
                ('release.check', {'return_value': ('1.2.3', NOTES)}),
                ('release.exact_source', {}),
                ('release.platform_target.require_host', {}),
                ('release.source_snapshot', {'return_value': {'source': 'b' * 64}}),
                ('release.ordinary_preparation', {'side_effect': native}),
                ('release.artifacts', {'return_value': (None, transported)}),
                ('release.resources.configure', {'return_value': self.root}),
                ('release_remote.GitHub', {'return_value': self.gh}),
                ('windows_release_export.verify_import', {'side_effect': self.foreign}),
            ]:
                stack.enter_context(patch(target, **kwargs))
            stack.enter_context(patch.object(sys, 'argv', argv + list(extra)))
            output = stack.enter_context(contextlib.redirect_stdout(io.StringIO()))
            release.main.__wrapped__()
            return output.getvalue()

    def test_actual_cli_set_dry_run_and_separate_draft_publish(self):
        result = self.cli('draft')
        self.assertIn('release-set.json', result)
        self.assertEqual(self.gh.effects, [])
        self.cli('draft', '--execute')
        self.assertEqual(len(self.gh.assets), 7)
        self.assertGreaterEqual(self.foreign.call_count, 11)  # Every effect plus entry/exit.
        self.cli('publish', '--execute')
        self.assertFalse(self.gh.release['draft'])
        self.assertEqual(self.native.call_count, 3)

    def test_legacy_cli_keeps_three_assets_without_foreign_authority(self):
        self.cli('draft', '--execute', use_set=False)
        self.assertEqual(len(self.gh.assets), 3)
        self.foreign.assert_not_called()

    def test_stored_shared_identity_tampering_refuses_before_effect(self):
        original = release_set.load(self.set_path)
        for key in ('repository', 'commit', 'version', 'tag', 'notesSha256'):
            changed = copy.deepcopy(original)
            changed[key] = 'changed'
            self.set_path.write_text(json.dumps(changed))
            with self.subTest(key=key), self.assertRaises(ValueError):
                self.cli('draft', '--execute')
            self.assertEqual(self.gh.effects, [])
        self.set_path.write_text(json.dumps(original))

    def test_foreign_provenance_failure_blocks_effect_without_native_bypass(self):
        self.foreign.side_effect = ValueError('wrong run')
        with self.assertRaisesRegex(ValueError, 'wrong run'):
            self.cli('draft', '--execute')
        self.assertEqual(self.gh.effects, [])
        self.native.assert_called_once()

    def test_original_unknown_effect_remains_reconcilable_without_retry(self):
        self.gh.fail_after = 3
        with self.assertRaises(TimeoutError):
            self.cli('draft', '--execute')
        self.assertEqual(len(self.gh.effects), 3)
        self.cli('status')
        self.assertEqual(len(self.gh.effects), 3)


if __name__ == '__main__':
    unittest.main()
