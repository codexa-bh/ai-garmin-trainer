"""Executable CLI parsing/orchestration with fake native admission/provider only."""

import contextlib
import copy
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

import release
import release_metadata as metadata
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


class PrepareCliTests(unittest.TestCase):
    """Real CLI check/prepare composition in a disposable Git fixture; no remote effects."""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        (self.root / 'src-tauri').mkdir()
        (self.root / 'release-notes/releases').mkdir(parents=True)
        (self.root / 'release-notes/unreleased').mkdir()
        for name, value in [
            ('package.json', {'name': 'test', 'version': '0.1.0'}),
            ('package-lock.json', {'version': '0.1.0', 'packages': {'': {'version': '0.1.0'}}}),
            ('src-tauri/tauri.conf.json', {'version': '0.1.0'}),
        ]:
            (self.root / name).write_text(json.dumps(value))
        (self.root / 'src-tauri/Cargo.toml').write_text(
            '[package]\nname = "garmin-trainer-desktop"\nversion = "0.1.0"\n'
        )
        (self.root / 'src-tauri/Cargo.lock').write_text(
            '[[package]]\nname = "garmin-trainer-desktop"\nversion = "0.1.0"\n'
        )
        (self.root / 'release-notes/releases/0.1.0.md').write_text(
            '# Garmin Trainer 0.1.0\n\nStatus: unreleased\n\n' + metadata.WARNINGS
        )
        self.fix = self.root / 'release-notes/unreleased/T0001-fix.md'
        self.fix.write_text(
            '---\ntask: T0001\npr: 5\ncategory: Fixed\nrelease_note_required: true\n---\n\n- Fixed it.\n'
        )
        self.marker = self.root / 'release-notes/unreleased/T0002-tests.md'
        self.marker.write_text(
            '---\ntask: T0002\npr: none\ncategory: Internal\nrelease_note_required: false\nreason: tests only\n---\n'
        )
        for command in (
            ['init', '-q'],
            ['add', '.'],
            ['-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-qm', 'fixture'],
        ):
            subprocess.run(['git', *command], cwd=self.root, check=True)
        mask = os.umask(0o077)
        os.umask(mask)
        self.addCleanup(os.umask, mask)

    def cli(self, *args):
        output = io.StringIO()
        with (
            patch.object(release, 'ROOT', self.root),
            patch.object(sys, 'argv', ['release', *args]),
            contextlib.redirect_stdout(output),
        ):
            release.main.__wrapped__()
        return json.loads(output.getvalue())

    def tree(self):
        return {
            str(path.relative_to(self.root)): path.read_bytes()
            for path in self.root.rglob('*')
            if path.is_file() and '.git' not in path.parts
        }

    def test_check_counts_pending_fragments_and_refuses_a_malformed_one(self):
        self.assertEqual(self.cli('check')['unreleasedFragments'], 2)
        self.marker.write_text('broken')
        with self.assertRaisesRegex(ValueError, 'T0002-tests.md'):
            self.cli('check')

    def test_dry_run_reports_promotion_and_changes_nothing(self):
        before = self.tree()
        result = self.cli('prepare', '--version', '0.2.0')
        self.assertEqual(
            (result['executed'], result['promotedFragments']), (False, ['T0001-fix.md'])
        )
        self.assertEqual(before, self.tree())

    def test_execute_promotes_consumes_required_only_and_rechecks(self):
        result = self.cli('prepare', '--version', '0.2.0', '--execute')
        self.assertEqual(result['promotedFragments'], ['T0001-fix.md'])
        self.assertFalse(self.fix.exists())
        self.assertTrue(self.marker.exists())
        self.assertIn('- Fixed it.', (self.root / 'release-notes/releases/0.2.0.md').read_text())
        self.assertEqual(self.cli('check')['version'], '0.2.0')

    def test_bad_input_and_dirty_source_refuse_without_effects(self):
        self.marker.write_text('broken')
        subprocess.run(['git', 'add', '.'], cwd=self.root, check=True)
        subprocess.run(
            ['git', '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-qm', 'bad'],
            cwd=self.root,
            check=True,
        )
        before = self.tree()
        for argv in (
            ['prepare', '--version', '0.2.0', '--execute'],
            ['prepare', '--version', '0.2.0'],
        ):
            with self.subTest(argv=argv), self.assertRaises(ValueError):
                self.cli(*argv)
        self.assertEqual(before, self.tree())
        self.marker.write_text(
            '---\ntask: T0002\npr: none\ncategory: Internal\nrelease_note_required: false\nreason: ok\n---\n'
        )
        before = self.tree()
        with self.assertRaisesRegex(ValueError, 'clean source'):
            self.cli('prepare', '--version', '0.2.0', '--execute')
        self.assertEqual(before, self.tree())


if __name__ == '__main__':
    unittest.main()
