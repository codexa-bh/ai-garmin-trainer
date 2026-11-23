"""Actual native-owned JSON/NDJSON structured KPI saves with a finite authored provider."""

import argparse
import contextlib
import datetime
import hashlib
import json
import os
from pathlib import Path
import signal
import sqlite3
import uuid
import smoke_resources as resources
from chat_smoke import AuthoredProvider, api, seed_run
from weekly_kpi_provider import ANSWER, NO_SAVE, RECOVERED, MISSING, EXACT_MISSING
from native_smoke import REPO, Observer, canonical, private_json, readonly, source_identity
from ordinary_identity import inventory_hash
from release_artifact import candidate_preparation
from ordinary_smoke import OrdinaryRun, private_directory
from release_smoke import audit
from smoke_input import prepare


def state(run, week):
    with contextlib.closing(readonly(run.database)) as db:
        row = db.execute('select state_json from weekly_kpi where week_start=?', (week,)).fetchone()
        return json.loads(row[0]) if row else None


def weekly_snapshot(run):
    """All weekly persistence, not just the selected KPI set, is read-only."""
    with contextlib.closing(readonly(run.database)) as db:
        return {
            table: db.execute('select * from ' + table + ' order by 1').fetchall()
            for table in [
                'weekly_artifact',
                'weekly_kpi',
                'weekly_kpi_track',
                'weekly_kpi_recipe',
                'weekly_kpi_measurement',
            ]
        }


def seed_auto_measurements(run, week):
    """Only the stopped exclusive synthetic run copy; no live/private input."""
    if run.child is not None or run.database.parent != run.root or run.database.is_symlink():
        raise ValueError('Stopped exclusive run copy required')
    start = int(
        datetime.datetime.fromisoformat(week).replace(tzinfo=datetime.timezone.utc).timestamp()
        * 1000
    )
    recipe = {
        'conceptId': 'authored-sessions',
        'version': 1,
        'sql': "select count(*) as count, sum(duration_sec) / 60.0 as duration from activity where sport in ('hiking','walking') and started_at >= :week_start_ms and started_at < :week_end_ms",
        'tracks': [
            {'key': key, 'signature': json.dumps(['numeric', unit, meaning], separators=(',', ':'))}
            for key, unit, meaning in [
                ('count', 'sessions', 'Selected session count'),
                ('duration', 'minutes', 'Selected session duration'),
            ]
        ],
        'savedAt': week + 'T00:00:00Z',
    }
    with contextlib.closing(sqlite3.connect(run.database)) as db:
        db.execute(
            'insert into weekly_kpi_recipe(concept_id,version,recipe_json) values (?,?,?)',
            ('authored-sessions', 1, json.dumps(recipe)),
        )
        for index in [1, 2]:
            db.execute(
                'insert into activity(id,garmin_id,name,sport,started_at,duration_sec) values (?,?,?,?,?,?)',
                (
                    'T0336-' + str(index),
                    'T0336-' + str(index),
                    'Authored point measurement',
                    'hiking',
                    start + index * 60000,
                    4500,
                ),
            )
        db.commit()
        if (
            db.execute('pragma integrity_check').fetchone()[0] != 'ok'
            or db.execute('pragma foreign_key_check').fetchone()
        ):
            raise ValueError('Authored automatic-point copy integrity failed')


