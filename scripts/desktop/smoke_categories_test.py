import contextlib
import io
import json
import os
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch
from types import SimpleNamespace

import smoke_resources as resources
from smoke_categories import CategoryPaths
from native_smoke import Run


class CategoryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.task = self.root / 'epics/E0005-epic/T1492-task'
        self.task.mkdir(parents=True)
        self.scratch = self.root / 'tmp/E0005/T1492'
        self.scratch.mkdir(parents=True, mode=0o700)
        self.original = self.root / 'borrowed.sqlite'
        with sqlite3.connect(self.original) as db:
            db.execute('create table example(value text)')
        self.original_bytes = self.original.read_bytes()
        self.commands = []

    def cli(self, command, **kwargs):
        self.commands.append(command)
        path = self.scratch / command[command.index('--category') + 1]
        path.mkdir(mode=0o700, exist_ok=True)
        return SimpleNamespace(returncode=0, stdout=str(path) + '\n', stderr='')

    def invoke(self, body):
        @resources.invocation
        def main():
            scratch = resources.configure(self.scratch)
            return body(scratch)
        with patch.dict(os.environ, PIVAN_TASK_PATH=str(self.task)), patch('smoke_categories.subprocess.run', side_effect=self.cli), contextlib.redirect_stdout(io.StringIO()):
            return main()

    def test_managed_runtime_evidence_and_owned_disposal_are_separate(self):
        state = {}
        def body(scratch):
            self.assertEqual(scratch, self.scratch / 'evidence')
            run = Run(scratch, self.original, 'a' * 64)
            state['run'] = run
            self.assertEqual(run.root.parent, self.scratch / 'disposable')
            (run.root / 'scenario.json').write_text('{"passed":true}')
            (run.root / 'screenshots/scenario.png').write_bytes(b'PNG fixture')
            (run.root / 'native.log').write_text('bounded synthetic diagnostic')
        self.invoke(body)
        run = state['run']
        evidence = self.scratch / 'evidence' / run.root.name
        self.assertEqual((evidence / 'scenario.json').read_text(), '{"passed":true}')
        self.assertEqual((evidence / 'screenshots/scenario.png').read_bytes(), b'PNG fixture')
        self.assertFalse((evidence / 'trainer.sqlite').exists())
        self.assertFalse(run.database.exists())
        self.assertEqual(self.original.read_bytes(), self.original_bytes)
        receipt = json.loads(next((self.scratch / 'evidence').glob('resource-disposition-*.json')).read_text())
        self.assertFalse(receipt['recoveryHold'])
        self.assertTrue(all(item['status'] == 'removed' for item in receipt['artifacts']))
        self.assertFalse(any(command[2] == 'preserve' for command in self.commands))

    def test_failed_or_prepare_only_allocations_hold_original_recovery_not_duplicate_bulk(self):
        state = {}
        def body(scratch):
            run = Run(scratch, self.original, 'a' * 64)
            state['run'] = run
            raise TimeoutError('original unknown effect')
        with self.assertRaisesRegex(TimeoutError, 'original unknown effect'):
            self.invoke(body)
        self.assertTrue(state['run'].database.exists())
        self.assertTrue(any(command[2] == 'preserve' for command in self.commands))
        self.assertFalse(list((self.scratch / 'evidence').rglob('*.sqlite')))
        self.assertEqual(self.original.read_bytes(), self.original_bytes)

    def test_evidence_alias_refuses_disposal_and_holds_category(self):
        state = {}
        def body(scratch):
            run = Run(scratch, self.original, 'a' * 64)
            state['run'] = run
            (run.root / 'screenshots/alias.png').symlink_to(self.original)
        with self.assertRaisesRegex(RuntimeError, 'disposal deferred'):
            self.invoke(body)
        self.assertTrue(state['run'].database.exists())
        self.assertTrue(any(command[2] == 'preserve' for command in self.commands))

    def test_standalone_scratch_and_wrong_resolver_or_old_tooling(self):
        with patch.dict(os.environ, PIVAN_TASK_PATH=str(self.task)):
            other = self.root / 'standalone'
            other.mkdir(mode=0o700)
            paths = CategoryPaths(other)
            self.assertEqual(paths.evidence, other)
            self.assertIsNone(paths.task)
            with patch('smoke_categories.subprocess.run', return_value=SimpleNamespace(returncode=2, stdout='', stderr='unknown category')):
                with self.assertRaisesRegex(RuntimeError, 'Compatible category tooling'):
                    CategoryPaths(self.scratch)
            with patch('smoke_categories.subprocess.run', return_value=SimpleNamespace(returncode=0, stdout='/foreign', stderr='')):
                with self.assertRaisesRegex(ValueError, 'foreign'):
                    CategoryPaths(self.scratch)


if __name__ == '__main__':
    unittest.main()
