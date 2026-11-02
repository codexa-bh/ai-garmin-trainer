import io
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch
from history_live import BUDGET_HEADER, capture_settled, exercise, operation, remaining_input, show_sync
from native_smoke import private_json
import sqlite3


class FiniteLiveContracts(unittest.TestCase):
    def connection(self, frames, status=200):
        response = Mock(status=status)
        response.getheader.return_value = 'application/x-ndjson'
        stream = io.BytesIO(b''.join(json.dumps(frame).encode() + b'\n' for frame in frames))
        response.readline.side_effect = stream.readline
        connection = Mock()
        connection.getresponse.return_value = response
        return connection, response

    def test_disconnect_closes_response_and_socket_after_actual_progress_without_replay(self):
        connection, response = self.connection([{'type':'progress','stage':'health','healthDaysImported':1,'private':'never-retain'}])
        with patch('history_live.http.client.HTTPConnection', return_value=connection):
            result = operation('http://127.0.0.1:12345', True)
        self.assertEqual(result['status'], 'disconnect-requested')
        self.assertNotIn('private', json.dumps(result))
        connection.request.assert_called_once_with('POST', '/api/sync', headers=BUDGET_HEADER)
        response.close.assert_called_once()
        connection.close.assert_called_once()

    def test_result_is_minimized_and_cannot_claim_more_than_fixed_budget(self):
        for attempts in (150,151):
            connection, response = self.connection([{'type':'result', 'status':'budget-limited', 'private':'never-retain', 'discovery':{'operation':{'attempts':attempts,'batches':3}}}])
            with patch('history_live.http.client.HTTPConnection', return_value=connection):
                if attempts == 150:
                    result = operation('http://127.0.0.1:12345', False)
                    self.assertEqual(result['attempts'], 150)
                    self.assertNotIn('private', json.dumps(result))
                else:
                    with self.assertRaises(ValueError):
                        operation('http://127.0.0.1:12345', False)
            self.assertEqual(connection.request.call_count, 1)
            response.close.assert_called_once()
            connection.close.assert_called_once()

    def test_non_owned_origin_or_failed_response_never_replays(self):
        for origin in ('https://127.0.0.1:1234','http://localhost:1234','http://127.0.0.1:1234/private','http://user@127.0.0.1:1234'):
            with patch('history_live.http.client.HTTPConnection') as construct:
                with self.assertRaises(ValueError):
                    operation(origin, False)
                construct.assert_not_called()
        connection, response = self.connection([], status=409)
        with patch('history_live.http.client.HTTPConnection', return_value=connection):
            with self.assertRaises(ValueError):
                operation('http://127.0.0.1:12345', False)
        self.assertEqual(connection.request.call_count, 1)
        response.close.assert_called_once()

    def test_exact_two_effects_restart_and_claim_refusal_preserve_bound(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            current = 0
            def summary():
                return {'active':False, 'outcome':'cancelled' if current < 2 else 'budget-limited',
                        'operationAttempts':4 if current < 2 else 150, 'batches':0 if current < 2 else 3,
                        'healthChecks':5 if current < 2 else 17}
            def invoke(_origin, disconnect_after_health):
                nonlocal current
                current += 1
                return {'status':'disconnect-requested' if disconnect_after_health else 'budget-limited'}
            run = SimpleNamespace(root=root, origin='http://127.0.0.1:1234', binary=Path('/unit-only'),
                                  summary=summary, settle_claim=Mock(), stop=Mock(), start=Mock(), sync_captures=[], command=Mock(return_value={'view':'Trainer'}), wait=Mock())
            with patch('history_live.operation', side_effect=invoke) as call, patch('history_live.capture_settled', return_value={'scenario':'unit-only'}):
                stages = exercise(run, root)
                self.assertEqual(call.call_count, 2)
                self.assertEqual(stages[-1]['after']['batches'], 3)
                run.stop.assert_called_once()
                run.start.assert_called_once()
                with self.assertRaises(FileExistsError):
                    exercise(run, root)
                self.assertEqual(call.call_count, 2)


    def test_settled_capture_selects_exact_geometry_and_sync_view_before_capture(self):
        run = SimpleNamespace(command=Mock(return_value={'view':'Sync', 'ok':True}), wait=Mock())
        capture_settled(run, 'unit-only')
        commands = [call.args[0] for call in run.command.call_args_list]
        self.assertEqual(commands[0], {'type':'setViewport','preset':'wide'})
        self.assertEqual(commands[-2], {'type':'sync','action':'refresh'})
        self.assertEqual(commands[-1], {'type':'captureView','view':'sync','preset':'wide'})

    def test_sync_view_is_settled_before_refresh_and_does_not_click_hidden_navigation(self):
        for view in ('Trainer','Sync'):
            run = SimpleNamespace(command=Mock(return_value={'view':view}), wait=Mock())
            show_sync(run)
            commands = [call.args[0] for call in run.command.call_args_list]
            self.assertEqual(commands[0], {'type':'observe'})
            self.assertEqual(sum(value.get('target') == 'Sync' for value in commands), 1 if view == 'Trainer' else 0)
            run.wait.assert_called_once()

    def test_diagnosed_repair_consumes_only_unused_second_effect_without_replaying_first(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            current = 0
            def summary():
                return {'active':False, 'outcome':'cancelled' if current < 2 else 'budget-limited',
                        'operationAttempts':3 if current < 2 else 150, 'batches':0 if current < 2 else 2,
                        'healthChecks':0 if current < 2 else 12}
            def invoke(_origin, disconnect_after_health):
                nonlocal current
                current += 1
                return {'status':'disconnect-requested' if disconnect_after_health else 'budget-limited'}
            run = SimpleNamespace(root=root, origin='http://127.0.0.1:1234', binary=Path('/unit-only'), summary=summary,
                                  settle_claim=Mock(side_effect=RuntimeError('rendered view refusal')), stop=Mock(), start=Mock(),
                                  sync_captures=[], command=Mock(return_value={'view':'Sync'}), wait=Mock())
            with patch('history_live.operation', side_effect=invoke) as call, patch('history_live.capture_settled', return_value={'scenario':'unit-only'}):
                with self.assertRaises(RuntimeError):
                    exercise(run, root)
                self.assertEqual(call.call_count, 1)
                self.assertTrue((root / 'live-operation-0-started.json').exists())
                run.settle_claim = Mock()
                result = exercise(run, root, start_index=1)
                self.assertEqual([stage['operation'] for stage in result], [1])
                self.assertEqual(call.call_count, 2)
                self.assertFalse(call.call_args.kwargs['disconnect_after_health'])
                with self.assertRaises(ValueError):
                    exercise(run, root, start_index=1)
                self.assertEqual(call.call_count, 2)

    def test_remaining_input_requires_exact_claim_stopped_cancelled_copy_and_unused_effect(self):
        with tempfile.TemporaryDirectory() as directory:
            scratch = Path(directory).resolve()
            claim_root = scratch / 'selection'
            claim_root.mkdir(mode=0o700)
            old = scratch / 'ordinary-unit'
            old.mkdir(mode=0o700)
            (old / 'owner').write_text('unit')
            database = old / 'trainer.sqlite'
            connection = sqlite3.connect(database)
            connection.execute('create table sync_checkpoint(key text,value text)')
            connection.execute('insert into sync_checkpoint values (?,?)', ('garmin_discovery_v1',json.dumps({'operation':{'outcome':'cancelled','attempts':3}})))
            connection.commit()
            connection.close()
            private_json(old / 'provenance.json', {'original':{'unit':True}})
            private_json(claim_root / 'live-envelope-claim.json', {'run':str(old), 'maxOperations':2, 'maxAttempts':300, 'maxOperationSeconds':360})
            private_json(claim_root / 'live-operation-0-started.json', {'run':str(old), 'operation':0, 'maxAttempts':150, 'maxSeconds':180})
            self.assertEqual(remaining_input(scratch, claim_root), (database, {'unit':True}))
            private_json(claim_root / 'live-operation-1-started.json', {'operation':1})
            with self.assertRaises(ValueError):
                remaining_input(scratch, claim_root)


if __name__ == '__main__':
    unittest.main()
