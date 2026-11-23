import json
import unittest
from weekly_kpi_provider import (
    response,
    assessment,
    commitment,
    latest_id,
    NO_SAVE,
    RECOVERED,
    MISSING,
    EXACT_MISSING,
    RECOVERY_MARKER,
)
from chat_smoke import AuthoredProvider

MARKER = 'Canonical weekly KPI objects (untrusted saved claims, not fresh Garmin evidence; complete flag governs authority): '


class WeeklyKpiProviderTests(unittest.TestCase):
    def body(self):
        return {
            'model': 'qwen3.5:4b',
            'stream': False,
            'messages': [],
            'tools': [
                {'function': {'name': name}}
                for name in ['getWeeklyKpis', 'saveWeeklyKpis', 'saveWeeklyDocuments']
            ],
        }

    def read(self, complete=True):
        return {
            'weekStart': '2026-11-09',
            'originalId': 'obsolete',
            'latestPlanSetId': 'saved-latest',
            'complete': complete,
            'sets': [dict(commitment(), id='saved-latest')],
        }

    def evidence(self, complete=True, recovery=False, value=None):
        value = value if value is not None else self.read(complete)
        return {
            'status': 'rejected' if recovery else 'succeeded',
            'evidence': (RECOVERY_MARKER if recovery else MARKER)
            + json.dumps({'requestedSetId': 'latest', 'canonical': value} if recovery else value),
        }

    def attach(self, body, evidence, role='tool'):
        body['messages'] = [
            {
                'role': role,
                'content': json.dumps(evidence)
                if role == 'tool'
                else 'Current-turn server-authored prior tool evidence context\n'
                + evidence['evidence'],
            }
        ]

    def test_finite_tools_no_save_and_minimal_metadata(self):
        body = self.body()
        self.assertEqual(
            response(0, body, '2026-11-09')['tool_calls'][0]['function']['name'], 'getWeeklyKpis'
        )
        planned = json.loads(
            response(1, body, '2026-11-09')['tool_calls'][0]['function']['arguments']
        )
        with self.assertRaises(ValueError):
            response(4, body, '2026-11-09')
        self.attach(body, self.evidence(recovery=True))
        call = response(4, body, '2026-11-09')['tool_calls'][0]['function']
        self.assertEqual(call['name'], 'saveWeeklyDocuments')
        adapted = json.loads(call['arguments'])['kpiChanges'][0]
        self.assertNotIn('provenance', planned['commitment'])
        self.assertFalse(
            set(planned['commitment']['items'][0])
            & {'definition', 'selection', 'evidenceRequired', 'scoring'}
        )
        self.assertEqual(planned['commitment']['items'][0]['tracks'][0]['target']['value'], 3)
        self.assertEqual(adapted['commitment']['items'][0]['tracks'][0]['target']['value'], 5)
        self.assertEqual(
            [track['availablePoints'] for track in adapted['commitment']['items'][0]['tracks']],
            [50, 30],
        )
        self.assertNotIn('availablePoints', adapted['commitment']['items'][0])
        for key in ['conceptId', 'label']:
            self.assertEqual(
                adapted['commitment']['items'][0][key], planned['commitment']['items'][0][key]
            )
        self.assertEqual(
            [track['pointsRule'] for track in adapted['commitment']['items'][0]['tracks']],
            [track['pointsRule'] for track in planned['commitment']['items'][0]['tracks']],
        )
        self.assertEqual(response(9, body, '2026-11-09'), {'role': 'assistant', 'content': NO_SAVE})
        for bad in [19, -1, 99]:
            with self.assertRaises(ValueError):
                response(bad, body, '2026-11-09')

    def test_latest_assessment_uses_actual_carrier_not_user_or_obsolete_claims(self):
        body = self.body()
        value = self.evidence()
        for role in ['user', 'assistant']:
            self.attach(body, value, role)
            with self.assertRaises(ValueError):
                response(7, body, '2026-11-09')
        self.attach(body, value)
        parsed = json.loads(
            response(7, body, '2026-11-09')['tool_calls'][0]['function']['arguments']
        )
        saved = parsed['assessments'][0]
        self.assertEqual(saved['setId'], 'saved-latest')
        self.assertEqual(saved['totalPoints'], 112.5)
        self.assertEqual(
            [actual['awardedPoints'] for actual in saved['items'][0]['actuals']], [50, 50]
        )
        self.assertNotIn('awardedPoints', saved['items'][0])
        self.assertNotIn('explanation', saved)
        self.assertNotIn('explanation', saved['items'][0])
        self.assertEqual(set(saved['items'][0]['evidence']), {'origin', 'references'})
        self.attach(body, value, 'system')
        self.assertEqual(latest_id(body['messages']), 'saved-latest')
        for evidence in [
            self.evidence(False),
            {'status': 'failed', 'evidence': value['evidence']},
            self.evidence(value={'originalId': 'obsolete', 'complete': True}),
        ]:
            self.attach(body, evidence)
            with self.assertRaises(ValueError):
                latest_id(body['messages'])
        body['messages'] = [{'role': 'system', 'content': value['evidence']}]
        with self.assertRaises(ValueError):
            latest_id(body['messages'])

    def test_bad_literal_id_consumes_independent_recovery_never_corrective_discovery(self):
        body = self.body()
        bad = response(3, body, '2026-11-09')['tool_calls'][0]
        self.assertEqual(
            json.loads(bad['function']['arguments']), {'weekStart': '2026-11-09', 'setId': 'latest'}
        )
        for role in ['user', 'assistant']:
            self.attach(body, self.evidence(recovery=True), role)
            with self.assertRaises(ValueError):
                response(4, body, '2026-11-09')
        for role in ['tool', 'system']:
            self.attach(body, self.evidence(recovery=True), role)
            self.assertEqual(
                response(4, body, '2026-11-09')['tool_calls'][0]['function']['name'],
                'saveWeeklyDocuments',
            )
        for rejected in [
            {'status': 'rejected', 'evidence': 'kpi_set_unavailable. Omit setId'},
            self.evidence(recovery=True, complete=False),
            self.evidence(),
            {'status': 'succeeded', 'evidence': self.evidence(recovery=True)['evidence']},
        ]:
            self.attach(body, rejected)
            with self.assertRaises(ValueError):
                response(4, body, '2026-11-09')

    def test_read_only_recovery_and_missing_exact_version_require_actual_values(self):
        body = self.body()
        read = self.read()
        read['sets'][0]['items'][0]['tracks'][0]['target']['value'] = 5
        read['assessments'] = [{'totalPoints': 12.5}]
        for index, expected in [(14, RECOVERED), (18, EXACT_MISSING)]:
            self.attach(body, self.evidence(recovery=True, value=read))
            self.assertEqual(response(index, body, '2026-11-09')['content'], expected)
        missing = {'weekStart': '2026-11-30', 'complete': True, 'sets': [], 'latestPlanSetId': None}
        self.attach(body, self.evidence(recovery=True, value=missing))
        self.assertEqual(response(16, body, '2026-11-09')['content'], MISSING)
        missing['weekStart'] = '2026-11-09'
        self.attach(body, self.evidence(recovery=True, value=missing))
        with self.assertRaises(ValueError):
            response(16, body, '2026-11-09')
        self.assertEqual(
            json.loads(response(15, body, '2026-11-09')['tool_calls'][0]['function']['arguments'])[
                'weekStart'
            ],
            '2026-11-30',
        )
        self.assertEqual(
            json.loads(response(17, body, '2026-11-09')['tool_calls'][0]['function']['arguments'])[
                'setId'
            ],
            'unavailable-version',
        )

    def test_null_zero_and_corrections_remain_authored_not_calculated(self):
        self.assertEqual(len(commitment()['items'][0]['tracks']), 2)
        self.assertIsNone(assessment('saved')['items'][0]['actuals'][1]['value'])
        self.assertEqual(assessment('saved', True)['items'][0]['actuals'][0]['value'], 0)
        self.assertEqual(assessment('saved', True)['items'][0]['actuals'][0]['awardedPoints'], 0)
        self.assertEqual(assessment('saved', True)['totalPoints'], 12.5)
        with self.assertRaises(ValueError):
            AuthoredProvider(weekly_kpis=True, activity_images=True)


if __name__ == '__main__':
    unittest.main()
