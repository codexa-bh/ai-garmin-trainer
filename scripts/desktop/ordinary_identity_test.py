"""Real classifier/context/producer/consumer contracts; no app build or provider calls."""
import contextlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

import ordinary_identity as identity
from release_smoke import audit, REQUIRED


class OrdinaryIdentityTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.repo = Path(self.temporary.name).resolve()
        self.scratch = self.repo / 'evidence'
        self.scratch.mkdir(mode=0o700)
        self.bundle = self.repo / 'src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Garmin Trainer.app'
        self.calls = []
        self.mutate_during_build = False
        subprocess.run(['git', 'init', '-q', str(self.repo)], check=True)
        (self.repo / '.gitignore').write_text('node_modules/\ndist/\nevidence/\nsrc-tauri/target/\nsrc-tauri/resources/\n')
        self.paths = sorted(identity.EXTERNAL) + ['scripts/desktop/ordinary_identity.py', 'scripts/desktop/native_smoke.py',
                'scripts/desktop/assemble.mjs', 'src-tauri/src/isolated_run.rs', 'src-tauri/debug/smoke.js',
                'scripts/desktop/smoke_input.py', 'scripts/desktop/garmin_auth.py', 'package-lock.json',
                'src-tauri/Cargo.lock', 'next.config.ts']
        for name in self.paths:
            path = self.repo / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text('tracked fixture ' + name)
        subprocess.run(['git', '-C', str(self.repo), 'add', '.'], check=True)
        dependencies = self.repo / 'node_modules'
        dependencies.mkdir()
        (dependencies / '.package-lock.json').write_text('{}')
        (dependencies / 'installed.js').write_text('installed bytes')
        real_output = subprocess.check_output
        def output(command, **kwargs):
            if command[0] == 'git':
                return real_output(command, **kwargs)
            return b'controlled toolchain and SDK v1'
        self.addCleanup(patch.stopall)
        patch('smoke_build.subprocess.check_output', side_effect=output).start()
        patch('ordinary_identity.run_build', side_effect=self.command).start()

    def command(self, command, **kwargs):
        self.calls.append(command)
        if command[0] == 'npm':
            current = identity.source_snapshot(self.repo)
            self.produced = {'version': 2, 'sourceFingerprint': current['source'],
                             'buildSourceFingerprint': current['buildSource'],
                             'buildContext': identity.context_key(self.repo, current), 'files': []}
        else:
            binary = self.bundle / 'Contents/MacOS/garmin-trainer-desktop'
            binary.parent.mkdir(parents=True, exist_ok=True)
            binary.write_bytes(b' '.join(REQUIRED))
            resources = self.bundle / 'Contents/Resources/resources'
            resources.mkdir(parents=True, exist_ok=True)
            (resources / 'provenance.json').write_text(json.dumps(self.produced))
            (resources / 'runtime').write_bytes(b'complete inventoried resource')
            if self.mutate_during_build:
                (self.repo / 'next.config.ts').write_text('concurrent change')

    def build(self):
        identity.build_ordinary(self.repo)
        return audit(self.bundle)

    def verify(self):
        source = identity.source_snapshot(self.repo)['source']
        return identity.verify_ordinary(self.repo, self.bundle, source, audit(self.bundle))

    def test_actual_external_mutation_hits_identical_bundle_without_any_build_requests(self):
        inventory = self.build()
        before = self.verify()
        for name in sorted(identity.EXTERNAL):
            (self.repo / name).write_text('reviewed corrected driver or documentation')
            current = self.verify()
            self.assertEqual(current['current']['buildSource'], before['current']['buildSource'])
            self.assertNotEqual(current['current']['source'], before['current']['source'])
            self.assertEqual(current['provenance']['sourceFingerprint'], before['current']['source'])
            self.assertEqual(audit(self.bundle), inventory)
        with identity.ordinary_preparation(self.repo, self.bundle, current['current']['source'], self.scratch):
            pass
        self.assertEqual(self.calls, [
            ['npm', 'run', 'desktop:resources'],
            [str(self.repo / 'node_modules/.bin/tauri'), 'build', '--target', 'aarch64-apple-darwin',
             '--bundles', 'app', '--no-sign', '--no-binary-patching', '--ci'],
        ])  # Initial full resources and native packaging only; never replaced by reuse.
        report = json.loads(next(self.scratch.glob('ordinary-reuse-*.json')).read_text())
        self.assertEqual(report['decision'], 'hit')
        self.assertEqual(sum(report['stageRequests'].values()), 0)

    def test_default_included_dirty_deleted_unknown_renamed_and_untracked_inputs_refuse(self):
        self.build()
        for name in self.paths:
            if name in identity.EXTERNAL:
                continue
            path = self.repo / name
            original = path.read_bytes()
            for mutation in ['dirty', 'deleted']:
                with self.subTest(name=name, mutation=mutation):
                    if mutation == 'dirty': path.write_bytes(b'changed runtime/config/helper')
                    else: path.unlink()
                    with self.assertRaisesRegex(ValueError, 'inputs/context'):
                        self.verify()
                    path.write_bytes(original)
        for name in ['unknown.py', 'docs/new.md', 'scripts/desktop/ordinary_smoke_renamed.py']:
            path = self.repo / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text('new input is not exempt')
            with self.assertRaisesRegex(ValueError, 'inputs/context'):
                self.verify()
            path.unlink()
        # An allowlisted spelling newly appearing as untracked must not be exempt.
        path = self.repo / 'docs/dev-bridge.md'
        tracked = subprocess.check_output
        def without_doc(command, **kwargs):
            value = tracked(command, **kwargs)
            if command == ['git', 'ls-files', '-z', '--cached']:
                return value.replace(b'docs/dev-bridge.md\0', b'')
            return value
        with patch('ordinary_identity.subprocess.check_output', side_effect=without_doc):
            with self.assertRaisesRegex(ValueError, 'inputs/context'):
                self.verify()
        self.assertTrue(path.exists())

    def test_deletion_marker_bytes_and_file_mode_cannot_alias_build_inputs(self):
        path = self.repo / 'next.config.ts'
        path.write_bytes(b'<deleted>')
        present = identity.source_snapshot(self.repo)
        path.unlink()
        deleted = identity.source_snapshot(self.repo)
        self.assertNotEqual(present['buildSource'], deleted['buildSource'])
        path.write_bytes(b'<deleted>')
        before = identity.source_snapshot(self.repo)
        path.chmod(0o700)
        self.assertNotEqual(before['buildSource'], identity.source_snapshot(self.repo)['buildSource'])

    def test_installed_bytes_environment_classifier_tool_mode_and_lock_inode_invalidate(self):
        self.build()
        module = self.repo / 'node_modules/installed.js'
        module.write_text('same lock, changed installed code')
        with self.assertRaisesRegex(ValueError, 'inputs/context'): self.verify()
        module.write_text('installed bytes')
        with patch.dict(os.environ, {'RUSTFLAGS': 'different flags'}):
            with self.assertRaisesRegex(ValueError, 'inputs/context'): self.verify()
        with patch.object(identity, 'CLASSIFIER', {'version': 99, 'externalTrackedPaths': []}):
            with self.assertRaisesRegex(ValueError, 'inputs/context'): self.verify()
        with patch.object(identity, 'MODE', 'debug'):
            with self.assertRaisesRegex(ValueError, 'inputs/context'): self.verify()
        with patch('smoke_build.platform.machine', return_value='other-architecture'):
            with self.assertRaisesRegex(ValueError, 'inputs/context'): self.verify()
        lock = self.repo / 'dist/native-smoke.lock'
        lock.rename(lock.with_suffix('.retained'))
        with self.assertRaisesRegex(ValueError, 'inputs/context'): self.verify()

    def test_legacy_ambiguous_partial_and_inventory_corruption_never_get_relabelled(self):
        inventory = self.build()
        provenance = self.bundle / 'Contents/Resources/resources/provenance.json'
        original = provenance.read_bytes()
        for bad in ['{"version":1}', '{"version":2,"version":2}', '{}', '[]', 'null']:
            provenance.write_text(bad)
            with self.assertRaises(ValueError): self.verify()
            self.assertEqual(provenance.read_text(), bad)
        provenance.write_bytes(original)
        binary = self.bundle / 'Contents/MacOS/garmin-trainer-desktop'
        original_binary = binary.read_bytes()
        binary.write_bytes(original_binary + b'corrupt native')
        with self.assertRaisesRegex(ValueError, 'stamp|inventory'): self.verify()
        binary.write_bytes(original_binary)
        extra = self.bundle / 'Contents/extra'
        extra.write_text('unexpected resource')
        with self.assertRaisesRegex(ValueError, 'stamp|inventory'): self.verify()
        extra.unlink()
        resource = self.bundle / 'Contents/Resources/resources/runtime'
        resource.unlink()
        with self.assertRaisesRegex(ValueError, 'stamp|inventory'): self.verify()
        resource.write_bytes(b'complete inventoried resource')
        stamp = self.repo / 'dist' / identity.STAMP
        stamp.write_text('{partial')
        with self.assertRaises(ValueError): self.verify()
        self.assertEqual(audit(self.bundle), inventory)
        self.assertEqual(len(self.calls), 2)  # Refusal never requests a build or patches bytes.

    def test_partial_or_concurrently_changed_build_never_publishes_stamp(self):
        self.mutate_during_build = True
        with self.assertRaisesRegex(ValueError, 'Inputs changed'): self.build()
        self.assertFalse((self.repo / 'dist' / identity.STAMP).exists())
        self.mutate_during_build = False
        with patch('ordinary_identity.run_build', side_effect=RuntimeError('partial build')):
            with self.assertRaisesRegex(RuntimeError, 'partial build'): self.build()
        self.assertFalse((self.repo / 'dist' / identity.STAMP).exists())

    def test_fresh_failed_oracle_is_truthful_on_hit_and_concurrent_driver_change_refuses(self):
        self.build()
        current = self.verify()
        with self.assertRaisesRegex(AssertionError, 'fresh corrected oracle'):
            with identity.ordinary_preparation(self.repo, self.bundle, current['current']['source'], self.scratch):
                raise AssertionError('fresh corrected oracle failed')
        report = json.loads(next(self.scratch.glob('ordinary-reuse-*.json')).read_text())
        self.assertEqual(report['decision'], 'hit')
        self.assertEqual(report['freshScenarioOutcome'], 'failed or incomplete')
        with self.assertRaisesRegex(ValueError, 'driver/source changed'):
            with identity.ordinary_preparation(self.repo, self.bundle, current['current']['source'], self.scratch):
                (self.repo / 'scripts/desktop/ordinary_smoke.py').write_text('changed during run')
        self.assertEqual(len(self.calls), 2)

    def test_aliases_replaced_worktree_and_lock_are_refused(self):
        self.build()
        alias = self.repo / 'alias.py'
        alias.symlink_to(self.repo / 'next.config.ts')
        with self.assertRaisesRegex(ValueError, 'aliases'): self.verify()
        alias.unlink()
        lock = self.repo / 'dist/native-smoke.lock'
        lock.unlink()
        lock.symlink_to(self.repo / 'next.config.ts')
        with self.assertRaises(OSError): self.verify()

    def test_ordinary_preparation_lock_serializes_competing_builds(self):
        entered, release = threading.Event(), threading.Event()
        original = self.command
        def command(args, **kwargs):
            if not entered.is_set():
                entered.set()
                self.assertTrue(release.wait(5))
            return original(args, **kwargs)
        errors = []
        def worker():
            try: self.build()
            except BaseException as error: errors.append(error)
        with patch('ordinary_identity.run_build', side_effect=command):
            first = threading.Thread(target=worker)
            second = threading.Thread(target=worker)
            first.start()
            self.assertTrue(entered.wait(5))
            second.start()
            time.sleep(.02)  # Local flock assertion, not remote polling.
            self.assertFalse(self.calls)
            release.set()
            first.join(5)
            second.join(5)
        self.assertFalse(errors)
        self.assertEqual(len(self.calls), 4)  # Full build semantics never become skip-if-stamped.


if __name__ == '__main__':
    unittest.main()
