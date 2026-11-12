"""Actual native-owned JSON/NDJSON structured KPI saves with a finite authored provider."""
import argparse
import contextlib
import datetime
import hashlib
import json
import os
import signal
import uuid
import smoke_resources as resources
from chat_smoke import AuthoredProvider, api, seed_run
from weekly_kpi_provider import ANSWER, NO_SAVE
from native_smoke import REPO, Observer, canonical, private_json, readonly, source_identity
from ordinary_identity import ordinary_preparation, inventory_hash
from ordinary_smoke import OrdinaryRun, private_directory
from release_smoke import audit
from smoke_input import prepare


def state(run, week):
    with contextlib.closing(readonly(run.database)) as db:
        row = db.execute('select state_json from weekly_kpi where week_start=?', (week,)).fetchone()
        return json.loads(row[0]) if row else None


def exercise(run, provider, receipt):
    conversation = 'T0319-authored-' + str(uuid.uuid4())
    evidence = []
    receipt['outcomes'] = evidence
    receipt['conversation'] = conversation
    original = None
    for action, stream in [('establish', False), ('adapt', True), ('assess', False), ('no-save', True), ('correct', False)]:
        receipt['lastAction'] = action
        before = state(run, provider.week)
        prompt = 'Authored draft only; do not save.' if action == 'no-save' else 'Authored structured weekly ' + action + '.'
        raw = api(run, 'POST', '/api/chat', {'conversationId': conversation, 'message': prompt, 'timeZone': 'UTC', 'stream': stream})
        expected = NO_SAVE if action == 'no-save' else ANSWER
        if stream:
            events = [json.loads(line) for line in raw.splitlines() if line]
            if ''.join(e.get('textDelta', '') for e in events if e.get('type') == 'delta') != expected or any(e.get('type') == 'error' for e in events) or not any(e.get('type') == 'done' for e in events):
                raise ValueError('Actual NDJSON KPI answer failed')
        else:
            value = json.loads(raw)
            receipt['lastToolSteps'] = [{key: step.get(key) for key in ['tool', 'status', 'reason']} for step in value.get('toolSteps', [])]
            if value['assistant']['content'] != expected or [(s['tool'], s['status']) for s in value['toolSteps']] != [('getWeeklyKpis', 'succeeded'), ('saveWeeklyDocuments' if action == 'correct' else 'saveWeeklyKpis', 'succeeded')]:
                raise ValueError('Actual JSON KPI tool sequence failed')
        saved = state(run, provider.week)
        if action == 'establish':
            if not saved or saved['originalId'] != saved['latestId'] or saved['assessments']:
                raise ValueError('Initial structured commitment failed')
            original = saved['originalId']
        elif saved['originalId'] != original:
            raise ValueError('Original baseline changed')
        if action == 'adapt' and (saved['latestId'] == original or len(saved['sets']) != 2):
            raise ValueError('Adaptation identity failed')
        if action == 'assess' and (saved['assessments'][0]['setId'] != saved['latestId'] or saved['assessments'][0]['totalPoints'] != 112.5 or saved['assessments'][0]['items'][0]['actuals'][1]['value'] is not None or [actual.get('awardedPoints') for actual in saved['assessments'][0]['items'][0]['actuals']] != [50, 50] or 'awardedPoints' in saved['assessments'][0]['items'][0] or [track.get('availablePoints') for track in saved['sets'][-1]['items'][0]['tracks']] != [50, 30] or 'availablePoints' in saved['sets'][-1]['items'][0]):
            raise ValueError('Latest-plan above100/unknown per-measurement assessment failed')
        if action == 'no-save' and saved != before:
            raise ValueError('No-save changed structured state')
        if action == 'correct' and (saved['assessments'][0]['totalPoints'] != 25 or saved['assessments'][0]['items'][0]['actuals'][0]['value'] != 0 or len(saved['assessments']) != 1 or saved['sets'] != before['sets']):
            raise ValueError('Focused correction/reference preservation failed')
        with contextlib.closing(readonly(run.database)) as db:
            if db.execute('select count(*) from weekly_kpi_track').fetchone()[0] != 2:
                raise ValueError('Canonical identity reuse fragmented track inventory')
        if action == 'adapt' and [(item['conceptId'], item['label'], [(track['key'], track['kind'], track['unit'], track['meaning']) for track in item['tracks']]) for item in saved['sets'][-1]['items']] != [(item['conceptId'], item['label'], [(track['key'], track['kind'], track['unit'], track['meaning']) for track in item['tracks']]) for item in before['sets'][-1]['items']]:
            raise ValueError('Adaptation did not reuse discovered canonical identity/name/meaning')
        for saved_set in saved['sets']:
            if 'provenance' in saved_set or any(any(key in item for key in ['definition', 'selection', 'evidenceRequired', 'scoring']) for item in saved_set['items']):
                raise ValueError('Redundant generation fields were not actually omitted')
        if any('explanation' in result or any('explanation' in item or 'qualification' in item['evidence'] or 'limitations' in item['evidence'] for item in result['items']) for result in saved['assessments']):
            raise ValueError('Assessment omission contract failed')
        evidence.append({'action': action, 'tool': 'saveWeeklyDocuments' if action in ['adapt', 'correct'] else 'saveWeeklyKpis' if action != 'no-save' else None, 'transport': 'NDJSON' if stream else 'JSON', 'http': 200, 'storedOutcomeVerified': True, 'redundantFieldsOmitted': True})
    if len(provider.calls) != 13:
        raise ValueError('Unexpected authored provider call count')
    return conversation, evidence, hashlib.sha256(json.dumps(state(run, provider.week), sort_keys=True).encode()).hexdigest()


