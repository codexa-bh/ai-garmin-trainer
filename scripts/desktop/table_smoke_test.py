import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from table_smoke import scenario


class TableScenarioContracts(unittest.TestCase):
    def test_finite_surfaces_edges_captures_and_private_local_evidence(self):
        with tempfile.TemporaryDirectory() as temporary:
            scratch = Path(temporary)
            (scratch / 'screenshots').mkdir()
            root = scratch / 'ordinary-unit'
            (root / 'screenshots').mkdir(parents=True)
            capture = root / 'screenshots/capture-unit.png'
            capture.write_bytes(b'synthetic unit bytes, not visual evidence')
            calls = []
            def command(value):
                calls.append(value)
                return {'capture': str(capture)} if value['type'] == 'captureView' else {
                    'compact': True, 'proseWrapped': True, 'contained': True,
                    'scrollable': True, 'edgeReached': True, 'allCells': True, 'headerVisible': True}
            run = SimpleNamespace(root=root, command=command, wait=lambda predicate, label: None)
            images = scenario(run, scratch)
            self.assertEqual(len(images), 12)
            self.assertEqual([(value['surface'], value['edge']) for value in calls if value['type'] == 'tables'],
                             [(surface, edge) for surface in ['chat', 'chat-simple', 'plan', 'review'] for edge in ['start', 'start', 'end']])
            self.assertEqual([value['target'] for value in calls if value['type'] == 'click'], ['Training Plan'])
            self.assertTrue(all(Path(value['capture']).parent == scratch / 'screenshots' for value in images))
            self.assertEqual(len(list(root.glob('table-capture-*.json'))), 12)
            self.assertNotIn('selector', repr(calls))
            for path in root.glob('table-capture-*.json'):
                self.assertTrue(json.loads(path.read_text())['observation']['allCells'])

    def test_geometry_failure_retains_capture_and_does_not_repeat_action(self):
        with tempfile.TemporaryDirectory() as temporary:
            scratch = Path(temporary)
            (scratch / 'screenshots').mkdir()
            root = scratch / 'ordinary-unit'
            (root / 'screenshots').mkdir(parents=True)
            capture = root / 'screenshots/capture-unit.png'
            capture.write_bytes(b'unit evidence')
            calls = []
            def command(value):
                calls.append(value)
                return {'capture': str(capture)} if value['type'] == 'captureView' else {
                    'compact': False, 'proseWrapped': True, 'contained': True,
                    'scrollable': True, 'edgeReached': True, 'allCells': True, 'headerVisible': True}
            run = SimpleNamespace(root=root, command=command, wait=lambda predicate, label: None)
            with self.assertRaisesRegex(ValueError, 'geometry gate'):
                scenario(run, scratch)
            self.assertEqual(sum(value['type'] == 'tables' for value in calls), 1)
            self.assertEqual(len(list((scratch / 'screenshots').glob('*.png'))), 1)
            self.assertTrue((root / 'table-capture-chat-wide-start.json').exists())


if __name__ == '__main__':
    unittest.main()
