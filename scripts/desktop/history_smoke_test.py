import hashlib
import json
import os
from pathlib import Path
import tempfile
import unittest
from history_smoke import (
    HistoryRun,
    copy_tokens,
    selected_tokens,
    tokens_unchanged,
    prepare_synthetic_history,
    prepare_connection_scenario,
)
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
        private_json(
            self.selection,
            {
                'tokenDirectory': str(self.source),
                'tokenFiles': ['garmin_tokens.json'],
                'purpose': 'T0238 private copied-token smoke only',
            },
        )

    def tearDown(self):
        self.temporary.cleanup()

    def test_finite_snow_sync_capture_selection_is_explicit_and_default_unchanged(self):
        run = HistoryRun.__new__(HistoryRun)
        calls = []
        run.command = lambda command: calls.append(command) or {'ok': True}
        self.assertEqual(run.synthetic_sync_capture('wide'), {'ok': True})
        self.assertEqual(calls, [{'type': 'captureView', 'view': 'sync', 'preset': 'wide'}])
        run.snow_hr_no_sync_captures = True
        self.assertTrue(run.synthetic_sync_capture('narrow')['captureOmitted'])
        self.assertEqual(len(calls), 1)
        with self.assertRaises(ValueError):
            run.synthetic_sync_capture('private')

    def test_history_observer_reuses_already_held_candidate_preparation_lock(self):
        import history_smoke as history
        import sqlite3
        from types import SimpleNamespace
        from unittest.mock import patch

        database = self.root / 'empty-authored.sqlite'
        sqlite3.connect(database).close()
        args = SimpleNamespace(token_input=None, no_external_tools=False)
        with (
            patch.object(
                history, 'Observer', side_effect=RuntimeError('before any launch')
            ) as observer,
            patch.object(history, 'private_json'),
        ):
            with self.assertRaisesRegex(RuntimeError, 'before any launch'):
                history.history_scenario(
                    args, self.root, database, self.root, 'source', {}, {}, lambda: None, None
                )
            observer.assert_called_once_with(self.root, preparation_locked=True)

    def test_cli_reaches_original_repo_candidate_owner_and_never_launches_after_refusal(self):
        import history_smoke as history
        import sys
        from unittest.mock import patch

        database = self.root / 'authored.sqlite'
        database.write_bytes(b'not opened before candidate admission')
        selection = self.root / 'database-selection.json'
        private_json(selection, {'database': str(database)})
        record = self.root / 'release.json'
        mask = os.umask(0o077)
        os.umask(mask)
        try:
            with (
                patch.object(
                    sys,
                    'argv',
                    [
                        'history',
                        '--scratch',
                        str(self.root),
                        '--input-file',
                        str(selection),
                        '--bundle',
                        str(self.root),
                        '--release-record',
                        str(record),
                    ],
                ),
                patch.object(history.resources, 'configure', return_value=self.root),
                patch.object(history, 'source_identity', return_value='a' * 64),
                patch.object(
                    history, 'candidate_preparation', side_effect=ValueError('candidate refused')
                ) as candidate,
                patch.object(history, 'history_scenario') as scenario,
            ):
                with self.assertRaisesRegex(ValueError, 'candidate refused'):
                    history.main.__wrapped__()
                candidate.assert_called_once_with(
                    history.REPO, self.root, 'a' * 64, self.root, record
                )
                scenario.assert_not_called()
        finally:
            os.umask(mask)

    def test_help_labels_legacy_routes_unavailable_without_preparing_inputs(self):
        import contextlib
        import io
        import sys
        import history_smoke as history
        from unittest.mock import patch

        output = io.StringIO()
        with (
            patch.object(sys, 'argv', ['history', '--help']),
            patch.object(history.resources, 'configure') as configure,
            contextlib.redirect_stdout(output),
        ):
            with self.assertRaises(SystemExit) as result:
                history.main.__wrapped__()
        self.assertEqual(result.exception.code, 0)
        self.assertEqual(output.getvalue().count('UNAVAILABLE legacy route'), 2)
        self.assertIn('before private input access', ' '.join(output.getvalue().split()))
        self.assertIn('smoke:help', output.getvalue())
        configure.assert_not_called()

    def test_legacy_flags_still_refuse_before_selection_or_resource_access(self):
        import contextlib
        import io
        import sys
        import history_smoke as history
        from unittest.mock import patch

        for flags in (['--token-input', '/never-read'], ['--continuation-only']):
            with self.subTest(flags=flags):
                argv = [
                    'history',
                    '--scratch',
                    '/never-created',
                    '--bundle',
                    '/never-opened',
                    '--input-file',
                    '/never-read',
                    *flags,
                ]
                with (
                    patch.object(sys, 'argv', argv),
                    patch.object(history.resources, 'configure') as configure,
                    patch.object(history, 'canonical') as canonical,
                    contextlib.redirect_stderr(io.StringIO()),
                ):
                    with self.assertRaises(SystemExit) as result:
                        history.main.__wrapped__()
                self.assertEqual(result.exception.code, 2)
                configure.assert_not_called()
                canonical.assert_not_called()

    def test_only_explicit_known_private_files_are_copied_without_original_mutation(self):
        directory, hashes = copy_tokens(self.selection, self.destination)
        target = self.destination / 'tokens/garmin_tokens.json'
        self.assertEqual(target.read_bytes(), self.token.read_bytes())
        self.assertEqual(target.stat().st_mode & 0o777, 0o600)
        self.assertEqual(target.stat().st_nlink, 1)
        self.assertEqual((self.destination / 'tokens').stat().st_mode & 0o777, 0o700)
        self.assertEqual(
            hashes['garmin_tokens.json'], hashlib.sha256(self.token.read_bytes()).hexdigest()
        )
        self.assertTrue(tokens_unchanged(directory, hashes))
        target.write_bytes(b'copy-only token refresh simulation')
        self.assertTrue(tokens_unchanged(directory, hashes))

    def _fixture_run(self):
        from types import SimpleNamespace
        from unittest.mock import Mock

        (self.destination / 'config').mkdir(mode=0o700, exist_ok=True)
        import sqlite3

        database = self.destination / 'trainer.sqlite'
        with sqlite3.connect(database) as db:
            db.execute('create table conversation(value text)')
            db.execute("insert into conversation values ('authored canary')")
            from history_smoke import AUTHORED_SUMMARY_IDS

            db.execute('create table activity(garmin_id text,training_effect real)')
            db.executemany(
                'insert into activity(garmin_id) values(?)',
                [(identity,) for identity in AUTHORED_SUMMARY_IDS],
            )
            db.execute(
                'create table activity_detail_availability(garmin_id text,source text,status text,unavailable_reason text)'
            )
        database.chmod(0o600)
        run = SimpleNamespace(
            root=self.destination,
            database=database,
            child=None,
            config={'port': 12345},
            descriptor={'runId': 'unit'},
            fixture=None,
            renew_capability=Mock(),
        )
        self.addCleanup(lambda: run.fixture and run.fixture.stop())
        return run

    def test_imported_snow_counts_cannot_be_satisfied_or_contaminated_by_retained_seed_rows(self):
        import sqlite3
        from history_smoke import imported_snow_snapshot

        with sqlite3.connect(':memory:') as db:
            db.execute('create table activity_snow_split(garmin_id text,split_type text)')
            db.execute(
                'create table garmin_data_coverage(data_group text,subject_id text,status text)'
            )
            db.executemany(
                'insert into activity_snow_split values(?,?)', [('synthetic-snow', 'run')] * 9
            )
            db.execute(
                "insert into garmin_data_coverage values('snow_run_lift_splits','synthetic-snow','populated')"
            )
            self.assertEqual(
                imported_snow_snapshot(db),
                {'importedSnowSplits': 0, 'snowTypes': {}, 'snowCoverage': {}},
            )
            db.executemany(
                'insert into activity_snow_split values(?,?)',
                [('83092', 'run')] * 2 + [('83092', 'lift')] * 2,
            )
            db.execute(
                "insert into garmin_data_coverage values('snow_run_lift_splits','83092','populated')"
            )
            self.assertEqual(
                imported_snow_snapshot(db),
                {
                    'importedSnowSplits': 4,
                    'snowTypes': {'run': 2, 'lift': 2},
                    'snowCoverage': {'populated': 1},
                },
            )

    def test_summary_only_setup_is_exact_stopped_private_and_never_a_detail_import(self):
        import sqlite3
        from unittest.mock import patch
        from history_smoke import settle_authored_summary_details, AUTHORED_SUMMARY_IDS

        run = self._fixture_run()
        before = run.database.read_bytes()
        with patch('history_smoke.listening', return_value=False):
            run.child = object()
            with self.assertRaisesRegex(ValueError, 'Stopped'):
                settle_authored_summary_details(run)
            self.assertEqual(run.database.read_bytes(), before)
            run.child = None
            run.database.chmod(0o644)
            with self.assertRaisesRegex(ValueError, 'private authored'):
                settle_authored_summary_details(run)
            run.database.chmod(0o600)
            with sqlite3.connect(run.database) as db:
                db.execute("insert into activity(garmin_id) values('foreign-activity')")
            with self.assertRaisesRegex(ValueError, 'fresh authored'):
                settle_authored_summary_details(run)
            with sqlite3.connect(run.database) as db:
                self.assertEqual(
                    db.execute('select count(*) from activity_detail_availability').fetchone()[0], 0
                )
                db.execute("delete from activity where garmin_id='foreign-activity'")
            settle_authored_summary_details(run)
            with sqlite3.connect(run.database) as db:
                self.assertEqual(
                    db.execute(
                        'select status,count(*) from activity_detail_availability group by status'
                    ).fetchall(),
                    [('unsupported', len(AUTHORED_SUMMARY_IDS))],
                )
                self.assertEqual(
                    db.execute('select value from conversation').fetchall(), [('authored canary',)]
                )
                self.assertEqual(
                    db.execute('select count(*) from activity where training_effect=0').fetchone()[
                        0
                    ],
                    len(AUTHORED_SUMMARY_IDS),
                )
            after = run.database.read_bytes()
            with self.assertRaisesRegex(ValueError, 'fresh authored'):
                settle_authored_summary_details(run)
            self.assertEqual(run.database.read_bytes(), after)

    def test_connection_presets_are_stopped_synthetic_only_and_bind_the_owned_fixture(self):
        from unittest.mock import patch
        from history_fixture import SYNTHETIC_KEY

        run = self._fixture_run()
        settings = self.destination / 'config/settings-v3.json'
        private_json(settings, {'version': 3, 'keys': {}, 'fields': {}})
        with patch('history_smoke.listening', return_value=False):
            prepare_synthetic_history(run)
            from datetime import datetime, timedelta, timezone

            prepared = json.loads(settings.read_text())
            self.assertEqual(prepared['garminApiKey'], SYNTHETIC_KEY)
            self.assertEqual(
                prepared['fields']['GARMIN_HISTORY_START_DATE'],
                (datetime.now(timezone.utc).date() - timedelta(days=70)).isoformat(),
            )
            self.assertEqual(
                (self.destination / 'tokens/garmin_tokens.json').read_bytes(),
                __import__('history_smoke').LEGACY_TOKEN_SENTINEL,
            )
            self.assertEqual(prepared['fields']['GARMIN_MCP_COMMAND'], 'uvx')
            self.assertTrue(all(run.legacy_before['retainedFields'].values()))
            # Only tables Sync does not own are fingerprinted for preservation.
            self.assertEqual(list(run.unrelated_before), ['conversation'])
            self.assertEqual(run.unrelated_before['conversation'][0], 1)
            fixture = run.descriptor['garminFixture']
            self.assertEqual(set(fixture), {'port', 'capability'})
            self.assertEqual(fixture['port'], run.fixture.port)
            self.assertEqual(len(fixture['capability']), 64)
            run.renew_capability.assert_called()
            for scenario in ('rejected-key', 'rate-limited', 'healthy'):
                prepare_connection_scenario(run, scenario)
                self.assertEqual(json.loads(settings.read_text())['garminApiKey'], SYNTHETIC_KEY)
                self.assertIn('garminFixture', run.descriptor)
            prepare_connection_scenario(run, 'missing-key')
            self.assertNotIn('garminApiKey', json.loads(settings.read_text()))
            self.assertNotIn('garminFixture', run.descriptor)
            with self.assertRaises(ValueError):
                prepare_connection_scenario(run, 'private-command')
            run.child = object()
            with self.assertRaisesRegex(ValueError, 'Stopped'):
                prepare_connection_scenario(run, 'healthy')
            run.child = None
            saved = json.loads(settings.read_text())
            saved['keys'] = {'OPENAI_API_KEY': 'private-canary'}
            settings.write_text(json.dumps(saved))
            with self.assertRaisesRegex(ValueError, 'synthetic-only'):
                prepare_connection_scenario(run, 'healthy')
            saved['keys'] = {}
            saved['garminApiKey'] = 'a-real-looking-key-from-elsewhere'
            settings.write_text(json.dumps(saved))
            with self.assertRaisesRegex(ValueError, 'synthetic-only'):
                prepare_connection_scenario(run, 'healthy')

    def test_overdue_metadata_changes_only_settled_latest_in_exact_stopped_synthetic_copy(self):
        import sqlite3
        from types import SimpleNamespace
        from unittest.mock import Mock
        from history_fixture import SYNTHETIC_KEY
        from history_smoke import prepare_overdue_auto_sync

        (self.destination / 'config').mkdir(mode=0o700)
        settings = self.destination / 'config/settings-v3.json'
        private_json(settings, {'keys': {}, 'fields': {}, 'garminApiKey': SYNTHETIC_KEY})
        database = self.destination / 'trainer.sqlite'
        operation = {
            'version': 1,
            'intent': 'latest',
            'outcome': 'settled',
            'updatedAt': '2026-11-20T12:00:00Z',
        }
        with sqlite3.connect(database) as db:
            db.execute('create table sync_checkpoint(key text primary key,value text)')
            db.executemany(
                'insert into sync_checkpoint values (?,?)',
                [
                    ('garmin_sync_v1', json.dumps(operation)),
                    ('garmin_history_v1', 'authored-history-bytes'),
                ],
            )
        database.chmod(0o600)
        run = SimpleNamespace(
            root=self.destination,
            database=database,
            verify_settled=Mock(),
            child=None,
            config={'port': 1},
            fixture=object(),
        )
        prepare_overdue_auto_sync(run)
        with sqlite3.connect(database) as db:
            rows = dict(db.execute('select key,value from sync_checkpoint'))
        aged = json.loads(rows['garmin_sync_v1'])
        self.assertNotEqual(aged.pop('updatedAt'), operation['updatedAt'])
        self.assertEqual(
            aged, {key: value for key, value in operation.items() if key != 'updatedAt'}
        )
        self.assertEqual(rows['garmin_history_v1'], 'authored-history-bytes')
        before = database.read_bytes()
        run.child = object()
        with self.assertRaises(ValueError):
            prepare_overdue_auto_sync(run)
        run.child = None
        run.verify_settled.side_effect = RuntimeError('live owner')
        with self.assertRaises(RuntimeError):
            prepare_overdue_auto_sync(run)
        run.verify_settled.side_effect = None
        settings.write_text(json.dumps({'keys': {}, 'fields': {}, 'garminApiKey': 'foreign-key'}))
        with self.assertRaises(ValueError):
            prepare_overdue_auto_sync(run)
        self.assertEqual(database.read_bytes(), before)

    def test_mixed_presentation_seeds_only_stopped_owned_synthetic_closed_state(self):
        import sqlite3
        from types import SimpleNamespace
        from unittest.mock import Mock
        from history_fixture import SYNTHETIC_KEY
        from history_smoke import prepare_mixed_sync_presentation

        (self.destination / 'config').mkdir(mode=0o700)
        settings = self.destination / 'config/settings-v3.json'
        private_json(settings, {'keys': {}, 'fields': {}, 'garminApiKey': SYNTHETIC_KEY})
        database = self.destination / 'trainer.sqlite'
        with sqlite3.connect(database) as db:
            db.execute(
                'create table sync_checkpoint(key text primary key,value text,updated_at integer)'
            )
            db.execute('create table untouched(value text)')
            db.execute("insert into untouched values ('authored canary')")
            db.execute(
                'insert into sync_checkpoint values (?,?,0)',
                ('garmin_history_v1', json.dumps({'outcome': 'settled', 'remoteLowerBound': None})),
            )
        database.chmod(0o600)
        run = SimpleNamespace(root=self.destination, database=database, verify_settled=Mock())
        for outcome in ('settled', 'failed'):
            prepare_mixed_sync_presentation(run, outcome)
            with sqlite3.connect(database) as db:
                rows = dict(db.execute('select key,value from sync_checkpoint'))
                self.assertEqual(
                    db.execute('select value from untouched').fetchall(), [('authored canary',)]
                )
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
        settings.write_text(
            json.dumps(
                {
                    'keys': {'OPENAI_API_KEY': 'private-canary'},
                    'fields': {},
                    'garminApiKey': SYNTHETIC_KEY,
                }
            )
        )
        with self.assertRaisesRegex(ValueError, 'Synthetic-only'):
            prepare_mixed_sync_presentation(run, 'settled')
        self.assertEqual(database.read_bytes(), before)
        settings.write_text(json.dumps({'keys': {}, 'fields': {}, 'garminApiKey': SYNTHETIC_KEY}))
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

    def test_automatic_transition_preparation_is_stopped_synthetic_and_settings_only(self):
        from types import SimpleNamespace
        from unittest.mock import patch
        from history_fixture import SYNTHETIC_KEY
        from history_smoke import prepare_automatic_history

        (self.destination / 'config').mkdir(mode=0o700)
        settings = self.destination / 'config/settings-v3.json'
        fields = {
            'GARMIN_HISTORY_START_DATE': '2026-10-11',
            'DATABASE_PATH': '/owned/trainer.sqlite',
        }
        private_json(settings, {'keys': {}, 'fields': fields, 'garminApiKey': SYNTHETIC_KEY})
        run = SimpleNamespace(root=self.destination, child=None, config={'port': 1})
        with patch('history_smoke.listening', return_value=True):
            with self.assertRaisesRegex(ValueError, 'Stopped'):
                prepare_automatic_history(run)
        with patch('history_smoke.listening', return_value=False):
            prepare_automatic_history(run)
            saved = json.loads(settings.read_text())
            self.assertNotIn('GARMIN_HISTORY_START_DATE', saved['fields'])
            self.assertEqual(saved['fields']['DATABASE_PATH'], '/owned/trainer.sqlite')
            self.assertEqual(settings.stat().st_mode & 0o777, 0o600)
            with self.assertRaisesRegex(ValueError, 'date-limited'):
                prepare_automatic_history(run)
            settings.unlink()
            private_json(
                settings,
                {
                    'keys': {'OPENAI_API_KEY': 'private-canary'},
                    'fields': fields,
                    'garminApiKey': SYNTHETIC_KEY,
                },
            )
            before = settings.read_bytes()
            with self.assertRaisesRegex(ValueError, 'Synthetic-only'):
                prepare_automatic_history(run)
            self.assertEqual(settings.read_bytes(), before)
            settings.unlink()
            private_json(
                settings, {'keys': {}, 'fields': fields, 'garminApiKey': 'real-looking-key-value'}
            )
            with self.assertRaisesRegex(ValueError, 'Synthetic-only'):
                prepare_automatic_history(run)

    def test_automatic_discovery_refuses_unsettled_or_already_automatic_history_before_any_mutation(
        self,
    ):
        from types import SimpleNamespace
        from unittest.mock import Mock

        for state in [
            {
                'active': True,
                'historicalState': 'complete',
                'savedLimit': '2026-10-11',
                'limit': '2026-10-11',
            },
            {
                'active': False,
                'historicalState': 'available',
                'savedLimit': '2026-10-11',
                'limit': '2026-10-11',
            },
            {'active': False, 'historicalState': 'complete', 'savedLimit': None, 'limit': None},
        ]:
            run = SimpleNamespace(
                sync_captures=[],
                summary=Mock(return_value=state),
                history_digest=Mock(),
                stop=Mock(),
                start=Mock(),
                command=Mock(),
            )
            with self.assertRaisesRegex(ValueError, 'Settled date-limited'):
                HistoryRun.automatic_discovery(run)
            run.stop.assert_not_called()
            run.command.assert_not_called()

    def test_automatic_discovery_requires_offered_action_without_passive_mutation(self):
        from types import SimpleNamespace
        from unittest.mock import Mock, patch

        settled = {
            'active': False,
            'historicalState': 'complete',
            'savedLimit': '2026-10-11',
            'limit': '2026-10-11',
            'remoteLowerBound': None,
        }
        offered = {**settled, 'historicalAction': 'discover', 'limit': None}
        for after, digests in [
            ({**offered, 'historicalAction': None, 'historicalState': 'blocked'}, ['d', 'd']),
            (offered, ['d', 'changed']),
        ]:
            run = SimpleNamespace(
                sync_captures=[],
                summary=Mock(side_effect=[settled, after]),
                history_digest=Mock(side_effect=digests),
                stop=Mock(),
                start=Mock(),
                command=Mock(),
                wait=Mock(),
                binary='b',
                latest_only=Mock(),
            )
            with patch('history_smoke.prepare_automatic_history') as prepare:
                with self.assertRaisesRegex(ValueError, 'did not offer Discover'):
                    HistoryRun.automatic_discovery(run)
                prepare.assert_called_once_with(run)
            run.latest_only.assert_not_called()
            self.assertNotIn(
                {'type': 'sync', 'action': 'continue'},
                [call.args[0] for call in run.command.call_args_list],
            )

    def test_automatic_discovery_uses_one_visible_action_per_operation_and_proves_older_progress(
        self,
    ):
        from types import SimpleNamespace
        from unittest.mock import Mock, patch

        state = {
            'active': False,
            'historicalState': 'complete',
            'historicalAction': None,
            'savedLimit': '2026-10-11',
            'limit': '2026-10-11',
            'remoteLowerBound': None,
            'outcome': 'settled',
            'healthChecks': 20,
            'nextHealthDate': '2026-10-10',
            'batches': 0,
            'operationAttempts': 10,
            'expandedFrom': None,
            'noDataBefore': None,
        }
        commands = []

        def command(value):
            commands.append(value)
            if value.get('action') == 'continue':
                discover = state['historicalAction'] == 'discover'
                state.update(
                    active=discover,
                    historicalState='active' if discover else 'complete',
                    batches=1,
                    outcome='running' if discover else 'settled',
                    savedLimit=None,
                    expandedFrom='2026-10-11',
                    healthChecks=state['healthChecks'] + 6,
                    nextHealthDate='2026-10-01' if discover else '2026-08-26',
                    historicalAction='discover' if discover else None,
                    noDataBefore=None if discover else '2026-08-27',
                )
            if value.get('action') == 'cancel':
                state.update(
                    active=False,
                    outcome='cancelled',
                    historicalState='available',
                    historicalAction='continue',
                )
            return {'ok': True, 'capture': 'unit.png'}

        def start(_binary):
            if state['limit'] is not None and state['historicalAction'] is None:
                state.update(limit=None, historicalState='available', historicalAction='discover')

        run = SimpleNamespace(
            sync_captures=[],
            summary=Mock(side_effect=lambda: dict(state)),
            history_digest=Mock(return_value='same'),
            stop=Mock(),
            start=Mock(side_effect=start),
            command=Mock(side_effect=command),
            wait=Mock(),
            binary='b',
            wait_sync=Mock(),
            settle_claim=Mock(),
            latest_only=Mock(
                side_effect=lambda: {'after': dict(state), 'historyBytesPreserved': True}
            ),
        )
        run.synthetic_sync_capture = lambda preset: HistoryRun.synthetic_sync_capture(run, preset)
        with patch('history_smoke.prepare_automatic_history') as prepare:
            result = HistoryRun.automatic_discovery(run)
        prepare.assert_called_once_with(run)
        self.assertEqual([op['action'] for op in result['operations']], ['discover', 'continue'])
        self.assertEqual(sum(value.get('action') == 'continue' for value in commands), 2)
        self.assertEqual(sum(value.get('action') == 'cancel' for value in commands), 1)
        self.assertEqual(result['operations'][1]['after']['noDataBefore'], '2026-08-27')
        self.assertIsNone(result['operations'][1]['after']['historicalAction'])
        self.assertEqual(run.latest_only.call_count, 2)
        self.assertEqual(run.stop.call_count, 3)
        self.assertLess(result['operations'][0]['after']['nextHealthDate'], '2026-10-11')
        self.assertLess(
            result['operations'][1]['after']['nextHealthDate'],
            result['operations'][0]['after']['nextHealthDate'],
        )
        self.assertEqual(len(run.sync_captures), 10)

    def test_sync_scope_uses_populated_existing_setup_without_changing_default_wizard_coverage(
        self,
    ):
        from types import SimpleNamespace
        from history_smoke import setup_modes

        for flags, expected in [
            ((False, False, False), ['create-new', 'use-existing']),
            ((True, False, False), ['use-existing']),
            ((False, True, False), ['use-existing']),
            ((False, False, True), ['use-existing']),
        ]:
            self.assertEqual(
                setup_modes(
                    SimpleNamespace(
                        continuation_only=flags[0],
                        dependency_guidance=flags[1],
                        synthetic_sync=flags[2],
                    )
                ),
                expected,
            )

    def test_latest_only_checks_checkpoint_identity_and_never_retries_a_mutation(self):
        from types import SimpleNamespace
        from unittest.mock import Mock

        before = {'active': False, 'historicalState': 'complete', 'detailsRemaining': 0}
        after = {**before, 'latestOutcome': 'settled'}
        for digest, success in [('same', True), ('changed', False)]:
            run = SimpleNamespace(
                summary=Mock(side_effect=[before, after]),
                history_digest=Mock(side_effect=['same', digest]),
                command=Mock(),
                wait_sync=Mock(),
                settle_claim=Mock(),
            )
            if success:
                self.assertTrue(HistoryRun.latest_only(run)['historyBytesPreserved'])
            else:
                with self.assertRaisesRegex(ValueError, 'changed saved history'):
                    HistoryRun.latest_only(run)
            self.assertEqual(
                run.command.call_args_list[0].args[0], {'type': 'sync', 'action': 'start'}
            )
            self.assertEqual(run.command.call_count, 1)

    def test_multi_detail_progress_requires_actual_owned_progress_without_replay(self):
        from types import SimpleNamespace
        from unittest.mock import Mock

        before = {'active': False, 'historicalState': 'complete', 'detailsRemaining': 3}
        after = {**before, 'latestOutcome': 'settled', 'detailsRemaining': 0}
        for middle, succeeds in [
            ({'active': True, 'detailsProcessed': 1}, True),
            ({'active': False}, False),
        ]:
            run = SimpleNamespace(
                summary=Mock(side_effect=[before, middle, after]),
                history_digest=Mock(return_value='same'),
                command=Mock(return_value={'ok': True}),
                wait_sync=Mock(),
                settle_claim=Mock(),
                sync_captures=[],
            )
            if succeeds:
                HistoryRun.latest_only(run)
                self.assertEqual(len(run.sync_captures), 2)
            else:
                with self.assertRaisesRegex(ValueError, 'no replay'):
                    HistoryRun.latest_only(run)
            self.assertEqual(
                sum(call.args[0].get('action') == 'start' for call in run.command.call_args_list), 1
            )

    def test_backend_latest_uses_one_actual_owned_post_and_requires_settlement(self):
        from types import SimpleNamespace
        from unittest.mock import Mock, patch, MagicMock

        before = {'active': False, 'historicalState': 'complete'}
        after = {**before, 'latestOutcome': 'settled'}
        for payload, digest, succeeds in [
            (b'{"type":"result","status":"completed"}\n', 'same', True),
            (b'{"type":"result","status":"failed"}\n', 'same', False),
            (b'{"type":"result","status":"completed"}\n', 'changed', False),
        ]:
            run = SimpleNamespace(
                origin='http://127.0.0.1:12345',
                summary=Mock(side_effect=[before, after]),
                history_digest=Mock(side_effect=['same', digest]),
                command=Mock(return_value={'ok': True}),
                wait_sync=Mock(),
                settle_claim=Mock(),
                sync_captures=[],
            )
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
                self.assertTrue(
                    all(
                        item.args[0].get('action') not in ('start', 'cancel', 'continue')
                        for item in run.command.call_args_list
                    )
                )
        run.summary = Mock(return_value={'active': True})
        with patch('history_smoke.urllib.request.urlopen') as post:
            with self.assertRaisesRegex(ValueError, 'no overlap'):
                HistoryRun.backend_latest(run)
            post.assert_not_called()

    def test_data_capture_follows_the_actual_existing_selection(self):
        from types import SimpleNamespace
        from unittest.mock import Mock, call

        run = SimpleNamespace(
            root=self.destination,
            descriptor={'historySetup': 'use-existing'},
            config={'source': 'unit-only'},
            boot='unit-only',
            binary=Path('/unit-only'),
            setup_start=Mock(),
            settings_action=Mock(return_value={'ok': True}),
            wait_settings=Mock(),
            wait_backend=Mock(),
            stop=Mock(),
            start=Mock(),
        )
        HistoryRun.onboarding(run)
        self.assertEqual(
            run.settings_action.call_args_list[:2], [call('useExisting'), call('capture')]
        )
        run.wait_backend.assert_called_once()

    def test_failed_continuation_retains_cancel_and_captures_without_another_start(self):
        from types import SimpleNamespace
        from unittest.mock import Mock

        summary = {'active': False, 'outcome': 'failed', 'operations': 0, 'failureClass': 'auth'}
        cancelled = {'failed': False, 'paused': True, 'running': False}
        failed = {'failed': True, 'paused': False, 'running': False}
        run = SimpleNamespace(
            root=self.destination,
            config={'source': 'unit-only'},
            boot='unit-only',
            command=Mock(return_value={'ok': True, 'capture': 'unit-only.png'}),
            wait=Mock(),
            summary=Mock(return_value=summary),
            settle_claim=Mock(),
            wait_sync=Mock(
                side_effect=[
                    {'running': True},
                    cancelled,
                    {'startEnabled': True},
                    {'running': True, 'failed': False},
                    failed,
                ]
            ),
        )
        with self.assertRaisesRegex(ValueError, 'continuation failed'):
            HistoryRun.real_sync(run)
        commands = [call.args[0] for call in run.command.call_args_list]
        self.assertEqual(sum(c.get('action') == 'start' for c in commands), 1)
        self.assertEqual(sum(c.get('action') == 'continue' for c in commands), 1)
        self.assertEqual(len(run.sync_captures), 2)
        for name in [
            'real-sync-progress.json',
            'real-sync-cancelled.json',
            'real-sync-failure.json',
        ]:
            evidence = json.loads((self.destination / name).read_text())
            self.assertTrue(evidence['captures'])
        evidence = json.loads((self.destination / 'real-sync-failure.json').read_text())
        self.assertEqual(evidence['cancelled'], cancelled)
        self.assertEqual(evidence['settled'][0]['summary']['failureClass'], 'auth')

    def test_selected_checkpoint_continuation_is_exactly_one_invocation(self):
        from types import SimpleNamespace
        from unittest.mock import Mock

        before = {'active': False, 'outcome': 'failed', 'operations': 50}
        after = {'active': False, 'outcome': 'budget-limited', 'operations': 96}
        run = SimpleNamespace(
            root=self.destination,
            config={'source': 'unit-only'},
            boot='unit-only',
            command=Mock(return_value={'ok': True, 'capture': 'unit-only.png'}),
            wait=Mock(),
            summary=Mock(side_effect=[before, after]),
            settle_claim=Mock(),
            wait_sync=Mock(
                side_effect=[
                    {'startEnabled': True},
                    {'running': True, 'failed': False},
                    {'running': False, 'paused': True, 'completed': False, 'failed': False},
                ]
            ),
        )
        HistoryRun.continue_once(run)
        actions = [call.args[0].get('action') for call in run.command.call_args_list]
        self.assertEqual(actions.count('continue'), 1)
        self.assertNotIn('start', actions)
        self.assertNotIn('cancel', actions)
        evidence = json.loads((self.destination / 'single-continuation.json').read_text())
        self.assertEqual(evidence['maxInvocations'], 1)
        self.assertEqual(evidence['after'], after)
        self.assertEqual(len(evidence['captures']), 2)

    def test_active_or_missing_checkpoint_refuses_single_continuation(self):
        from types import SimpleNamespace
        from unittest.mock import Mock

        for summary in [{'active': True, 'outcome': 'failed'}, {'active': False, 'outcome': None}]:
            run = SimpleNamespace(command=Mock(), wait=Mock(), summary=Mock(return_value=summary))
            with self.assertRaisesRegex(ValueError, 'prior discovery checkpoint'):
                HistoryRun.continue_once(run)
            self.assertFalse(
                any(call.args[0].get('action') == 'continue' for call in run.command.call_args_list)
            )

    def test_native_setup_failure_is_retained_without_finish_replay(self):
        from types import SimpleNamespace
        from unittest.mock import Mock, call

        failure = (
            'Settings filename/version conflict; preserve originals and use a compatible build.'
        )
        run = SimpleNamespace(
            root=self.destination,
            child=SimpleNamespace(poll=lambda: None),
            http=Mock(return_value={'origin': None}),
            accept_identity=Mock(return_value=True),
            settings_action=Mock(return_value={'setupFailure': failure}),
        )
        with self.assertRaisesRegex(RuntimeError, 'filename/version conflict'):
            HistoryRun.wait_backend(run)
        self.assertEqual(run.settings_action.call_args_list, [call('observe')])
        evidence = json.loads((self.destination / 'native-setup-failure.json').read_text())
        self.assertEqual(evidence['nativeStaticFailure'], failure)

    def test_backend_origin_alone_does_not_authorize_renderer_dispatch(self):
        from types import SimpleNamespace
        from unittest.mock import Mock

        origin = 'http://127.0.0.1:12346'
        run = SimpleNamespace(
            root=self.destination,
            child=SimpleNamespace(poll=lambda: None),
            config={'port': 12345},
            launches=1,
            http=Mock(
                side_effect=[
                    TimeoutError('Atomic creation still owns identity'),
                    {
                        'origin': origin,
                        'runtimeReady': False,
                        'rendererDiagnostic': {'dashboard': True, 'bootstrap': True, 'ipc': True},
                    },
                    {
                        'origin': origin,
                        'runtimeReady': True,
                        'rendererDiagnostic': {'dashboard': True, 'bootstrap': True, 'ipc': True},
                    },
                ]
            ),
            accept_identity=Mock(return_value=True),
            settings_action=Mock(),
            command=Mock(return_value={'dashboard': True, 'hydrated': True}),
        )
        HistoryRun.wait_backend(run)
        run.command.assert_called_once_with({'type': 'observe'})
        run.settings_action.assert_not_called()
        self.assertTrue(
            json.loads((self.destination / 'readiness-1.json').read_text())['rendererRoundTrip']
        )

    def test_admission_refusal_is_never_retried_as_readiness(self):
        from types import SimpleNamespace
        from unittest.mock import Mock

        run = SimpleNamespace(
            child=SimpleNamespace(poll=lambda: None),
            http=Mock(side_effect=RuntimeError('Bridge status 403: Run authority changed')),
            settings_action=Mock(),
            command=Mock(),
        )
        with self.assertRaisesRegex(RuntimeError, '403'):
            HistoryRun.wait_backend(run)
        self.assertEqual(run.http.call_count, 1)
        run.settings_action.assert_not_called()
        run.command.assert_not_called()

    def test_identity_transport_timeout_still_obeys_overall_readiness_deadline(self):
        from types import SimpleNamespace
        from unittest.mock import Mock, patch

        run = SimpleNamespace(
            child=SimpleNamespace(poll=lambda: None),
            http=Mock(side_effect=TimeoutError('Identity pending')),
            settings_action=Mock(),
            command=Mock(),
        )
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


