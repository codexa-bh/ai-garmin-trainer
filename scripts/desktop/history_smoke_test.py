import hashlib
import json
import os
from pathlib import Path
import tempfile
import unittest
from history_smoke import HistoryRun, copy_tokens, selected_tokens, tokens_unchanged, prepare_synthetic_history, prepare_dependency_scenario
from native_smoke import private_json


class HistoryTokenContracts(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name).resolve()
        self.root.chmod(0o700)
        self.source = self.root / 'selected'
        self.source.mkdir(mode=0o700)
        self.token = self.source / 'garmin_tokens.json'
        self.token.write_bytes(b'synthetic unit data, not credentials')
        self.token.chmod(0o600)
        self.destination = self.root / 'owned-run'
        self.destination.mkdir(mode=0o700)
        self.selection = self.root / 'selection.json'
        private_json(self.selection, {'tokenDirectory': str(self.source), 'tokenFiles': ['garmin_tokens.json'],
                                     'purpose': 'T0238 private copied-token smoke only'})

    def tearDown(self):
        self.temporary.cleanup()

    def test_only_explicit_known_private_files_are_copied_without_original_mutation(self):
        directory, hashes = copy_tokens(self.selection, self.destination)
        target = self.destination / 'tokens/garmin_tokens.json'
        self.assertEqual(target.read_bytes(), self.token.read_bytes())
        self.assertEqual(target.stat().st_mode & 0o777, 0o600)
        self.assertEqual(target.stat().st_nlink, 1)
        self.assertEqual((self.destination / 'tokens').stat().st_mode & 0o777, 0o700)
        self.assertEqual(hashes['garmin_tokens.json'], hashlib.sha256(self.token.read_bytes()).hexdigest())
        self.assertTrue(tokens_unchanged(directory, hashes))
        target.write_bytes(b'copy-only token refresh simulation')
        self.assertTrue(tokens_unchanged(directory, hashes))

    def test_dependency_presets_are_stopped_synthetic_only_and_do_not_install(self):
        from types import SimpleNamespace
        from unittest.mock import patch
        (self.destination / 'config').mkdir(mode=0o700)
        private_json(self.destination / 'config/settings-v3.json', {'version':3, 'keys':{}, 'fields':{}})
        run = SimpleNamespace(root=self.destination, child=None, config={'port':12345})
        with patch('history_smoke.listening', return_value=False):
            prepare_synthetic_history(run)
            from datetime import datetime, timedelta, timezone
            prepared = json.loads((self.destination / 'config/settings-v3.json').read_text())
            self.assertEqual(prepared['fields']['GARMIN_HISTORY_START_DATE'], (datetime.now(timezone.utc).date() - timedelta(days=35)).isoformat())
            for scenario in ('missing', 'unknown', 'healthy'):
                prepare_dependency_scenario(run, scenario)
                saved = json.loads((self.destination / 'config/settings-v3.json').read_text())
                command = Path(saved['fields']['GARMIN_MCP_COMMAND'])
                self.assertEqual(command.parent, self.destination)
                self.assertTrue(command.is_file())
                self.assertEqual(bool(command.stat().st_mode & 0o111), scenario != 'missing')
            with self.assertRaises(ValueError):
                prepare_dependency_scenario(run, 'private-command')
            run.child = object()
            with self.assertRaisesRegex(ValueError, 'Stopped'):
                prepare_dependency_scenario(run, 'healthy')
            run.child = None
            saved['keys'] = {'OPENAI_API_KEY':'private-canary'}
            (self.destination / 'config/settings-v3.json').write_text(json.dumps(saved))
            with self.assertRaisesRegex(ValueError, 'synthetic-only'):
                prepare_dependency_scenario(run, 'healthy')

    def test_mixed_presentation_seeds_only_stopped_owned_synthetic_closed_state(self):
        import sqlite3
        from types import SimpleNamespace
        from unittest.mock import Mock
        from history_connector import SENTINEL
        from history_smoke import prepare_mixed_sync_presentation
        (self.destination / 'config').mkdir(mode=0o700)
        (self.destination / 'tokens').mkdir(mode=0o700)
        token = self.destination / 'tokens/garmin_tokens.json'
        token.write_bytes(SENTINEL)
        token.chmod(0o600)
        settings = self.destination / 'config/settings-v3.json'
        private_json(settings, {'keys':{}, 'fields':{'GARMIN_MCP_TOKEN_DIR':str(token.parent)}})
        database = self.destination / 'trainer.sqlite'
        with sqlite3.connect(database) as db:
            db.execute('create table sync_checkpoint(key text primary key,value text,updated_at integer)')
            db.execute('create table untouched(value text)')
            db.execute("insert into untouched values ('authored canary')")
            db.execute('insert into sync_checkpoint values (?,?,0)', ('garmin_history_v1', json.dumps({'outcome':'settled','remoteLowerBound':None})))
        database.chmod(0o600)
        run = SimpleNamespace(root=self.destination, database=database, verify_settled=Mock())
        for outcome in ('settled', 'failed'):
            prepare_mixed_sync_presentation(run, outcome)
            with sqlite3.connect(database) as db:
                rows = dict(db.execute('select key,value from sync_checkpoint'))
                self.assertEqual(db.execute('select value from untouched').fetchall(), [('authored canary',)])
            self.assertEqual(json.loads(rows['garmin_latest_v1'])['outcome'], outcome)
            self.assertEqual(json.loads(rows['garmin_latest_v1'])['activitiesProcessed'], 6)
            self.assertEqual(json.loads(rows['garmin_latest_v1'])['healthDaysRefreshed'], 14)
            self.assertEqual(json.loads(rows['garmin_history_v1'])['recoveryReason'], 'no-progress')
        before = database.read_bytes()
        with self.assertRaisesRegex(ValueError, 'Closed'):
            prepare_mixed_sync_presentation(run, 'arbitrary')
        run.verify_settled.side_effect = RuntimeError('active owner')
        with self.assertRaisesRegex(RuntimeError, 'active owner'):
            prepare_mixed_sync_presentation(run, 'settled')
        run.verify_settled.side_effect = None
        settings.write_text(json.dumps({'keys':{'OPENAI_API_KEY':'private-canary'}, 'fields':{'GARMIN_MCP_TOKEN_DIR':str(token.parent)}}))
        with self.assertRaisesRegex(ValueError, 'Synthetic-only'):
            prepare_mixed_sync_presentation(run, 'settled')
        self.assertEqual(database.read_bytes(), before)
        settings.write_text(json.dumps({'keys':{}, 'fields':{'GARMIN_MCP_TOKEN_DIR':str(token.parent)}}))
        database.chmod(0o644)
        with self.assertRaisesRegex(ValueError, 'private owned'):
            prepare_mixed_sync_presentation(run, 'settled')
        database.chmod(0o600)
        alias = self.destination / 'alias.sqlite'
        alias.symlink_to(database)
        run.database = alias
        with self.assertRaises(ValueError):
            prepare_mixed_sync_presentation(run, 'settled')
        self.assertEqual(database.read_bytes(), before)

    def test_sync_scope_uses_populated_existing_setup_without_changing_default_wizard_coverage(self):
        from types import SimpleNamespace
        from history_smoke import setup_modes
        for flags, expected in [((False, False, False), ['create-new', 'use-existing']), ((True, False, False), ['use-existing']), ((False, True, False), ['use-existing']), ((False, False, True), ['use-existing'])]:
            self.assertEqual(setup_modes(SimpleNamespace(continuation_only=flags[0], dependency_guidance=flags[1], synthetic_sync=flags[2])), expected)

    def test_latest_only_checks_checkpoint_identity_and_never_retries_a_mutation(self):
        from types import SimpleNamespace
        from unittest.mock import Mock
        before = {'active':False, 'historicalState':'complete', 'detailsRemaining':0}
        after = {**before, 'latestOutcome':'settled'}
        for digest, success in [('same', True), ('changed', False)]:
            run = SimpleNamespace(summary=Mock(side_effect=[before, after]), history_digest=Mock(side_effect=['same', digest]),
                                  command=Mock(), wait_sync=Mock(), settle_claim=Mock())
            if success:
                self.assertTrue(HistoryRun.latest_only(run)['historyBytesPreserved'])
            else:
                with self.assertRaisesRegex(ValueError, 'changed saved history'):
                    HistoryRun.latest_only(run)
            self.assertEqual(run.command.call_args_list[0].args[0], {'type':'sync','action':'start'})
            self.assertEqual(run.command.call_count, 1)

    def test_multi_detail_progress_requires_actual_owned_progress_without_replay(self):
        from types import SimpleNamespace
        from unittest.mock import Mock
        before = {'active':False, 'historicalState':'complete', 'detailsRemaining':3}
        after = {**before, 'latestOutcome':'settled', 'detailsRemaining':0}
        for middle, succeeds in [({'active':True, 'detailsProcessed':1}, True), ({'active':False}, False)]:
            run = SimpleNamespace(summary=Mock(side_effect=[before, middle, after]), history_digest=Mock(return_value='same'),
                command=Mock(return_value={'ok':True}), wait_sync=Mock(), settle_claim=Mock(), sync_captures=[])
            if succeeds:
                HistoryRun.latest_only(run)
                self.assertEqual(len(run.sync_captures), 2)
            else:
                with self.assertRaisesRegex(ValueError, 'no replay'):
                    HistoryRun.latest_only(run)
            self.assertEqual(sum(call.args[0].get('action') == 'start' for call in run.command.call_args_list), 1)

    def test_backend_latest_uses_one_actual_owned_post_and_requires_settlement(self):
        from types import SimpleNamespace
        from unittest.mock import Mock, patch, MagicMock
        before = {'active':False, 'historicalState':'complete'}
        after = {**before, 'latestOutcome':'settled'}
        for payload, digest, succeeds in [(b'{"type":"result","status":"completed"}\n', 'same', True),
                (b'{"type":"result","status":"failed"}\n', 'same', False),
                (b'{"type":"result","status":"completed"}\n', 'changed', False)]:
            run = SimpleNamespace(origin='http://127.0.0.1:12345', summary=Mock(side_effect=[before, after]),
                history_digest=Mock(side_effect=['same', digest]), command=Mock(return_value={'ok':True}),
                wait_sync=Mock(), settle_claim=Mock(), sync_captures=[])
            reply = MagicMock()
            reply.__enter__.return_value.read.return_value = payload
            with patch('history_smoke.urllib.request.urlopen', return_value=reply) as post:
                if succeeds:
                    self.assertTrue(HistoryRun.backend_latest(run)['backendOnly'])
                else:
                    with self.assertRaises(ValueError):
                        HistoryRun.backend_latest(run)
                self.assertEqual(post.call_count, 1)
                request = post.call_args.args[0]
                self.assertEqual(request.full_url, run.origin + '/api/sync')
                self.assertEqual(request.data, b'{"intent":"latest"}')
                self.assertEqual(request.method, 'POST')
                self.assertEqual(len(run.sync_captures), 2)
                self.assertTrue(all(item.args[0].get('action') not in ('start', 'cancel', 'continue') for item in run.command.call_args_list))
        run.summary = Mock(return_value={'active':True})
        with patch('history_smoke.urllib.request.urlopen') as post:
            with self.assertRaisesRegex(ValueError, 'no overlap'):
                HistoryRun.backend_latest(run)
            post.assert_not_called()

    def test_data_capture_follows_the_actual_existing_selection(self):
        from types import SimpleNamespace
        from unittest.mock import Mock, call
        run = SimpleNamespace(root=self.destination, descriptor={'historySetup':'use-existing'},
                              config={'source':'unit-only'}, boot='unit-only', binary=Path('/unit-only'),
                              setup_start=Mock(), settings_action=Mock(return_value={'ok':True}),
                              wait_settings=Mock(), wait_backend=Mock(), stop=Mock(), start=Mock())
        HistoryRun.onboarding(run)
        self.assertEqual(run.settings_action.call_args_list[:2], [call('useExisting'), call('capture')])
        run.wait_backend.assert_called_once()

    def test_failed_continuation_retains_cancel_and_captures_without_another_start(self):
        from types import SimpleNamespace
        from unittest.mock import Mock
        summary = {'active':False, 'outcome':'failed', 'operations':0, 'failureClass':'auth'}
        cancelled = {'failed':False, 'paused':True, 'running':False}
        failed = {'failed':True, 'paused':False, 'running':False}
        run = SimpleNamespace(root=self.destination, config={'source':'unit-only'}, boot='unit-only',
                              command=Mock(return_value={'ok':True, 'capture':'unit-only.png'}),
                              wait=Mock(), summary=Mock(return_value=summary), settle_claim=Mock(),
                              wait_sync=Mock(side_effect=[{'running':True}, cancelled,
                                                          {'startEnabled':True}, {'running':True, 'failed':False}, failed]))
        with self.assertRaisesRegex(ValueError, 'continuation failed'):
            HistoryRun.real_sync(run)
        commands = [call.args[0] for call in run.command.call_args_list]
        self.assertEqual(sum(c.get('action') == 'start' for c in commands), 1)
        self.assertEqual(sum(c.get('action') == 'continue' for c in commands), 1)
        self.assertEqual(len(run.sync_captures), 2)
        for name in ['real-sync-progress.json', 'real-sync-cancelled.json', 'real-sync-failure.json']:
            evidence = json.loads((self.destination/name).read_text())
            self.assertTrue(evidence['captures'])
        evidence = json.loads((self.destination/'real-sync-failure.json').read_text())
        self.assertEqual(evidence['cancelled'], cancelled)
        self.assertEqual(evidence['settled'][0]['summary']['failureClass'], 'auth')

    def test_selected_checkpoint_continuation_is_exactly_one_invocation(self):
        from types import SimpleNamespace
        from unittest.mock import Mock
        before = {'active':False, 'outcome':'failed', 'operations':50}
        after = {'active':False, 'outcome':'budget-limited', 'operations':96}
        run = SimpleNamespace(root=self.destination, config={'source':'unit-only'}, boot='unit-only',
                              command=Mock(return_value={'ok':True, 'capture':'unit-only.png'}), wait=Mock(),
                              summary=Mock(side_effect=[before, after]), settle_claim=Mock(),
                              wait_sync=Mock(side_effect=[{'startEnabled':True}, {'running':True,'failed':False},
                                                          {'running':False,'paused':True,'completed':False,'failed':False}]))
        HistoryRun.continue_once(run)
        actions = [call.args[0].get('action') for call in run.command.call_args_list]
        self.assertEqual(actions.count('continue'), 1)
        self.assertNotIn('start', actions)
        self.assertNotIn('cancel', actions)
        evidence=json.loads((self.destination/'single-continuation.json').read_text())
        self.assertEqual(evidence['maxInvocations'], 1)
        self.assertEqual(evidence['after'], after)
        self.assertEqual(len(evidence['captures']), 2)

    def test_active_or_missing_checkpoint_refuses_single_continuation(self):
        from types import SimpleNamespace
        from unittest.mock import Mock
        for summary in [{'active':True,'outcome':'failed'}, {'active':False,'outcome':None}]:
            run=SimpleNamespace(command=Mock(), wait=Mock(), summary=Mock(return_value=summary))
            with self.assertRaisesRegex(ValueError, 'prior discovery checkpoint'):
                HistoryRun.continue_once(run)
            self.assertFalse(any(call.args[0].get('action') == 'continue' for call in run.command.call_args_list))

    def test_native_setup_failure_is_retained_without_finish_replay(self):
        from types import SimpleNamespace
        from unittest.mock import Mock, call
        failure = 'Settings filename/version conflict; preserve originals and use a compatible build.'
        run = SimpleNamespace(root=self.destination, child=SimpleNamespace(poll=lambda:None),
                              http=Mock(return_value={'origin':None}), accept_identity=Mock(return_value=True),
                              settings_action=Mock(return_value={'setupFailure':failure}))
        with self.assertRaisesRegex(RuntimeError, 'filename/version conflict'):
            HistoryRun.wait_backend(run)
        self.assertEqual(run.settings_action.call_args_list, [call('observe')])
        evidence = json.loads((self.destination/'native-setup-failure.json').read_text())
        self.assertEqual(evidence['nativeStaticFailure'], failure)

    def test_backend_origin_alone_does_not_authorize_renderer_dispatch(self):
        from types import SimpleNamespace
        from unittest.mock import Mock
        origin = 'http://127.0.0.1:12346'
        run = SimpleNamespace(root=self.destination, child=SimpleNamespace(poll=lambda:None),
                              config={'port':12345}, launches=1,
                              http=Mock(side_effect=[TimeoutError('Atomic creation still owns identity'), {'origin':origin,'runtimeReady':False,'rendererDiagnostic':{'dashboard':True,'bootstrap':True,'ipc':True}},
                                                     {'origin':origin,'runtimeReady':True,'rendererDiagnostic':{'dashboard':True,'bootstrap':True,'ipc':True}}]),
                              accept_identity=Mock(return_value=True), settings_action=Mock(),
                              command=Mock(return_value={'dashboard':True,'hydrated':True}))
        HistoryRun.wait_backend(run)
        run.command.assert_called_once_with({'type':'observe'})
        run.settings_action.assert_not_called()
        self.assertTrue(json.loads((self.destination/'readiness-1.json').read_text())['rendererRoundTrip'])

    def test_admission_refusal_is_never_retried_as_readiness(self):
        from types import SimpleNamespace
        from unittest.mock import Mock
        run = SimpleNamespace(child=SimpleNamespace(poll=lambda:None),
                              http=Mock(side_effect=RuntimeError('Bridge status 403: Run authority changed')),
                              settings_action=Mock(), command=Mock())
        with self.assertRaisesRegex(RuntimeError, '403'):
            HistoryRun.wait_backend(run)
        self.assertEqual(run.http.call_count, 1)
        run.settings_action.assert_not_called()
        run.command.assert_not_called()

    def test_identity_transport_timeout_still_obeys_overall_readiness_deadline(self):
        from types import SimpleNamespace
        from unittest.mock import Mock, patch
        run = SimpleNamespace(child=SimpleNamespace(poll=lambda:None),
                              http=Mock(side_effect=TimeoutError('Identity pending')),
                              settings_action=Mock(), command=Mock())
        with patch('history_smoke.time.monotonic', side_effect=[0, 0, 101]):
            with self.assertRaisesRegex(TimeoutError, 'Finish/backend deadline'):
                HistoryRun.wait_backend(run)
        self.assertEqual(run.http.call_count, 1)
        run.settings_action.assert_not_called()
        run.command.assert_not_called()

    def test_insecure_alias_and_unknown_selections_are_refused(self):
        self.selection.chmod(0o644)
        with self.assertRaises(ValueError):
            selected_tokens(self.selection)
        self.selection.chmod(0o600)
        alias = self.root / 'alias.json'
        alias.symlink_to(self.selection)
        with self.assertRaises(ValueError):
            selected_tokens(alias)
        value = json.loads(self.selection.read_text())
        value['tokenFiles'].append('other-private-file')
        self.selection.write_text(json.dumps(value))
        with self.assertRaises(ValueError):
            selected_tokens(self.selection)

    def test_token_alias_hardlink_or_insecure_source_refuses_before_read(self):
        original = self.token.read_bytes()
        self.token.chmod(0o644)
        with self.assertRaises(ValueError):
            copy_tokens(self.selection, self.destination)
        self.assertEqual(self.token.read_bytes(), original)
        (self.destination / 'tokens').rmdir()
        self.token.chmod(0o600)
        os.link(self.token, self.source / 'linked')
        with self.assertRaises(ValueError):
            copy_tokens(self.selection, self.destination)
        self.assertEqual(self.token.read_bytes(), original)
