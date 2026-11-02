import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import smoke_build


class PreparationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()
        self.scratch = self.root / 'scratch'
        self.scratch.mkdir()
        self.repo = self.root / 'repo'
        self.repo.mkdir()
        self.source = 'a' * 64
        self.current = self.source
        self.key = 'key'
        self.binary = self.repo / 'src-tauri/target/debug/garmin-trainer-desktop'
        self.binary.parent.mkdir(parents=True)
        self.resource = self.repo / 'src-tauri/resources/node'
        self.resource.parent.mkdir(parents=True)
        self.resource.write_bytes(b'resource')
        self.calls = []

    def verify(self, source):
        if source != self.source or self.resource.read_bytes() != b'resource':
            raise ValueError('resource mismatch')

    def command(self, args, **kwargs):
        self.calls.append(args)
        if args[0] == 'npm':
            self.resource.write_bytes(b'resource')
        else:
            binary = self.binary if '--release' not in args else self.repo / 'src-tauri/target/aarch64-apple-darwin/release/garmin-trainer-desktop'
            binary.parent.mkdir(parents=True, exist_ok=True)
            binary.write_bytes(b'compiled ' + ('probe' if '--release' in args else 'debug').encode())
            binary.chmod(0o700)

    def prepare(self, **kwargs):
        with patch.object(smoke_build, 'build_key', side_effect=lambda *a: self.key), patch.object(smoke_build.subprocess, 'run', side_effect=self.command):
            return smoke_build.prepare(self.repo, self.scratch, self.source, lambda: self.current, self.verify, **kwargs)

    def test_two_compatible_invocations_skip_resources_and_native_requests_but_keep_independent_copies(self):
        first = self.prepare()
        second = self.prepare()
        self.assertEqual(len(self.calls), 2)
        self.assertNotEqual(first, second)
        self.assertNotEqual(first.stat().st_ino, second.stat().st_ino)
        self.assertEqual(first.read_bytes(), second.read_bytes())
        reports = [json.loads(path.read_text()) for path in self.scratch.glob('build-reuse-*.json')]
        self.assertEqual(sorted(report['reused'] for report in reports), [False, True])

    def test_changed_key_binary_resources_stamp_or_mode_cannot_hit(self):
        for change in ('key', 'missing-binary', 'resources', 'stamp', 'mode'):
            with self.subTest(change=change):
                self.prepare()
                before = len(self.calls)
                if change == 'key': self.key += 'changed'
                if change == 'missing-binary': self.binary.unlink()
                if change == 'resources': self.resource.write_bytes(b'corrupt')
                if change == 'stamp': (self.repo / 'dist/smoke-build-debug.json').write_text('{incomplete')
                self.prepare(mode='release-probe' if change == 'mode' else 'debug')
                self.assertEqual(len(self.calls) - before, 2)

    def test_corrupted_existing_binary_refuses_instead_of_adopting_cargo_freshness(self):
        self.prepare()
        self.binary.write_bytes(b'corrupt existing executable')
        before = len(self.calls)
        with self.assertRaisesRegex(RuntimeError, 'executable changed'):
            self.prepare()
        self.assertEqual(len(self.calls), before)

    def test_explicit_resources_ready_mismatch_refuses_without_build_fallback(self):
        self.prepare()
        self.resource.write_bytes(b'corrupt')
        before = len(self.calls)
        with self.assertRaisesRegex(ValueError, 'resource mismatch'):
            self.prepare(resources_ready=True)
        self.assertEqual(len(self.calls), before)

    def test_source_mutation_or_partial_build_never_publishes_stamp(self):
        self.current = 'changed'
        with self.assertRaisesRegex(ValueError, 'Source changed before'):
            self.prepare()
        self.assertFalse(self.calls)
        self.current = self.source
        def failed(*args, **kwargs):
            raise RuntimeError('deterministic build failure')
        with patch.object(smoke_build, 'build_key', return_value='key'), patch.object(smoke_build.subprocess, 'run', side_effect=failed):
            with self.assertRaisesRegex(RuntimeError, 'deterministic'):
                smoke_build.prepare(self.repo, self.scratch, self.source, lambda: self.source, self.verify)
        self.assertFalse((self.repo / 'dist/smoke-build-debug.json').exists())
        def changed(args, **kwargs):
            self.command(args, **kwargs)
            if args[0] == 'cargo': self.current = 'changed'
        with patch.object(smoke_build, 'build_key', return_value='key'), patch.object(smoke_build.subprocess, 'run', side_effect=changed):
            with self.assertRaisesRegex(ValueError, 'Inputs changed'):
                smoke_build.prepare(self.repo, self.scratch, self.source, lambda: self.current, self.verify)
        self.assertFalse((self.repo / 'dist/smoke-build-debug.json').exists())

    def test_key_binds_installed_dirty_inputs_environment_modes_toolchain_and_worktree(self):
        dependencies = self.repo / 'node_modules'
        dependencies.mkdir()
        (dependencies / '.package-lock.json').write_text('{}')
        module = dependencies / 'module.js'
        module.write_text('module')
        def key(mode='debug', source=self.source):
            return smoke_build.build_key(self.repo, source, mode)
        with patch.object(smoke_build.subprocess, 'check_output', return_value=b'tool v1'):
            initial = key()
            self.assertNotEqual(initial, key(source='dirty/untracked source hash'))
            self.assertNotEqual(initial, key('release-probe'))
            module.write_text('changed installed dependency')
            self.assertNotEqual(initial, key())
            module.write_text('module')
            self.assertEqual(initial, key())
            with patch.dict(os.environ, {'RUSTFLAGS': 'new config'}):
                self.assertNotEqual(initial, key())
            with patch.object(smoke_build.subprocess, 'check_output', return_value=b'tool v2'):
                self.assertNotEqual(initial, key())
            alias = dependencies / 'foreign'
            alias.symlink_to(self.scratch, target_is_directory=True)
            with self.assertRaisesRegex(ValueError, 'alias'):
                key()

    def test_source_identity_binds_tracked_dirty_deleted_and_untracked_inputs(self):
        import subprocess
        import native_smoke
        subprocess.run(['git', 'init', '-q', str(self.repo)], check=True)
        source = self.repo / 'source'
        source.write_text('tracked')
        subprocess.run(['git', '-C', str(self.repo), 'add', 'source'], check=True)
        with patch.object(native_smoke, 'REPO', self.repo):
            initial = native_smoke.source_identity()
            source.write_text('unstaged')
            self.assertNotEqual(initial, native_smoke.source_identity())
            source.write_text('tracked')
            self.assertEqual(initial, native_smoke.source_identity())
            extra = self.repo / 'untracked'
            extra.write_text('new input')
            self.assertNotEqual(initial, native_smoke.source_identity())
            extra.unlink()
            source.unlink()
            self.assertNotEqual(initial, native_smoke.source_identity())
            source.symlink_to(self.resource)
            with self.assertRaisesRegex(ValueError, 'aliases'):
                native_smoke.source_identity()

    def test_observer_reuse_checks_source_compiler_sdk_and_binary(self):
        source = self.repo / 'scripts/desktop/native_observer.swift'
        source.parent.mkdir(parents=True)
        source.write_text('synthetic Swift fixture')
        calls = []
        def compile(args, **kwargs):
            calls.append(args)
            Path(args[-1]).write_bytes(b'compiled observer')
        with patch.object(smoke_build.subprocess, 'check_output', return_value=b'version1'), patch.object(smoke_build.subprocess, 'run', side_effect=compile):
            binary = smoke_build.observer_binary(self.repo)
            self.assertEqual(binary, smoke_build.observer_binary(self.repo))
            self.assertEqual(len(calls), 1)
            binary.write_bytes(b'corrupt')
            smoke_build.observer_binary(self.repo)
            self.assertEqual(len(calls), 2)
            source.write_text('changed Swift')
            smoke_build.observer_binary(self.repo)
            self.assertEqual(len(calls), 3)
            with patch.object(smoke_build.subprocess, 'check_output', return_value=b'version2'):
                smoke_build.observer_binary(self.repo)
                self.assertEqual(len(calls), 4)

    def test_output_or_lock_alias_never_builds_through_borrowed_paths(self):
        self.prepare()
        self.binary.unlink()
        self.binary.symlink_to(self.resource)
        before = len(self.calls)
        with self.assertRaisesRegex(ValueError, 'alias'):
            self.prepare()
        self.assertEqual(len(self.calls), before)
        lock = self.repo / 'dist/native-smoke.lock'
        lock.unlink()
        lock.symlink_to(self.resource)
        with self.assertRaises(OSError):
            self.prepare()
        self.assertEqual(self.resource.read_bytes(), b'resource')

    def test_worktree_lock_serializes_same_preparation(self):
        import threading
        import time
        entered = threading.Event()
        release = threading.Event()
        original = self.command
        def command(args, **kwargs):
            if args[0] == 'npm':
                entered.set()
                self.assertTrue(release.wait(5))
            original(args, **kwargs)
        results = []
        errors = []
        def worker():
            try:
                results.append(smoke_build.prepare(self.repo, self.scratch, self.source, lambda: self.source, self.verify))
            except BaseException as error:
                errors.append(error)
        (self.repo / 'dist').mkdir()
        with patch.object(smoke_build, 'build_key', return_value='key'), patch.object(smoke_build.subprocess, 'run', side_effect=command):
            first = threading.Thread(target=worker)
            second = threading.Thread(target=worker)
            first.start()
            self.assertTrue(entered.wait(5))
            second.start()
            time.sleep(.02)  # Local lock assertion, not remote-CI polling.
            release.set()
            first.join(5)
            second.join(5)
        self.assertFalse(errors)
        self.assertEqual(len(results), 2)
        self.assertEqual(len(self.calls), 2)


if __name__ == '__main__':
    unittest.main()