def exercise(run, provider, receipt):
    conversation = 'T0319-authored-' + str(uuid.uuid4())
    evidence = []
    receipt['outcomes'] = evidence
    receipt['conversation'] = conversation
    original = None
    for action, stream in [
        ('establish', False),
        ('adapt', True),
        ('assess', False),
        ('no-save', True),
        ('correct', False),
    ]:
        receipt['lastAction'] = action
        before = state(run, provider.week)
        prompt = (
            'Authored draft only; do not save.'
            if action == 'no-save'
            else 'Authored structured weekly ' + action + '.'
        )
        raw = api(
            run,
            'POST',
            '/api/chat',
            {
                'conversationId': conversation,
                'message': prompt,
                'timeZone': 'UTC',
                'stream': stream,
            },
        )
        expected = NO_SAVE if action == 'no-save' else ANSWER
        if stream:
            events = [json.loads(line) for line in raw.splitlines() if line]
            if (
                ''.join(e.get('textDelta', '') for e in events if e.get('type') == 'delta')
                != expected
                or any(e.get('type') == 'error' for e in events)
                or not any(e.get('type') == 'done' for e in events)
            ):
                raise ValueError('Actual NDJSON KPI answer failed')
        else:
            value = json.loads(raw)
            receipt['lastToolSteps'] = [
                {key: step.get(key) for key in ['tool', 'status', 'reason']}
                for step in value.get('toolSteps', [])
            ]
            if value['assistant']['content'] != expected or [
                (s['tool'], s['status']) for s in value['toolSteps']
            ] != [
                ('getWeeklyKpis', 'succeeded'),
                ('saveWeeklyDocuments' if action == 'correct' else 'saveWeeklyKpis', 'succeeded'),
            ]:
                raise ValueError('Actual JSON KPI tool sequence failed')
        if action == 'adapt':
            with contextlib.closing(readonly(run.database)) as db:
                grounding = json.loads(
                    db.execute(
                        "select grounding_json from message where conversation_id=? and role='assistant' order by created_at desc limit 1",
                        (conversation,),
                    ).fetchone()[0]
                )
            steps = grounding.get('toolSteps', [])
            if [(step['tool'], step['status']) for step in steps] != [
                ('getWeeklyKpis', 'rejected'),
                ('saveWeeklyDocuments', 'succeeded'),
            ] or steps[0].get('reason') != 'kpi_set_unavailable':
                raise ValueError(
                    'Actual independent read recovery did not precede the single normal save'
                )
            receipt['readCorrection'] = {
                'rejectedRead': 'kpi_set_unavailable',
                'deterministicCanonicalRecovery': True,
                'correctiveDiscoveryCall': False,
                'singleConfirmedSave': True,
                'transport': 'NDJSON',
            }
        saved = state(run, provider.week)
        points = json.loads(
            api(run, 'GET', '/api/weekly?weekStart=' + provider.week + '&timeZone=UTC')
        )['kpis']['points']
        if action in ['establish', 'adapt']:
            expected_points = 80 if action == 'establish' else 50
            if (
                saved['assessments']
                or points['total'] != expected_points
                or not points['automatic']
                or not points['provisional']
            ):
                raise ValueError(
                    'Post-save refresh did not publish common automatic points without manual Refresh'
                )
            if any(
                track.get('pointsRule') != {'kind': 'proportional'}
                for track in saved['sets'][-1]['items'][0]['tracks']
            ):
                raise ValueError('Adaptation dropped actual canonical rule metadata')
        elif action in ['assess', 'correct']:
            if points['automatic'] or points['total'] != (112.5 if action == 'assess' else 12.5):
                raise ValueError('Reviewed override did not win over measured automatic points')
        if action == 'establish':
            if not saved or saved['originalId'] != saved['latestId'] or saved['assessments']:
                raise ValueError('Initial structured commitment failed')
            original = saved['originalId']
        elif saved['originalId'] != original:
            raise ValueError('Original baseline changed')
        if action == 'adapt' and (saved['latestId'] == original or len(saved['sets']) != 2):
            raise ValueError('Adaptation identity failed')
        if action == 'assess' and (
            saved['assessments'][0]['setId'] != saved['latestId']
            or saved['assessments'][0]['totalPoints'] != 112.5
            or saved['assessments'][0]['items'][0]['actuals'][1]['value'] is not None
            or [
                actual.get('awardedPoints')
                for actual in saved['assessments'][0]['items'][0]['actuals']
            ]
            != [50, 50]
            or 'awardedPoints' in saved['assessments'][0]['items'][0]
            or [track.get('availablePoints') for track in saved['sets'][-1]['items'][0]['tracks']]
            != [50, 30]
            or 'availablePoints' in saved['sets'][-1]['items'][0]
        ):
            raise ValueError('Latest-plan above100/unknown per-measurement assessment failed')
        if action == 'no-save' and saved != before:
            raise ValueError('No-save changed structured state')
        if action == 'correct' and (
            saved['assessments'][0]['totalPoints'] != 12.5
            or saved['assessments'][0]['items'][0]['actuals'][0]['value'] != 0
            or len(saved['assessments']) != 1
            or saved['sets'] != before['sets']
        ):
            raise ValueError('Focused correction/reference preservation failed')
        with contextlib.closing(readonly(run.database)) as db:
            if db.execute('select count(*) from weekly_kpi_track').fetchone()[0] != 2:
                raise ValueError('Canonical identity reuse fragmented track inventory')
        if action == 'adapt' and [
            (
                item['conceptId'],
                item['label'],
                [
                    (track['key'], track['kind'], track['unit'], track['meaning'])
                    for track in item['tracks']
                ],
            )
            for item in saved['sets'][-1]['items']
        ] != [
            (
                item['conceptId'],
                item['label'],
                [
                    (track['key'], track['kind'], track['unit'], track['meaning'])
                    for track in item['tracks']
                ],
            )
            for item in before['sets'][-1]['items']
        ]:
            raise ValueError('Adaptation did not reuse discovered canonical identity/name/meaning')
        for saved_set in saved['sets']:
            if 'provenance' in saved_set or any(
                any(
                    key in item
                    for key in ['definition', 'selection', 'evidenceRequired', 'scoring']
                )
                for item in saved_set['items']
            ):
                raise ValueError('Redundant generation fields were not actually omitted')
        if any(
            'explanation' in result
            or any(
                'explanation' in item
                or 'qualification' in item['evidence']
                or 'limitations' in item['evidence']
                for item in result['items']
            )
            for result in saved['assessments']
        ):
            raise ValueError('Assessment omission contract failed')
        evidence.append(
            {
                'action': action,
                'tool': 'saveWeeklyDocuments'
                if action in ['adapt', 'correct']
                else 'saveWeeklyKpis'
                if action != 'no-save'
                else None,
                'transport': 'NDJSON' if stream else 'JSON',
                'http': 200,
                'storedOutcomeVerified': True,
                'redundantFieldsOmitted': True,
            }
        )
    for index, (action, expected) in enumerate(
        [
            ('ordinary-recovery', RECOVERED),
            ('missing-week', MISSING),
            ('explicit-unavailable-version', EXACT_MISSING),
        ]
    ):
        receipt['lastAction'] = action
        before = weekly_snapshot(run)
        raw = json.loads(
            api(
                run,
                'POST',
                '/api/chat',
                {
                    'conversationId': conversation,
                    'message': {
                        'ordinary-recovery': 'What are my saved KPI targets this week?',
                        'missing-week': 'What KPIs are saved three weeks from now?',
                        'explicit-unavailable-version': 'Read the exact saved unavailable-version, not another version.',
                    }[action],
                    'timeZone': 'UTC',
                    'stream': False,
                },
            )
        )
        steps = raw.get('toolSteps', [])
        if (
            raw['assistant']['content'] != expected
            or len(steps) != 1
            or steps[0]['tool'] != 'getWeeklyKpis'
            or steps[0]['status'] != 'rejected'
            or steps[0].get('reason') != 'kpi_set_unavailable'
        ):
            raise ValueError('Actual deterministic read-only recovery/absence failed')
        if weekly_snapshot(run) != before:
            raise ValueError(
                'Read recovery changed weekly documents, KPIs, recipes or measurements'
            )
        receipt['readOnlyWeeklyPersistence'] = True
        receipt['backSync'] = (
            'verified no-op on authored disposable state; no schema/data reinterpretation or primary access'
        )
        with contextlib.closing(readonly(run.database)) as db:
            counts = dict(
                db.execute(
                    'select role,count(*) from message where conversation_id=? group by role',
                    (conversation,),
                ).fetchall()
            )
        if counts != {'user': 6 + index, 'assistant': 6 + index}:
            raise ValueError('Recovery chat was not persisted exactly once')
        evidence.append(
            {
                'action': action,
                'transport': 'JSON',
                'http': 200,
                'readOnly': True,
                'correctiveDiscoveryCall': False,
                'exactlyOncePersistence': True,
            }
        )
    if len(provider.calls) != 19:
        raise ValueError('Unexpected authored provider call count')
    return (
        conversation,
        evidence,
        hashlib.sha256(json.dumps(state(run, provider.week), sort_keys=True).encode()).hexdigest(),
    )


