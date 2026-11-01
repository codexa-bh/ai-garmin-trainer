import contextlib
import fcntl
import json
import os
from pathlib import Path
import sqlite3
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import uuid

from ordinary_smoke import OrdinaryRun, inventory_hash, private_directory
from release_smoke import audit, REQUIRED


class OrdinaryContracts(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name).resolve()
        self.root.chmod(0o700)
        self.source = self.root / 'source.sqlite'
        with contextlib.closing(sqlite3.connect(self.source)) as db:
            db.execute('create table synthetic(id integer, value text)')
            db.execute("insert into synthetic values(1, 'unit only')")
            db.commit()
        self.bundle = self.root / 'unit.app'
        binary = self.bundle / 'Contents/MacOS/garmin-trainer-desktop'
        binary.parent.mkdir(parents=True)
        binary.write_bytes(b' '.join(REQUIRED))
        self.inventory = audit(self.bundle)

    def tearDown(self):
        self.temporary.cleanup()

    def run_fixture(self):
        return OrdinaryRun(self.root, self.source, 'a' * 64, self.bundle, self.inventory)

    def test_independent_private_preparation_and_unmodified_bundle_copy(self):
        first, second = self.run_fixture(), self.run_fixture()
        self.assertNotEqual(first.root, second.root)
        self.assertNotEqual(first.config['token'], second.config['token'])
        self.assertEqual(audit(first.bundle), self.inventory)
        self.assertEqual(audit(second.bundle), self.inventory)
        self.assertEqual(audit(self.bundle), self.inventory)
        for run in [first, second]:
            self.assertFalse((run.root / 'home').exists())
            self.assertFalse((run.root / 'config.json').exists())
            for name in ['app-data', 'setup-profile', 'profile', 'tmp', 'screenshots', 'config']:
                self.assertEqual((run.root / name).stat().st_mode & 0o777, 0o700)
            self.assertEqual((run.root / 'launch.json').stat().st_mode & 0o777, 0o600)
            descriptor = json.loads((run.root / 'launch.json').read_text())
            self.assertEqual(set(descriptor), {'schemaVersion', 'runId', 'root', 'sourceFingerprint', 'artifactInventoryHash', 'controlPort', 'capability'})
            self.assertEqual(descriptor['artifactInventoryHash'], inventory_hash(self.inventory))

    def test_launch_keeps_home_and_excludes_capability_from_argv_env_logs(self):
        run = self.run_fixture()
        with patch.dict(os.environ, {'HOME': '/operator-home', 'OPENAI_API_KEY': 'never-forward-this'}):
            with patch('ordinary_smoke.subprocess.Popen') as spawn:
                run.spawn(run.binary, run.root / 'unit.log')
        args, keywords = spawn.call_args
        self.assertEqual(args[0], [str(run.binary), '--isolated-smoke-run', str(run.root / 'launch.json')])
        self.assertEqual(keywords['env']['HOME'], '/operator-home')
        self.assertEqual(keywords['env']['TMPDIR'], str(run.root / 'tmp'))
        self.assertNotIn('OPENAI_API_KEY', keywords['env'])
        self.assertNotIn(run.config['token'], repr(spawn.call_args))
        self.assertEqual((run.root / 'unit.log').read_bytes(), b'')

    def test_fresh_capability_each_boot_with_private_atomic_descriptor(self):
        run = self.run_fixture()
        first, identity = run.config['token'], run.launch_identity
        run.renew_capability()
        second = run.config['token']
        self.assertNotEqual(first, second)
        self.assertNotEqual(identity, run.launch_identity)
        self.assertEqual(run.previous_token, first)
        self.assertEqual(json.loads((run.root / 'launch.json').read_text()), run.descriptor)
        run.renew_capability()
        self.assertNotEqual(second, run.config['token'])
        self.assertEqual(run.previous_token, second)
        self.assertEqual(run.descriptor['capability'], run.config['token'])
        self.assertEqual((run.root / 'launch.json').stat().st_mode & 0o777, 0o600)
        self.assertEqual((run.root / 'launch.json').stat().st_nlink, 1)
        self.assertEqual(list(run.root.glob('.launch-*')), [])

    def test_descriptor_replacement_or_alias_is_preserved_not_adopted(self):
        run = self.run_fixture()
        launch = run.root / 'launch.json'
        launch.rename(run.root / 'retained-launch.json')
        launch.write_text('foreign descriptor')
        launch.chmod(0o600)
        original = run.config['token']
        with self.assertRaises(ValueError):
            run.renew_capability()
        self.assertEqual(launch.read_text(), 'foreign descriptor')
        launch.unlink()
        target = run.root / 'foreign.json'
        target.write_text('foreign private data')
        launch.symlink_to(target)
        with self.assertRaises(ValueError):
            run.renew_capability()
        self.assertEqual(target.read_text(), 'foreign private data')
        self.assertTrue(launch.is_symlink())
        self.assertEqual(run.config['token'], original)

    def test_live_root_owner_or_replaced_root_never_gets_a_new_descriptor(self):
        run = self.run_fixture()
        original = (run.root / 'launch.json').read_bytes()
        fd = os.open(run.root, os.O_RDONLY | os.O_DIRECTORY)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with self.assertRaises(BlockingIOError):
                run.renew_capability()
            self.assertEqual((run.root / 'launch.json').read_bytes(), original)
        finally:
            os.close(fd)
        run.root.rename(run.root.with_name(run.root.name + '-retained'))
        run.root.mkdir(mode=0o700)
        launch = run.root / 'launch.json'
        launch.write_text('foreign root data')
        with self.assertRaises(ValueError):
            run.renew_capability()
        self.assertEqual(launch.read_text(), 'foreign root data')

    def test_exact_identity_and_new_boot_required_and_request_bound(self):
        run = self.run_fixture()
        run.child = SimpleNamespace(pid=12345)
        identity = {'runId': run.id, 'source': run.config['source'], 'pid': 12345, 'database': str(run.database),
                    'appIdentity': 'com.codexa.garmin-trainer.ordinary.r' + run.id.replace('-', ''),
                    'artifactKind': 'ordinary', 'buildMode': 'release', 'launchMode': 'isolated', 'controlContract': 'trainer-ordinary-isolated/v1',
                    'artifactInventoryHash': run.artifact, 'boot': str(uuid.uuid4())}
        for key, wrong in [('runId', str(uuid.uuid4())), ('source', 'b' * 64), ('pid', 1), ('database', '/normal/data.sqlite'),
                           ('buildMode', 'debug'), ('artifactKind', 'probe'), ('controlContract', 'wrong-version'), ('artifactInventoryHash', 'b' * 64)]:
            self.assertFalse(run.accept_identity({**identity, key: wrong}))
        self.assertTrue(run.accept_identity(identity))
        self.assertEqual(run.request({'type': 'observe'}, 'unit')['expectedBoot'], identity['boot'])
        run.previous_boot = identity['boot']
        self.assertFalse(run.accept_identity(identity))
        run.child = None

    def test_capture_navigation_returns_to_visible_wide_controls_before_each_destination(self):
        run = self.run_fixture()
        commands = []
        run.command = lambda command: commands.append(command) or {'ok': True}
        run.wait = lambda predicate, label: None
        run.captures()
        preset = 'wide'
        captures = []
        for command in commands:
            if command['type'] == 'setViewport':
                preset = command['preset']
            if command['type'] == 'click':
                self.assertEqual(preset, 'wide')
            if command['type'] == 'captureView':
                captures.append((command['view'], command['preset']))
                self.assertEqual(preset, command['preset'])
        self.assertEqual(captures, [(view, preset) for view in ['trainer', 'sync', 'profile'] for preset in ['wide', 'narrow']])

    def test_private_scratch_alias_and_foreign_inventory_denied(self):
        self.assertEqual(private_directory(self.root), self.root)
        self.root.chmod(0o755)
        with self.assertRaises(ValueError):
            private_directory(self.root)
        self.root.chmod(0o700)
        alias = self.root / 'alias'
        alias.symlink_to(self.root, target_is_directory=True)
        with self.assertRaises(ValueError):
            private_directory(alias)
        with self.assertRaises(ValueError):
            inventory_hash({'bad\npath': 'a' * 64})

    def test_receipts_without_live_handles_never_authorize_signals_or_lease_stealing(self):
        run = self.run_fixture()
        run.pids = [12345]
        fd = os.open(run.root, os.O_RDONLY | os.O_DIRECTORY)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with patch('native_smoke.os.killpg') as kill:
                with self.assertRaises(BlockingIOError):
                    run.stop()
                kill.assert_not_called()
        finally:
            fcntl.flock(fd, fcntl.LOCK_UN)
            os.close(fd)
        run.stop()


if __name__ == '__main__':
    unittest.main()
