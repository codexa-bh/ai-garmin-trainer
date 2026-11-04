import hashlib
import json
import sqlite3
import uuid
from pathlib import Path
import signal
import tempfile
import time
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, PropertyMock, patch

import integrated_memory_live as live

BINDING = {'source': 'a' * 64, 'artifact': 'b' * 64}


class IntegratedMemoryLiveTests(unittest.TestCase):
    def test_cumulative_boot_chat_and_title_reservations_never_refund_or_reopen(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder).resolve()
            envelope = live.Envelope(root, BINDING)
            with self.assertRaises(ValueError):
                envelope.claim('chat')
            for _ in range(4):
                envelope.claim('boot')
            for _ in range(12):
                envelope.claim('chat')
            self.assertEqual(envelope.total, 1772)
            self.assertEqual(sum(c['partsMilliUsd'].get('title', 0) for c in envelope.claims), 12)
            for kind in ['boot', 'chat', 'title', 'unbounded']:
                with self.assertRaises(ValueError):
                    envelope.claim(kind)
            with self.assertRaises(FileExistsError):
                live.Envelope(root, BINDING)
            self.assertTrue(all(c['source'] == BINDING['source'] and c['artifact'] == BINDING['artifact'] for c in envelope.claims))
            self.assertTrue(all('unknown' in c['outcome'] for c in envelope.claims))

    def test_modified_partial_missing_extra_and_concurrent_claims_refuse(self):
        for mutation in ['modify', 'partial', 'missing', 'extra', 'approval']:
            with self.subTest(mutation=mutation), tempfile.TemporaryDirectory() as folder:
                envelope = live.Envelope(Path(folder).resolve(), BINDING)
                envelope.claim('boot')
                claim = envelope.root / 'effect-0.json'
                if mutation == 'modify':
                    claim.write_text('{}')
                elif mutation == 'partial':
                    claim.write_text('{')
                elif mutation == 'missing':
                    claim.unlink()
                elif mutation == 'approval':
                    (envelope.root / 'approval.json').write_text('{}')
                else:
                    live.durable_claim(envelope.root / 'effect-1.json', {})
                with self.assertRaises((ValueError, FileNotFoundError)):
                    envelope.claim('chat')
                self.assertEqual(envelope.total, 200)

    def test_explicit_settled_reconciliation_keeps_all_claims_and_binds_reviewed_new_source(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder).resolve()
            envelope = live.Envelope(root, BINDING)
            envelope.claim('boot')
            original = (envelope.root / 'effect-0.json').read_bytes()
            approval = (envelope.root / 'approval.json').read_bytes()
            proof = {'purpose': live.PRESET, 'scenarioPassed': False, 'syntheticOnly': True,
                     'credentialReadback': False, 'credentialSourceUnchanged': True, 'inputUnchanged': True,
                     'allOwnedProcessesSettled': True, 'claims': envelope.claims, 'reservedMilliUsd': 200, **BINDING}
            path = root / 'integrated-memory-live-proof.json'
            live.durable_claim(path, proof)
            current = {'source': 'c' * 64, 'artifact': 'd' * 64}
            resumed = live.Envelope(root, current, path)
            self.assertEqual(resumed.total, 200)
            resumed.claim('boot')
            self.assertEqual(resumed.total, 400)
            self.assertEqual(resumed.claims[-1]['source'], current['source'])
            self.assertEqual((envelope.root / 'effect-0.json').read_bytes(), original)
            self.assertEqual((envelope.root / 'approval.json').read_bytes(), approval)
            with self.assertRaises(ValueError):
                live.Envelope(root, current, path)  # Stale snapshot cannot hide new claims.

    def test_unsettled_wrong_scope_missing_or_understated_receipt_never_reopens(self):
        for mutation in ['unsettled', 'source', 'scope', 'claims', 'budget', 'success']:
            with self.subTest(mutation=mutation), tempfile.TemporaryDirectory() as folder:
                root = Path(folder).resolve()
                envelope = live.Envelope(root, BINDING)
                envelope.claim('boot')
                proof = {'purpose': live.PRESET, 'scenarioPassed': False, 'syntheticOnly': True,
                         'credentialReadback': False, 'credentialSourceUnchanged': True, 'inputUnchanged': True,
                         'allOwnedProcessesSettled': True, 'claims': envelope.claims, 'reservedMilliUsd': 200, **BINDING}
                key, value = {'unsettled': ('allOwnedProcessesSettled', False), 'source': ('source', 'c' * 64),
                              'scope': ('purpose', 't0270-summary-luna-100'), 'claims': ('claims', []),
                              'budget': ('reservedMilliUsd', 0), 'success': ('scenarioPassed', True)}[mutation]
                proof[key] = value
                path = root / 'integrated-memory-live-proof.json'
                live.durable_claim(path, proof)
                with self.assertRaises(ValueError):
                    live.Envelope(root, BINDING, path)

    def test_success_continuation_is_explicit_ledger_only_and_stale_receipts_still_refuse(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder).resolve()
            old = live.Envelope(root, BINDING)
            old.claim('boot')
            proof = {'purpose': live.PRESET, 'scenarioPassed': False, 'syntheticOnly': True,
                     'credentialReadback': False, 'credentialSourceUnchanged': True, 'inputUnchanged': True,
                     'allOwnedProcessesSettled': True, 'claims': list(old.claims), 'reservedMilliUsd': old.total, **BINDING}
            failed = root / 'integrated-memory-live-failed.json'; live.durable_claim(failed, proof)
            amended = live.Envelope(root, BINDING, failed, approved_reallocation=True)
            amended.claim('boot')
            success = root / 'integrated-memory-live-success.json'
            live.durable_claim(success, {**proof, 'scenarioPassed': True, 'claims': amended.claims, 'reservedMilliUsd': amended.total})
            before = {p.name: p.read_bytes() for p in old.root.iterdir()}
            with self.assertRaises(ValueError):
                live.read_receipt(success)  # Lineage recovery still refuses success.
            with self.assertRaises(ValueError):
                live.Envelope(root, BINDING, success, approved_reallocation=True)
            continued = live.Envelope(root, BINDING, success, approved_reallocation=True, allow_settled_success=True)
            self.assertEqual(continued.total, 400)
            self.assertEqual(before, {p.name: p.read_bytes() for p in old.root.iterdir()})
            continued.claim('chat')
            self.assertEqual(continued.total, 481)
            with self.assertRaises(ValueError):
                live.Envelope(root, BINDING, success, approved_reallocation=True, allow_settled_success=True)
            for key in ['inputUnchanged', 'credentialSourceUnchanged', 'allOwnedProcessesSettled']:
                changed = root / ('integrated-memory-live-' + key + '.json')
                live.durable_claim(changed, {**proof, 'scenarioPassed': True, key: False})
                with self.assertRaises(ValueError):
                    live.read_receipt(changed, allow_success=True)

    def test_off_title_oracle_refuses_fallback_unknown_usage_and_summary_activity(self):
        observed = {'effectiveOff': True, 'summaryAttempts': 0, 'titleSettled': True,
                    'generatedNonExcerpt': True, 'attempts': 1, 'reservedUsd': .001,
                    'usage': {'input': 100, 'output': 12, 'cached': 0}}
        live.assert_off_title(observed)
        for key, value in [('effectiveOff', False), ('summaryAttempts', 1), ('titleSettled', False),
                           ('generatedNonExcerpt', False), ('attempts', 2), ('reservedUsd', 0),
                           ('usage', None), ('usage', {'input': None, 'output': 10})]:
            with self.subTest(key=key), self.assertRaises(ValueError):
                live.assert_off_title({**observed, key: value})

    def test_import_oracle_requires_real_selected_provenance_usage_and_unchanged_frontier(self):
        selected = ['a:1', 'b:1', 'c:1', 'd:1']
        observed = {'state': 'complete', 'position': 4, 'frontier': 5, 'selected': selected,
                    'publishedSources': selected, 'disposedSources': selected,
                    'attempts': [{'outcome': 'committed', 'sources': selected, 'usage': {'input': 900, 'output': 100}}]}
        live.assert_import(observed, selected, 5)
        for key, value in [('state', 'active'), ('position', 3), ('frontier', 6), ('selected', ['foreign:1']),
                           ('publishedSources', ['foreign:1']), ('publishedSources', []), ('disposedSources', []),
                           ('attempts', []), ('attempts', [{**observed['attempts'][0], 'usage': None}]),
                           ('attempts', [{**observed['attempts'][0], 'outcome': 'interrupted'}])]:
            with self.subTest(key=key), self.assertRaises(ValueError):
                live.assert_import({**observed, key: value}, selected, 5)

    def test_summary_control_failure_never_retries_mutation(self):
        with patch.object(live, 'api', side_effect=[(200, {'expected': {'revision': 1}}), (409, {})]) as request:
            with self.assertRaises(ValueError):
                live.summary_command(SimpleNamespace(), 'enable')
            self.assertEqual(request.call_count, 2)
            self.assertEqual(request.call_args.args[3]['expected'], {'revision': 1})

    def test_controls_flow_restarts_paused_and_completed_import_without_reseed(self):
        run = Mock(id='run', binary=Path('/unused'))
        run.http.return_value = {'providerSourceUnchanged': True}
        run.accept_identity.return_value = True
        envelope = Mock()
        selected = ['a:1', 'b:1', 'c:1', 'd:1']
        observed = {'state': 'complete', 'position': 4, 'frontier': 5, 'selected': selected,
                    'publishedSources': selected, 'disposedSources': selected,
                    'attempts': [{'outcome': 'committed', 'sources': selected, 'usage': {'input': 900, 'output': 100}}]}
        content_reads = []
        def api(_run, method, path, body=None, budget=None):
            if path == '/api/conversations':
                return 200, {'conversation': {'id': body['id']}}
            if path == '/api/chat':
                budget.claim('chat')
                return 200, {'assistant': {'content': 'Short walks can be approachable for a fictional beginner.',
                            'grounding': {'debugTrace': {'providerCalls': [{'purpose': 'direct_answer', 'tokenUsage': {}}]}}}}
            if '?view=content' in path:
                content_reads.append(path)
                return (200, {'historical': {'candidates': [{'id': s, 'conversationId': 'T0272-run-A'} for s in selected]
                                 + [{'id': 'excluded:1', 'conversationId': 'other'}]}}) if len(content_reads) == 1 else (
                       200, {'historical': {'manifests': [{'id': 'manifest'}]}})
            return 200, {'enabled': False}
        title = {'effectiveOff': True, 'summaryAttempts': 0, 'titleSettled': True,
                 'generatedNonExcerpt': True, 'attempts': 1, 'reservedUsd': .001, 'usage': {'input': 50, 'output': 10}}
        with patch.object(live, 'api', side_effect=api), patch.object(live, 'original_controls_messages', return_value='same'), \
                patch.object(live, 'observe_summary', return_value={'attempts': []}), patch.object(live, 'meaning_passed', return_value=True), \
                patch.object(live, 'title_observation', return_value=title), patch.object(live, 'summary_command') as command, \
                patch.object(live, 'pin', return_value={'revision': 3, 'tokens': 100}), patch.object(live, 'assert_answer') as consumed, \
                patch.object(live, 'wait_summary', return_value={'itemCount': 0, 'frontier': 5}), \
                patch.object(live, 'import_observation', side_effect=[{**observed, 'state': 'paused', 'position': 0, 'attempts': []}] * 2 + [observed] * 3):
            receipt = {}
            live.run_controls(run, envelope, receipt)
        self.assertEqual([c.args for c in envelope.claim.call_args_list], [('boot',), ('chat',), ('boot',), ('chat',), ('boot',)])
        consumed.assert_called_once()
        self.assertEqual([c.args[1] for c in command.call_args_list], ['enable', 'import-create', 'import-pause', 'import-resume'])
        self.assertEqual(command.call_args_list[1].kwargs, {'sourceIds': selected})
        self.assertTrue(receipt['controls']['originalMessagesUnchanged'])
        self.assertTrue(receipt['controls']['pausedImportSurvivesRestart'])
        self.assertTrue(receipt['controls']['completedImportAndPinSurviveRestart'])
        self.assertEqual(run.start.call_count, 3)
        self.assertEqual(run.stop.call_count, 3)
        self.assertEqual(run.verify_settled.call_count, 3)

    def test_restart_refuses_changed_source_and_reserves_before_start_after_settlement(self):
        run = Mock(binary=Path('/unused'))
        envelope = Mock()
        calls = Mock()
        calls.attach_mock(run, 'run')
        calls.attach_mock(envelope, 'envelope')
        run.http.return_value = {'providerSourceUnchanged': False}
        run.accept_identity.return_value = True
        with self.assertRaises(ValueError):
            live.restart_owned(run, envelope, {})
        envelope.claim.assert_not_called()
        run.start.assert_not_called()
        run.http.return_value = {'providerSourceUnchanged': True}
        calls.reset_mock()
        live.restart_owned(run, envelope, {})
        names = [c[0] for c in calls.mock_calls]
        self.assertLess(names.index('run.verify_settled'), names.index('envelope.claim'))
        self.assertLess(names.index('envelope.claim'), names.index('run.start'))
        envelope.claim.assert_called_once_with('boot')

    def test_budget_only_removes_count_gates_without_resetting_or_exceeding_five_dollars(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder).resolve()
            old = live.Envelope(root, BINDING)
            old.claim('boot')
            proof = {'purpose': live.PRESET, 'scenarioPassed': False, 'syntheticOnly': True,
                     'credentialReadback': False, 'credentialSourceUnchanged': True, 'inputUnchanged': True,
                     'allOwnedProcessesSettled': True, 'claims': list(old.claims), 'reservedMilliUsd': old.total, **BINDING}
            first = root / 'integrated-memory-live-original.json'; live.durable_claim(first, proof)
            amended = live.Envelope(root, BINDING, first, approved_reallocation=True)
            amended.claim('boot'); amended.claim('chat')
            prior = root / 'integrated-memory-live-before-budget.json'
            live.durable_claim(prior, {**proof, 'claims': list(amended.claims), 'reservedMilliUsd': amended.total})
            original = {p.name: p.read_bytes() for p in old.root.iterdir()}
            budget = live.Envelope(root, BINDING, prior, approved_reallocation=True, budget_only=True)
            self.assertEqual(budget.total, 481)
            for name, value in original.items():
                self.assertEqual((budget.root / name).read_bytes(), value)
            for _ in range(8):
                budget.claim('boot')  # Beyond both original and seven-boot caps.
            for _ in range(30):
                budget.claim('chat')  # Beyond seven, twelve AND proposed28.
            self.assertEqual(budget.total, 4511)
            self.assertTrue(budget.has_capacity(0, 6))
            self.assertFalse(budget.has_capacity(0, 7))
            for _ in range(6):
                budget.claim('chat')
            self.assertEqual(budget.total, 4997)
            for kind in ['boot', 'chat']:
                with self.assertRaises(ValueError):
                    budget.claim(kind)
            for counts in [(-1, 0), (0, .5), (True, 0)]:
                with self.assertRaises(ValueError):
                    budget.has_capacity(*counts)
            latest = root / 'integrated-memory-live-after-budget.json'
            live.durable_claim(latest, {**proof, 'claims': budget.claims, 'reservedMilliUsd': budget.total})
            restored = live.Envelope(root, BINDING, latest, approved_reallocation=True, budget_only=True)
            self.assertEqual(restored.total, 4997)
            with self.assertRaises(ValueError):
                live.Envelope(root, BINDING, prior, approved_reallocation=True, budget_only=True)  # Stale.
            with self.assertRaises(ValueError):
                live.Envelope(root, BINDING, latest, approved_reallocation=True)  # Explicit current authority required.
            amendment = budget.root / 'amendment-v2-budget-only.json'
            changed = json.loads(amendment.read_text()); changed['maximumMilliUsd'] = 6000
            amendment.write_text(json.dumps(changed))
            with self.assertRaises(ValueError):
                restored.claim('chat')

    def test_budget_only_refuses_missing_authority_and_over_budget_claim_before_effect(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder).resolve()
            with self.assertRaises(ValueError):
                live.Envelope(root, BINDING, budget_only=True)
            self.assertFalse((root / 't0272-integrated-memory-approved-usd200').exists())
            envelope = live.Envelope(root, BINDING)
            envelope.limits = live.BUDGET_ONLY  # Unit-test admission at exact arithmetic boundary only.
            for _ in range(25):
                envelope.claim('boot')
            self.assertEqual(envelope.total, 5000)
            before = sorted(p.name for p in envelope.root.iterdir())
            with self.assertRaises(ValueError):
                envelope.claim('boot')
            with self.assertRaises(ValueError):
                envelope.claim('chat')
            self.assertEqual(before, sorted(p.name for p in envelope.root.iterdir()))

    def test_usd100_is_additive_preserves_prior_claims_and_enforces_only_the_new_dollar_cap(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder).resolve()
            old = live.Envelope(root, BINDING)
            old.claim('boot')
            proof = {'purpose': live.PRESET, 'scenarioPassed': False, 'syntheticOnly': True,
                     'credentialReadback': False, 'credentialSourceUnchanged': True, 'inputUnchanged': True,
                     'allOwnedProcessesSettled': True, **BINDING}
            def receipt(name, envelope):
                path = root / ('integrated-memory-live-' + name + '.json')
                live.durable_claim(path, {**proof, 'claims': list(envelope.claims), 'reservedMilliUsd': envelope.total})
                return path
            first = receipt('original', old)
            five = live.Envelope(root, BINDING, first, approved_reallocation=True, budget_only=True)
            five.claim('boot')
            previous = receipt('five', five)
            original = {p.name: p.read_bytes() for p in old.root.iterdir()}
            with self.assertRaises(ValueError):
                live.Envelope(root, BINDING, previous, approved_usd100=True)
            raised = live.Envelope(root, BINDING, previous, approved_reallocation=True, budget_only=True, approved_usd100=True)
            self.assertEqual(raised.total, 400)
            self.assertEqual(raised.limits['maximumMilliUsd'], 100000)
            self.assertIsNone(raised.limits['maximumChats'])
            for name, value in original.items():
                self.assertEqual((raised.root / name).read_bytes(), value)
            for _ in range(24):
                raised.claim('boot')
            raised.claim('chat')
            self.assertEqual(raised.total, 5281)
            latest = receipt('latest', raised)
            restored = live.Envelope(root, BINDING, latest, approved_reallocation=True, budget_only=True, approved_usd100=True)
            self.assertEqual(restored.total, 5281)
            with self.assertRaises(ValueError):
                live.Envelope(root, BINDING, latest, approved_reallocation=True, budget_only=True)
            with self.assertRaises(ValueError):
                live.Envelope(root, BINDING, previous, approved_reallocation=True, budget_only=True, approved_usd100=True)
            inventory = {p.name: p.read_bytes() for p in raised.root.iterdir()}
            with patch.object(live.Envelope, 'total', new_callable=PropertyMock, return_value=99920):
                self.assertFalse(restored.has_capacity(0, 1))
                with self.assertRaises(ValueError):
                    restored.claim('chat')
            self.assertEqual(inventory, {p.name: p.read_bytes() for p in raised.root.iterdir()})
            amendment = raised.root / 'amendment-v3-usd100.json'
            changed = json.loads(amendment.read_text()); changed['maximumMilliUsd'] = 100001
            amendment.write_text(json.dumps(changed))
            with self.assertRaises(ValueError):
                restored.claim('chat')

    def test_timing_oracle_requires_expected_meaning_consumption_usage_and_no_tools(self):
        answer = live.answer_observation(200, {'assistant': {'content': 'Your current preference is mornings.',
            'grounding': {'debugTrace': {'providerCalls': [{'purpose': 'direct_answer', 'tokenUsage': {'inputTokens': 100}}]}}},
            'conversationContext': {'summaryRevision': 3}}, 1)
        live.assert_timing_answer(answer, 'morning', 3)
        for changed in [{**answer, 'httpStatus': 409}, {**answer, 'providerCalls': []},
                        {**answer, 'tools': [{'tool': 'save'}]}, {**answer, 'excerpt': 'Evenings suit you.'},
                        {**answer, 'context': {'summaryRevision': 2}}]:
            with self.assertRaises(ValueError):
                live.assert_timing_answer(changed, 'morning', 3)
        live.assert_timing_answer({**answer, 'excerpt': 'Your explicit Profile constraint is weekday lunchtime.'}, 'profile')
        revoked = live.answer_observation(200, {'assistant': {'content': 'Mornings suit you now.',
            'grounding': {'conversationContext': {'summaryRevoked': True}}}}, 1)
        self.assertTrue(revoked['diagnosticsRevoked'])
        with self.assertRaises(ValueError):
            live.assert_timing_answer(revoked, 'morning')
        live.assert_timing_answer(revoked, 'morning', allow_revoked_diagnostics=True)
        for marker in [False, None, 1, 'true']:
            with self.assertRaises(ValueError):
                live.assert_timing_answer({**revoked, 'diagnosticsRevoked': marker}, 'morning', allow_revoked_diagnostics=True)

    def test_correction_flow_has_four_paid_answers_and_profile_precedence_without_mutation_retries(self):
        run = Mock(id='run', binary=Path('/unused'))
        run.http.return_value = {'providerSourceUnchanged': True}
        run.accept_identity.return_value = True
        envelope = Mock()
        def answer(_run, budget, conversation, question):
            budget.claim('chat')
            return {'question': question, 'context': {}, 'providerCalls': []}
        def request(_run, method, path, body=None):
            if path == '/api/profile' and method == 'GET':
                return 200, {'constraints': ['Synthetic prior constraint']}
            return 200, {'ok': True}
        with patch.object(live, 'api', side_effect=request) as api, \
                patch.object(live, 'original_controls_messages', return_value='same'), \
                patch.object(live, 'wait_summary', side_effect=[{'revision': 2}, {'revision': 4}]), \
                patch.object(live, 'current_summary_text', side_effect=['Evenings suit the user.', 'Mornings now suit the user.']), \
                patch.object(live, 'new_authored_chat', side_effect=['a', 'b', 'c']), \
                patch.object(live, 'timing_answer', side_effect=answer), patch.object(live, 'assert_timing_answer'), \
                patch.object(live, 'pin', return_value={'tokens': 100}), patch.object(live, 'revoked_pin', return_value=True):
            receipt = {}
            live.run_correction(run, envelope, receipt)
        self.assertEqual([c.args for c in envelope.claim.call_args_list], [('boot',), ('chat',), ('chat',), ('chat',), ('chat',)])
        saves = [c for c in api.call_args_list if c.args[1:3] == ('POST', '/api/profile')]
        self.assertEqual(len(saves), 1)
        self.assertEqual(saves[0].args[3]['constraints'][0], 'Synthetic prior constraint')
        self.assertEqual(receipt['correction']['stage'], 'complete')
        self.assertTrue(receipt['correction']['oldPinRevokedAtCorrection'])
        self.assertTrue(receipt['correction']['currentPinRevokedAtProfile'])
        run.stop.assert_called_once(); run.verify_settled.assert_called_once()

    def test_revoked_pin_requires_durable_null_and_invalidation_not_corruption(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'synthetic.sqlite'
            db = sqlite3.connect(path)
            db.execute('create table conversation_summary_pin(conversation_id,payload,reason)')
            db.execute('insert into conversation_summary_pin values(?,?,?)', ('a', 'null', 'invalidated')); db.commit()
            run = SimpleNamespace(database=path)
            self.assertTrue(live.revoked_pin(run, 'a'))
            self.assertFalse(live.revoked_pin(run, 'absent'))
            for payload, reason in [('null', 'pin_corrupt'), ('{}', 'invalidated')]:
                db.execute('update conversation_summary_pin set payload=?,reason=?', (payload, reason)); db.commit()
                self.assertFalse(live.revoked_pin(run, 'a'))
            db.close()

    def test_compaction_requires_real_publication_pin_consumption_and_preserved_originals(self):
        text = ('Short weekday walks and weekend hiking were chosen for time. Long weekday sessions were rejected. '
                'The goal is three hours hiking. Hiking poles and a lighter bag are undecided. The early second option was short weekday walks.')
        answer = live.answer_observation(200, {'assistant': {'content': text,
            'grounding': {'debugTrace': {'providerCalls': [{'purpose': 'direct_answer', 'tokenUsage': {'inputTokens': 100}}]}}},
            'conversationContext': {'summaryRevision': 2}}, 1)
        before = {'coveredThrough': 0, 'revision': 1, 'attempts': 0, 'reservedUsd': 0, 'originalMessagesSha256': 'original'}
        after = {**before, 'coveredThrough': 20, 'revision': 2, 'attempts': 1, 'reservedUsd': .01,
                 'compactHash': 'a' * 64, 'characters': 500}
        projected = {'revision': 2, 'tokens': 100}
        live.assert_compaction(before, after, answer, projected)
        for key, value in [('coveredThrough', 0), ('revision', 1), ('attempts', 0), ('reservedUsd', 0),
                           ('compactHash', ''), ('characters', 0), ('characters', 6001), ('originalMessagesSha256', 'changed')]:
            with self.subTest(key=key), self.assertRaises(ValueError):
                live.assert_compaction(before, {**after, key: value}, answer, projected)
        with self.assertRaises(ValueError):
            live.assert_compaction(before, after, answer, {'revision': 1, 'tokens': 100})

    def test_second_option_oracle_rejects_actual_false_green_and_negated_or_unrelated_mapping(self):
        for text in ['The early second option was short weekday walks and weekend hiking.',
                     'Option two: short weekday sessions plus a longer weekend hike.',
                     'The early “second option” refers to the short-weekday-walks/weekend-hike approach that you chose, not a different plan.',
                     'Short weekday walks and weekend hikes were the second option.']:
            self.assertTrue(live.second_option_preserved({'excerpt': text}))
        for text in ['The remembered early second option was the long-weekday-session approach, which you later rejected.',
                     'Short weekday walks are chosen. The second option was long weekday sessions.',
                     'The second option was not short weekday walks.',
                     'The “second option” refers to long-weekday-sessions, not short-weekday-walks.',
                     'Short weekday walks were not the second option.']:
            self.assertFalse(live.second_option_preserved({'excerpt': text}))

    def test_reviewed_hyphenated_authored_phrase_normalizes_without_relaxing_sensitive_screen(self):
        text = 'Your early second option was the short-weekday-walks-and-weekend-hiking approach you chose.'
        observed = live.answer_observation(200, {'assistant': {'content': text}}, 1)
        self.assertEqual(observed['characters'], len(text))
        self.assertTrue(live.second_option_preserved(observed))
        for unsafe in ['x' * 40, 'sk-' + 'x' * 40, 'https://example.invalid/' + text, 'private@example.invalid ' + text]:
            self.assertEqual(live.answer_observation(200, {'assistant': {'content': unsafe}}, 1)['excerpt'],
                             '[noncanonical synthetic excerpt withheld]')

    def test_finite_seed_selection_refuses_unknown_scenario_before_files_or_subprocess(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(live.subprocess, 'run') as process:
            root = Path(folder)
            with self.assertRaises(ValueError):
                live.configure(SimpleNamespace(root=root), scenario='arbitrary')
            self.assertEqual(list(root.iterdir()), [])
            process.assert_not_called()

    def test_equipment_nonchoice_accepts_actual_contracted_negation_not_endorsement(self):
        for sentence in ["Hiking poles and a lighter bag are options; you haven't chosen between them.",
                         'Hiking poles and a lighter bag are options; you haven’t chosen between them.',
                         'Hiking poles or a lighter bag remain undecided.']:
            observed = live.answer_observation(200, {'assistant': {'content': sentence}}, 1)
            self.assertTrue(observed['meaning']['unchosenEquipment'])
        for sentence in ['You have chosen hiking poles and a lighter bag.',
                         'Hiking poles and a lighter bag are your preference.',
                         'You have not chosen a bicycle.']:
            observed = live.answer_observation(200, {'assistant': {'content': sentence}}, 1)
            self.assertFalse(observed['meaning']['unchosenEquipment'])

    def test_pending_invalidation_waits_without_retrying_mutations_but_failures_stop(self):
        run = SimpleNamespace(activity_deadline=time.monotonic() + 30)
        with patch.object(live, 'api', side_effect=[(200, {'reason': 'summary_invalidated'}), (200, {'reason': None})]) as api, \
                patch.object(live, 'observe_summary', side_effect=[{'frontier': 0}, {'frontier': 20}]), \
                patch.object(live.time, 'sleep'):
            self.assertEqual(live.wait_summary(run, 20)['frontier'], 20)
            self.assertTrue(all(call.args[1:] == ('GET', '/api/cross-chat-summary') for call in api.call_args_list))
        with patch.object(live, 'api', return_value=(200, {'reason': 'summary_interrupted'})), \
                patch.object(live, 'observe_summary', return_value={'frontier': 0}):
            with self.assertRaises(ValueError):
                live.wait_summary(run, 20)

    def test_additive_approved_seven_seven_keeps_original_bytes_and_caps_contingency(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder).resolve()
            old = live.Envelope(root, BINDING)
            old.claim('boot')
            original = {p.name: p.read_bytes() for p in old.root.iterdir()}
            proof = {'purpose': live.PRESET, 'scenarioPassed': False, 'syntheticOnly': True,
                     'credentialReadback': False, 'credentialSourceUnchanged': True, 'inputUnchanged': True,
                     'allOwnedProcessesSettled': True, 'claims': list(old.claims), 'reservedMilliUsd': old.total, **BINDING}
            path = root / 'integrated-memory-live-original.json'
            live.durable_claim(path, proof)
            amended = live.Envelope(root, BINDING, path, approved_reallocation=True)
            self.assertEqual(amended.limits['maximumMilliUsd'], 5000)
            for name, content in original.items():
                self.assertEqual((old.root / name).read_bytes(), content)
            for _ in range(6):
                amended.claim('boot')
            for _ in range(7):
                amended.claim('chat')
            self.assertEqual(amended.total, 1967)
            for kind in ['boot', 'chat']:
                with self.assertRaises(ValueError):
                    amended.claim(kind)
            continued = root / 'integrated-memory-live-continued.json'
            live.durable_claim(continued, {**proof, 'claims': amended.claims, 'reservedMilliUsd': amended.total})
            loaded = live.Envelope(root, BINDING, continued, approved_reallocation=True)
            self.assertEqual(loaded.total, 1967)
            with self.assertRaises(ValueError):
                live.Envelope(root, BINDING, continued)  # File/unused dollars are not authority.
            value = json.loads((old.root / 'amendment-v1.json').read_text())
            value['priorClaimSha256'][0] = '0' * 64
            (old.root / 'amendment-v1.json').write_text(json.dumps(value))
            with self.assertRaises(ValueError):
                live.Envelope(root, BINDING, continued, approved_reallocation=True)

    def test_large_bounded_receipt_does_not_expand_settings_input_limit_or_allow_duplicates(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder).resolve()
            path = root / 'integrated-memory-live-large.json'
            value = {'purpose': live.PRESET, 'scenarioPassed': False, 'syntheticOnly': True,
                     'credentialReadback': False, 'credentialSourceUnchanged': True, 'inputUnchanged': True,
                     'allOwnedProcessesSettled': True, 'padding': 'x' * 9000}
            live.durable_claim(path, value)
            self.assertEqual(live.read_receipt(path)[1], value)
            with self.assertRaises(ValueError):
                live.json_document(path)
            path.write_text('{"purpose":"first","purpose":"second"}')
            with self.assertRaises(ValueError):
                live.read_receipt(path)
            path.write_text('x' * 65537)
            with self.assertRaises(ValueError):
                live.read_receipt(path)

    def test_four_round_recovery_verifies_actual_sqlite_pin_frontier_metadata_and_borrowed_original(self):
        with tempfile.TemporaryDirectory() as folder:
            base = Path(folder).resolve()
            evidence = base / 'evidence'; evidence.mkdir(mode=0o700)
            run_id = str(uuid.uuid4())
            root = base / ('ordinary-' + run_id); root.mkdir(mode=0o700)
            mirrored = evidence / root.name; mirrored.mkdir(mode=0o700)
            (root / 'owner').write_text(run_id); (root / 'owner').chmod(0o600)
            documents = {'artifact.json': {'sourceFingerprint': BINDING['source']},
                         'provenance.json': {'source': BINDING['source']},
                         'shutdown-1.json': {'nativeReaped': True, 'endpointsAndLeaseSettled': True},
                         'integrated-seed.json': {'task': 'T0272', 'completed': 184}}
            for name, value in documents.items():
                live.durable_claim(root / name, value); live.durable_claim(mirrored / name, value)
            database = root / 'trainer.sqlite'
            db = sqlite3.connect(database)
            db.executescript('''create table summary_state(id,revision,frontier,payload,checksum);
                create table summary_attempt(outcome,source_ids_json,upper_event,usage_json,started_at,job_id);
                create table message(id); create table conversation_completion(id);
                create table conversation_summary_pin(conversation_id,payload,seal);''')
            items = [{'text': 'Short weekdays for time; three hours hiking.', 'category': 'goal', 'stance': 'user-stated'},
                     {'text': 'Long weekdays rejected.', 'category': 'rejected', 'stance': 'user-stated'},
                     {'text': 'Hiking poles or bag undecided.', 'category': 'question', 'stance': 'user-stated'}]
            payload = json.dumps({'items': items, 'text': ' '.join(i['text'] for i in items)})
            db.execute('insert into summary_state values(1,5,80,?,?)', (payload, 'summary-seal'))
            for n in range(1, 5):
                db.execute('insert into summary_attempt values(?,?,?,?,?,?)', ('committed', json.dumps(list(range(20))), n * 20, None, n, str(n)))
            db.executemany('insert into conversation_completion values(?)', [(n,) for n in range(185)])
            pin_payload = json.dumps({'stamp': {'revision': 2}, 'tokens': 117, 'omitted': 0})
            seal = hashlib.sha256(pin_payload.encode()).hexdigest()
            db.execute('insert into conversation_summary_pin values(?,?,?)', ('authored', pin_payload, seal))
            db.commit(); db.close(); database.chmod(0o600)
            run = SimpleNamespace(database=database)
            observed = live.observe_summary(run)
            rounds = [{'observedRound': n, **({'pin': live.pin(run, 'authored')} if n == 1 else {})} for n in range(1, 5)]
            proof = {'purpose': live.PRESET, 'scenarioPassed': False, 'syntheticOnly': True,
                     'credentialReadback': False, 'credentialSourceUnchanged': True, 'inputUnchanged': True,
                     'allOwnedProcessesSettled': True, 'runId': run_id, 'lastStage': 'summary-round-5',
                     'rounds': rounds, 'lastSummary': observed, **BINDING}
            receipt = evidence / 'integrated-memory-live-proof.json'; live.durable_claim(receipt, proof)
            disposition = evidence / 'resource-disposition-proof.json'
            live.durable_claim(disposition, {'invocationFailed': True, 'recoveryHold': True, 'evidenceRoot': str(evidence),
                                            'allocationRoots': [str(root)], 'artifacts': [{'path': str(database), 'status': 'retained'}]})
            with patch.object(live.resources, 'runtime_path', return_value=root), patch.object(live.resources, 'guard'):
                prepared = live.RetainedLineage(evidence, disposition, receipt)
                self.assertEqual(prepared.snapshots, {'authored': live.pin(run, 'authored')})
                self.assertFalse(prepared.proof['reseeded'])
                prepared.verify_current()
                lease = Path(str(database) + '.trainer-writer'); lease.write_text('foreign')
                with self.assertRaises(ValueError):
                    live.RetainedLineage(evidence, disposition, receipt)
                lease.unlink()
                db = sqlite3.connect(database); db.execute('update summary_state set frontier=81'); db.commit(); db.close()
                with self.assertRaises(ValueError):
                    prepared.verify_current()
                with self.assertRaises(ValueError):
                    live.RetainedLineage(evidence, disposition, receipt)

    def test_continuation_configuration_never_reseeds_or_reads_a_key(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder).resolve(); (root / 'config').mkdir()
            with patch.object(live.subprocess, 'run') as seed:
                live.configure(SimpleNamespace(root=root, database=root / 'trainer.sqlite'), seed=False)
                seed.assert_not_called()
            self.assertEqual(json.loads((root / 'config/settings-v3.json').read_text())['keys'], {})

    def test_symlink_or_replaced_approval_directory_refuses(self):
        for alias in [True, False]:
            with tempfile.TemporaryDirectory() as folder:
                root = Path(folder).resolve()
                envelope = live.Envelope(root, BINDING)
                old = root / 'retained-original'
                envelope.root.rename(old)
                if alias:
                    envelope.root.symlink_to(old, target_is_directory=True)
                else:
                    envelope.root.mkdir(mode=0o700)
                with self.assertRaises(ValueError):
                    envelope.claim('boot')

    def test_durable_claim_syncs_file_and_directory_and_is_exclusive(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(live.os, 'fsync', wraps=live.os.fsync) as sync:
            path = Path(folder) / 'claim.json'
            live.durable_claim(path, {'unknown': True})
            self.assertEqual(sync.call_count, 2)
            before = path.read_bytes()
            with self.assertRaises(FileExistsError):
                live.durable_claim(path, {})
            self.assertEqual(path.read_bytes(), before)
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)

    def test_exact_source_binding_and_pricing_bounds(self):
        with tempfile.TemporaryDirectory() as folder:
            for binding in [{}, {**BINDING, 'source': 'unknown'}, {**BINDING, 'extra': 'c' * 64}]:
                with self.assertRaises(ValueError):
                    live.Envelope(Path(folder), binding)
        # Current standard prices, conservatively treating every input as a 12h write.
        self.assertLess(6 * (27033 * .25 + 4096 * .50) / 1_000_000 + .01, .08)
        self.assertLess((8000 * .25 + 2048 * .50) / 1_000_000, .01)
        self.assertLess((2048 * .25 + 120 * .50) / 1_000_000, .001)
        self.assertLessEqual(1 + 400 // 30, 16)
        self.assertLess(16 * .01, .20)
        self.assertEqual(live.ANSWER_ROUNDS, (1, 5, 10))
        self.assertEqual(live.SEED_COMPLETIONS + 2, 9 * 20 + 6)
        self.assertLess(len(live.QUESTION), 12000)

    def test_keyless_exact_t0272_settings_preserve_inactive_unavailable_embedding_route(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder).resolve()
            (root / 'config').mkdir()
            run = SimpleNamespace(root=root, database=root / 'trainer.sqlite', id='run')
            seed = {'task': 'T0272', 'runId': 'run', 'completed': 184, 'providerCalls': 0, 'variant': 'integrated-summary'}
            with patch.object(live.subprocess, 'run', return_value=SimpleNamespace(stdout=json.dumps(seed).encode())) as invoke:
                live.configure(run)
            saved = json.loads((root / 'config/settings-v3.json').read_text())
            self.assertEqual(saved['keys'], {})
            self.assertEqual(len(saved['fields']), 13)
            self.assertEqual(saved['fields']['MEMORY_ENABLED'], 'true')
            self.assertEqual(saved['fields']['MEMORY_EMBEDDING_BASE_URL'], 'http://127.0.0.1:1')
            self.assertEqual(saved['fields']['SUMMARY_CONTRACT_VERSION'], '2')
            self.assertEqual(saved['chatCatalog']['entries'][0]['id'], live.CATALOG_ID)
            self.assertEqual(list((root / 'tokens').iterdir()), [])
            self.assertEqual(invoke.call_args.args[0][-1], 'integrated')

    def run_scope(self):
        return SimpleNamespace(origin='http://127.0.0.1:1234', descriptor={'providerSmoke': live.PRESET},
                               activity_deadline=time.monotonic() + 100,
                               http=Mock(return_value={'providerSourceUnchanged': True}), accept_identity=lambda _: True)

    def test_request_reserves_chat_and_title_before_socket_without_retry(self):
        run = self.run_scope()
        events = []
        envelope = Mock()
        envelope.claim.side_effect = lambda kind: events.append(kind)
        connection = Mock()
        connection.getresponse.side_effect = TimeoutError('unknown')
        with patch.object(live.http.client, 'HTTPConnection', side_effect=lambda *a, **k: events.append('socket') or connection):
            with self.assertRaises(TimeoutError):
                live.api(run, 'POST', '/api/chat', {'message': 'authored'}, envelope)
        self.assertEqual(events, ['chat', 'socket'])
        self.assertEqual(connection.request.call_count, 1)
        self.assertEqual(connection.request.call_args.args[3]['x-trainer-turn-budget'], 'finite-live-smoke')
        connection.close.assert_called_once()
        self.assertEqual(signal.getitimer(signal.ITIMER_REAL), (0.0, 0.0))

    def test_old_grants_bad_identity_deadline_unknown_routes_and_unreserved_chat_deny_before_socket(self):
        for mutation in ['old', 'source', 'identity', 'expired', 'during-identity', 'route', 'unreserved']:
            run = self.run_scope()
            method, path = 'GET', '/api/cross-chat-summary'
            if mutation == 'old':
                run.descriptor['providerSmoke'] = 't0270-summary-luna-100'
            elif mutation == 'source':
                run.http.return_value = {'providerSourceUnchanged': False}
            elif mutation == 'identity':
                run.accept_identity = lambda _: False
            elif mutation == 'expired':
                run.activity_deadline = time.monotonic() - 1
            elif mutation == 'during-identity':
                def expire(_):
                    run.activity_deadline = time.monotonic() - 1
                    return {'providerSourceUnchanged': True}
                run.http.side_effect = expire
            elif mutation == 'route':
                path = '/api/export'
            else:
                method, path = 'POST', '/api/chat'
            with self.subTest(mutation=mutation), patch.object(live.http.client, 'HTTPConnection') as socket:
                with self.assertRaises((ValueError, TimeoutError)):
                    live.api(run, method, path)
                socket.assert_not_called()

    def test_wall_clock_deadline_interrupts_and_restores_handler(self):
        previous = signal.getsignal(signal.SIGALRM)
        with self.assertRaises(TimeoutError):
            with live.request_deadline(.01):
                time.sleep(.1)
        self.assertEqual(signal.getsignal(signal.SIGALRM), previous)
        self.assertEqual(signal.getitimer(signal.ITIMER_REAL), (0.0, 0.0))

    def test_real_answer_oracle_requires_meanings_actual_pin_and_usage(self):
        text = ('Chosen: short weekday walks and a longer weekend hike because time is limited by bicycle collection at 18:00. '
                'Rejected: long weekday sessions. Goal: three hours hiking. Hiking poles and a lighter bag remain undecided.')
        body = {'assistant': {'content': text, 'grounding': {'debugTrace': {'providerCalls': [{'purpose': 'planner', 'tokenUsage': {'input': 10}}]}}},
                'conversationContext': {'summaryRevision': 7}}
        answer = live.answer_observation(200, body, 1)
        projected = {'revision': 7, 'tokens': 100}
        live.assert_answer(answer, projected)
        for key in answer['meaning']:
            with self.assertRaises(ValueError):
                live.assert_answer({**answer, 'meaning': {**answer['meaning'], key: False}}, projected)
        for invalid in [{'revision': 6, 'tokens': 100}, {'revision': 7, 'tokens': None}, {'revision': 7, 'tokens': 2049}]:
            with self.assertRaises(ValueError):
                live.assert_answer(answer, invalid)
        with self.assertRaises(ValueError):
            live.assert_answer({**answer, 'providerCalls': []}, projected)
        unsafe = live.answer_observation(200, {'assistant': {'content': 'https://example.invalid'}}, 1)
        self.assertEqual(unsafe['excerpt'], '[noncanonical synthetic excerpt withheld]')
