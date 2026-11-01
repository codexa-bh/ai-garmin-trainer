import contextlib
import json
import os
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

from native_smoke import Run, canonical, fingerprint, readonly


class OwnershipTests(unittest.TestCase):
    def test_online_backup_is_independent_private_and_does_not_change_source(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            source = root / 'populated.sqlite'
            with contextlib.closing(sqlite3.connect(source)) as db:
                db.execute('pragma journal_mode=wal')
                db.execute('create table example (id integer, value text)')
                db.execute('insert into example values (1, "test fixture")')
                db.commit()
                baseline = fingerprint(db)
                first = Run(root, source, 'a' * 64)
                second = Run(root, source, 'a' * 64)
                self.assertNotEqual(first.root, second.root)
                self.assertNotEqual(first.config['token'], second.config['token'])
                self.assertEqual(fingerprint(db), baseline)
            for run in [first, second]:
                self.assertEqual(run.database.stat().st_mode & 0o777, 0o600)
                self.assertEqual(run.root.stat().st_mode & 0o777, 0o700)
                settings = json.loads((run.root / 'config/settings-v2.json').read_text())
                self.assertEqual(settings['version'], 2)
                self.assertEqual(settings['keys'], {})
                with contextlib.closing(readonly(run.database)) as copy:
                    self.assertEqual(fingerprint(copy), baseline)
                # A receipt/PID is never shutdown authority without a live handle.
                with patch('native_smoke.os.killpg') as kill:
                    run.pids = [1234]
                    run.stop()
                    kill.assert_not_called()

    def test_health_preparation_is_bounded_copy_only_prelaunch_and_never_repeated(self):
        from datetime import date, timedelta
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            source = root / 'populated.sqlite'
            with contextlib.closing(sqlite3.connect(source)) as db:
                db.execute('create table daily_health(date text primary key, availability text, steps real)')
                db.executemany('insert into daily_health values (?, ?, ?)', [
                    ((date(2026, 1, 31) - timedelta(days=index)).isoformat(), 'partial', index)
                    for index in range(30)])
                db.commit()
                baseline = fingerprint(db)
                run = Run(root, source, 'a' * 64)
                run.prepare_health_comparison()
                self.assertEqual(fingerprint(db), baseline)
            with contextlib.closing(readonly(run.database)) as copy:
                self.assertEqual(fingerprint(copy)['counts']['daily_health'], 29)
                self.assertIsNone(copy.execute("select date from daily_health where date='2026-01-21'").fetchone())
                self.assertEqual(copy.execute('select count(*) from daily_health where availability=\'partial\'').fetchone()[0], 29)
            gapped = Run(root, run.database, 'a' * 64)
            with contextlib.closing(readonly(gapped.database)) as copy:
                gapped_before = fingerprint(copy)
            gapped.prepare_health_comparison()
            with contextlib.closing(readonly(gapped.database)) as copy:
                self.assertEqual(fingerprint(copy), gapped_before)
            existing = json.loads((gapped.root / 'health-preparation.json').read_text())
            self.assertTrue(existing['existingInputGap'])
            self.assertEqual(existing['removedDailyRowCount'], 0)
            receipt = json.loads((run.root / 'health-preparation.json').read_text())
            self.assertTrue(receipt['copyOnly'])
            self.assertEqual(receipt['removedDailyRowCount'], 1)
            with self.assertRaisesRegex(ValueError, 'unlaunched owned copy'):
                run.prepare_health_comparison()
            fresh = Run(root, source, 'a' * 64)
            fresh.launches = 1
            with self.assertRaisesRegex(ValueError, 'unlaunched owned copy'):
                fresh.prepare_health_comparison()
            empty = Run(root, source, 'a' * 64)
            with sqlite3.connect(empty.database) as copy:
                copy.execute("update daily_health set availability='complete'")
            with self.assertRaisesRegex(ValueError, 'lacks a partial'):
                empty.prepare_health_comparison()
            with contextlib.closing(readonly(empty.database)) as copy:
                self.assertEqual(fingerprint(copy)['counts']['daily_health'], 30)

    def test_failed_settlement_remains_failed_after_native_handle_is_reaped(self):
        from unittest.mock import Mock
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            source = root / 'populated.sqlite'
            with contextlib.closing(sqlite3.connect(source)) as db:
                db.execute('create table example(id integer)')
            run = Run(root, source, 'a' * 64)
            run.child = Mock(returncode=-9)
            run.child.poll.return_value = -9
            run.launches = 1
            Path(str(run.database) + '.trainer-writer').write_text('unknown owner')
            with patch('native_smoke.time.monotonic', side_effect=[0, 20]), patch('native_smoke.listening', return_value=False), patch('native_smoke.os.killpg') as kill:
                with self.assertRaisesRegex(RuntimeError, 'shutdown incomplete'):
                    run.stop()
                self.assertIsNone(run.child)
                with self.assertRaisesRegex(RuntimeError, 'shutdown incomplete'):
                    run.stop()
                kill.assert_not_called()

    def test_client_never_retries_a_mismatched_or_failed_mutation(self):
        from unittest.mock import Mock
        for response in [{'requestId': 'wrong', 'result': {'ok': True}}, {'result': {'ok': False}}]:
            run = Run.__new__(Run)
            run.id = 'unit'
            run.observer = None
            run.http = Mock(return_value=response)
            with self.assertRaises(ValueError):
                run.command({'type': 'click', 'target': 'Save Profile'})
            self.assertEqual(run.http.call_count, 1)

    def test_health_scenario_is_finite_and_never_retries_failed_actions(self):
        from unittest.mock import Mock
        run = Run.__new__(Run)
        run.root = Path('/unused')
        run.wait = Mock()
        run.command = Mock(return_value={'ok': True, 'healthPreviousEnabled': True})
        with patch('native_smoke.private_json') as receipt:
            run.health_scenario()
            self.assertTrue(receipt.call_args.args[1]['rangeTabsAwayBack'])
        actions = [call.args[0] for call in run.command.call_args_list]
        self.assertEqual([action['action'] for action in actions if action['type'] == 'health'], [
            'previous', 'next', 'previous', 'remember-range', 'weekly', 'monthly', 'daily',
            'assert-range', 'assert-range', 'capture-narrow', 'capture-wide', 'latest'])
        self.assertFalse(any(action['type'] in ['input', 'assert'] for action in actions))
        run.command = Mock(side_effect=[{'healthPreviousEnabled': True}, ValueError('effect unknown')])
        with self.assertRaises(ValueError):
            run.health_scenario()
        self.assertEqual(run.command.call_count, 2)
        run.command = Mock(return_value={'healthPreviousEnabled': False})
        with self.assertRaisesRegex(ValueError, 'lacks older'):
            run.health_scenario()
        self.assertEqual(run.command.call_count, 1)

    def test_readonly_resources_preserve_executable_node(self):
        from release_smoke import protect_resources
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            executable = root / 'node'
            data = root / 'runtime.cjs'
            executable.write_bytes(b'unit executable mode fixture')
            executable.chmod(0o700)
            data.write_bytes(b'unit data fixture')
            data.chmod(0o600)
            protect_resources(root)
            self.assertEqual(executable.stat().st_mode & 0o777, 0o500)
            self.assertEqual(data.stat().st_mode & 0o777, 0o400)

    def test_ordinary_audit_requires_supported_contract_and_excludes_legacy_admission(self):
        from release_smoke import audit, MARKERS, REQUIRED
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            file = root / 'ordinary-fixture'
            supported = b' '.join(REQUIRED) + b' smoke_result __trainerSmoke'
            file.write_bytes(supported)
            self.assertEqual(len(audit(root)), 1)
            for marker in MARKERS:
                file.write_bytes(supported + b' ' + marker)
                with self.assertRaises(ValueError):
                    audit(root)
            for required in REQUIRED:
                file.write_bytes(b' '.join(marker for marker in REQUIRED if marker != required))
                with self.assertRaises(ValueError):
                    audit(root)

    def test_reused_run_and_aliases_refuse(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            alias = root / 'alias'
            alias.symlink_to(root, target_is_directory=True)
            with self.assertRaises(ValueError):
                canonical(alias)
            with self.assertRaises(ValueError):
                canonical(Path('relative'))
            self.assertEqual(canonical(root), root)

    def test_occupied_endpoint_never_launches_or_kills(self):
        import socket
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            source = root / 'populated.sqlite'
            with contextlib.closing(sqlite3.connect(source)) as db:
                db.execute('create table example (id integer)')
            run = Run(root, source, 'b' * 64)
            with socket.socket() as listener:
                listener.bind(('127.0.0.1', run.config['port']))
                listener.listen()
                with patch('native_smoke.subprocess.Popen') as launch:
                    with self.assertRaises(ValueError):
                        run.start(root / 'not-executed')
                    launch.assert_not_called()


if __name__ == '__main__':
    os.umask(0o077)
    unittest.main()
