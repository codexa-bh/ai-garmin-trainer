"""Finite paid-envelope/metadata-only projection contracts; no real keys, native launch or network."""
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from conversation_live import PaidEnvelope, api, observe_answer, PRESET
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
