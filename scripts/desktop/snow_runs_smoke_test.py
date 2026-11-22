"""Snow composition intent and assertion failures, without native allocation."""

import unittest
from unittest.mock import patch
import snow_runs_smoke as snow


class Run:
    def __init__(self, contained=True):
        self.commands = []
        self.contained = contained

    def command(self, value):
        self.commands.append(value)
        return {
            'ready': True,
            'choicesReady': True,
            'contained': self.contained,
            'edgeReached': True,
            'headerVisible': True,
            'scrollable': True,
        }

    def wait(self, predicate, _label):
        value = {
            'view': 'Trainer' if self.commands[-1].get('target') == 'Back to chat' else 'Activities'
        }
        if not predicate(value):
            raise AssertionError('readiness failed')
        return value


class SnowRunsTests(unittest.TestCase):
    def test_finite_scenarios_edges_and_navigation(self):
        run = Run()
        snow.scenario(run)
        captures = [value for value in run.commands if value['type'] == 'captureView']
        self.assertEqual(len(captures), 15)
        self.assertEqual(sum(value.get('action') == 'unproven' for value in run.commands), 1)
        self.assertEqual(sum(value.get('action') == 'times' for value in run.commands), 2)
        self.assertTrue(all(value['view'] == 'snowRuns' for value in captures))
        self.assertEqual(run.commands[-1], {'type': 'click', 'target': 'Back to chat'})
        self.assertEqual(snow.snow_scenario().configuration, 'keyless')

    def test_compact_selection_preserves_every_non_capture_action(self):
        full = Run()
        snow.scenario(full)
        for first, count in [(True, 4), (False, 0)]:
            run = Run()
            run.snow_hr_compact_captures = True
            run.snow_hr_capture_instance = first
            snow.scenario(run)
            self.assertEqual(len([c for c in run.commands if c['type'] == 'captureView']), count)
            self.assertEqual(
                [c for c in run.commands if c['type'] != 'captureView'],
                [c for c in full.commands if c['type'] != 'captureView'],
            )

    def test_failure_stops_before_capture_and_never_retries_mutations(self):
        run = Run(contained=False)
        with self.assertRaises(ValueError):
            snow.scenario(run)
        self.assertFalse(any(value['type'] == 'captureView' for value in run.commands))
        self.assertEqual(sum(value.get('action') == 'populated' for value in run.commands), 1)

    def test_not_ready_propagates_without_retry(self):
        run = Run()
        with patch.object(run, 'wait', side_effect=TimeoutError('unknown effect')):
            with self.assertRaises(TimeoutError):
                snow.scenario(run)
        self.assertEqual(len(run.commands), 2)


if __name__ == '__main__':
    unittest.main()
