import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from about_smoke import about, about_scenario, wait_about
from ordinary_smoke import composition_plan


class FakeRun:
    def __init__(self, root):
        self.root, self.id, self.boot = root, 'authored-run', 'authored-boot'
        self.capture_results, self.actions = [], []
        self.visible = False

    def command(self, command):
        action = command['action']
        self.actions.append(action)
        if action == 'open':
            self.visible = True
        elif action in ('escape', 'close'):
            self.visible = False
        return {
            'ok': True,
            'ready': self.visible,
            'visible': self.visible,
            'closeFocused': True,
            'linksMatch': True,
        }

    def wait(self, predicate, label):
        if not predicate({'view': 'Trainer'}):
            raise AssertionError(label)


class AboutTests(unittest.TestCase):
    def test_shared_menu_requires_full_baseline(self):
        with self.assertRaises(ValueError):
            composition_plan((about_scenario(),), 'shared', 'app menu', False)
        _, plan = composition_plan((about_scenario(),), 'shared', 'app menu', True)
        self.assertEqual(plan['instances'], 2)
        self.assertIn('about-dialog', plan['selected'])

    def test_quiet_lifecycle_never_activates_browser_links(self):
        with tempfile.TemporaryDirectory() as directory:
            run = FakeRun(Path(directory))
            about(run)
            self.assertFalse(run.visible)
            self.assertEqual(run.actions.count('open'), 3)
            self.assertNotIn('repository', run.actions)
            self.assertNotIn('licence', run.actions)
            self.assertEqual(len(run.capture_results), 1)
            self.assertTrue((run.root / 'about.json').is_file())

    def test_unknown_destruction_does_not_count_as_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            run = FakeRun(Path(directory))
            with (
                patch.object(
                    run,
                    'command',
                    side_effect=[
                        {'ok': True, 'visible': True, 'ready': False, 'unavailable': True},
                        {'ok': True, 'visible': False, 'ready': False},
                    ],
                ) as command,
                patch('about_smoke.time.sleep'),
            ):
                self.assertFalse(wait_about(run, 'visible', False)['visible'])
                self.assertEqual(command.call_count, 2)
                self.assertTrue(
                    all(call.args[0]['action'] == 'observe' for call in command.call_args_list)
                )

    def test_timeout_does_not_replay_mutation(self):
        with tempfile.TemporaryDirectory() as directory:
            run = FakeRun(Path(directory))
            with (
                patch('about_smoke.time.monotonic', side_effect=[0, 1, 10]),
                patch('about_smoke.time.sleep'),
            ):
                with self.assertRaises(TimeoutError):
                    wait_about(run, 'visible', True)
            self.assertEqual(run.actions, ['observe'])
