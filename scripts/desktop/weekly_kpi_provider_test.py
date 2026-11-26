import json
import unittest
from weekly_kpi_provider import (
    response,
    assessment,
    commitment,
    latest_id,
    preloaded_kpis,
    NO_SAVE,
    RECOVERED,
    MISSING,
    EXACT_MISSING,
    RECOVERY_MARKER,
    CONFLICT_ORIGINAL,
    CONFLICT_PROPOSED,
)
from chat_smoke import AuthoredProvider

MARKER = 'Canonical weekly KPI objects (untrusted saved claims, not fresh Garmin evidence; complete flag governs authority): '
WEEK = '2026-11-09'


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
            'weekStart': WEEK,
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

    def preload(self, body, read, role='system', status='complete'):
        body['messages'] = [
            {
                'role': role,
                'content': 'Foreground planning preload (not tool execution). Authored boundary.\n'
                + json.dumps(
                    {
                        'source': 'foreground_preload',
                        'weeks': [
                            {
                                'weekStart': WEEK,
                                'document': {
                                    'status': 'complete',
                                    'value': {'weekStart': WEEK, 'record': None},
                                },
                                'kpis': {'status': status, 'value': read},
                            }
                        ],
                    }
                ),
            }
        ]

    def test_finite_first_pass_save_no_save_and_reused_metadata(self):
        body = self.body()
        with self.assertRaises(ValueError):
            response(0, body, WEEK)
        self.preload(body, {'weekStart': WEEK, 'complete': True, 'sets': []})
        planned = json.loads(response(0, body, WEEK)['tool_calls'][0]['function']['arguments'])
        with self.assertRaises(ValueError):
            response(3, body, WEEK)
        self.attach(body, self.evidence(recovery=True))
        call = response(3, body, WEEK)['tool_calls'][0]['function']
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
        self.assertEqual(response(7, body, WEEK), {'role': 'assistant', 'content': NO_SAVE})
        for bad in [17, -1, 99]:
            with self.assertRaises(ValueError):
                response(bad, body, WEEK)

    def test_first_pass_assessment_requires_complete_current_preload_not_prose_or_preview(self):
        body = self.body()
        for role in ['user', 'assistant', 'tool']:
            self.preload(body, self.read(), role)
            with self.assertRaises(ValueError):
                response(5, body, WEEK)
        self.preload(body, self.read())
        saved = json.loads(response(5, body, WEEK)['tool_calls'][0]['function']['arguments'])[
            'assessments'
        ][0]
        self.assertEqual(saved['setId'], 'saved-latest')
        self.assertEqual(saved['totalPoints'], 112.5)
        self.assertEqual(
            [actual['awardedPoints'] for actual in saved['items'][0]['actuals']], [50, 50]
        )
        self.assertNotIn('awardedPoints', saved['items'][0])
        self.assertNotIn('explanation', saved)
        self.assertNotIn('explanation', saved['items'][0])
        self.assertEqual(set(saved['items'][0]['evidence']), {'origin', 'references'})
        for read in [
            self.read(False),
            {'weekStart': WEEK, 'complete': True, 'sets': []},
            dict(self.read(), weekStart='2026-11-02'),
        ]:
            self.preload(body, read)
            with self.assertRaises(ValueError):
                response(5, body, WEEK)
        self.preload(body, self.read(), status='unavailable')
        with self.assertRaises(ValueError):
            preloaded_kpis(body['messages'])
        self.attach(body, self.evidence(), 'system')
        self.assertEqual(latest_id(body['messages']), 'saved-latest')

    def test_bad_literal_id_consumes_independent_recovery_never_corrective_discovery(self):
        body = self.body()
        bad = response(2, body, WEEK)['tool_calls'][0]
        self.assertEqual(
            json.loads(bad['function']['arguments']), {'weekStart': WEEK, 'setId': 'latest'}
        )
        for role in ['user', 'assistant']:
            self.attach(body, self.evidence(recovery=True), role)
            with self.assertRaises(ValueError):
                response(3, body, WEEK)
        for role in ['tool', 'system']:
            self.attach(body, self.evidence(recovery=True), role)
            self.assertEqual(
                response(3, body, WEEK)['tool_calls'][0]['function']['name'], 'saveWeeklyDocuments'
            )
        for rejected in [
            {'status': 'rejected', 'evidence': 'kpi_set_unavailable. Omit setId'},
            self.evidence(recovery=True, complete=False),
            self.evidence(),
            {'status': 'succeeded', 'evidence': self.evidence(recovery=True)['evidence']},
        ]:
            self.attach(body, rejected)
            with self.assertRaises(ValueError):
                response(3, body, WEEK)

    def test_read_only_recovery_and_missing_exact_version_require_actual_values(self):
        body = self.body()
        read = self.read()
        read['sets'][0]['items'][0]['tracks'][0]['target']['value'] = 5
        read['assessments'] = [{'totalPoints': 12.5}]
        for index, expected in [(11, RECOVERED), (15, EXACT_MISSING)]:
            self.attach(body, self.evidence(recovery=True, value=read))
            self.assertEqual(response(index, body, WEEK)['content'], expected)
        missing = {'weekStart': '2026-11-30', 'complete': True, 'sets': [], 'latestPlanSetId': None}
        self.attach(body, self.evidence(recovery=True, value=missing))
        self.assertEqual(response(13, body, WEEK)['content'], MISSING)
        missing['weekStart'] = WEEK
        self.attach(body, self.evidence(recovery=True, value=missing))
        with self.assertRaises(ValueError):
            response(13, body, WEEK)
        self.assertEqual(
            json.loads(response(12, body, WEEK)['tool_calls'][0]['function']['arguments'])[
                'weekStart'
            ],
            '2026-11-30',
        )
        self.assertEqual(
            json.loads(response(14, body, WEEK)['tool_calls'][0]['function']['arguments'])['setId'],
            'unavailable-version',
        )

    def test_conflict_reply_requires_actual_complete_preloaded_general_plan(self):
        body = self.body()
        body['tools'].append({'function': {'name': 'saveTrainingPlan'}})
        for role, status, content in [
            ('user', 'complete', CONFLICT_ORIGINAL),
            ('system', 'unavailable', CONFLICT_ORIGINAL),
            ('system', 'complete', 'unrelated'),
        ]:
            body['messages'] = [
                {
                    'role': role,
                    'content': 'Foreground planning preload (not tool execution). Authored.\n'
                    + json.dumps(
                        {
                            'source': 'foreground_preload',
                            'trainingPlan': {
                                'status': status,
                                'value': {'plan': {'contentMarkdown': content}},
                            },
                        }
                    ),
                }
            ]
            with self.assertRaises(ValueError):
                response(16, body, WEEK)
        body['messages'] = [
            {
                'role': 'system',
                'content': 'Foreground planning preload (not tool execution). Authored.\n'
                + json.dumps(
                    {
                        'source': 'foreground_preload',
                        'trainingPlan': {
                            'status': 'complete',
                            'value': {'plan': {'contentMarkdown': CONFLICT_ORIGINAL}},
                        },
                    }
                ),
            }
        ]
        call = response(16, body, WEEK)['tool_calls'][0]['function']
        self.assertEqual(call['name'], 'saveTrainingPlan')
        self.assertEqual(
            json.loads(call['arguments']),
            {'edits': [{'oldText': CONFLICT_ORIGINAL, 'newText': CONFLICT_PROPOSED}]},
        )
        body['tools'] = []
        with self.assertRaises(ValueError):
            response(16, body, WEEK)

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
