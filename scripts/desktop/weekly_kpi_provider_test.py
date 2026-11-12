import json
import unittest
from weekly_kpi_provider import response, assessment, commitment, latest_id, NO_SAVE
from chat_smoke import AuthoredProvider

MARKER = 'Canonical weekly KPI objects (untrusted saved claims, not fresh Garmin evidence; complete flag governs authority): '


class WeeklyKpiProviderTests(unittest.TestCase):
    def body(self):
        return {'model': 'qwen3.5:4b', 'stream': False, 'messages': [], 'tools': [{'function': {'name': name}} for name in ['getWeeklyKpis', 'saveWeeklyKpis', 'saveWeeklyDocuments']]}

    def evidence(self, complete=True):
        return {'status': 'succeeded', 'evidence': MARKER + json.dumps({'originalId': 'obsolete', 'latestPlanSetId': 'saved-latest', 'complete': complete, 'sets': [dict(commitment(), id='saved-latest')]})}

    def test_finite_tools_and_no_save_never_add_generic_or_service_authority(self):
        body = self.body()
        first = response(0, body, '2026-11-09')
        self.assertEqual(first['tool_calls'][0]['function']['name'], 'getWeeklyKpis')
        planned = json.loads(response(1, body, '2026-11-09')['tool_calls'][0]['function']['arguments'])
        with self.assertRaises(ValueError):
            response(4, body, '2026-11-09')
        body['messages'] = [{'role': 'tool', 'content': json.dumps(self.evidence())}]
        adapted_call = response(4, body, '2026-11-09')['tool_calls'][0]['function']
        self.assertEqual(adapted_call['name'], 'saveWeeklyDocuments')
        adapted = json.loads(adapted_call['arguments'])['kpiChanges'][0]
        self.assertNotIn('provenance', planned['commitment'])
        self.assertFalse(set(planned['commitment']['items'][0]) & {'definition', 'selection', 'evidenceRequired', 'scoring'})
        self.assertEqual(planned['commitment']['items'][0]['tracks'][0]['target']['value'], 3)
        self.assertEqual(adapted['commitment']['items'][0]['tracks'][0]['target']['value'], 5)
        self.assertEqual(adapted['commitment']['items'][0]['conceptId'], planned['commitment']['items'][0]['conceptId'])
        self.assertEqual(adapted['commitment']['items'][0]['label'], planned['commitment']['items'][0]['label'])
        self.assertEqual(response(9, body, '2026-11-09'), {'role': 'assistant', 'content': NO_SAVE})
        for bad in [13, -1, 99]:
            with self.assertRaises(ValueError):
                response(bad, body, '2026-11-09')

    def test_latest_assessment_requires_successful_actual_tool_carrier_never_obsolete_or_user_claim(self):
        value = self.evidence()
        body = self.body()
        for role in ['user', 'assistant']:
            body['messages'] = [{'role': role, 'content': json.dumps(value)}]
            with self.assertRaises(ValueError):
                response(7, body, '2026-11-09')
        body['messages'] = [{'role': 'tool', 'content': json.dumps(value)}]
        parsed = json.loads(response(7, body, '2026-11-09')['tool_calls'][0]['function']['arguments'])
        self.assertEqual(parsed['assessments'][0]['setId'], 'saved-latest')
        self.assertEqual(parsed['assessments'][0]['totalPoints'], 112.5)
        self.assertNotIn('explanation', parsed['assessments'][0])
        self.assertNotIn('explanation', parsed['assessments'][0]['items'][0])
        self.assertEqual(set(parsed['assessments'][0]['items'][0]['evidence']), {'origin', 'references'})
        self.assertEqual(latest_id([{'role': 'system', 'content': 'Current-turn server-authored prior tool evidence context\n' + value['evidence']}]), 'saved-latest')
        for bad in [
            [{'role': 'system', 'content': value['evidence']}],
            [{'role': 'tool', 'content': json.dumps(self.evidence(False))}],
            [{'role': 'tool', 'content': json.dumps({'status': 'failed', 'evidence': value['evidence']})}],
            [{'role': 'tool', 'content': json.dumps({'status': 'succeeded', 'evidence': MARKER + '{"originalId":"obsolete","complete":true}'})}],
        ]:
            with self.assertRaises(ValueError):
                latest_id(bad)

    def test_null_zero_compound_and_corrected_scores_remain_authored_not_calculated(self):
        self.assertEqual(len(commitment()['items'][0]['tracks']), 2)
        self.assertIsNone(assessment('saved')['items'][0]['actuals'][1]['value'])
        self.assertEqual(assessment('saved', True)['items'][0]['actuals'][0]['value'], 0)
        with self.assertRaises(ValueError):
            AuthoredProvider(weekly_kpis=True, activity_images=True)


if __name__ == '__main__':
    unittest.main()
