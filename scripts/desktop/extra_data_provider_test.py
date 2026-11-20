"""Before-use contracts for the finite authored T0352 extra-data chat provider."""

import contextlib
import json
import sqlite3
import unittest

import extra_data_provider as provider
from chat_smoke import AuthoredProvider

TOOLS = ['describeGarminDatabase', 'runReadOnlySql', 'runMathAnalysis']


def body(evidence='', tools=TOOLS):
    return {
        'messages': [
            {'role': 'user', 'content': 'review'},
            {'role': 'system', 'content': evidence},
        ],
        'tools': [{'function': {'name': name}} for name in tools],
    }


SCHEMA = '\n'.join(table + ' columns: date.' for table in provider.TABLES) + (
    ' never individual runs. not yet imported. no-proven-lap-link.'
)
SQL_EVIDENCE = (
    'Tool step 2: runReadOnlySql (succeeded).\nSQL result handle extra_groups: returned 1/1 rows.\n1. '
    + json.dumps(provider.EXPECTED)
)
MATH_EVIDENCE = (
    'runMathAnalysis succeeded. Math result handle snow_km: customFormula.\n1. {"score":0.3}'
)


class ExtraDataProviderTests(unittest.TestCase):
    def call(self, index, evidence=''):
        return provider.response(index, body(evidence))['tool_calls'][0]['function']

    def test_finite_describe_sql_math_answer_sequence(self):
        self.assertEqual(self.call(0)['name'], 'describeGarminDatabase')
        sql = self.call(1, SCHEMA)
        self.assertEqual(sql['name'], 'runReadOnlySql')
        self.assertIn('activity_lap_hr_zone_time', json.loads(sql['arguments'])['sql'])
        math = self.call(2, SCHEMA + SQL_EVIDENCE)
        self.assertEqual(json.loads(math['arguments'])['formula'], 'run_distance_meters / 1000')
        self.assertEqual(
            provider.response(3, body(SQL_EVIDENCE + MATH_EVIDENCE))['content'], provider.ANSWER
        )

    def test_refuses_missing_schema_wrong_cells_math_and_extra_calls(self):
        with self.assertRaises(ValueError):
            self.call(1, 'daily_health columns: date.')
        changed = dict(provider.EXPECTED, measured_runs=9, snow_latest_status='populated')
        with self.assertRaises(ValueError):
            self.call(
                2, 'runReadOnlySql succeeded SQL result handle extra_groups ' + json.dumps(changed)
            )
        with self.assertRaises(ValueError):
            provider.response(3, body(SQL_EVIDENCE))
        with self.assertRaises(ValueError):
            provider.response(4, body(MATH_EVIDENCE))
        with self.assertRaises(ValueError):
            provider.response(0, body('', ['runReadOnlySql']))
        with self.assertRaises(ValueError):
            provider.response(0, body('', TOOLS + ['completeTrainerTurn']))

    def test_seed_satisfies_schema_constraints_and_expected_cells(self):
        with contextlib.closing(sqlite3.connect(':memory:')) as db:
            db.executescript(
                """
                create table daily_sleep_detail (date text primary key, overall_score integer, overall_qualifier text, fetched_at integer not null);
                create table daily_sleep_score_component (date text not null, component text not null, value integer, qualifier text, primary key(date, component));
                create table daily_hrv_detail (date text primary key, weekly_avg_ms real, baseline_balanced_low_ms real, baseline_balanced_upper_ms real, fetched_at integer not null);
                create table vo2_max_reading (date text not null, branch text not null, vo2_max real, vo2_max_precise real, sport text, fetched_at integer not null, primary key(date, branch));
                create table body_battery_event (date text not null, event_key text not null, event_type text, impact integer, primary key(date, event_key));
                create table daily_stress (date text primary key, high_seconds real, total_seconds real, fetched_at integer not null);
                create table activity_lap (garmin_id text not null, lap_number integer not null, start_time text, primary key(garmin_id, lap_number));
                create table activity_lap_hr_zone_time (garmin_id text not null, lap_number integer not null, bucket integer not null, zone integer, bucket_kind text not null, seconds real not null, lower_bpm integer, fetched_at integer not null, primary key(garmin_id, lap_number, bucket));
                create table activity_split_summary (garmin_id text not null, split_type text not null, split_count integer, fetched_at integer not null, primary key(garmin_id, split_type));
                create table activity_snow_split (garmin_id text not null, split_key text not null, message_index integer, source_order integer, split_type text check(split_type in ('run','lift')), distance_meters real, fetched_at integer not null, primary key(garmin_id,split_key));
                create table garmin_data_coverage (data_group text not null, subject_type text not null, subject_id text not null, status text not null, reason text, updated_at integer not null, primary key(data_group, subject_type, subject_id));
                """
            )
            provider.seed(db)
            row = db.execute(provider.SQL).fetchone()
            names = [column[0] for column in db.execute(provider.SQL).description]
            self.assertEqual(dict(zip(names, row)), provider.EXPECTED)

    def test_scope_is_exclusive(self):
        with self.assertRaises(ValueError):
            AuthoredProvider(extra_data=True, activity_images=True)
        with self.assertRaises(ValueError):
            AuthoredProvider(extra_data=True, weekly_kpis=True)


if __name__ == '__main__':
    unittest.main()