@resources.invocation
def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--scratch', required=True)
    parser.add_argument('--bundle', required=True)
    parser.set_defaults(task_id='T0319', input_file=None, grant_file=None, provenance_file=None, anchor=None)
    args = parser.parse_args()
    os.umask(0o077)
    scratch = private_directory(resources.configure(canonical(args.scratch)))
    prepared = prepare(scratch, args, 'ordinary')
    bundle = canonical(args.bundle)
    source = source_identity()
    run = provider = observer = None
    receipt = {'scenario': 'T0324-minimal-focused-combined-KPI-native-chat', 'passed': False, 'privateInputs': 'none', 'realServices': 'not exercised; finite authored provider', 'screenshot': 'N/A for HTTP/tool proof; actual weekly/Progress presentation is separately captured by smoke:weekly-kpis', 'cleanup': 'Only task-attributed run-copy chats/KPIs; original input unchanged, no primary access/copy-back.'}
    with ordinary_preparation(REPO, bundle, source, scratch) as (verified, inventory):
        try:
            run = OrdinaryRun(scratch, prepared.database, source, bundle, inventory, verified=verified)
            run.before_start = prepared.verify_current
            receipt.update({'source': source, 'artifactInventoryHash': inventory_hash(inventory), 'runId': run.id})
            provider = AuthoredProvider(weekly_kpis=True, scratch=scratch)
            today = datetime.datetime.now(datetime.timezone.utc).date()
            provider.week = (today - datetime.timedelta(days=today.weekday())).isoformat()
            seed_run(run, provider)
            observer = Observer(scratch, preparation_locked=True)
            run.observer = observer
            run.start(run.binary)
            conversation, outcomes, expected = exercise(run, provider, receipt)
            old_boot = run.boot
            run.stop(); run.start(run.binary)
            if run.boot == old_boot or hashlib.sha256(json.dumps(state(run, provider.week), sort_keys=True).encode()).hexdigest() != expected:
                raise ValueError('Actual native restart persistence failed')
            if source_identity() != source or audit(bundle) != inventory or audit(run.bundle) != inventory:
                raise ValueError('Source/artifact changed')
            receipt.update({'source': source, 'artifactInventoryHash': inventory_hash(inventory), 'runId': run.id, 'conversation': conversation, 'outcomes': outcomes, 'calls': provider.calls, 'restartPersistence': True, 'passed': True})
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
                    raise RuntimeError('Authored native KPI chat failed; original evidence retained')


if __name__ == '__main__':
    def interrupted(_signal, _frame):
        raise KeyboardInterrupt('Owned native KPI chat interrupted')
    signal.signal(signal.SIGTERM, interrupted)
    main()
