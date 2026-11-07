from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from activity_labels_smoke import scenario


class ActivityLabelsContracts(unittest.TestCase):
    def test_finite_actions_and_six_captures(self):
        with tempfile.TemporaryDirectory() as directory:
            calls = []
            def command(value):
                calls.append(value)
                if value['type'] == 'captureView':
                    return {'capture': 'synthetic'}
                return {'choicesReady': True, 'ready': True, 'contained': True}
            run = SimpleNamespace(root=Path(directory), command=command, wait=lambda predicate, label: None)
            self.assertEqual(len(scenario(run)), 6)
            self.assertEqual([item['action'] for item in calls if item.get('action') in ['strength', 'gravel', 'hiking']], ['strength', 'gravel', 'hiking'])
            self.assertNotIn('selector', repr(calls))

    def test_failed_containment_does_not_repeat_selection(self):
        with tempfile.TemporaryDirectory() as directory:
            calls = []
            def command(value):
                calls.append(value)
                if value['type'] == 'captureView':
                    return {'capture': 'synthetic'}
                return {'choicesReady': True, 'ready': True, 'contained': False}
            run = SimpleNamespace(root=Path(directory), command=command, wait=lambda predicate, label: None)
            with self.assertRaisesRegex(ValueError, 'overflow'):
                scenario(run)
            self.assertEqual(sum(item.get('action') == 'strength' for item in calls), 1)
            self.assertEqual(sum(item['type'] == 'captureView' for item in calls), 1)


if __name__ == '__main__':
    unittest.main()
