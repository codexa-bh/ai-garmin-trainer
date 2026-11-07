from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from terrain_smoke import scenario


class TerrainContracts(unittest.TestCase):
    def run_scenario(self, fail=False):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        calls = []
        state = {'choicesReady': True, 'ready': True, 'selected': False, 'highlighted': False,
                 'compact': True, 'partial': False, 'capped': False, 'contained': True,
                 'paragraphVisible': True, 'headerVisible': True}
        def command(value):
            calls.append(value)
            if value['type'] == 'captureView':
                return {'capture': str(Path(temporary.name) / 'unit.png')}
            if value['type'] == 'terrain':
                action = value['action']
                if action in ['supported', 'partial', 'capped']:
                    state.update(selected=False, highlighted=False, partial=action != 'supported', capped=action == 'capped')
                if action == 'toggle':
                    state.update(selected=not state['selected'], highlighted=not state['highlighted'])
                if fail and action == 'start':
                    state['contained'] = False
            return dict(state)
        run = SimpleNamespace(root=Path(temporary.name), command=command, wait=lambda predicate, label: None)
        return run, calls

    def test_finite_cases_toggle_reset_and_nine_captures(self):
        run, calls = self.run_scenario()
        captures = scenario(run)
        self.assertEqual(len(captures), 9)
        self.assertEqual([value['action'] for value in calls if value['type'] == 'terrain' and value['action'] in ['supported', 'partial', 'capped']], ['supported', 'partial', 'capped'])
        self.assertEqual(sum(value.get('action') == 'toggle' for value in calls), 9)
        self.assertNotIn('selector', repr(calls))
        self.assertEqual(len(list(run.root.glob('terrain-*.json'))), 9)

    def test_geometry_failure_keeps_receipt_and_never_repeats_mutation(self):
        run, calls = self.run_scenario(fail=True)
        with self.assertRaisesRegex(ValueError, 'geometry gate'):
            scenario(run)
        self.assertEqual(sum(value.get('action') == 'supported' for value in calls), 1)
        self.assertEqual(sum(value['type'] == 'captureView' for value in calls), 1)
        self.assertTrue((run.root / 'terrain-supported-wide-start.json').exists())


if __name__ == '__main__':
    unittest.main()
