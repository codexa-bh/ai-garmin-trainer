import contextlib
import io
import json
import os
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

import smoke_resources as resources
from native_smoke import Run


class DisposableTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()
        self.root.chmod(0o700)
        self.scratch = self.root / 'scratch'
        self.scratch.mkdir(mode=0o700)
        self.original = self.root / 'borrowed.sqlite'
        with contextlib.closing(sqlite3.connect(self.original)) as db:
            db.execute('create table example(value text)')
            db.execute("insert into example values ('synthetic')")
            db.commit()
        self.original_bytes = self.original.read_bytes()

    def invoke(self, body):
        @resources.invocation
        def main():
            resources.configure(self.scratch)
            return body()
        with contextlib.redirect_stdout(io.StringIO()):
            return main()

    def receipts(self):
        return [json.loads(path.read_text()) for path in sorted(self.scratch.glob('resource-disposition-*.json'), key=lambda path: path.stat().st_mtime_ns)]

    def test_only_enumerated_owned_database_and_bundle_are_removed_after_evidence(self):
        state = {}
        bundle = self.root / 'borrowed.app'
        bundle.mkdir()
        (bundle / 'node').write_bytes(b'original immutable binary')
        def body():
            run = Run(self.scratch, self.original, 'a' * 64)
            state['run'] = run
            destination = run.root / 'Copy.app'
            resources.copy_tree(bundle, destination)
            with sqlite3.connect(run.database) as db:
                db.execute("insert into example values ('run-owned edit')")
            (run.root / 'screenshots/evidence.png').write_bytes(b'PNG retained')
            (run.root / 'receipt.json').write_text('{"scenario":"passed"}')
            run.stop()  # Intermediate restart settlement never deletes anything.
            self.assertTrue(run.database.exists())
            self.assertTrue(destination.exists())
        self.invoke(body)
        run = state['run']
        self.assertFalse(run.database.exists())
        self.assertFalse((run.root / 'Copy.app').exists())
        self.assertTrue((run.root / 'screenshots/evidence.png').exists())
        self.assertTrue((run.root / 'receipt.json').exists())
        self.assertTrue((bundle / 'node').exists())
        self.assertEqual(self.original.read_bytes(), self.original_bytes)
        self.assertTrue(all(item['status'] == 'removed' for item in self.receipts()[0]['artifacts']))

    def test_mutable_database_descriptor_is_released_before_native_writer_admission(self):
        import subprocess
        import sys
        def body():
            run = Run(self.scratch, self.original, 'a' * 64)
            ledger = resources._CURRENT.get()
            entry = next(item for item in ledger.items if item['path'] == run.database)
            self.assertIsNone(entry['fd'])
            if sys.platform == 'darwin':
                ownership = subprocess.run(['/usr/sbin/lsof', '-t', str(run.database)], capture_output=True, timeout=10)
                self.assertEqual(ownership.returncode, 1)
                self.assertFalse(ownership.stdout)
            run.verify_settled()
        self.invoke(body)

    def test_failure_cancellation_prepare_only_and_receipt_failure_retain(self):
        for mode in ('error', 'cancel', 'prepare-only', 'receipt'):
            state = {}
            def body():
                run = Run(self.scratch, self.original, 'a' * 64)
                state['run'] = run
                if mode == 'error': raise ValueError('original scenario error')
                if mode == 'cancel': raise KeyboardInterrupt('cancelled unknown effect')
                if mode == 'receipt': raise OSError('final evidence write failed')
                resources.retain('prepare-only: usable outputs, zero launches')
            with self.subTest(mode=mode):
                if mode == 'prepare-only': self.invoke(body)
                else:
                    with self.assertRaises((ValueError, KeyboardInterrupt, OSError)):
                        self.invoke(body)
                self.assertTrue(state['run'].database.exists())
                self.assertIsNone(state['run'].child)
                self.assertEqual(self.original.read_bytes(), self.original_bytes)

    def test_substitution_alias_hardlink_foreign_mixed_or_unsettled_refuse_before_any_deletion(self):
        for mode in ('root', 'database', 'symlink', 'hardlink', 'mixed', 'foreign', 'lease', 'sidecar', 'shutdown', 'observer', 'preservation'):
            state = {}
            def body():
                run = Run(self.scratch, self.original, 'a' * 64)
                state['run'] = run
                bundle = run.root / 'bundle'
                source = self.root / ('source-' + mode)
                source.mkdir()
                (source / 'node').write_bytes(b'owned copy')
                resources.copy_tree(source, bundle)
                if mode == 'root':
                    old = run.root.with_name(run.root.name + '-old')
                    run.root.rename(old)
                    run.root.mkdir(mode=0o700)
                if mode == 'database':
                    run.database.rename(run.root / 'original-copy.sqlite')
                    run.database.write_bytes(b'foreign replacement')
                if mode == 'symlink':
                    (bundle / 'node').unlink()
                    (bundle / 'node').symlink_to(self.original)
                if mode == 'hardlink': os.link(bundle / 'node', self.root / 'foreign-hardlink')
                if mode == 'mixed': (bundle / 'unexpected').write_bytes(b'foreign data')
                if mode == 'foreign':
                    resources.guard(lambda: (_ for _ in ()).throw(ValueError('foreign owner')))
                if mode == 'lease': Path(str(run.database) + '.trainer-writer').write_text('unsettled')
                if mode == 'sidecar': Path(str(run.database) + '-wal').write_bytes(b'unknown sidecar')
                if mode == 'shutdown': run.shutdown_failure = 'incomplete shutdown'
                if mode == 'observer': resources.guard(lambda: (_ for _ in ()).throw(RuntimeError('live observer')))
                if mode == 'preservation': raise ValueError('original-preservation failure')
            with self.subTest(mode=mode):
                with self.assertRaises((RuntimeError, ValueError)):
                    self.invoke(body)
                self.assertTrue(state['run'].root.exists())
                self.assertTrue(all(item['status'] == 'retained' for item in self.receipts()[-1]['artifacts']))
                self.assertEqual(self.original.read_bytes(), self.original_bytes)

    def test_partial_constructor_and_partial_copy_failure_are_recorded_not_adopted_or_deleted(self):
        state = {}
        def body():
            with patch('native_smoke.readonly', side_effect=ValueError('backup failed')):
                Run(self.scratch, self.original, 'a' * 64)
        with self.assertRaisesRegex(ValueError, 'backup failed'):
            self.invoke(body)
        self.assertTrue(self.receipts()[0]['artifacts'])
        self.assertTrue(Path(self.receipts()[0]['artifacts'][0]['path']).exists())
        def copy():
            state['copy'] = self.scratch / 'partial-binary'
            with patch.object(resources.shutil, 'copyfileobj', side_effect=OSError('copy failed')):
                resources.copy_file(self.original, state['copy'])
        with self.assertRaisesRegex(OSError, 'copy failed'):
            self.invoke(copy)
        self.assertTrue(state['copy'].exists())

    def test_quarantine_reverifies_actual_moved_object_and_repeated_finalization_does_not_adopt_replacement(self):
        ledger = resources.Disposables()
        ledger.configure(self.scratch)
        self.addCleanup(ledger.close)
        file = self.scratch / 'owned'
        file.write_bytes(b'owned')
        entry = ledger.register(file)
        ledger.seal(entry)
        original_rename = os.rename
        def swapped(src, dst, **kwargs):
            original_rename(file, self.scratch / 'preserved-owned')
            file.write_bytes(b'foreign replacement')
            original_rename(src, dst, **kwargs)
        with patch.object(resources.os, 'rename', side_effect=swapped):
            with self.assertRaisesRegex(ValueError, 'Replaced'):
                ledger.dispose(entry)
        self.assertEqual(Path(entry['quarantine']).read_bytes(), b'foreign replacement')
        self.assertEqual((self.scratch / 'preserved-owned').read_bytes(), b'owned')

    def test_repeat_disposal_is_noop_for_a_new_object_and_borrowed_escape_refuses(self):
        ledger = resources.Disposables()
        ledger.configure(self.scratch)
        self.addCleanup(ledger.close)
        file = self.scratch / 'owned'
        file.write_bytes(b'owned')
        entry = ledger.register(file)
        ledger.seal(entry)
        ledger.dispose(entry)
        file.write_bytes(b'new foreign object')
        ledger.dispose(entry)
        self.assertEqual(file.read_bytes(), b'new foreign object')
        with self.assertRaisesRegex(ValueError, 'escapes'):
            ledger.register(self.original)

    def test_secondary_settlement_failure_does_not_hide_original_timeout(self):
        def body():
            Run(self.scratch, self.original, 'a' * 64)
            try:
                raise TimeoutError('original effect unknown')
            finally:
                with resources.preserve_failure():
                    raise RuntimeError('secondary shutdown failure')
        with self.assertRaisesRegex(TimeoutError, 'original effect unknown'):
            self.invoke(body)
        self.assertTrue(list(self.scratch.glob('settlement-failure-*.json')))
        self.assertTrue(list(self.scratch.glob('native-*/trainer.sqlite')))

    def test_readonly_probe_copy_disposal_never_chmods_borrowed_original(self):
        from release_smoke import protect_resources
        bundle = self.root / 'source.app'
        bundle.mkdir()
        (bundle / 'node').write_bytes(b'original')
        (bundle / 'node').chmod(0o700)
        mode = (bundle / 'node').stat().st_mode
        self.invoke(lambda: resources.copy_tree(bundle, self.scratch / 'Probe.app', prepare=protect_resources))
        self.assertFalse((self.scratch / 'Probe.app').exists())
        self.assertEqual((bundle / 'node').stat().st_mode, mode)

    def test_disposition_write_failure_preserves_original_exception(self):
        def body():
            Run(self.scratch, self.original, 'a' * 64)
            raise ValueError('original failure')
        original_open = Path.open
        def open_path(path, *args, **kwargs):
            if path.name.startswith('resource-disposition-'):
                raise OSError('manifest unavailable')
            return original_open(path, *args, **kwargs)
        with patch.object(Path, 'open', open_path), self.assertRaisesRegex(ValueError, 'original failure'):
            self.invoke(body)
        self.assertTrue(list(self.scratch.glob('native-*/trainer.sqlite')))


if __name__ == '__main__':
    unittest.main()
