"""Finite authored provider replies for the T0352 extra-data chat scope.

Exercises the actual guarded describe → SQL → math path over the additional
Garmin evidence relations. Replies are authored, never real-provider reasoning.
"""

import json

ANSWER = (
    'Authored extra-data review: sleep overall 82 with GOOD deep sleep, weekly HRV 61 ms '
    'inside the Garmin baseline 50-70, sparse VO2 45.2 on one measured date, -12 Body Battery '
    'event impact, 3600 s high stress, 600 s lap zone 2 and 9 snowboard runs as a per-type '
    'total. Individual FIT evidence has 2 measured runs (300 m) and 2 lifts, kept separate; '
    'latest split coverage failed, so retained rows are not a complete fresh read and split HR '
    'is unavailable without a proven lap link. Not backfilled dates remain unknown, not zero.'
)
CALLS = 4
SQL = (
    "select (select value from daily_sleep_score_component where date='2026-11-02' and component='overall') as sleep_overall, "
    "(select qualifier from daily_sleep_score_component where date='2026-11-02' and component='deep') as deep_qualifier, "
    "(select weekly_avg_ms from daily_hrv_detail where date='2026-11-02') as hrv_weekly_ms, "
    "(select baseline_balanced_low_ms from daily_hrv_detail where date='2026-11-02') as hrv_low_ms, "
    "(select baseline_balanced_upper_ms from daily_hrv_detail where date='2026-11-02') as hrv_upper_ms, "
    "(select vo2_max_precise from vo2_max_reading where branch='generic' order by date desc limit 1) as vo2_precise, "
    '(select count(*) from vo2_max_reading) as vo2_readings, '
    "(select sum(impact) from body_battery_event where date='2026-11-02') as battery_event_impact, "
    "(select high_seconds from daily_stress where date='2026-11-02') as high_stress_seconds, "
    "(select sum(seconds) from activity_lap_hr_zone_time where garmin_id='weekdayHike' and bucket_kind='zone' and zone=2) as lap_zone2_seconds, "
    "(select split_count from activity_split_summary where garmin_id='weekdayHike' and split_type='SKI_RUN_SPLIT') as ski_runs, "
    "(select count(*) from garmin_data_coverage where subject_id='2026-11-01') as not_backfilled_rows, "
    "(select count(*) from activity_snow_split where split_type='run') as measured_runs, "
    "(select count(*) from activity_snow_split where split_type='lift') as measured_lifts, "
    "(select sum(distance_meters) from activity_snow_split where split_type='run') as run_distance_meters, "
    "(select status from garmin_data_coverage where data_group='snow_run_lift_splits' and subject_id='weekdayHike') as snow_latest_status"
)
EXPECTED = {
    'sleep_overall': 82,
    'deep_qualifier': 'GOOD',
    'hrv_weekly_ms': 61,
    'hrv_low_ms': 50,
    'hrv_upper_ms': 70,
    'vo2_precise': 45.2,
    'vo2_readings': 1,
    'battery_event_impact': -12,
    'high_stress_seconds': 3600,
    'lap_zone2_seconds': 600,
    'ski_runs': 9,
    'not_backfilled_rows': 0,
    'measured_runs': 2,
    'measured_lifts': 2,
    'run_distance_meters': 300,
    'snow_latest_status': 'failed',
}
TABLES = (
    'daily_sleep_detail',
    'daily_sleep_score_component',
    'daily_hrv_detail',
    'vo2_max_reading',
    'daily_body_battery',
    'body_battery_event',
    'daily_stress',
    'activity_extra_metrics',
    'activity_split_summary',
    'activity_snow_split',
    'activity_lap_hr_zone_time',
    'garmin_data_coverage',
)