class NoExternalToolsLaunch(unittest.TestCase):
    def test_restricted_launch_denies_only_python_and_uv_tools(self):
        import subprocess
        from types import SimpleNamespace
        from history_smoke import HistoryRun, NO_EXTERNAL_TOOLS_PROFILE, SANDBOX_EXEC

        from unittest.mock import patch

        run = SimpleNamespace(no_external_tools=False)
        self.assertEqual(HistoryRun.launch_prefix(run), [])
        run.no_external_tools = True
        if not SANDBOX_EXEC.is_file():
            # Off macOS the proof refuses rather than silently running unrestricted.
            with self.assertRaisesRegex(ValueError, 'sandbox-exec required'):
                HistoryRun.launch_prefix(run)
            self.skipTest('macOS sandbox-exec unavailable')
        self.assertEqual(
            HistoryRun.launch_prefix(run), [str(SANDBOX_EXEC), '-p', NO_EXTERNAL_TOOLS_PROFILE]
        )
        with patch('history_smoke.SANDBOX_EXEC', SANDBOX_EXEC.with_name('missing-sandbox')):
            with self.assertRaisesRegex(ValueError, 'sandbox-exec required'):
                HistoryRun.launch_prefix(run)
        denied = subprocess.run(
            [*HistoryRun.launch_prefix(run), '/usr/bin/python3', '-c', 'print(1)'],
            capture_output=True,
        )
        self.assertNotEqual(denied.returncode, 0)
        allowed = subprocess.run(
            [*HistoryRun.launch_prefix(run), '/bin/echo', 'ok'], capture_output=True
        )
        self.assertEqual((allowed.returncode, allowed.stdout), (0, b'ok\n'))
