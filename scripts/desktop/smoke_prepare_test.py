"""Authored CLI/category composition and finite task-owned rehearsal contracts."""
import contextlib
import io
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

import smoke_input
import smoke_resources as resources
from native_smoke import REPO, Run, fingerprint, readonly


class PrepareCliTests(unittest.TestCase):
    def setUp(self):
        previous_umask = os.umask(0o077)
        self.addCleanup(os.umask, previous_umask)
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.task = self.root / 'epics/E0007-authored/T9001-authored'
        self.task.mkdir(parents=True)
        self.scratch = self.root / 'tmp/E0007/T9001'
        self.scratch.mkdir(parents=True, mode=0o700)
        self.bin = self.root / 'bin'
        self.bin.mkdir()
        self.tool = self.bin / 'pivan-harness'
        self.tool.write_text('#!' + sys.executable + '\n' + '''import os, pathlib, sys
args = sys.argv[1:]
assert args[:2] == ['task-scratch', 'path'] and args[-1] == '--create'
task = pathlib.Path(args[2])
category = args[args.index('--category') + 1]
root = task.parents[2] / 'tmp' / task.parent.name[:5] / task.name[:5]
mode = os.environ.get('AUTHORED_ALLOCATOR', '')
if mode == 'invalid-proof':
    sys.exit('authored registration proof refused')
if mode == 'foreign':
    print('/foreign')
elif mode == 'malformed':
    print('not a path\\nextra output')
else:
    path = root / category
    path.mkdir(mode=0o700, exist_ok=True)
    if mode == 'public':
        path.chmod(0o755)
    print(path)
''')
        self.tool.chmod(0o700)
        self.env = {**os.environ, 'PIVAN_TASK_PATH': str(self.task),
                    'PATH': str(self.bin) + os.pathsep + os.environ['PATH']}

    def command(self, scratch=None, extra=(), env=None):
        return subprocess.run([sys.executable, str(REPO / 'scripts/desktop/smoke_input.py'),
                               '--scratch', str(scratch or self.scratch), '--task-id', 'T9001',
                               '--anchor', '2026-11-01', *extra],
                              env=env or self.env, capture_output=True, text=True, timeout=60)

    def records(self, result):
        self.assertEqual(result.returncode, 0, result.stderr[-2000:])
        records = [json.loads(line) for line in result.stdout.splitlines()]
        prepared = next(record for record in records if 'prepared' in record)
        receipt = json.loads(Path(next(record['resourceDisposition'] for record in records
                                      if 'resourceDisposition' in record)).read_text())
        return prepared, receipt

    def assert_output(self, result, parent):
        prepared, receipt = self.records(result)
        root = Path(prepared['prepared'])
        self.assertTrue(root.is_relative_to(parent))
        self.assertEqual(prepared['launches'], 0)
        self.assertEqual(prepared['route'], 'authored-synthetic')
        selection = json.loads((root / 'selection.json').read_text())
        self.assertEqual(set(selection), {'database'})
        database = Path(selection['database'])
        self.assertEqual(database.parent, root)
        self.assertTrue(database.exists(), 'successful CLI must not immediately dispose its output')
        self.assertEqual(root.stat().st_mode & 0o777, 0o700)
        for path in root.iterdir():
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            self.assertEqual(path.stat().st_nlink, 1)
        self.assertEqual(json.loads((root / 'selection.json').read_text()), {'database': str(database)})
        with contextlib.closing(readonly(database)) as db:
            self.assertEqual(db.execute('pragma integrity_check').fetchone()[0], 'ok')
            self.assertEqual(db.execute('pragma foreign_key_check').fetchall(), [])
        self.assertFalse(receipt['invocationFailed'])
        self.assertTrue(receipt['retentionReason'])
        self.assertTrue(all(item['status'] == 'retained' for item in receipt['artifacts']))
        return database

    def test_actual_managed_cli_routes_private_and_readable_roots_without_chmod(self):
        for mode in (0o700, 0o755):
            with self.subTest(mode=mode):
                self.scratch.chmod(mode)
                self.assert_output(self.command(), self.scratch / 'disposable')
                self.assertEqual(self.scratch.stat().st_mode & 0o777, mode)
                self.assertEqual(list((self.scratch / 'evidence').rglob('*.sqlite')), [])
                self.assertTrue(list((self.scratch / 'evidence').glob('preparation-*.json')))
                self.assertEqual(list(self.scratch.glob('input-allocation-*')), [])

    def test_external_cli_stays_independent_with_or_without_ambient_task(self):
        for ambient in (True, False):
            external = self.root / ('external-' + str(ambient))
            external.mkdir(mode=0o700)
            env = {**self.env, 'AUTHORED_ALLOCATOR': 'invalid-proof'}
            if not ambient:
                env.pop('PIVAN_TASK_PATH')
            self.assert_output(self.command(external, env=env), external)
            self.assertFalse((external / 'disposable').exists())
            self.assertFalse((self.scratch / 'evidence').exists())

    def test_managed_native_prepare_only_has_one_owner_independent_copies_and_zero_launches(self):
        result = subprocess.run([sys.executable, str(REPO / 'scripts/desktop/native_smoke.py'),
                                 '--scratch', str(self.scratch), '--task-id', 'T9001',
                                 '--anchor', '2026-11-01', '--prepare-only'],
                                env=self.env, capture_output=True, text=True, timeout=60)
        self.assertEqual(result.returncode, 0, result.stderr[-2000:])
        records = [json.loads(line) for line in result.stdout.splitlines()]
        prepared = next(record for record in records if 'prepared' in record)
        self.assertEqual(prepared['launches'], 0)
        copies = [Path(root) / 'trainer.sqlite' for root in prepared['prepared']]
        self.assertEqual(len(set(copies)), 2)
        self.assertTrue(all(path.exists() for path in copies))
        self.assertNotEqual(copies[0].stat().st_ino, copies[1].stat().st_ino)
        self.assertEqual(len(list((self.scratch / 'evidence').glob('resource-disposition-*.json'))), 1)
        self.assertEqual(list((self.scratch / 'evidence').rglob('*.sqlite')), [])

    def test_consuming_standalone_output_does_not_enroll_or_remove_borrowed_input(self):
        database = self.assert_output(self.command(), self.scratch / 'disposable')
        before = smoke_input.database_state(database)[1]
        with patch.dict(os.environ, self.env), contextlib.redirect_stdout(io.StringIO()):
            @resources.invocation
            def consumer():
                evidence = resources.configure(self.scratch)
                run = Run(evidence, database, 'a' * 64)
                self.assertNotEqual(run.database, database)
                return run.database
            copy = consumer()
        self.assertFalse(copy.exists())
        self.assertEqual(smoke_input.database_state(database)[1], before)

    def test_bad_or_missing_allocator_refuses_before_selection_access_without_fallback(self):
        for mode in ('invalid-proof', 'foreign', 'malformed', 'public', 'missing'):
            with self.subTest(mode=mode):
                env = {**self.env, 'AUTHORED_ALLOCATOR': mode}
                if mode == 'missing':
                    self.tool.rename(self.bin / 'unavailable')
                    env['PATH'] = str(self.bin)
                result = self.command(extra=('--input-file', '/authored-never-opened'), env=env)
                self.assertNotEqual(result.returncode, 0)
                self.assertNotIn('applicable grant required', result.stderr)
                self.assertNotIn('prepared', result.stdout)
                self.assertEqual(list(self.scratch.rglob('*.sqlite')), [])
                self.assertEqual(list(self.scratch.glob('input-allocation-*')), [])

    def test_original_failure_cancellation_and_secondary_receipt_error_are_preserved(self):
        for original in (TimeoutError('authored backup deadline'), KeyboardInterrupt('authored cancel'),
                         ValueError('authored verifier failure')):
            with self.subTest(original=type(original).__name__):
                def fail(scratch, *_args):
                    database = resources.runtime_path(scratch / 'partial.sqlite')
                    database.write_bytes(b'authored partial output')
                    resources.file_created(database)
                    raise original
                with patch.dict(os.environ, self.env), patch('sys.argv', ['prepare', '--scratch', str(self.scratch)]), \
                        patch('smoke_input.prepare', side_effect=fail), \
                        patch('smoke_resources.Disposables.finish', side_effect=OSError('authored receipt failure')), \
                        contextlib.redirect_stderr(io.StringIO()):
                    with self.assertRaises(type(original)) as caught:
                        smoke_input.main()
                self.assertIs(caught.exception, original)
                partial = self.scratch / 'disposable/partial.sqlite'
                self.assertEqual(partial.read_bytes(), b'authored partial output')
                partial.rename(partial.with_name('retained-' + type(original).__name__ + '.sqlite'))

    def test_successful_preparation_receipt_failure_is_nonzero_and_retains_output(self):
        output = io.StringIO()
        with patch.dict(os.environ, self.env), patch('sys.argv', ['prepare', '--scratch', str(self.scratch)]), \
                patch('smoke_resources.Disposables.finish', side_effect=OSError('authored receipt failure')), \
                contextlib.redirect_stdout(output):
            with self.assertRaisesRegex(OSError, 'authored receipt failure'):
                smoke_input.main()
        prepared = json.loads(output.getvalue())
        selection = Path(prepared['prepared']) / 'selection.json'
        self.assertTrue(Path(json.loads(selection.read_text())['database']).exists())

    def test_authored_wal_rehearsal_restore_and_run_backup_keep_compact_evidence(self):
        # Same allocator/category boundary as managed preparation; no production migration.
        with patch.dict(os.environ, self.env), contextlib.redirect_stdout(io.StringIO()):
            @resources.invocation
            def rehearsal():
                resources.retain('authored rehearsal outputs; scheduled expiry unchanged')
                evidence = resources.configure(self.scratch)
                root = resources.directory(resources.runtime_path(evidence / 'rehearsal'))
                source = root / 'authored.sqlite'
                with contextlib.closing(sqlite3.connect(source)) as writer:
                    writer.execute('pragma journal_mode=wal')
                    writer.executescript('create table sample(value integer); insert into sample values(7);')
                    before = smoke_input.database_state(source)[1]
                    original = fingerprint(writer)
                    previous = source
                    for name in ('rehearsal.sqlite', 'restore.sqlite', 'run-backup.sqlite'):
                        destination = root / name
                        fd = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
                        os.close(fd)
                        with contextlib.closing(readonly(previous)) as reader, \
                                contextlib.closing(sqlite3.connect(destination)) as copy:
                            reader.backup(copy)
                            self.assertEqual(fingerprint(copy), original)
                            self.assertEqual(copy.execute('pragma integrity_check').fetchone()[0], 'ok')
                            self.assertEqual(copy.execute('pragma foreign_key_check').fetchall(), [])
                            self.assertEqual(copy.execute('select count(*) from sample').fetchone()[0], 1)
                        previous = destination
                    self.assertEqual(smoke_input.database_state(source)[1], before)
                    self.assertEqual(fingerprint(writer), original)
                (evidence / 'rehearsal.json').write_text(json.dumps({'integrity': 'ok', 'foreignKeys': 0,
                                                                  'count': 1, 'originalPreserved': True}))
                with self.assertRaises(FileExistsError):
                    os.open(previous, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
            rehearsal()
        self.assertEqual(len(list((self.scratch / 'disposable').rglob('*.sqlite'))), 4)
        self.assertEqual(list((self.scratch / 'evidence').rglob('*.sqlite')), [])


if __name__ == '__main__':
    os.umask(0o077)
    unittest.main()
