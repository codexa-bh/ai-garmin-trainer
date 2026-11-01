"""All grants and artifacts below are authored synthetic stand-ins, never real approval."""
import argparse
import contextlib
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch
import uuid

from native_smoke import Run, fingerprint, private_json, readonly
from smoke_input import CLASSES, SCENARIOS, authorize, database_state, json_document, prepare, private_file, recipe_command


class InputTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name).resolve()
        self.root.chmod(0o700)
        self.args = argparse.Namespace(input_file=None, grant_file=None, provenance_file=None, task_id='T9001', anchor='2026-11-01')

    def tearDown(self):
        self.temporary.cleanup()

    def standin(self):
        output = recipe_command(['create', str(self.root), 'smoke-input-' + str(uuid.uuid4()), '2026-11-01'])
        database = Path(output['path'])
        with contextlib.closing(sqlite3.connect(database)) as db:
            db.executescript('delete from message;delete from conversation;')
            original = fingerprint(db)
        selection = self.root / 'standin-selection.json'
        provenance = self.root / 'standin-provenance.json'
        private_json(selection, {'database': str(database)})
        private_json(provenance, {'schemaVersion': 1, 'artifactId': 'synthetic-test-only', 'artifactVersion': '1', 'logicalHash': original['logicalHash'], 'dataClasses': CLASSES, 'originalPreserved': True})
        grant = {'schemaVersion': 1, 'grantId': 'synthetic-test-not-operator-approval', 'revision': 1, 'status': 'active', 'kind': 'standing', 'consumerTask': None,
                 'approval': {'operator': 'authored-test-standin', 'evidence': 'synthetic unit test only; not real authorization'},
                 'artifactId': 'synthetic-test-only', 'artifactVersion': '1', 'selectionSha256': hashlib.sha256(selection.read_bytes()).hexdigest(), 'provenanceSha256': hashlib.sha256(provenance.read_bytes()).hexdigest(), 'logicalHash': original['logicalHash'],
                 'epic': 'E0007', 'scenarios': SCENARIOS, 'dataClasses': CLASSES,
                 'validFrom': '2020-01-01T00:00:00Z', 'expiresAt': '2090-01-01T00:00:00Z', 'retentionUntil': '2090-01-02T00:00:00Z',
                 'originalReadOnly': True, 'primaryWrite': False, 'credentials': False, 'externalTransmission': False}
        path = self.root / 'standin-grant.json'
        private_json(path, grant)
        self.args.input_file, self.args.grant_file, self.args.provenance_file, self.args.anchor = str(selection), str(path), str(provenance), None
        return path, grant, database, original

    def replace_grant(self, path, grant):
        # Simulate the owner publishing a current revision; never alter real input.
        staged = self.root / ('revision-' + str(uuid.uuid4()))
        private_json(staged, grant)
        staged.replace(path)

    def test_synthetic_default_is_private_deterministic_preparation_with_no_launch(self):
        with patch('native_smoke.Run.start') as launch, patch('smoke_input.authorize', side_effect=AssertionError('no private route')):
            a = prepare(self.root, self.args, 'native')
            b = prepare(self.root, self.args, 'ordinary')
            a.verify_current(); b.verify_current()
            self.assertEqual(a.original, b.original)
            self.assertNotEqual(a.database, b.database)
            self.assertEqual(a.provenance['route'], 'authored-synthetic')
            self.assertFalse(a.provenance['personalInputRead'])
            self.assertEqual(set(json_document(a.root / 'selection.json')[1]), {'database'})
            launch.assert_not_called()

    def test_valid_standing_grant_reuses_across_tasks_preserves_original_and_rechecks_revocation_before_boot(self):
        path, grant, database, original = self.standin()
        first = prepare(self.root, self.args, 'native')
        self.args.task_id = 'T9002'
        second = prepare(self.root, self.args, 'ordinary')
        self.assertNotEqual(first.database, second.database)
        first.verify_current(); second.verify_current()
        with contextlib.closing(readonly(database)) as db:
            self.assertEqual(original, fingerprint(db))
        self.replace_grant(path, {**grant, 'revision': 2, 'status': 'revoked'})
        for prepared in [first, second]:
            with self.assertRaises(ValueError):
                prepared.verify_current()
        run = Run(self.root, first.database, 'a' * 64)
        run.before_start = first.verify_current
        with patch.object(run, 'spawn') as launch:
            with self.assertRaises(ValueError):
                run.start(Path('/never-launched'))
            launch.assert_not_called()
            self.assertEqual(run.launches, 0)

    def test_grant_negative_matrix_and_oneoff_compatibility(self):
        path, grant, _, _ = self.standin()
        now = datetime(2026, 11, 1, tzinfo=timezone.utc)
        cases = [
            {'schemaVersion': 2}, {'schemaVersion': True}, {'revision': 0}, {'revision': True}, {'status': 'revoked'}, {'status': 'unknown'}, {'epic': 'E9999'}, {'kind': 'other'}, {'consumerTask': 'T9001'}, {'scenarios': ['ordinary']}, {'scenarios': ['native', 'private-eval']}, {'dataClasses': ['credentials']}, {'primaryWrite': True}, {'credentials': True}, {'externalTransmission': True}, {'originalReadOnly': False}, {'expiresAt': '2025-01-01T00:00:00Z'}, {'validFrom': '2080-01-01T00:00:00Z'}, {'retentionUntil': '2025-01-01T00:00:00Z'}, {'retentionUntil': None}, {'logicalHash': 'wrong'}, {'approval': {'operator': '', 'evidence': ''}}, {'unknown': True},
        ]
        for changes in cases:
            with self.subTest(changes=changes):
                self.replace_grant(path, {**grant, **changes})
                with self.assertRaises(ValueError): authorize(path, 'T9001', 'native', now)
        oneoff = {**grant, 'kind': 'one-off', 'consumerTask': 'T9001'}
        self.replace_grant(path, oneoff)
        self.assertEqual(authorize(path, 'T9001', 'native', now)[1], oneoff)
        with self.assertRaises(ValueError): authorize(path, 'T9002', 'native', now)

    def test_missing_authority_refuses_before_opening_selection_or_launching(self):
        self.args.input_file, self.args.anchor = str(self.root / 'unopened-personal-selection'), None
        with patch('smoke_input.json_document', side_effect=AssertionError('must not read selection')), patch('native_smoke.Run.start') as launch:
            with self.assertRaisesRegex(ValueError, 'applicable grant required'):
                prepare(self.root, self.args, 'native')
            launch.assert_not_called()
        self.assertEqual(list(self.root.iterdir()), [])

    def test_identity_provenance_content_and_current_revision_mismatches_never_fall_back(self):
        path, grant, database, _ = self.standin()
        for changes in [{'selectionSha256': '0' * 64}, {'provenanceSha256': '0' * 64}, {'logicalHash': '0' * 64}, {'artifactVersion': '2'}]:
            self.replace_grant(path, {**grant, **changes})
            with self.assertRaises(ValueError): prepare(self.root, self.args, 'native')
        self.replace_grant(path, grant)
        prepared = prepare(self.root, self.args, 'native')
        self.replace_grant(path, {**grant, 'revision': 2})
        with self.assertRaises(ValueError): prepared.verify_current()
        self.replace_grant(path, grant)
        with contextlib.closing(sqlite3.connect(database)) as db:
            db.execute('update daily_health set steps=steps+1'); db.commit()
        with self.assertRaises(ValueError): prepared.verify_current()
        with self.assertRaises(ValueError): prepare(self.root, self.args, 'native')

    def test_file_boundary_refuses_alias_hardlink_public_foreign_type_unbounded_duplicate_and_extra_keys(self):
        file = self.root / 'document.json'
        private_json(file, {'database': 'synthetic-only'})
        for name in ['alias', 'hardlink']:
            target = self.root / name
            if name == 'alias': target.symlink_to(file)
            else: os.link(file, target)
            with self.assertRaises(ValueError): private_file(target, 8192)
        with self.assertRaises(ValueError): private_file(file, 8192)
        other = self.root / 'other.json'; private_json(other, {})
        other.chmod(0o644)
        with self.assertRaises(ValueError): json_document(other)
        other.chmod(0o600)
        other.write_text('{"duplicate":1,"duplicate":2}')
        with self.assertRaises(ValueError): json_document(other)
        other.write_bytes(b'x' * 8193)
        with self.assertRaises(ValueError): json_document(other)
        with self.assertRaises(ValueError): private_file(self.root, 8192)
        with self.assertRaises(ValueError): private_file('relative', 8192)
        with patch('smoke_input.os.getuid', return_value=-1):
            with self.assertRaises(ValueError): private_file(other, 8192)

    def test_implicit_sqlite_sidecars_cannot_alias_or_bypass_private_file_policy(self):
        database = self.root / 'synthetic.sqlite'
        database.write_bytes(b'authored standin'); database.chmod(0o600)
        target = self.root / 'outside-selection'; target.write_bytes(b'never-consumed'); target.chmod(0o600)
        wal = Path(str(database) + '-wal'); wal.symlink_to(target)
        with self.assertRaises(ValueError): database_state(database)
        wal.unlink()  # Test-owned alias only, never owner/real artifact cleanup.
        wal.write_bytes(b''); wal.chmod(0o644)
        with self.assertRaises(ValueError): database_state(database)
        wal.chmod(0o600)
        self.assertIn('-wal', database_state(database)[1])
        journal = Path(str(database) + '-journal'); journal.write_bytes(b''); journal.chmod(0o600)
        with self.assertRaisesRegex(ValueError, 'rollback journal'): database_state(database)

    def test_active_wal_copy_is_consistent_and_source_change_during_verification_refuses(self):
        path, grant, database, _ = self.standin()
        with contextlib.closing(sqlite3.connect(database)) as writer:
            writer.execute('pragma journal_mode=wal')
            writer.execute('update daily_health set steps=steps+1'); writer.commit()
            with contextlib.closing(readonly(database)) as source: logical = fingerprint(source)['logicalHash']
            provenance = Path(self.args.provenance_file)
            value = json.loads(provenance.read_text()); value['logicalHash'] = logical
            staged = self.root / 'wal-provenance'; private_json(staged, value); staged.replace(provenance)
            grant = {**grant, 'logicalHash': logical, 'provenanceSha256': hashlib.sha256(provenance.read_bytes()).hexdigest()}
            self.replace_grant(path, grant)
            prepared = prepare(self.root, self.args, 'native'); prepared.verify_current()
            self.assertEqual(prepared.original['logicalHash'], logical)
            from smoke_input import recipe_command as actual
            def mutate(arguments):
                result = actual(arguments)
                if arguments[0] == 'verify':
                    writer.execute('update daily_health set steps=steps+1'); writer.commit()
                return result
            with patch('smoke_input.recipe_command', side_effect=mutate):
                with self.assertRaises(ValueError): prepare(self.root, self.args, 'native')

    def test_rejected_runner_preparation_has_zero_process_launches(self):
        import native_smoke
        import ordinary_smoke
        for module, arguments in [(native_smoke, []), (ordinary_smoke, ['--bundle', '/never-opened'])]:
            with patch('sys.argv', ['runner', '--scratch', str(self.root), '--input-file', '/unopened', *arguments]), patch('native_smoke.subprocess.Popen') as launch:
                with self.assertRaises(ValueError): module.main()
                launch.assert_not_called()


if __name__ == '__main__':
    os.umask(0o077)
    unittest.main()
