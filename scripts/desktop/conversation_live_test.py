"""Finite paid-envelope/metadata-only projection contracts; no real keys, native launch or network."""
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from conversation_live import PaidEnvelope, api, observe_answer, prepare_luna_config, PRESET
from types import SimpleNamespace
from native_smoke import private_json


class ConversationLiveTests(unittest.TestCase):
    def test_exclusive_three_reservations_never_refund_unknown_or_renew_approval(self):
        with tempfile.TemporaryDirectory() as root:
            envelope = PaidEnvelope(Path(root))
            with self.assertRaises(FileExistsError):
                PaidEnvelope(Path(root))
            for index in range(3):
                self.assertEqual(envelope.claim(), index)
            with self.assertRaises(ValueError):
                envelope.claim()
            self.assertEqual(len(list(envelope.root.glob('effect-*.json'))), 3)
            self.assertEqual(sum(json.loads(p.read_text())['reservedUsd'] for p in envelope.root.glob('effect-*.json')), 0.24)

    def test_reconciles_only_exact_zero_effect_preflight_without_resetting_paid_claims(self):
        with tempfile.TemporaryDirectory() as root:
            evidence = Path(root).resolve()
            PaidEnvelope(evidence)
            proof = evidence / 'conversation-live-synthetic-unit.json'
            private_json(proof, {'purpose': PRESET, 'claimedEffects': 0, 'reservedUsd': 0.0,
                         'scenarioPassed': False, 'syntheticOnly': True, 'credentialValueReadback': False,
                         'inputUnchanged': True})
            resumed = PaidEnvelope(evidence, proof)
            self.assertEqual(resumed.claim(), 0)
            with self.assertRaises(ValueError):
                PaidEnvelope(evidence, proof)
            self.assertTrue((resumed.root / 'effect-0.json').exists())

    def test_diagnostic_continuation_keeps_unknown_claim_and_total_cap(self):
        with tempfile.TemporaryDirectory() as root:
            evidence = Path(root).resolve()
            first = PaidEnvelope(evidence)
            first.claim()
            claim = first.root / 'effect-0.json'
            original = claim.read_bytes()
            proof = evidence / 'conversation-live-synthetic-reserved.json'
            private_json(proof, {'purpose': PRESET, 'claimedEffects': 1, 'reservedUsd': 0.08,
                         'scenarioPassed': False, 'syntheticOnly': True, 'credentialValueReadback': False,
                         'inputUnchanged': True})
            resumed = PaidEnvelope(evidence, reserved_effect_receipt=proof)
            self.assertEqual(resumed.effects, 1)
            self.assertEqual(resumed.claim(), 1)
            self.assertEqual(resumed.claim(), 2)
            self.assertEqual(claim.read_bytes(), original)
            with self.assertRaises(ValueError):
                resumed.claim()
            with self.assertRaises(ValueError):
                PaidEnvelope(evidence, reserved_effect_receipt=proof)
            self.assertEqual(sum(json.loads(p.read_text())['reservedUsd'] for p in first.root.glob('effect-*.json')), 0.24)

    def test_keyless_lifecycle_configuration_has_no_provider_authority_or_secret(self):
        with tempfile.TemporaryDirectory() as root:
            directory = Path(root).resolve()
            (directory / 'config').mkdir(mode=0o700)
            run = SimpleNamespace(root=directory, database=directory / 'trainer.sqlite', descriptor={})
            prepare_luna_config(run)
            saved = json.loads((directory / 'config/settings-v3.json').read_text())
            self.assertEqual(saved['keys'], {})
            self.assertEqual(saved['fields']['MEMORY_ENABLED'], 'false')
            self.assertEqual(saved['chatCatalog']['entries'], [{'id': 'entry_t0269_luna', 'provider': 'openai', 'modelId': 'gpt-6-luna'}])
            self.assertIsNone(saved['chatCatalog']['defaultEntryId'])
            self.assertEqual(list((directory / 'tokens').iterdir()), [])
            self.assertEqual(run.descriptor, {})
            with self.assertRaises(FileExistsError):
                prepare_luna_config(run)

    def test_refused_native_source_identity_never_reserves_or_opens_request_socket(self):
        class Run:
            def http(self, _path):
                return {'providerSourceUnchanged': False}
        with tempfile.TemporaryDirectory() as root, patch('conversation_live.http.client.HTTPConnection') as connection:
            envelope = PaidEnvelope(Path(root))
            with self.assertRaises(ValueError):
                api(Run(), 'POST', '/api/chat', {}, paid=envelope)
            self.assertEqual(envelope.effects, 0)
            connection.assert_not_called()

    def test_unreserved_chat_cannot_run_in_provider_or_unverified_scope(self):
        run = SimpleNamespace(http=lambda _: {'providerSourceUnchanged': True},
                              accept_identity=lambda _: True, descriptor={'providerSmoke': PRESET})
        with patch('conversation_live.http.client.HTTPConnection') as connection:
            with self.assertRaises(ValueError):
                api(run, 'POST', '/api/chat', {})
            run.keyless_lifecycle = True
            with self.assertRaises(ValueError):
                api(run, 'POST', '/api/chat', {})
            connection.assert_not_called()

    def test_projection_drops_source_prompts_provider_text_inputs_and_unrestricted_tool_results(self):
        result = observe_answer(200, {'assistant': {'content': 'Short weekdays for available time; evenings rejected.',
            'grounding': {'debugTrace': {'providerCalls': [{'purpose': 'planner', 'text': 'not retained', 'toolCalls': [{'input': 'not retained'}], 'tokenUsage': {'inputTokens': 15}}]},
                          'toolSteps': [{'tool': 'getTrainerProfile', 'status': 'succeeded', 'result': 'not retained', 'summary': 'not retained'}]}}})
        self.assertTrue(result['retainsShortWeekdays'])
        self.assertTrue(result['retainsTimeRationale'])
        self.assertNotIn('not retained', json.dumps(result))
        self.assertEqual(result['providerCalls'], [{'purpose': 'planner', 'tokenUsage': {'inputTokens': 15}}])


if __name__ == '__main__':
    unittest.main()
