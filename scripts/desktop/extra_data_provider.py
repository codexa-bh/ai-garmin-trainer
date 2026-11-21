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
    'latest split coverage failed, so retained rows are not a complete fresh read. Split HR is '
    'derived from stored samples inside each split window, not from lap allocation: 123 bpm '
    'for both runs and both lifts, while split zone time is unavailable because no activity-file '
    'zone limits are stored. Not backfilled dates remain unknown, not zero.'
)
CALLS = 5
SQL = (
    "select (select value from daily_sleep_score_component where date='2026-11-02' and component='overall') as sleep_overall, "
    "(select qualifier from daily_sleep_score_component where date='2026-11-02' and component='deep') as deep_qualifier, "
    "(select weekly_avg_ms from daily_hrv_detail where date='2026-11-02') as hrv_weekly_ms, "
    "(select baseline_balanced_low_ms from daily_hrv_detail where date='2026-11-02') as hrv_low_ms, "
    "(select baseline_balanced_upper_ms from daily_hrv_detail where date='2026-11-02') as hrv_upper_ms, "
    "(select vo2_max_precise from vo2_max_reading where branch='generic' and date='2026-10-20') as vo2_precise, "
    "(select count(*) from vo2_max_reading where date='2026-10-20') as vo2_readings, "
    "(select sum(impact) from body_battery_event where date='2026-11-02') as battery_event_impact, "
    "(select high_seconds from daily_stress where date='2026-11-02') as high_stress_seconds, "
    "(select sum(seconds) from activity_lap_hr_zone_time where garmin_id='weekdayHike' and bucket_kind='zone' and zone=2) as lap_zone2_seconds, "
    "(select split_count from activity_split_summary where garmin_id='weekdayHike' and split_type='SKI_RUN_SPLIT') as ski_runs, "
    "(select count(*) from garmin_data_coverage where subject_id='2026-11-01') as not_backfilled_rows, "
    "(select count(*) from activity_snow_split where garmin_id='weekdayHike' and split_type='run') as measured_runs, "
    "(select count(*) from activity_snow_split where garmin_id='weekdayHike' and split_type='lift') as measured_lifts, "
    "(select sum(distance_meters) from activity_snow_split where garmin_id='weekdayHike' and split_type='run') as run_distance_meters, "
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
    # Seed the latest existing legacy day too: default preview must not discover
    # older extra-only dates or require an operator-provided SQL query.
    latest = db.execute('select max(date) from daily_health').fetchone()[0]
    if not latest:
        raise ValueError('Populated authored legacy health required')
    db.execute(
        "insert or replace into daily_sleep_detail(date,overall_score,overall_qualifier,fetched_at) values (?,82,'GOOD',1)",
        (latest,),
    )
    db.execute(
        'insert or replace into daily_hrv_detail(date,weekly_avg_ms,baseline_balanced_low_ms,baseline_balanced_upper_ms,fetched_at) values (?,61,50,70,1)',
        (latest,),
    )
    db.execute(
        'insert or replace into daily_body_battery(date,charged,drained,fetched_at) values (?,0,65,1)',
        (latest,),
    )
    db.execute(
        'insert or replace into daily_stress(date,high_seconds,total_seconds,fetched_at) values (?,3600,72000,1)',
        (latest,),
    )
    db.execute(
        "insert into activity_extra_metrics(garmin_id,body_battery_delta,avg_run_cadence_spm,avg_stride_length_cm,fit_avg_cadence_cpm,fetched_at) values ('weekdayHike',-9,158,98.5,79.5,1)"
    )
    db.executemany(
        'insert into activity_snow_split(garmin_id,split_key,message_index,source_order,split_type,start_time,end_time,distance_meters,fetched_at) values (?,?,?,?,?,?,?,?,1)',
        [
            # Four consecutive 100 s windows over the run copy's 10 s HR samples
            # (constant 123 bpm, activity start 2026-11-01T00:00:00Z).
            (
                'weekdayHike',
                'index:' + str(i),
                i,
                i,
                kind,
                '2026-11-01T00:%02d:%02dZ' % ((i * 100) // 60, (i * 100) % 60),
                '2026-11-01T00:%02d:%02dZ' % (((i + 1) * 100) // 60, ((i + 1) * 100) % 60),
                distance,
            )
            for i, (kind, distance) in enumerate(
                [('run', 100), ('lift', 100), ('run', 200), ('lift', 200)]
            )
        ],
    )
    db.executemany(
        # The recipe may already cover the newest day; the authored row must win, not collide.
        'insert or replace into garmin_data_coverage(data_group,subject_type,subject_id,status,reason,updated_at) values (?,?,?,?,?,1)',
        [
            ('sleep', 'date', '2026-11-02', 'populated', None),
            ('vo2_max', 'date', '2026-11-02', 'empty', 'source-empty'),
            ('lap_hr_zones', 'activity', 'weekdayHike', 'populated', None),
            *[
                (group, 'date', latest, 'populated', None)
                for group in ['sleep', 'hrv', 'body_battery', 'stress']
                if latest != '2026-11-02' or group != 'sleep'
            ],
            ('activity_body_battery', 'activity', 'weekdayHike', 'populated', None),
            ('running_dynamics', 'activity', 'weekdayHike', 'populated', None),
            ('snowboard_splits', 'activity', 'weekdayHike', 'populated', None),
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


def validate_dashboard(evidence):
    marker = 'Dashboard values and explicit limits: '
    if marker not in evidence:
        raise ValueError('Actual default dashboard missing')
    dashboard = json.JSONDecoder().raw_decode(evidence.split(marker, 1)[1].lstrip())[0]
    extra = dashboard.get('extraEvidence', {})
    if (
        extra.get('bodyBatteryDelta') != -9
        or extra.get('cadence', {}).get('activityList', {}).get('avgRunCadenceSpm') != 158
        or extra.get('cadence', {}).get('fitSession', {}).get('avgCadenceCpm') != 79.5
    ):
        raise ValueError('Actual default cadence/battery missing')
    if (
        extra['cadence']['activityList']['avgStrideLengthCm'] != 98.5
        or extra['cadence']['fitSession']['avgStepLengthM'] is not None
    ):
        raise ValueError('Actual stride/missing sensor mismatch')
    laps = extra['laps']
    buckets = laps['rows'][0]['heartRateZones']['buckets']
    if (
        laps['sourceLapCount'] != 1
        or laps['returnedCount'] != 1
        or [(b['bucket'], b['seconds']) for b in buckets] != [(0, 40), (2, 600)]
    ):
        raise ValueError('Actual default lap evidence mismatch')
    if (
        extra['snowboard']['rows'][0]['count'] != 9
        or extra['coverage']['lap_hr_zones']['status'] != 'populated'
        or extra['limits']['bucketsPerLap'] != 8
    ):
        raise ValueError('Actual default split/coverage/caps mismatch')
    split_hr = dashboard.get('snowEvidence', {}).get('splitHeartRate', {})
    kinds = {entry['splitType']: entry for entry in split_hr.get('types', [])}
    if (
        sorted(kinds) != ['lift', 'run']
        or any(
            entry['sourceCount'] != 2
            or entry['returnedCount'] != 2
            or entry['omittedCount'] != 0
            or [row['avgHeartRate'] for row in entry['rows']] != [123, 123]
            or any(
                row['zoneSeconds'] is not None
                or row['zoneUnavailableReason'] != 'missing-zone-boundaries'
                for row in entry['rows']
            )
            for entry in kinds.values()
        )
        or split_hr.get('zoneLowerBpm') is not None
    ):
        raise ValueError('Actual derived split HR evidence mismatch')
    if any(field in dashboard for field in ['route', 'charts', 'stream', 'visualInput']):
        raise ValueError('Private visual inputs in default numerical evidence')


def response(index, body):
    names = [tool.get('function', {}).get('name') for tool in body.get('tools', [])]
    if index >= CALLS or 'completeTrainerTurn' in names:
        raise ValueError('Unexpected extra provider call')
    if index == 0:
        evidence = _tool_messages(body)
        if not all(
            value in evidence
            for value in [
                'sleep score 82/100 qualifier GOOD',
                'weekly HRV 61 ms',
                'baseline 50–70 ms',
                'charged 0/drained 65',
                'high stress 60 min',
                'body_battery=populated',
            ]
        ):
            raise ValueError('Actual default recovery context missing')
        name, args = 'getActivityDashboard', {'garminId': 'weekdayHike'}
    elif index == 1:
        validate_dashboard(_tool_messages(body))
        name, args = 'describeGarminDatabase', {}
    elif index == 2:
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
    elif index == 3:
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