@resources.invocation
def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--scratch', required=True)
    parser.add_argument('--bundle', required=True)
    parser.add_argument(
        '--release-record',
        type=Path,
        help='Selected final DMG record; original bundle admission remains required',
    )
    parser.set_defaults(
        task_id='T0319', input_file=None, grant_file=None, provenance_file=None, anchor=None
    )
    args = parser.parse_args()
    os.umask(0o077)
    scratch = private_directory(resources.configure(canonical(args.scratch)))
    prepared = prepare(scratch, args, 'ordinary')
    bundle = canonical(args.bundle)
    source = source_identity()
    run = provider = observer = None
    receipt = {
        'scenario': 'T0376-deterministic-canonical-recovery-missing-exact-version-read-only-and-protected-save-native-chat',
        'passed': False,
        'privateInputs': 'none',
        'realServices': 'not exercised; finite authored provider',
        'screenshot': 'N/A for HTTP/tool proof; actual weekly/Progress presentation is separately captured by smoke:weekly-kpis',
        'cleanup': 'Only task-attributed run-copy chats/KPIs; original input unchanged, no primary access/copy-back.',
    }
    with candidate_preparation(REPO, bundle, source, scratch, args.release_record) as (
        bundle,
        verify_current,
        verified,
        inventory,
        release_record,
    ):
        try:
            run = OrdinaryRun(
                scratch,
                prepared.database,
                source,
                bundle,
                inventory,
                verified=verified,
                macos_metadata=bool(release_record),
            )

            def before_start():
                prepared.verify_current()
                verify_current()

            run.before_start = before_start
            receipt['releaseTransport'] = release_record
            receipt.update(
                {
                    'source': source,
                    'artifactInventoryHash': inventory_hash(inventory),
                    'runId': run.id,
                }
            )
            provider = AuthoredProvider(weekly_kpis=True, scratch=scratch)
            today = datetime.datetime.now(datetime.timezone.utc).date()
            provider.week = (today - datetime.timedelta(days=today.weekday())).isoformat()
            seed_run(run, provider)
            seed_auto_measurements(run, provider.week)
            observer = Observer(scratch, preparation_locked=True)
            run.observer = observer
            run.start(run.binary)
            conversation, outcomes, expected = exercise(run, provider, receipt)
            old_boot = run.boot
            run.stop()
            run.start(run.binary)
            if (
                run.boot == old_boot
                or hashlib.sha256(
                    json.dumps(state(run, provider.week), sort_keys=True).encode()
                ).hexdigest()
                != expected
            ):
                raise ValueError('Actual native restart persistence failed')
            with contextlib.closing(readonly(run.database)) as db:
                history = db.execute(
                    'select role,content from message where conversation_id=? order by created_at',
                    (conversation,),
                ).fetchall()
            if (
                len(history) != 16
                or sum(role == 'assistant' for role, _ in history) != 8
                or history[-1][1] != EXACT_MISSING
            ):
                raise ValueError('Recovery history restart persistence failed')
            if len(provider.calls) != 19:
                raise ValueError('Restart replayed a provider call')
            receipt['exactlyOnceHistoryRestart'] = True
            if (
                source_identity() != source
                or audit(bundle) != inventory
                or audit(run.bundle) != inventory
            ):
                raise ValueError('Source/artifact changed')
            receipt.update(
                {
                    'source': source,
                    'artifactInventoryHash': inventory_hash(inventory),
                    'runId': run.id,
                    'conversation': conversation,
                    'outcomes': outcomes,
                    'calls': provider.calls,
                    'restartPersistence': True,
                    'passed': True,
                }
            )
        finally:
            with resources.preserve_failure():
                errors = []
                for owner in [run, provider]:
                    if owner:
                        try:
                            owner.stop()
                        except Exception as error:
                            errors.append(type(error).__name__ + ': owned shutdown failed')
                if observer:
                    receipt['noninterference'] = observer.stop(run.pids)
                prepared.verify_current()
                receipt['inputUnchanged'] = True
                receipt['calls'] = provider.calls if provider else []
                receipt['shutdownErrors'] = errors
                receipt['passed'] = receipt['passed'] and not errors
                path = scratch / ('kpi-chat-receipt-' + str(uuid.uuid4()) + '.json')
                private_json(path, receipt)
                print(json.dumps({'passed': receipt['passed'], 'receipt': str(path)}))
                if not receipt['passed']:
                    raise RuntimeError(
                        'Authored native KPI chat failed; original evidence retained'
                    )


if __name__ == '__main__':

    def interrupted(_signal, _frame):
        raise KeyboardInterrupt('Owned native KPI chat interrupted')

    signal.signal(signal.SIGTERM, interrupted)
    main()
