import contextlib
import copy
import json
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

import capacity_memory_live as live


class CapacityLiveContracts(unittest.TestCase):
    def binding(self):
        return {'source': 'a' * 64, 'artifact': 'b' * 64}

    def seed(self):
        return {'task': 'T0274', 'variant': 'memory-capacity', 'completed': 1, 'providerCalls': 0,
                'manualItems': 18, 'renderedCharacters': 15000, 'configuredCharacters': 20000,
                'budgetPolicy': copy.deepcopy(live.POLICY)}

    def test_current_allowances_cadence_and_exact_measured_chat_fit_finite_budget(self):
        result = live.qualify(self.seed())
        self.assertEqual(result['maximumSummaryAttemptsPerBoot'], 67)
        self.assertLessEqual(result['summaryWorstUsdPerBoot'], 9)
        self.assertEqual(2 * live.COSTS['boundedBoot'] + 2 * live.COSTS['chat'], 22000)
        self.assertLessEqual(result['chatWorstUsd'], 2)
        self.assertEqual(2 * live.APPROVAL['bootMilliUsd'] + 3 * live.APPROVAL['chatMilliUsd'], 30000)
        for key, value in [('input', 8000), ('output', 2048), ('debounceMs', 1000), ('priceBasis', 'old')]:
            seed = self.seed(); seed['budgetPolicy'][key] = value
            with self.assertRaises(ValueError): live.qualify(seed)
        for key, value in [('task', 'T0272'), ('manualItems', 0), ('providerCalls', 1), ('renderedCharacters', 20001)]:
            seed = self.seed(); seed[key] = value
            with self.assertRaises(ValueError): live.qualify(seed)

    def test_durable_claim_precedes_effect_and_failures_cannot_reset_or_refund(self):
        with tempfile.TemporaryDirectory() as root:
            evidence = Path(root).resolve()
            ledger = live.Envelope(evidence, self.binding())
            ledger.claim('boot', 'authored-run')
            ledger.claim('chat', 'authored-run')
            first = (ledger.root / 'claim-001.json').read_bytes()
            with self.assertRaises(FileExistsError): live.Envelope(evidence, self.binding())
            receipt = {'purpose': live.PRESET, 'scenarioPassed': False, 'allOwnedProcessesSettled': True,
                       'inputUnchanged': True, 'syntheticOnly': True, 'credentialReadback': False,
                       'claims': ledger.claims, 'reservedMilliUsd': ledger.total}
            path = evidence / 'failure.json'; path.write_text(json.dumps(receipt)); path.chmod(0o600)
            resumed = live.Envelope(evidence, self.binding(), path)
            self.assertEqual(resumed.total, 14000)
            resumed.claim('boot', 'another-authored-run')
            self.assertEqual(resumed.total, 26000)
            self.assertEqual((ledger.root / 'claim-001.json').read_bytes(), first)
            self.assertEqual(os.stat(ledger.root / 'claim-001.json').st_mode & 0o777, 0o600)
            with self.assertRaises(ValueError): live.Envelope(evidence, self.binding(), path)
            while resumed.total + 12000 <= 50000: resumed.claim('boot', 'finite')
            before = len(resumed.claims)
            with self.assertRaises(ValueError): resumed.claim('boot', 'refused')
            self.assertEqual(len(resumed.claims), before)
            self.assertLessEqual(resumed.total, 50000)

    def test_old_grant_success_unsettled_duplicate_and_unknown_partial_claim_refuse(self):
        with tempfile.TemporaryDirectory() as root:
            evidence = Path(root).resolve(); ledger = live.Envelope(evidence, self.binding())
            base = {'purpose': live.PRESET, 'scenarioPassed': False, 'allOwnedProcessesSettled': True,
                    'inputUnchanged': True, 'syntheticOnly': True, 'credentialReadback': False,
                    'claims': [], 'reservedMilliUsd': 0}
            path = evidence / 'failure.json'
            for key, value in [('purpose', 't0272-integrated-memory-luna-200'), ('scenarioPassed', True),
                               ('allOwnedProcessesSettled', False), ('inputUnchanged', False), ('credentialReadback', True)]:
                invalid = {**base, key: value}; path.write_text(json.dumps(invalid)); path.chmod(0o600)
                with self.assertRaises(ValueError): live.Envelope(evidence, self.binding(), path)
            path.write_text('{"purpose":"x","purpose":"y"}')
            with self.assertRaises(ValueError): live.document(path)
            path.write_text(json.dumps(base))
            (ledger.root / 'claim-001.json').write_text('{partial')
            with self.assertRaises(ValueError): live.Envelope(evidence, self.binding(), path)

    def fake_run(self):
        return SimpleNamespace(id='authored-run', activity_deadline=float('inf'), adoptions=0,
                               capacity_conversations={'owned'}, descriptor={'providerSmoke': live.PRESET},
                               http=Mock(return_value={'providerSourceUnchanged': True}), accept_identity=lambda _: True,
                               origin='http://127.0.0.1:12345')

    def test_closed_routes_payloads_and_foreign_scope_never_open_socket(self):
        run = self.fake_run()
        for method, path, body in [('GET', '/api/profile', None), ('GET', '/api/cross-chat-summary?view=content', None),
                                  ('PATCH', '/api/model-settings', {'modelId': 'other'}),
                                  ('POST', '/api/conversations', {'id': 'foreign', 'title': 'arbitrary'}),
                                  ('POST', '/api/cross-chat-summary', {'action': 'clear'}),
                                  ('POST', '/api/chat', {'conversationId': 'owned', 'message': 'arbitrary', 'stream': False})]:
            with patch.object(live.http.client, 'HTTPConnection') as socket:
                with self.assertRaises(ValueError): live.api(run, method, path, body, Mock())
                socket.assert_not_called()
        run.http.return_value = {'providerSourceUnchanged': False}
        with patch.object(live.http.client, 'HTTPConnection') as socket:
            with self.assertRaises(ValueError): live.api(run, 'GET', '/api/cross-chat-summary')
            socket.assert_not_called()
        run.activity_deadline = 0
        with self.assertRaises(TimeoutError): live.api(run, 'GET', '/api/cross-chat-summary')

    def test_adoption_bound_and_actual_large_pin_validation(self):
        run = self.fake_run(); run.adoptions = 4
        with self.assertRaises(ValueError): live.api(run, 'POST', '/api/conversations',
            {'id': 'T0274-authored-run-capacity-1', 'title': 'Authored T0274 capacity 1'})
        for tokens, omitted in [(2048, 0), (1050001, 0), (6000, 1), (None, 0)]:
            with patch.object(live, 'pin', return_value={'tokens': tokens, 'omitted': omitted}):
                with self.assertRaises(ValueError): live.large_pin(run, 'owned')
        run.adoptions = 0
        body = {'conversationId': 'owned', 'message': live.QUESTION, 'stream': False}
        events = []
        envelope = Mock()
        envelope.claim.side_effect = lambda *_: events.append('reserved')
        response = SimpleNamespace(status=200, read=lambda _: b'{}')
        connection = SimpleNamespace(request=Mock(), getresponse=lambda: response, close=Mock())
        def socket(*_, **__): events.append('socket'); return connection
        with patch.object(live.http.client, 'HTTPConnection', side_effect=socket):
            self.assertEqual(live.api(run, 'POST', '/api/chat', body, envelope), (200, {}))
        self.assertEqual(events, ['reserved', 'socket'])

    def test_first_actual_turn_measures_adopted_pin_instead_of_requiring_fake_precount(self):
        run = self.fake_run()
        before = {'revision': 3, 'tokens': None, 'omitted': 0, 'seal': 'adopted'}
        after = {**before, 'tokens': 6000, 'seal': 'measured'}
        observation = {'context': {'summaryRevision': 3}, 'tools': [], 'providerCalls': [
            {'purpose': 'direct_answer', 'tokenUsage': {'inputTokens': 7000}}]}
        with patch.object(live, 'pin', side_effect=[before, after]), patch.object(live, 'api',
                return_value=(200, {'assistant': {'content': 'Authored acknowledgement.'}})), patch.object(live, 'answer_observation', return_value=observation):
            value, passed = live.answer(run, 'owned', live.SMALL_TURN, Mock())
        self.assertTrue(passed)
        self.assertEqual(value['pin'], after)

    def test_tool_question_still_requires_planner_final_synthesis_and_only_local_read(self):
        run = self.fake_run()
        adopted = {'revision': 3, 'tokens': None, 'omitted': 0, 'seal': 'adopted'}
        measured = {**adopted, 'tokens': 6000, 'seal': 'measured'}
        for purposes, tools, expected in [
            (['direct_answer'], [{'tool': 'getSyncStatus', 'status': 'succeeded'}], False),
            (['planner'], [{'tool': 'getSyncStatus', 'status': 'succeeded'}], False),
            (['planner', 'final_synthesis'], [], False),
            (['planner', 'final_synthesis'], [{'tool': 'runGarminSync', 'status': 'succeeded'}], False),
            (['planner', 'final_synthesis'], [{'tool': 'getSyncStatus', 'status': 'succeeded'}], True),
        ]:
            observation = {'context': {'summaryRevision': 3}, 'tools': tools, 'providerCalls': [
                {'purpose': purpose, 'tokenUsage': {'inputTokens': 7000}} for purpose in purposes]}
            with patch.object(live, 'pin', side_effect=[adopted, measured]), patch.object(live, 'api',
                    return_value=(200, {'assistant': {'content': 'Paper postcard, Thursday, cedar pause.'}})), patch.object(live, 'answer_observation', return_value=observation):
                _, passed = live.answer(run, 'owned', live.QUESTION, Mock(), facts=True)
            self.assertEqual(passed, expected)

    def test_retained_source_refuses_foreign_or_unknown_case_before_database_selection(self):
        with tempfile.TemporaryDirectory() as root:
            evidence = Path(root).resolve()
            base = {'purpose': live.PRESET, 'scenarioPassed': False, 'lastStage': 'single-small-ordinary-turn',
                    'syntheticOnly': True, 'credentialReadback': False, 'allOwnedProcessesSettled': True,
                    'inputUnchanged': True, 'runId': '11111111-1111-4111-8111-111111111111'}
            for key, value in [('purpose', 't0272-integrated-memory-luna-200'), ('lastStage', 'large-prior-maintenance'),
                               ('allOwnedProcessesSettled', False), ('inputUnchanged', False), ('syntheticOnly', False)]:
                with patch.object(live, 'document', side_effect=[(evidence / 'prefix.json', {**base, key: value}),
                     (evidence / 'disposition.json', {'invocationFailed': True, 'evidenceRoot': str(evidence)})]), patch.object(live.resources, 'runtime_path') as runtime:
                    with self.assertRaises(ValueError): live.RetainedCapacity(evidence, evidence / 'prefix.json', evidence / 'disposition.json')
                    runtime.assert_not_called()

    def test_retained_source_never_opens_or_stops_a_writer(self):
        with tempfile.TemporaryDirectory() as root:
            carrier = live.RetainedCapacity.__new__(live.RetainedCapacity)
            carrier.database = Path(root).resolve() / 'authored.sqlite'
            Path(str(carrier.database) + '.trainer-writer').write_text('unknown writer')
            with patch.object(live, 'database_state') as state:
                with self.assertRaises(ValueError): carrier.verify_current()
                state.assert_not_called()

    def test_whole_boot_alarm_and_owned_stop_survive_failure_without_stale_pid_actions(self):
        run = self.fake_run(); run.binary = Path('/authored/not-executed')
        run.start, run.stop, run.verify_settled = Mock(), Mock(), Mock()
        envelope, receipt = Mock(), {}
        observed = []
        @contextlib.contextmanager
        def deadline(seconds):
            observed.append(seconds); yield
        with patch.object(live, 'request_deadline', deadline), patch.object(live, 'api', return_value=(200, {})):
            with self.assertRaisesRegex(ValueError, 'authored failure'):
                live.boot(run, envelope, receipt, lambda: (_ for _ in ()).throw(ValueError('authored failure')))
        self.assertEqual(observed, [60])
        envelope.claim.assert_called_once_with('boundedBoot', run.id)
        run.stop.assert_called_once(); run.verify_settled.assert_called_once()


if __name__ == '__main__': unittest.main()
