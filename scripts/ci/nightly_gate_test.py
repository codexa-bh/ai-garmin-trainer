import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch, MagicMock

from nightly_gate import GATE_JOB, NATIVE_JOB, api, collection, decide, main

A = 'a' * 40
B = 'b' * 40


def run(sha=A, **kwargs):
    return dict(id=1, head_sha=sha, head_branch='main', event='schedule', status='completed', **kwargs)


def jobs(result='success', allocated=True, gate='success'):
    return [dict(name=GATE_JOB, status='completed', conclusion=gate),
            dict(name=NATIVE_JOB, status='completed', conclusion=result, runner_id=1 if allocated else 0,
                 started_at='2026-10-31T02:17:00Z' if allocated else None)]


class GateTests(unittest.TestCase):
    def test_initial_changed_and_every_allocated_outcome(self):
        self.assertTrue(decide([], lambda _: [], A, 2)[0])
        for result in ['success', 'failure', 'cancelled', 'timed_out', 'action_required', 'startup_failure', 'neutral']:
            self.assertFalse(decide([run()], lambda _: jobs(result), A, 2)[0], result)
            self.assertTrue(decide([run()], lambda _: jobs(result), B, 2)[0], result)

    def test_carried_skip_and_preallocation_failure(self):
        self.assertFalse(decide([run()], lambda _: jobs('skipped', False), A, 2)[0])
        for result in ['cancelled', 'startup_failure']:
            self.assertTrue(decide([run()], lambda _: jobs(result, False), A, 2)[0])
        for gate in ['failure', 'cancelled', 'timed_out']:
            self.assertTrue(decide([run()], lambda _: jobs('skipped', False, gate), A, 2)[0])
            self.assertTrue(decide([run()], lambda _: jobs(gate=gate)[:1], A, 2)[0])

    def test_current_incomplete_and_newest_baseline(self):
        current = {**run(), 'id': 3}
        incomplete = {**run(), 'id': 2, 'status': 'in_progress'}
        self.assertFalse(decide([run(), current, incomplete], lambda _: jobs(), A, 3)[0])
        newest = {**run(B), 'id': 2}
        self.assertTrue(decide([run(), newest], lambda _: jobs(), A, 3)[0])

    def test_uncertain_metadata_fails_closed(self):
        for source in ['a' * 39, 'z' * 40, 'A' * 40, None]:
            with self.assertRaises(ValueError):
                decide([], lambda _: [], source, 2)
        bad_runs = [None, [None], [run(), run()], [{**run(), 'head_sha': 'bad'}],
                    [{**run(), 'head_branch': 'feature'}], [{**run(), 'event': 'push'}]]
        for history in bad_runs:
            with self.assertRaises(ValueError):
                decide(history, lambda _: jobs(), A, 2)
        for bad in [None, [], jobs() + jobs(), jobs() + [dict(name='unknown')],
                    [{**jobs()[0], 'status': 'in_progress'}, jobs()[1]],
                    [jobs()[0], {**jobs()[1], 'status': 'queued'}],
                    [jobs()[0], {**jobs()[1], 'conclusion': 'unknown'}],
                    jobs(allocated=False), jobs(gate='failure')]:
            with self.assertRaises(ValueError):
                decide([run()], lambda _: bad, A, 2)
        with self.assertRaises(ValueError):
            decide([], lambda _: [], A, 2, truncated=True)
        with self.assertRaises(ValueError):
            collection({'total_count': 0, 'jobs': [1]}, 'jobs')
        with self.assertRaises(ValueError):
            collection({'jobs': []}, 'jobs')

    def test_environment_outputs_and_exact_source(self):
        with tempfile.TemporaryDirectory() as directory:
            output, summary = Path(directory) / 'output', Path(directory) / 'summary'
            env = dict(GITHUB_REF='refs/heads/main', GITHUB_EVENT_NAME='workflow_dispatch', GITHUB_SHA=A,
                       GITHUB_RUN_ID='2', GITHUB_OUTPUT=str(output), GITHUB_STEP_SUMMARY=str(summary))
            with patch.dict(os.environ, env), patch('nightly_gate.api', return_value={'total_count': 0, 'workflow_runs': []}):
                self.assertEqual(main(), 0)
                self.assertIn(f'source_sha={A}', output.read_text())
                self.assertIn('should_run=true', output.read_text())
            for key, value in [('GITHUB_REF', 'refs/heads/feature'), ('GITHUB_EVENT_NAME', 'push')]:
                with patch.dict(os.environ, {**env, key: value}), patch('nightly_gate.api') as request:
                    self.assertEqual(main(), 1)
                    request.assert_not_called()
            with patch.dict(os.environ, env), patch('nightly_gate.api', side_effect=OSError('private response')):
                self.assertEqual(main(), 1)
                self.assertNotIn('private response', summary.read_text())

    def test_api_time_size_and_collection_limits(self):
        response = MagicMock()
        response.__enter__.return_value = response
        response.read.return_value = json.dumps({'jobs': []}).encode()
        with patch.dict(os.environ, {'GITHUB_REPOSITORY': 'owner/repo', 'GH_TOKEN': 'unit-secret'}), patch('nightly_gate.urlopen', return_value=response) as request:
            api('runs/1/jobs')
            self.assertEqual(request.call_args.kwargs['timeout'], 10)
            response.read.assert_called_with(1024 * 1024 + 1)
            response.read.return_value = b'x' * (1024 * 1024 + 1)
            with self.assertRaises(ValueError):
                api('runs/1/jobs')
        rows, truncated = collection({'jobs': [], 'total_count': 21}, 'jobs')
        self.assertEqual(rows, [])
        self.assertTrue(truncated)


if __name__ == '__main__':
    unittest.main()