def seed(db):
    """Authored rows on the exclusive stopped run copy only."""
    db.execute(
        "insert into daily_sleep_detail(date,overall_score,overall_qualifier,fetched_at) values ('2026-11-02',82,'GOOD',1)"
    )
    db.executemany(
        'insert into daily_sleep_score_component(date,component,value,qualifier) values (?,?,?,?)',
        [('2026-11-02', 'overall', 82, 'GOOD'), ('2026-11-02', 'deep', 24, 'GOOD')],
    )
    db.execute(
        "insert into daily_hrv_detail(date,weekly_avg_ms,baseline_balanced_low_ms,baseline_balanced_upper_ms,fetched_at) values ('2026-11-02',61,50,70,1)"
    )
    db.execute(
        "insert into vo2_max_reading(date,branch,vo2_max,vo2_max_precise,sport,fetched_at) values ('2026-10-20','generic',45,45.2,'WALKING',1)"
    )
    db.execute(
        "insert into body_battery_event(date,event_key,event_type,impact) values ('2026-11-02','ACTIVITY|2026-11-02T16:00:00.0|3600000','ACTIVITY',-12)"
    )
    db.execute(
        "insert into daily_stress(date,high_seconds,total_seconds,fetched_at) values ('2026-11-02',3600,72000,1)"
    )
    db.execute(
        "insert into activity_lap(garmin_id,lap_number,start_time) values ('weekdayHike',1,'2026-11-01T00:00:00Z')"
    )
    db.execute(
        "insert into activity_lap_hr_zone_time(garmin_id,lap_number,bucket,zone,bucket_kind,seconds,lower_bpm,fetched_at) values ('weekdayHike',1,2,2,'zone',600,115,1)"
    )
    db.execute(
        "insert into activity_lap_hr_zone_time(garmin_id,lap_number,bucket,zone,bucket_kind,seconds,fetched_at) values ('weekdayHike',1,0,null,'below',40,1)"
    )
    db.execute(
        "insert into activity_split_summary(garmin_id,split_type,split_count,fetched_at) values ('weekdayHike','SKI_RUN_SPLIT',9,1)"
    )
    db.executemany(
        'insert into activity_snow_split(garmin_id,split_key,message_index,source_order,split_type,distance_meters,fetched_at) values (?,?,?,?,?,?,1)',
        [
            ('weekdayHike', 'index:' + str(i), i, i, kind, distance)
            for i, (kind, distance) in enumerate(
                [('run', 100), ('lift', 100), ('run', 200), ('lift', 200)]
            )
        ],
    )
    db.executemany(
        'insert into garmin_data_coverage(data_group,subject_type,subject_id,status,reason,updated_at) values (?,?,?,?,?,1)',
        [
            ('sleep', 'date', '2026-11-02', 'populated', None),
            ('vo2_max', 'date', '2026-11-02', 'empty', 'source-empty'),
            ('lap_hr_zones', 'activity', 'weekdayHike', 'populated', None),
            ('snow_run_lift_splits', 'activity', 'weekdayHike', 'failed', 'read-failed'),
        ],
    )


def _tool_messages(body):
    carriers = []
    for message in body['messages']:
        content = message.get('content')
        if not isinstance(content, str):
            continue
        if message.get('role') == 'tool':
            try:
                carriers.append(json.loads(content).get('evidence', ''))
            except ValueError:
                continue
        else:
            carriers.append(content)
    return '\n'.join(carriers)


def response(index, body):
    names = [tool.get('function', {}).get('name') for tool in body.get('tools', [])]
    if index >= CALLS or 'completeTrainerTurn' in names:
        raise ValueError('Unexpected extra provider call')
    if index == 0:
        name, args = 'describeGarminDatabase', {}
    elif index == 1:
        evidence = _tool_messages(body)
        # Actual production schema evidence must expose every new relation.
        if not all(table + ' columns:' in evidence for table in TABLES):
            raise ValueError('Actual schema evidence missing extra relations')
        if (
            'never individual runs' not in evidence
            or 'not yet imported' not in evidence
            or 'no-proven-lap-link' not in evidence
        ):
            raise ValueError('Actual schema meanings missing')
        name, args = 'runReadOnlySql', {'sql': SQL, 'resultName': 'extra_groups', 'maxRows': 5}
    elif index == 2:
        evidence = _tool_messages(body)
        # Legacy context says "runReadOnlySql (succeeded)"; native carriers say
        # "runReadOnlySql succeeded". The result handle line is common to both.
        if 'SQL result handle extra_groups' not in evidence:
            raise ValueError('Actual SQL result missing')
        for key, value in EXPECTED.items():
            if f'"{key}":{json.dumps(value)}' not in evidence.replace(' ', ''):
                raise ValueError('Actual SQL cell mismatch: ' + key)
        name, args = (
            'runMathAnalysis',
            {
                'inputResult': 'extra_groups',
                'operation': 'customFormula',
                'formula': 'run_distance_meters / 1000',
                'outputName': 'snow_km',
            },
        )
    else:
        evidence = _tool_messages(body)
        if 'Math result handle snow_km' not in evidence or '"score":0.3' not in evidence.replace(
            ' ', ''
        ):
            raise ValueError('Actual math result missing')
        return {'role': 'assistant', 'content': ANSWER}
    if name not in names:
        raise ValueError('Actual action schema missing: ' + name)
    return {
        'role': 'assistant',
        'content': None,
        'tool_calls': [
            {
                'id': 'authored-extra-' + str(index),
                'type': 'function',
                'function': {'name': name, 'arguments': json.dumps(args)},
            }
        ],
    }
