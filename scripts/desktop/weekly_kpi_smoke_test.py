import unittest
from unittest.mock import patch
import weekly_kpi_smoke as kpis


class Run:
    def __init__(self):
        self.commands = []
        self.progress = False

    def command(self, command):
        self.commands.append(command)
        if command.get('action') in ['progress', 'oneMonth', 'threeMonths', 'twelveMonths']:
            self.progress = True
        if command.get('action') in ['previous', 'current', 'next']:
            self.progress = False
        if command['type'] == 'setViewport':
            self.preset = command['preset']
        if command.get('target') == 'Training Plan':
            if getattr(self, 'preset', 'wide') != 'wide':
                raise ValueError('Desktop navigation hidden at narrow viewport')
            self.progress = False
        if command['type'] == 'captureView':
            return {'capture': '/owned/capture.png', 'boundary': 'geometry-preserving redacted own-WebView'}
        return {'ready': True, 'progress': self.progress, 'aboveHundred': True,
                'unknown': True, 'gaps': self.progress, 'contained': True,
                'notesCorrect': not self.progress, 'allCharts': self.progress,
                'chartsSized': self.progress, 'rangeCorrect': self.progress, 'bottomVisible': command.get('action') == 'bottom'}

    def wait(self, predicate, _label):
        if not predicate({'view': 'Trainer'}):
            raise ValueError('Unexpected navigation destination')


class WeeklyKpiRunnerTests(unittest.TestCase):
    def test_finite_scenario_captures_both_views_and_sizes_without_write_actions(self):
        run = Run()
        result = kpis.scenario(run)
        expected = [(view, size, edge) for view in ['current', 'next', 'previous'] for size in ['wide', 'narrow'] for edge in ['frame', 'notes']]
        expected += [('progress', size, edge) for size in ['wide', 'narrow', 'wide-short', 'narrow-short'] for edge in ['frame', 'middle', 'bottom']]
        expected += [('progress', size, 'bottom') for size in ['wide', 'narrow']]
        expected += [(view, size, edge) for view in ['oneMonth', 'threeMonths', 'twelveMonths'] for size in ['wide', 'narrow'] for edge in ['frame', 'middle', 'bottom']]
        self.assertEqual([(value['view'], value['preset'], value['edge']) for value in result], expected)
        self.assertFalse(any(value.get('action') in ['reload', 'measurement'] for value in run.commands))
        self.assertTrue(all(set(value) <= {'type', 'action', 'target', 'view', 'preset'} for value in run.commands))
        self.assertEqual([value['target'] for value in run.commands if value['type'] == 'click'],
                         ['Training Plan', 'Back to chat', 'Training Plan'])
        self.assertFalse(run.progress)

    def test_reentry_must_reset_progress_without_retry_or_restart(self):
        run = Run()
        original = run.command
        def retained_mode(value):
            was_progress = run.progress
            result = original(value)
            if value.get('target') == 'Training Plan' and was_progress:
                run.progress = True
            return result
        run.command = retained_mode
        run.root = __import__('pathlib').Path('/owned')
        with patch.object(kpis.time, 'monotonic', side_effect=range(1000)), patch.object(kpis.time, 'sleep'), patch.object(kpis, 'private_json'):
            with self.assertRaises(TimeoutError):
                kpis.scenario(run)
        self.assertEqual(sum(value.get('target') == 'Training Plan' for value in run.commands), 2)

    def test_internal_current_must_leave_progress_without_retry(self):
        run = Run()
        original = run.command
        def retained_progress(value):
            result = original(value)
            if value.get('action') == 'current':
                run.progress = True
                result['progress'] = True
            return result
        run.command = retained_progress
        run.root = __import__('pathlib').Path('/owned')
        with patch.object(kpis.time, 'monotonic', side_effect=range(1000)), patch.object(kpis.time, 'sleep'), patch.object(kpis, 'private_json'):
            with self.assertRaises(TimeoutError):
                kpis.scenario(run)
        self.assertEqual(sum(value.get('action') == 'current' for value in run.commands), 1)

    def test_geometry_failure_stays_failed_after_capture_no_mutation_retry(self):
        run = Run()
        original = run.command
        def command(value):
            result = original(value)
            if value['type'] == 'weeklyKpis':
                result['contained'] = False
            return result
        run.command = command
        with self.assertRaisesRegex(ValueError, 'geometry'):
            kpis.scenario(run)
        self.assertEqual(sum(value['type'] == 'captureView' for value in run.commands), 1)

    def test_bottom_and_all_chart_failures_do_not_pass_or_retry(self):
        for field in ['allCharts', 'chartsSized', 'rangeCorrect', 'bottomVisible', 'notesCorrect']:
            run = Run()
            original = run.command
            def invalid(value):
                result = original(value)
                if value['type'] == 'weeklyKpis':
                    result[field] = False
                return result
            run.command = invalid
            with self.assertRaisesRegex(ValueError, 'proof failed'):
                kpis.scenario(run)

    def test_pane_underfill_after_growing_stays_failed(self):
        run = Run()
        original = run.command
        progress_sizes = []
        def underfilled(value):
            result = original(value)
            if value['type'] == 'setViewport' and run.progress:
                progress_sizes.append(value['preset'])
            if value.get('action') == 'bottom' and len(progress_sizes) >= 5:
                result['contained'] = False
            return result
        run.command = underfilled
        with self.assertRaisesRegex(ValueError, 'geometry'):
            kpis.scenario(run)
        self.assertEqual(progress_sizes, ['wide', 'narrow', 'wide-short', 'narrow-short', 'wide'])
        self.assertEqual(sum(value['type'] == 'captureView' for value in run.commands), 25)

    def test_failed_readiness_retains_bounded_observation_without_replay(self):
        run = Run()
        run.command = lambda _value: {'ready': False, 'progress': False}
        run.root = __import__('pathlib').Path('/owned')
        with patch.object(kpis.time, 'monotonic', side_effect=[0, 0, 9]), patch.object(kpis.time, 'sleep'), patch.object(kpis, 'private_json') as retained:
            with self.assertRaises(TimeoutError):
                kpis.wait_kpis(run)
            retained.assert_called_once()


if __name__ == '__main__':
    unittest.main()
