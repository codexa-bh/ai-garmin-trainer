import contextlib
import fcntl
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import uuid

from ordinary_smoke import OrdinaryRun, inventory_hash, private_directory
from release_smoke import audit, REQUIRED


class OrdinaryContracts(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name).resolve()
        self.root.chmod(0o700)
        self.source = self.root / 'source.sqlite'
        with contextlib.closing(sqlite3.connect(self.source)) as db:
            db.execute('create table synthetic(id integer, value text)')
            db.execute("insert into synthetic values(1, 'unit only')")
            db.commit()
        self.bundle = self.root / 'unit.app'
        binary = self.bundle / 'Contents/MacOS/garmin-trainer-desktop'
        binary.parent.mkdir(parents=True)
        binary.write_bytes(b' '.join(REQUIRED))
        self.inventory = audit(self.bundle)

    def tearDown(self):
        self.temporary.cleanup()

    def run_fixture(self):
        # Identity admission has real filesystem/mutation contracts in ordinary_identity_test.
        verified = {'provenance': {'sourceFingerprint': 'a' * 64, 'buildSourceFingerprint': 'd' * 64,
                                  'buildContext': 'e' * 64}, 'current': {'source': 'a' * 64}}
        return OrdinaryRun(self.root, self.source, 'a' * 64, self.bundle, self.inventory, verified=verified)

    def test_independent_private_preparation_and_unmodified_bundle_copy(self):
        first, second = self.run_fixture(), self.run_fixture()
        self.assertNotEqual(first.root, second.root)
        self.assertNotEqual(first.config['token'], second.config['token'])
        self.assertEqual(audit(first.bundle), self.inventory)
        self.assertEqual(audit(second.bundle), self.inventory)
        self.assertEqual(audit(self.bundle), self.inventory)
        for run in [first, second]:
            self.assertFalse((run.root / 'home').exists())
            self.assertFalse((run.root / 'config.json').exists())
            for name in ['app-data', 'setup-profile', 'profile', 'tmp', 'screenshots', 'config']:
                self.assertEqual((run.root / name).stat().st_mode & 0o777, 0o700)
            self.assertEqual((run.root / 'launch.json').stat().st_mode & 0o777, 0o600)
            descriptor = json.loads((run.root / 'launch.json').read_text())
            self.assertEqual(set(descriptor), {'schemaVersion', 'runId', 'root', 'sourceFingerprint', 'buildSourceFingerprint', 'buildContext', 'artifactInventoryHash', 'controlPort', 'capability'})
            self.assertEqual(descriptor['artifactInventoryHash'], inventory_hash(self.inventory))

    def test_launch_keeps_home_and_excludes_capability_from_argv_env_logs(self):
        run = self.run_fixture()
        with patch.dict(os.environ, {'HOME': '/operator-home', 'OPENAI_API_KEY': 'never-forward-this'}):
            with patch('ordinary_smoke.subprocess.Popen') as spawn:
                run.spawn(run.binary, run.root / 'unit.log')
        args, keywords = spawn.call_args
        self.assertEqual(args[0], [str(run.binary), '--isolated-smoke-run', str(run.root / 'launch.json')])
        self.assertEqual(keywords['env']['HOME'], '/operator-home')
        self.assertEqual(keywords['env']['TMPDIR'], str(run.root / 'tmp'))
        self.assertNotIn('OPENAI_API_KEY', keywords['env'])
        self.assertEqual(keywords['stdin'], subprocess.PIPE)
        self.assertNotIn(run.config['token'], repr(spawn.call_args))
        self.assertEqual((run.root / 'unit.log').read_bytes(), b'')

    def test_fresh_capability_each_boot_with_private_atomic_descriptor(self):
        run = self.run_fixture()
        first, identity = run.config['token'], run.launch_identity
        run.renew_capability()
        second = run.config['token']
        self.assertNotEqual(first, second)
        self.assertNotEqual(identity, run.launch_identity)
        self.assertEqual(run.previous_token, first)
        self.assertEqual(json.loads((run.root / 'launch.json').read_text()), run.descriptor)
        run.renew_capability()
        self.assertNotEqual(second, run.config['token'])
        self.assertEqual(run.previous_token, second)
        self.assertEqual(run.descriptor['capability'], run.config['token'])
        self.assertEqual((run.root / 'launch.json').stat().st_mode & 0o777, 0o600)
        self.assertEqual((run.root / 'launch.json').stat().st_nlink, 1)
        self.assertEqual(list(run.root.glob('.launch-*')), [])

    def test_descriptor_replacement_or_alias_is_preserved_not_adopted(self):
        run = self.run_fixture()
        launch = run.root / 'launch.json'
        launch.rename(run.root / 'retained-launch.json')
        launch.write_text('foreign descriptor')
        launch.chmod(0o600)
        original = run.config['token']
        with self.assertRaises(ValueError):
            run.renew_capability()
        self.assertEqual(launch.read_text(), 'foreign descriptor')
        launch.unlink()
        target = run.root / 'foreign.json'
        target.write_text('foreign private data')
        launch.symlink_to(target)
        with self.assertRaises(ValueError):
            run.renew_capability()
        self.assertEqual(target.read_text(), 'foreign private data')
        self.assertTrue(launch.is_symlink())
        self.assertEqual(run.config['token'], original)

    def test_live_root_owner_or_replaced_root_never_gets_a_new_descriptor(self):
        run = self.run_fixture()
        original = (run.root / 'launch.json').read_bytes()
        fd = os.open(run.root, os.O_RDONLY | os.O_DIRECTORY)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with self.assertRaises(BlockingIOError):
                run.renew_capability()
            self.assertEqual((run.root / 'launch.json').read_bytes(), original)
        finally:
            os.close(fd)
        run.root.rename(run.root.with_name(run.root.name + '-retained'))
        run.root.mkdir(mode=0o700)
        launch = run.root / 'launch.json'
        launch.write_text('foreign root data')
        with self.assertRaises(ValueError):
            run.renew_capability()
        self.assertEqual(launch.read_text(), 'foreign root data')

    def test_exact_identity_and_new_boot_required_and_request_bound(self):
        run = self.run_fixture()
        run.child = SimpleNamespace(pid=12345)
        identity = {'schemaVersion': 1, 'runId': run.id, 'source': run.config['source'], 'pid': 12345, 'database': str(run.database),
                    'appIdentity': 'com.codexa.garmin-trainer.ordinary.r' + run.id.replace('-', ''),
                    'artifactKind': 'ordinary', 'buildMode': 'release', 'launchMode': 'isolated', 'controlContract': 'trainer-ordinary-isolated/v2', 'buildSourceFingerprint': run.build_source, 'buildContext': run.build_context,
                    'artifactInventoryHash': run.artifact, 'boot': str(uuid.uuid4())}
        for key, wrong in [('schemaVersion', 2), ('schemaVersion', True), ('runId', str(uuid.uuid4())), ('source', 'b' * 64), ('pid', 1), ('database', '/normal/data.sqlite'),
                           ('buildMode', 'debug'), ('artifactKind', 'probe'), ('controlContract', 'wrong-version'), ('artifactInventoryHash', 'b' * 64),
                           ('buildSourceFingerprint', 'f' * 64), ('buildContext', 'f' * 64)]:
            self.assertFalse(run.accept_identity({**identity, key: wrong}))
        self.assertTrue(run.accept_identity(identity))
        self.assertEqual(run.request({'type': 'observe'}, 'unit')['expectedBoot'], identity['boot'])
        run.previous_boot = identity['boot']
        self.assertFalse(run.accept_identity(identity))
        run.child = None

    def test_fresh_failed_scenario_on_hit_writes_its_own_false_receipt_without_build_requests(self):
        from ordinary_smoke import execute_ordinary
        from native_smoke import fingerprint, readonly
        runs = [self.run_fixture(), self.run_fixture()]
        for index, run in enumerate(runs):
            def start(_binary, run=run, index=index):
                run.origin, run.boot = 'http://127.0.0.1:' + str(10000 + index), str(uuid.uuid4())
            run.start = start
            run.stop = lambda: None
            run.verify_admission_denials = lambda: None
            def failed():
                raise AssertionError('fresh scenario oracle failed')
            run.scenario = failed
        with contextlib.closing(readonly(self.source)) as database:
            original = fingerprint(database)
        private = self.root / 'preparation.json'
        private.write_text('{}')
        (self.root / 'selection.json').write_text('{}')
        prepared = SimpleNamespace(database=self.source, original=original, root=self.root,
                                   provenance={'route': 'unit-authored-synthetic'}, verify_current=lambda: None)
        verified = {'current': {'source': 'a' * 64, 'driver': 'f' * 64},
                    'provenance': {'sourceFingerprint': 'b' * 64, 'buildSourceFingerprint': 'd' * 64}, 'context': 'e' * 64}
        args = SimpleNamespace(summary_engine=False, conversation_selection=False, composer_footer=False,
                               model_eligibility=False, prepare_only=False)
        observer = SimpleNamespace(stop=lambda pids: {'ownedNativeFrontmost': False})
        allocations = iter(runs)
        def construct(*_args, enroll, **_kwargs):
            run = next(allocations)
            enroll(run)
            return run
        with patch('ordinary_smoke.OrdinaryRun', side_effect=construct), patch('ordinary_smoke.Observer', return_value=observer), \
             patch('ordinary_smoke.verify_ordinary', return_value=verified), patch('ordinary_smoke.source_snapshot', return_value=verified['current']), \
             patch('ordinary_smoke.security'), patch('ordinary_identity.run_build') as build:
            with self.assertRaisesRegex(AssertionError, 'fresh scenario oracle'):
                execute_ordinary(args, self.root, prepared, self.bundle, 'a' * 64, verified, self.inventory)
            build.assert_not_called()
        receipt = json.loads(next(self.root.glob('ordinary-receipt-*.json')).read_text())
        self.assertFalse(receipt['scenarioPassed'])
        self.assertTrue(receipt['artifactReused'])
        self.assertEqual(receipt['artifactOriginalSource'], 'b' * 64)
        self.assertEqual(receipt['source'], 'a' * 64)
        self.assertEqual(sum(receipt['buildStageRequests'].values()), 0)
        self.assertTrue(receipt['currentDriverUnchanged'])
        self.assertTrue(receipt['inputUnchanged'])
        self.assertEqual(receipt['shutdownErrors'], [])
        self.assertIn('AssertionError', receipt['scenarioFailure'])

    def test_capture_navigation_returns_to_visible_wide_controls_before_each_destination(self):
        run = self.run_fixture()
        commands = []
        run.command = lambda command: commands.append(command) or {'ok': True}
        run.wait = lambda predicate, label: None
        run.captures()
        preset = 'wide'
        captures = []
        for command in commands:
            if command['type'] == 'setViewport':
                preset = command['preset']
            if command['type'] == 'click':
                self.assertEqual(preset, 'wide')
            if command['type'] == 'captureView':
                captures.append((command['view'], command['preset']))
                self.assertEqual(preset, command['preset'])
        self.assertEqual(captures, [(view, preset) for view in ['trainer', 'sync', 'profile'] for preset in ['wide', 'narrow']])

    def test_conversation_scenario_uses_finite_actions_fresh_origin_and_only_run_copy(self):
        run = self.run_fixture()
        run.origin, run.boot = 'http://127.0.0.1:11111', 'old-boot'
        commands = []
        run.command = lambda command: commands.append(command) or {'ok': True}
        run.wait = lambda predicate, label: None
        run.conversation_wait = lambda predicate, label: None
        run.conversation_open_history = lambda: commands.append({'type': 'conversation', 'action': 'open-history'})
        run.stop = lambda: commands.append({'type': 'owned-stop'})
        def start(binary):
            self.assertEqual(binary, run.binary)
            run.origin, run.boot = 'http://127.0.0.1:22222', 'fresh-boot'
        run.start = start
        run.conversation_state = lambda: {'onlySynthetic': True, 'messagesEmpty': True, 'defaultAbsent': True}
        original = self.source.read_bytes()
        run.conversation_scenario()
        actions = [c['action'] for c in commands if c['type'] == 'conversation']
        self.assertEqual([action for action in actions if action in ['new', 'choose-first', 'delete-second', 'delete-first']], ['new', 'new', 'choose-first', 'delete-second', 'new', 'delete-second', 'delete-first'])
        self.assertEqual(actions.count('save-title'), 3)
        self.assertEqual(actions.count('menu-second'), 2)
        self.assertEqual(actions.count('menu-first'), 1)
        self.assertEqual(sum(c['type'] == 'owned-stop' for c in commands), 1)
        self.assertTrue(all(set(c) <= {'type', 'action', 'target', 'view', 'preset'} for c in commands))
        captures = [c for c in commands if c['type'] == 'captureView']
        self.assertEqual([c['preset'] for c in captures], ['wide', 'narrow', 'wide'])
        receipt = json.loads((run.root / 'conversation-scenario.json').read_text())
        self.assertTrue(receipt['passed'])
        self.assertTrue(receipt['freshOriginAndBoot'])
        self.assertNotIn('conversationId', repr(receipt))
        self.assertEqual(self.source.read_bytes(), original)

    def test_conversation_readback_exposes_only_bounded_synthetic_booleans(self):
        run = self.run_fixture()
        with contextlib.closing(sqlite3.connect(run.database)) as db:
            db.executescript('create table conversation(id text, title text); create table message(id text); create table app_metadata(key text, value text);')
            title = 'T0250-first-' + run.id.replace('-', '')
            db.execute('insert into conversation values (?,?)', ('private-generated-id', title))
            db.execute('insert into app_metadata values (?,?)', ('chat.active_conversation.v1', 'private-generated-id'))
            db.commit()
        state = run.conversation_state()
        self.assertTrue(state['savedFirst'])
        self.assertTrue(state['onlySynthetic'])
        self.assertTrue(state['messagesEmpty'])
        self.assertNotIn('private-generated-id', repr(state))
        self.assertNotIn(title, repr(state))

    def test_opt_in_composer_config_is_fixed_keyless_private_and_preserves_source(self):
        original = self.source.read_bytes()
        run = self.run_fixture()
        prior = (run.root / 'config/settings-v2.json').read_bytes()
        run.prepare_composer()
        configured = run.root / 'config/settings-v3.json'
        value = json.loads(configured.read_text())
        self.assertEqual(value['version'], 3)
        self.assertEqual(value['keys'], {})
        self.assertEqual(value['fields']['DATABASE_PATH'], str(run.database))
        self.assertIsNone(value['chatCatalog']['defaultEntryId'])
        self.assertEqual(value['selectionCompatibility']['catalog']['entries'], [])
        self.assertEqual([entry['id'] for entry in value['chatCatalog']['entries']], ['entry_footer_long', 'entry_footer_other'])
        self.assertTrue(all(entry['provider'] == 'ollama' for entry in value['chatCatalog']['entries']))
        self.assertEqual(configured.stat().st_mode & 0o777, 0o600)
        self.assertEqual((run.root / 'config/settings-v2.json').read_bytes(), prior)
        self.assertEqual(self.source.read_bytes(), original)
        with self.assertRaises(FileExistsError):
            run.prepare_composer()  # Never replace/adopt existing config on replay.

    def test_eligibility_preparation_is_finite_keyless_copy_only_and_refuses_existing_preferences(self):
        original = self.source.read_bytes()
        for scenario in ['mixed', 'empty']:
            run = self.run_fixture()
            with contextlib.closing(sqlite3.connect(run.database)) as db:
                db.execute('create table app_metadata(key text primary key, value text, updated_at integer not null)')
                db.commit()
            prior = (run.root / 'config/settings-v2.json').read_bytes()
            run.prepare_composer(scenario)
            value = json.loads((run.root / 'config/settings-v3.json').read_text())
            self.assertEqual(value['keys'], {})
            self.assertIsNone(value['chatCatalog']['defaultEntryId'])
            providers = [entry['provider'] for entry in value['chatCatalog']['entries']]
            self.assertEqual(providers, (['ollama', 'ollama'] if scenario == 'mixed' else []) + ['openai', 'openai', 'deepseek', 'openrouter'])
            with contextlib.closing(sqlite3.connect(run.database)) as db:
                self.assertEqual(db.execute('select key,value from app_metadata').fetchall(), [('ai.chat_model.v2', 'entry_hidden_0')])
            self.assertEqual((run.root / 'config/settings-v2.json').read_bytes(), prior)
        self.assertEqual(self.source.read_bytes(), original)
        run = self.run_fixture()
        with self.assertRaisesRegex(ValueError, 'Unknown finite'):
            run.prepare_composer('private')
        self.assertFalse((run.root / 'config/settings-v3.json').exists())
        with contextlib.closing(sqlite3.connect(run.database)) as db:
            db.execute('create table app_metadata(key text, value text, updated_at integer)')
            db.execute("insert into app_metadata values ('ai.chat_model.v2','existing',0)")
            db.commit()
        with self.assertRaisesRegex(ValueError, 'Existing model preference refused'):
            run.prepare_composer('mixed')
        with contextlib.closing(sqlite3.connect(run.database)) as db:
            self.assertEqual(db.execute('select value from app_metadata').fetchall(), [('existing',)])

    def test_eligibility_scenarios_have_finite_actions_exact_state_and_no_mutation_replay(self):
        for scenario in ['mixed', 'empty']:
            run = self.run_fixture()
            run.composer_eligibility = scenario
            calls = []
            observation = {key: True for key in ['catalogKnown', 'unavailableChoice', 'singleControl', 'footerOrder', 'fitsViewport', 'draftMatches', 'textareaStable']}
            observation['noEligibleChoices'] = scenario == 'empty'
            run.command = lambda command: calls.append(command) or observation
            run.wait = lambda predicate, label: None
            run.composer_wait = lambda predicate, label: None
            choices = [('entry_hidden_0', 'selected')] + ([] if scenario == 'empty' else [('entry_footer_long', 'selected')])
            with patch.object(run, 'chat_hash', return_value='unchanged'), patch.object(run, 'model_choice', side_effect=choices):
                run.composer_scenario()
            actions = [command['action'] for command in calls if command['type'] == 'composer' and command['action'] != 'observe']
            self.assertEqual(actions, ['draft'] if scenario == 'empty' else ['draft', 'keys', 'choose'])
            self.assertEqual(len([command for command in calls if command['type'] == 'captureView']), 2 if scenario == 'empty' else 4)
            receipt = json.loads((run.root / 'eligibility-scenario.json').read_text())
            self.assertTrue(receipt['hiddenPreferencePreservedUntilExplicitAction'])
            self.assertTrue(receipt['noResetOrFallback'])
            self.assertTrue(receipt['chatDataUnchanged'])
            self.assertNotIn('modelId', repr(calls))
        run = self.run_fixture()
        run.composer_eligibility = 'mixed'
        calls = []
        run.command = lambda command: calls.append(command) or {}
        run.wait = lambda predicate, label: None
        run.composer_wait = lambda predicate, label: None
        with patch.object(run, 'model_choice', return_value=(None, 'env')):
            with self.assertRaisesRegex(ValueError, 'Rendering changed'):
                run.composer_scenario()
        self.assertFalse(any(command['type'] == 'captureView' for command in calls))
        self.assertFalse(any(command['type'] == 'composer' for command in calls))

    def test_composer_scenario_uses_finite_ui_actions_four_captures_and_persisted_choice(self):
        run = self.run_fixture()
        calls = []
        observation = {key: True for key in ['modelReady', 'unselectedChoice', 'singleControl', 'footerOrder', 'fitsViewport', 'draftMatches', 'textareaStable', 'keysNoSend']}
        run.command = lambda command: calls.append(command) or observation
        run.wait = lambda predicate, label: None
        run.composer_wait = lambda predicate, label: None
        with patch.object(run, 'chat_hash', return_value='unchanged'), patch.object(run, 'model_choice', side_effect=[(None, 'unselected'), ('entry_footer_long', 'selected')]):
            run.composer_scenario()
        self.assertEqual([command['action'] for command in calls if command['type'] == 'composer' and command['action'] != 'observe'], ['draft', 'keys', 'choose'])
        self.assertEqual([(command['view'], command['preset']) for command in calls if command['type'] == 'captureView'], [('composer', preset) for _state in ['unselected', 'saved'] for preset in ['wide', 'narrow']])
        receipt = json.loads((run.root / 'composer-scenario.json').read_text())
        self.assertTrue(receipt['chatDataUnchanged'])
        self.assertEqual(receipt['providerSend'], 'not invoked')
        self.assertNotIn('value', repr(calls))

    def test_composer_persistence_failure_does_not_replay_choice_or_continue_capture(self):
        run = self.run_fixture()
        calls = []
        run.command = lambda command: calls.append(command) or {'unselectedChoice': True}
        run.wait = lambda predicate, label: None
        run.composer_wait = lambda predicate, label: None
        with patch.object(run, 'chat_hash', return_value='unchanged'), patch.object(run, 'model_choice', side_effect=[(None, 'unselected'), ('entry_wrong', 'selected')]):
            with self.assertRaisesRegex(ValueError, 'did not persist'):
                run.composer_scenario()
        self.assertEqual(sum(command == {'type': 'composer', 'action': 'choose'} for command in calls), 1)
        self.assertEqual(sum(command['type'] == 'captureView' for command in calls), 2) # Initial no-selection captures only.
        self.assertFalse((run.root / 'composer-scenario.json').exists())

    def test_private_scratch_alias_and_foreign_inventory_denied(self):
        self.assertEqual(private_directory(self.root), self.root)
        self.root.chmod(0o755)
        with self.assertRaises(ValueError):
            private_directory(self.root)
        self.root.chmod(0o700)
        alias = self.root / 'alias'
        alias.symlink_to(self.root, target_is_directory=True)
        with self.assertRaises(ValueError):
            private_directory(alias)
        with self.assertRaises(ValueError):
            inventory_hash({'bad\npath': 'a' * 64})

    def test_receipts_without_live_handles_never_authorize_signals_or_lease_stealing(self):
        run = self.run_fixture()
        run.pids = [12345]
        fd = os.open(run.root, os.O_RDONLY | os.O_DIRECTORY)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with patch('native_smoke.os.killpg') as kill:
                with self.assertRaises(BlockingIOError):
                    run.stop()
                kill.assert_not_called()
        finally:
            fcntl.flock(fd, fcntl.LOCK_UN)
            os.close(fd)
        run.stop()

    def selection_args(self, **options):
        return SimpleNamespace(**{**dict(summary_engine=False, conversation_selection=False,
            composer_footer=False, model_eligibility=False, prepare_only=False,
            smoke_scope='full', impact='unknown', impact_basis='', summary_part='all', summary_family=None), **options})

    def test_finite_selection_refuses_empty_shared_unknown_and_incompatible_before_preparation(self):
        from ordinary_smoke import selection_plan, main
        cases = [dict(smoke_scope='feature'), dict(smoke_scope='feature', composer_footer=True),
                 dict(smoke_scope='feature', composer_footer=True, impact='shared', impact_basis='shared owner'),
                 dict(smoke_scope='feature', composer_footer=True, impact='unknown', impact_basis='uncertain'),
                 dict(summary_engine=True, composer_footer=True), dict(summary_part='lifecycle'),
                 dict(summary_engine=True, summary_part='lifecycle', summary_family=['densify']),
                 dict(summary_engine=True, summary_family=['unknown']),
                 dict(summary_engine=True, summary_family=['history', 'history']),
                 dict(summary_engine=True, smoke_scope='feature', impact='local-feature', impact_basis='wrong'),
                 dict(summary_engine=True, summary_part='presentation', smoke_scope='feature', impact='summary-lifecycle', impact_basis='wrong')]
        for options in cases:
            with self.subTest(options=options), self.assertRaises(ValueError):
                selection_plan(self.selection_args(**options))
        with patch('sys.argv', ['ordinary', '--scratch', '/unavailable', '--bundle', '/unavailable',
                               '--smoke-scope', 'feature', '--composer-footer']), \
             patch('ordinary_smoke.resources.configure') as configure, patch('smoke_input.prepare') as prepare:
            with self.assertRaises(SystemExit):
                main.__wrapped__()
            configure.assert_not_called(); prepare.assert_not_called()

    def orchestration(self, args, failure=None, construction_failure=False, *, scenarios=(), plan=None,
                      configure=None, expected_failure=False, partial_failure_at=None):
        from ordinary_smoke import execute_ordinary
        from native_smoke import fingerprint, readonly
        from unittest.mock import Mock
        runs = [self.run_fixture(), self.run_fixture()]
        for index, run in enumerate(runs):
            def start(_binary, run=run, index=index):
                run.previous_boot, run.previous_token = run.boot, 'old-token'
                run.origin, run.boot = 'http://127.0.0.1:' + str(10000 + index + run.launches * 2), str(uuid.uuid4())
                run.launches += 1
            run.start = Mock(side_effect=start)
            for method in ('stop', 'http', 'wait', 'command', 'verify_admission_denials', 'verify_restart',
                           'verify_parent_death', 'captures', 'prepare_composer', 'conversation_scenario'):
                setattr(run, method, Mock())
            run.scenario = Mock(return_value='sentinel')
            run.composer_scenario = Mock(side_effect=failure)
            run.model_choice = Mock(return_value=('fixed', 'selected'))
        with contextlib.closing(readonly(self.source)) as database:
            original = fingerprint(database)
        (self.root / 'preparation.json').write_text('{}')
        (self.root / 'selection.json').write_text('{}')
        prepared = SimpleNamespace(database=self.source, original=original, root=self.root,
                                   provenance={'route': 'unit-authored'}, verify_current=Mock())
        verified = {'current': {'source': 'a' * 64}, 'provenance': {'sourceFingerprint': 'b' * 64,
                    'buildSourceFingerprint': 'd' * 64}, 'context': 'e' * 64}
        if configure:
            configure(runs, prepared)
        constructors = [runs[0], RuntimeError('partial construction')] if construction_failure else runs
        allocations = iter(constructors)
        allocated_count = 0
        def construct(*_args, enroll, **_kwargs):
            nonlocal allocated_count
            run = next(allocations)
            if isinstance(run, BaseException):
                raise run
            enroll(run)
            allocated_count += 1
            if allocated_count == partial_failure_at:
                run.prepared = False
                raise RuntimeError('enrolled partial constructor')
            return run
        previous_receipts = set(self.root.glob('ordinary-receipt-*.json'))
        with patch('ordinary_smoke.OrdinaryRun', side_effect=construct) as constructor, \
             patch('ordinary_smoke.Observer', return_value=SimpleNamespace(stop=Mock(return_value={}))) as observer, \
             patch('ordinary_smoke.verify_ordinary', return_value=verified), \
             patch('ordinary_smoke.source_snapshot', return_value=verified['current']), \
             patch('ordinary_smoke.source_identity', return_value='a' * 64), patch('ordinary_smoke.security') as security, \
             patch('summary_smoke.prepare_summary') as summary_prepare, patch('summary_smoke.scenario') as summary, \
             patch('summary_smoke.presentation_scenario') as presentations:
            try:
                execute_ordinary(args, self.root, prepared, self.bundle, 'a' * 64, verified, self.inventory,
                                 scenarios=scenarios, plan=plan)
                self.execution_error = None
            except BaseException as error:
                self.execution_error = error
                if not failure and not construction_failure and not expected_failure:
                    raise
            receipts = list(set(self.root.glob('ordinary-receipt-*.json')) - previous_receipts)
            receipt = json.loads(receipts[0].read_text()) if receipts else None
            return runs, receipt, constructor, observer, security, summary, presentations

    def test_default_full_keeps_both_simultaneous_runs_and_every_broad_group(self):
        runs, receipt, constructor, observer, security, _, _ = self.orchestration(self.selection_args())
        self.assertEqual(constructor.call_count, 2)
        self.assertEqual(security.call_count, 2)
        self.assertTrue(receipt['scenarioPassed'])
        for run in runs:
            run.scenario.assert_called_once(); run.captures.assert_called_once()
            run.verify_admission_denials.assert_called_once(); run.verify_parent_death.assert_called_once_with('sentinel')
            run.stop.assert_called_once()
        self.assertTrue(all(value == 'passed' for outcome in receipt['groupOutcomes'] for value in outcome['groups'].values()))

    def test_feature_composer_executes_real_orchestration_prerequisite_persistence_and_omits_broad_groups(self):
        args = self.selection_args(smoke_scope='feature', composer_footer=True, impact='local-feature', impact_basis='reviewed composer only')
        runs, receipt, constructor, _, security, _, _ = self.orchestration(args)
        self.assertEqual(constructor.call_count, 1); security.assert_not_called()
        run = runs[0]
        run.composer_scenario.assert_called_once()
        run.command.assert_any_call({'type': 'click', 'target': 'Profile & data'})
        self.assertEqual(run.start.call_count, 2)
        run.http.assert_any_call('/identity', extra={'Authorization': 'Bearer old-token'}, expected=403)
        for method in ('scenario', 'captures', 'verify_parent_death', 'verify_admission_denials'):
            getattr(run, method).assert_not_called()
        self.assertEqual(receipt['execution'][0]['starts'], 2)
        self.assertEqual(receipt['groupOutcomes'][0]['groups'], {'composer': 'passed'})
        self.assertIn('security', receipt['selection']['omitted'])

    def test_eligibility_keeps_two_distinct_catalogs_and_feature_failures_are_fresh(self):
        args = self.selection_args(smoke_scope='feature', composer_footer=True, model_eligibility=True, impact='local-feature', impact_basis='reviewed eligibility')
        runs, receipt, constructor, _, security, _, _ = self.orchestration(args)
        self.assertEqual(constructor.call_count, 2); security.assert_not_called()
        runs[0].prepare_composer.assert_called_once_with('mixed')
        runs[1].prepare_composer.assert_called_once_with('empty')
        self.assertEqual([outcome['groups'] for outcome in receipt['groupOutcomes']], [{'model-eligibility': 'passed'}] * 2)

    def test_feature_failure_does_not_borrow_hit_success_and_keeps_other_groups_not_run(self):
        args = self.selection_args(smoke_scope='feature', composer_footer=True, conversation_selection=True,
                                   impact='local-feature', impact_basis='reviewed both features')
        runs, receipt, *_ = self.orchestration(args, failure=AssertionError('fresh feature failed'))
        self.assertFalse(receipt['scenarioPassed'])
        self.assertEqual(receipt['groupOutcomes'][0]['groups'], {'composer': 'failed', 'conversation': 'not-run'})
        runs[0].conversation_scenario.assert_not_called(); runs[0].stop.assert_called_once()
        self.assertIn('AssertionError', receipt['scenarioFailure'])

    def test_summary_parts_dispatch_actual_lifecycle_and_only_named_presentations(self):
        args = self.selection_args(summary_engine=True, summary_part='presentation', summary_family=['densify'])
        _, receipt, _, _, _, lifecycle, presentations = self.orchestration(args)
        lifecycle.assert_not_called()
        self.assertEqual(presentations.call_count, 2)
        self.assertTrue(all(call.args[1] == ('densify',) for call in presentations.call_args_list))
        self.assertNotIn('summary-lifecycle', receipt['selection']['selected'])

    def test_feature_interruption_settles_without_replay_or_success_claim(self):
        args = self.selection_args(composer_footer=True, smoke_scope='feature', impact='local-feature', impact_basis='reviewed composer')
        runs, receipt, *_ = self.orchestration(args, failure=KeyboardInterrupt('owned interruption'))
        self.assertFalse(receipt['scenarioPassed'])
        self.assertIn('KeyboardInterrupt', receipt['scenarioFailure'])
        self.assertEqual(receipt['groupOutcomes'][0]['groups'], {'composer': 'failed'})
        runs[0].composer_scenario.assert_called_once(); runs[0].stop.assert_called_once()
        self.assertEqual(runs[0].start.call_count, 1)

    def test_failed_summary_stale_capability_assertion_keeps_the_group_failed(self):
        args = self.selection_args(summary_engine=True, summary_part='lifecycle', smoke_scope='feature',
                                   impact='summary-lifecycle', impact_basis='actual controls and stale capability')
        with patch('ordinary_smoke.deny_previous_boot', side_effect=ValueError('stale gate failed')):
            runs, receipt, *_ = self.orchestration(args, failure=ValueError('expected failure'))
        self.assertFalse(receipt['scenarioPassed'])
        self.assertEqual(receipt['groupOutcomes'][0]['groups'], {'summary-lifecycle': 'failed'})
        runs[0].stop.assert_called_once()

    def test_prepare_only_and_partial_construction_have_no_launch_or_smoke_claim(self):
        runs, receipt, _, observer, *_ = self.orchestration(self.selection_args(prepare_only=True))
        self.assertTrue(receipt['preparedOnly']); self.assertFalse(receipt['scenarioPassed'])
        observer.assert_not_called()
        for run in runs:
            run.start.assert_not_called(); run.stop.assert_called_once()
        self.assertTrue(all(value == 'not-run' for outcome in receipt['groupOutcomes'] for value in outcome['groups'].values()))

    def test_partial_construction_settles_created_run_and_preserves_failure(self):
        runs, receipt, _, observer, *_ = self.orchestration(self.selection_args(), construction_failure=True)
        observer.assert_not_called(); runs[0].start.assert_not_called(); runs[0].stop.assert_called_once()
        self.assertFalse(receipt['scenarioPassed']); self.assertEqual(len(receipt['runs']), 1)
        self.assertIn('RuntimeError', receipt['scenarioFailure'])

    def test_independent_composition_uses_guard_owner_and_observable_navigation(self):
        from ordinary_composition_example import navigation_scenario
        from ordinary_smoke import composition_plan
        scenario = navigation_scenario()
        args, plan = composition_plan((scenario,), 'local-feature', 'reviewed navigation', False)
        events = []
        def configure(runs, prepared):
            state = {'view': 'Trainer'}
            def command(value):
                events.append(value)
                if value['type'] == 'click':
                    state['view'] = 'Sync' if value['target'] == 'Sync' else 'Trainer'
            runs[0].command.side_effect = command
            runs[0].wait.side_effect = lambda predicate, label: self.assertTrue(predicate(state), label)
        runs, receipt, constructor, observer, security, *_ = self.orchestration(args, scenarios=(scenario,), plan=plan, configure=configure)
        self.assertTrue(receipt['scenarioPassed'])
        self.assertEqual(receipt['groupOutcomes'][0]['groups'], {'sync-return': 'passed'})
        constructor.assert_called_once(); security.assert_not_called()
        runs[0].stop.assert_called_once(); observer.return_value.stop.assert_called_once()
        self.assertEqual([e['target'] for e in events if e['type'] == 'click'], ['Sync', 'Back to chat'])
        self.assertEqual(receipt['selection']['compositions'][0]['expected'], list(scenario.expected))
        self.assertEqual(len(receipt['selection']['compositions'][0]['sources'][0]['sha256']), 64)
        self.assertIn('security', receipt['selection']['omitted'])

    def test_public_api_refuses_declarations_before_resources_or_preparation(self):
        from dataclasses import replace
        from ordinary_composition_example import navigation_scenario
        from ordinary_smoke import composition_plan, run_scenarios
        scenario = navigation_scenario()
        for invalid in (replace(scenario, expected=()), replace(scenario, configuration='unknown'),
                        replace(scenario, action=lambda run: None), replace(scenario, evidence=''),
                        replace(scenario, label='full'), replace(scenario, dependencies=('/missing-source',))):
            with self.subTest(invalid=invalid), patch('ordinary_smoke.resources.configure') as configure, patch('smoke_input.prepare') as prepare:
                with self.assertRaises((ValueError, FileNotFoundError)):
                    run_scenarios(scratch=self.root, bundle=self.bundle, scenarios=(invalid,),
                                  impact='local-feature', impact_basis='reviewed')
                configure.assert_not_called(); prepare.assert_not_called()
        from ordinary_smoke import densify_scenario
        for scenarios, impact, full in (((), 'local-feature', False), ((scenario, scenario), 'local-feature', False),
                                       ((scenario, densify_scenario()), 'local-feature', False),
                                       ((scenario,), 'shared', False), ((scenario,), 'unknown', False)):
            with self.assertRaises(ValueError):
                composition_plan(scenarios, impact, 'reviewed', full)

    def test_external_source_binding_rejects_stale_loaded_or_changed_code(self):
        import importlib.util
        from ordinary_smoke import Scenario, scenario_identity
        path = self.root / 'independently_authored.py'
        path.write_text('def action(run):\n    run.command({"type": "observe"})\n')
        spec = importlib.util.spec_from_file_location('independent', path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        scenario = Scenario('external', module.action, 'keyless', ('observed',), 'no visual claim')
        binding = scenario_identity(scenario)
        self.assertEqual(binding['sources'][0]['path'], str(path))
        path.write_text('def action(run):\n    raise AssertionError("changed")\n')
        with self.assertRaisesRegex(ValueError, 'current source'):
            scenario_identity(scenario)

    def test_finalization_failure_after_assertions_never_writes_success(self):
        def configure(runs, prepared):
            runs[0].stop.side_effect = RuntimeError('shutdown failed')
            runs[1].stop.side_effect = KeyboardInterrupt('shutdown cancellation')
        _, receipt, *_ = self.orchestration(self.selection_args(), configure=configure, expected_failure=True)
        self.assertTrue(receipt['assertionsPassed']); self.assertFalse(receipt['scenarioPassed'])
        self.assertEqual(len(receipt['shutdownErrors']), 2)
        self.assertIsInstance(self.execution_error, RuntimeError)

    def test_primary_unknown_effect_survives_shutdown_observer_and_input_failures(self):
        def configure(runs, prepared):
            runs[0].composer_scenario.side_effect = TimeoutError('effect unknown; never replay')
            runs[0].stop.side_effect = RuntimeError('secondary shutdown')
            prepared.verify_current.side_effect = lambda: (_ for _ in ()).throw(ValueError('changed input')) if runs[0].composer_scenario.call_count else None
        args = self.selection_args(composer_footer=True, smoke_scope='feature', impact='local-feature', impact_basis='reviewed')
        _, receipt, _, observer, *_ = self.orchestration(args, configure=configure, expected_failure=True)
        self.assertIsInstance(self.execution_error, TimeoutError)
        self.assertFalse(receipt['scenarioPassed'])
        self.assertEqual(len(receipt['shutdownErrors']), 2)
        observer.return_value.stop.assert_called_once()

    def test_observer_failure_is_aggregate_failure_after_passed_assertions(self):
        # Configure the shared observer through the run after attachment.
        def configure(runs, prepared):
            def start(_binary):
                runs[0].previous_token = 'old-token'
                runs[0].origin, runs[0].boot = 'http://127.0.0.1:11111', str(uuid.uuid4())
                runs[0].observer.stop.side_effect = RuntimeError('observer failed')
            runs[0].start.side_effect = start
        _, receipt, *_ = self.orchestration(self.selection_args(), configure=configure, expected_failure=True)
        self.assertTrue(receipt['assertionsPassed']); self.assertFalse(receipt['scenarioPassed'])
        self.assertTrue(any('observer' in value for value in receipt['shutdownErrors']))

    def test_receipt_write_failure_retains_primary_and_never_emits_pass(self):
        from native_smoke import private_json
        def writer(path, value):
            if path.name.startswith('ordinary-receipt-'):
                raise OSError('receipt unavailable')
            return private_json(path, value)
        args = self.selection_args(composer_footer=True, smoke_scope='feature', impact='local-feature', impact_basis='reviewed')
        with patch('ordinary_smoke.private_json', side_effect=writer):
            _, receipt, *_ = self.orchestration(args, failure=AssertionError('primary assertion'))
        self.assertIsNone(receipt)
        self.assertIsInstance(self.execution_error, AssertionError)

    def test_first_and_later_partial_real_constructor_are_enrolled_before_effects(self):
        enrolled = []
        with patch.object(OrdinaryRun, 'prepare_ordinary', side_effect=ValueError('partial setup')):
            with self.assertRaisesRegex(ValueError, 'partial setup'):
                OrdinaryRun(self.root, self.source, 'a' * 64, self.bundle, self.inventory,
                            verified={'current': {'source': 'a' * 64}}, enroll=enrolled.append)
        self.assertEqual(len(enrolled), 1)
        self.assertFalse(enrolled[0].prepared)
        with patch('native_smoke.os.killpg') as kill:
            enrolled[0].stop()
            kill.assert_not_called()

    def test_callable_factories_share_migrated_helpers_without_lifecycle_duplication(self):
        from ordinary_smoke import composer_scenario, densify_scenario, scenario_identity
        for factory in (composer_scenario, densify_scenario):
            scenario_identity(factory())
        args = self.selection_args(composer_footer=True, smoke_scope='feature', impact='local-feature', impact_basis='reviewed')
        from ordinary_smoke import composition_plan
        scenarios = (composer_scenario(),)
        args, plan = composition_plan(scenarios, 'local-feature', 'reviewed composer', False)
        runs, receipt, *_ = self.orchestration(args, scenarios=scenarios, plan=plan)
        self.assertEqual(runs[0].start.call_count, 2)
        runs[0].composer_scenario.assert_called_once()
        self.assertTrue(receipt['scenarioPassed'])

    def test_public_callable_owns_single_preparation_and_resource_context(self):
        from ordinary_composition_example import navigation_scenario
        from ordinary_smoke import run_scenarios
        with patch('ordinary_smoke.resources.configure', return_value=self.root) as configure, \
             patch('smoke_input.prepare', return_value=object()) as prepare, \
             patch('ordinary_smoke.ordinary_preparation', return_value=contextlib.nullcontext(('verified', 'inventory'))) as admission, \
             patch('ordinary_smoke.execute_ordinary', return_value={'scenarioPassed': True}) as execute:
            receipt = run_scenarios(scratch=self.root, bundle=self.bundle, scenarios=(navigation_scenario(),),
                                    impact='local-feature', impact_basis='reviewed')
        self.assertTrue(receipt['scenarioPassed'])
        configure.assert_called_once(); prepare.assert_called_once(); admission.assert_called_once(); execute.assert_called_once()
        self.assertEqual(prepare.call_args.args[1].task_id, Path(os.environ.get('PIVAN_TASK_PATH', 'local')).name.split('-')[0])

    def test_source_change_during_composition_refuses_remaining_work_and_aggregate(self):
        import importlib.util
        from dataclasses import replace
        from ordinary_smoke import Scenario, composition_plan
        path = self.root / 'external.py'
        path.write_text('def action(run):\n    run.command({"type": "observe"})\n')
        spec = importlib.util.spec_from_file_location('external', path)
        module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
        first = Scenario('first', module.action, 'keyless', ('observed',), 'no visual claim')
        scenarios = (first, replace(first, label='later'))
        args, plan = composition_plan(scenarios, 'local-feature', 'reviewed external navigation', False)
        def configure(runs, prepared):
            runs[0].command.side_effect = lambda command: path.write_text('def action(run):\n    raise AssertionError("new")\n')
        runs, receipt, *_ = self.orchestration(args, scenarios=scenarios, plan=plan, configure=configure, expected_failure=True)
        self.assertEqual(receipt['groupOutcomes'][0]['groups'], {'first': 'passed', 'later': 'not-run'})
        self.assertFalse(receipt['scenarioPassed']); runs[0].stop.assert_called_once()
        self.assertIsInstance(self.execution_error, ValueError)

    def test_api_assertion_timeout_and_cancellation_preserve_not_run_without_replay(self):
        from dataclasses import replace
        from ordinary_composition_example import navigation_scenario
        from ordinary_smoke import composition_plan
        first = navigation_scenario()
        scenarios = (first, replace(first, label='later'))
        args, plan = composition_plan(scenarios, 'local-feature', 'reviewed navigation', False)
        for failure in (AssertionError('oracle'), TimeoutError('effect unknown'), KeyboardInterrupt('cancelled')):
            with self.subTest(failure=type(failure).__name__):
                def configure(runs, prepared):
                    runs[0].wait.side_effect = failure
                runs, receipt, *_ = self.orchestration(args, scenarios=scenarios, plan=plan, configure=configure, expected_failure=True)
                self.assertIs(self.execution_error, failure)
                self.assertEqual(receipt['groupOutcomes'][0]['groups'], {'sync-return': 'failed', 'later': 'not-run'})
                runs[0].command.assert_called_once_with({'type': 'setViewport', 'preset': 'wide'})
                runs[0].stop.assert_called_once(); self.assertFalse(receipt['scenarioPassed'])

    def test_composition_deadline_and_term_use_owned_unwinding_and_restore_handlers(self):
        import signal
        from ordinary_smoke import composition_lifetime
        term, alarm = signal.getsignal(signal.SIGTERM), signal.getsignal(signal.SIGALRM)
        mask = os.umask(0o077); os.umask(mask)
        for trigger, exception in ((signal.SIGALRM, TimeoutError), (signal.SIGTERM, KeyboardInterrupt)):
            with self.assertRaises(exception):
                with composition_lifetime(2):
                    signal.raise_signal(trigger)
            self.assertEqual(signal.getitimer(signal.ITIMER_REAL), (0.0, 0.0))
            self.assertEqual(signal.getsignal(signal.SIGTERM), term)
            self.assertEqual(signal.getsignal(signal.SIGALRM), alarm)
            observed_mask = os.umask(mask)
            self.assertEqual(observed_mask, mask)
        for timeout in (0, -1, 1801, float('inf'), float('nan'), True):
            with self.assertRaises(ValueError), composition_lifetime(timeout):
                self.fail('invalid timeout admitted')

    def test_enrolled_first_and_later_partial_allocations_keep_all_groups_not_run(self):
        for position in (1, 2):
            with self.subTest(position=position):
                runs, receipt, _, observer, *_ = self.orchestration(self.selection_args(), expected_failure=True, partial_failure_at=position)
                self.assertIsInstance(self.execution_error, RuntimeError)
                self.assertEqual(len(receipt['groupOutcomes']), position)
                self.assertFalse(receipt['scenarioPassed'])
                observer.assert_not_called()
                for run in runs[:position]:
                    run.stop.assert_called_once(); run.start.assert_not_called()
                self.assertTrue(all(value == 'not-run' for outcome in receipt['groupOutcomes'] for value in outcome['groups'].values()))

    def test_full_plus_independent_composition_keeps_broad_simultaneous_contract(self):
        from ordinary_composition_example import navigation_scenario
        from ordinary_smoke import composition_plan
        scenarios = (navigation_scenario(),)
        args, plan = composition_plan(scenarios, 'shared', 'reviewed execution owner extraction', True)
        events = []
        def configure(runs, prepared):
            for run in runs:
                original_start = run.start.side_effect
                def start(binary, original_start=original_start):
                    events.append('start'); original_start(binary)
                run.start.side_effect = start
                run.scenario.side_effect = lambda: events.append('broad') or 'sentinel'
        _, receipt, constructor, *_ = self.orchestration(args, scenarios=scenarios, plan=plan, configure=configure)
        self.assertEqual(constructor.call_count, 2)
        self.assertEqual(events[:2], ['start', 'start'])
        self.assertTrue(receipt['scenarioPassed'])
        self.assertTrue(all(value == 'passed' for outcome in receipt['groupOutcomes'] for value in outcome['groups'].values()))


if __name__ == '__main__':
    unittest.main()
