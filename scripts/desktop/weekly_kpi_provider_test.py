import json
import unittest
from weekly_kpi_provider import response, assessment, commitment, original_id, NO_SAVE
from chat_smoke import AuthoredProvider


class WeeklyKpiProviderTests(unittest.TestCase):
    def body(self):
        return {'model': 'qwen3.5:4b', 'stream': False, 'messages': [], 'tools': [{'function': {'name': name}} for name in ['getWeeklyKpis', 'saveWeeklyKpis']]}

    def test_finite_tools_and_no_save_never_add_generic_or_service_authority(self):
        body = self.body()
        first = response(0, body, '2026-11-09')
        self.assertEqual(first['tool_calls'][0]['function']['name'], 'getWeeklyKpis')
        planned = json.loads(response(1, body, '2026-11-09')['tool_calls'][0]['function']['arguments'])
        adapted = json.loads(response(4, body, '2026-11-09')['tool_calls'][0]['function']['arguments'])
        self.assertEqual(planned['commitment']['items'][0]['tracks'][0]['target']['value'], 3)
        self.assertEqual(adapted['commitment']['items'][0]['tracks'][0]['target']['value'], 5)
        self.assertEqual(response(9, body, '2026-11-09'), {'role': 'assistant', 'content': NO_SAVE})
        for bad in [13, -1, 99]:
            with self.assertRaises(ValueError):
                response(bad, body, '2026-11-09')

    def test_assessment_requires_successful_actual_tool_carrier_not_user_or_assistant_claim(self):
        marker = 'Canonical weekly KPI objects (untrusted saved claims, not fresh Garmin evidence; complete flag governs authority): '
        value = {'status': 'succeeded', 'evidence': marker + '{"originalId":"saved-baseline","complete":true}'}
        body = self.body()
        for role in ['user', 'assistant']:
            body['messages'] = [{'role': role, 'content': json.dumps(value)}]
            with self.assertRaises(ValueError):
                response(7, body, '2026-11-09')
        body['messages'] = [{'role': 'tool', 'content': json.dumps(value)}]
        parsed = json.loads(response(7, body, '2026-11-09')['tool_calls'][0]['function']['arguments'])
        self.assertEqual(parsed['assessments'][0]['setId'], 'saved-baseline')
        self.assertEqual(parsed['assessments'][0]['totalPoints'], 112.5)
        self.assertEqual(original_id([{'role': 'system', 'content': 'Current-turn server-authored prior tool evidence context\n' + value['evidence']}]), 'saved-baseline')
        with self.assertRaises(ValueError):
            original_id([{'role': 'system', 'content': value['evidence']}])
        with self.assertRaises(ValueError):
            original_id([{'role': 'tool', 'content': json.dumps({'status': 'succeeded', 'evidence': marker + '{"originalId":"saved-baseline","complete":false}'})}])
        value['status'] = 'failed'
        with self.assertRaises(ValueError):
            original_id([{'role': 'tool', 'content': json.dumps(value)}])

    def test_null_zero_compound_and_corrected_scores_remain_authored_not_calculated(self):
        self.assertEqual(len(commitment()['items'][0]['tracks']), 2)
        self.assertIsNone(assessment('saved')['items'][0]['actuals'][1]['value'])
        self.assertEqual(assessment('saved', True)['items'][0]['actuals'][0]['value'], 0)
        with self.assertRaises(ValueError):
            AuthoredProvider(weekly_kpis=True, activity_images=True)


if __name__ == '__main__':
    unittest.main()
