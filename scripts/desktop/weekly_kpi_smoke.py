"""Finite authored weekly KPI/Progress proof in an isolated ordinary artifact."""
import argparse
import contextlib
import datetime
import hashlib
import json
import os
import signal
import subprocess
import time
import uuid
import smoke_resources as resources
from native_smoke import REPO, Observer, canonical, fingerprint, private_json, readonly, source_identity
from ordinary_smoke import OrdinaryRun, private_directory
from ordinary_identity import ordinary_preparation, inventory_hash
from release_smoke import audit


def saved_hash(database):
    with contextlib.closing(readonly(database)) as db:
        rows = db.execute('select week_start,state_json from weekly_kpi order by week_start').fetchall()
    return hashlib.sha256(json.dumps(rows).encode()).hexdigest()


def current_week():
    today = datetime.date.today()
    return (today - datetime.timedelta(days=today.weekday())).isoformat()


def measured(database, week):
    with contextlib.closing(readonly(database)) as db:
        row = db.execute('select state_json from weekly_kpi_measurement where week_start=?', (week,)).fetchone()
    return json.loads(row[0]) if row else None


def refresh_proof(run, week):
    """T0328: one explicit current-week Refresh recomputes stored actuals from the
    authored activities in a real bounded child; reviewed KPI bytes stay unchanged."""
    if measured(run.database, week) is not None:
        raise ValueError('Authored seed must not contain a stored measurement')
    before = saved_hash(run.database)
    run.command({'type': 'setViewport', 'preset': 'wide'})
    run.command({'type': 'weeklyKpis', 'action': 'progress'})
    wait_kpis(run, True)
    run.command({'type': 'weeklyKpis', 'action': 'refresh'})  # Effect unknown on timeout; never retried.
    deadline = time.monotonic() + 15
    state = None
    while time.monotonic() < deadline:
        state = measured(run.database, week)
        if state:
            break
        time.sleep(.2)  # Read-only observation of the one requested refresh.
    success = (state or {}).get('concepts', {}).get('authored-sessions', {}).get('success') or {}
    if success.get('values') != {'count': 2, 'duration': 150} or success.get('status') != 'measured' or success.get('recipeVersion') != 1:
        raise ValueError('Current-week Refresh did not publish the authored measured actuals')
    if saved_hash(run.database) != before:
        raise ValueError('Refresh changed reviewed KPI state')
    wait_kpis(run, True)
    captures = []
    for preset in ['wide', 'narrow']:
        run.command({'type': 'setViewport', 'preset': preset})
        wait_kpis(run, True)
        for edge in ['frame', 'middle']:
            observed = run.command({'type': 'weeklyKpis', 'action': edge})
            image = run.command({'type': 'captureView', 'view': 'weeklyKpis', 'preset': preset})
            captures.append({'view': 'refreshed', 'preset': preset, 'edge': edge, 'observation': observed, **image})
            if not (observed['contained'] and observed['allCharts'] and observed['chartsSized'] and observed['rangeCorrect']):
                raise ValueError('Refreshed Progress geometry/all-chart proof failed; inspect retained capture')
    run.command({'type': 'setViewport', 'preset': 'wide'})
    run.command({'type': 'weeklyKpis', 'action': 'current'})
    wait_kpis(run)
    for preset in ['wide', 'narrow']:
        run.command({'type': 'setViewport', 'preset': preset})
        wait_kpis(run)
        observed = run.command({'type': 'weeklyKpis', 'action': 'frame'})
        image = run.command({'type': 'captureView', 'view': 'weeklyKpis', 'preset': preset})
        captures.append({'view': 'refreshed-grid', 'preset': preset, 'edge': 'frame', 'observation': observed, **image})
        if not (observed['contained'] and observed['notesCorrect']):
            raise ValueError('Refreshed grid geometry/notes proof failed; inspect retained capture')
    run.command({'type': 'setViewport', 'preset': 'wide'})
    return captures, {'recipeVersion': 1, 'values': success['values'], 'reviewedKpisUnchanged': True}


def wait_kpis(run, progress=False):
    deadline = time.monotonic() + 8
    value = None
    while time.monotonic() < deadline:
        value = run.command({'type': 'weeklyKpis', 'action': 'observe'})
        if value['ready'] and value['progress'] == progress:
            return value
        time.sleep(.1)  # Read-only readiness only; no mutation retry.
    private_json(run.root / ('kpi-failure-' + str(uuid.uuid4()) + '.json'), {'observation': value})
    raise TimeoutError('Weekly KPI rendered readiness')


def scenario(run):
    captures = []
    run.command({'type': 'click', 'target': 'Training Plan'})
    observed = wait_kpis(run)
    if not observed['aboveHundred'] or not observed['unknown']:
        raise ValueError('Saved above100/unknown facts missing')
    for view in ['current', 'next', 'previous', 'progress', 'oneMonth', 'threeMonths', 'twelveMonths']:
        progress_view = view in ['progress', 'oneMonth', 'threeMonths', 'twelveMonths']
        if view != 'current':
            run.command({'type': 'weeklyKpis', 'action': view})
            wait_kpis(run, progress_view)
        presets = ['wide', 'narrow', 'wide-short', 'narrow-short', 'wide', 'narrow'] if view == 'progress' else ['wide', 'narrow']
        for index, preset in enumerate(presets):
            run.command({'type': 'setViewport', 'preset': preset})
            wait_kpis(run, progress_view)
            # Revisit both normal heights after the short viewports. Capture the
            # real end again, not just a pane that fits inside a larger window.
            edges = ['bottom'] if progress_view and index >= 4 else ['frame', 'middle', 'bottom'] if progress_view else ['frame', 'notes']
            for edge in edges:
                observed = run.command({'type': 'weeklyKpis', 'action': edge})
                image = run.command({'type': 'captureView', 'view': 'weeklyKpis', 'preset': preset})
                captures.append({'view': view, 'preset': preset, 'edge': edge, 'observation': observed, **image})
                valid = observed['contained'] and (observed['allCharts'] and observed['chartsSized'] and observed['rangeCorrect'] and observed['gaps'] if progress_view else observed['notesCorrect'])
                if not valid or (edge == 'bottom' and not observed['bottomVisible']):
                    raise ValueError('Weekly KPI geometry/notes/all-chart/bottom proof failed; inspect retained capture')
    # Internal navigation and fresh explicit entry preserve existing routing.
    run.command({'type': 'setViewport', 'preset': 'wide'})
    run.command({'type': 'weeklyKpis', 'action': 'current'})
    wait_kpis(run)
    run.command({'type': 'weeklyKpis', 'action': 'progress'})
    wait_kpis(run, True)
    run.command({'type': 'click', 'target': 'Back to chat'})
    run.wait(lambda value: value['view'] == 'Trainer', 'Trainer before weekly reentry')
    run.command({'type': 'click', 'target': 'Training Plan'})
    wait_kpis(run)
    return captures


@resources.invocation
def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--scratch', required=True)
    parser.add_argument('--bundle', required=True)
    args = parser.parse_args()
    os.umask(0o077)
    scratch = private_directory(resources.configure(canonical(args.scratch)))
    bundle = canonical(args.bundle)
    source = source_identity()
    with ordinary_preparation(REPO, bundle, source, scratch) as (verified, inventory):
        allocation = resources.directory(resources.runtime_path(scratch / ('kpi-seed-' + str(uuid.uuid4()))))
        name = 'ci-seed-' + str(uuid.uuid4())
        subprocess.run(['npm', 'run', 'ci:seed', '--', str(allocation), name, '--weekly-kpis'], cwd=REPO, check=True, timeout=60)
        database = allocation / name / 'synthetic.sqlite'
        resources.file_created(database)
        run = OrdinaryRun(scratch, database, source, bundle, inventory, verified=verified)
        expected = saved_hash(run.database)
        observer = None
        errors = []
        receipt = {'source': source, 'scenario': 'T0328-measured-refresh-independent-points-preset-periods-real-pane-bottom', 'artifactKind': 'ordinary', 'artifactInventoryHash': inventory_hash(inventory), 'passed': False, 'run': str(run.root), 'privateInputs': 'none; independently authored KPI state', 'providerAndGarmin': 'not invoked', 'limits': 'Actual isolated ordinary WebView; only exact authored/static KPI text revealed at actual geometry. One synthetic DOM Refresh click runs the real bounded recipe child on the run copy. Synthetic DOM input, not trusted input, real trainer/provider recipe writes or production migration.', 'resourceDisposition': resources.disposition()}
        try:
            observer = Observer(scratch, preparation_locked=True)
            run.observer = observer
            run.start(run.binary)
            receipt['captures'] = scenario(run)
            week = current_week()
            refreshed, receipt['refresh'] = refresh_proof(run, week)
            receipt['captures'] += refreshed
            expected = saved_hash(run.database)
            expected_measured = measured(run.database, week)
            run.command({'type': 'setViewport', 'preset': 'wide'})
            run.command({'type': 'click', 'target': 'Back to chat'})
            run.wait(lambda value: value['view'] == 'Trainer', 'Trainer before owned Profile restart proof')
            sentinel = run.profile_scenario(capture=False)
            run.verify_restart(run.binary, sentinel)
            run.command({'type': 'click', 'target': 'Close Profile & data'})
            run.command({'type': 'click', 'target': 'Training Plan'})
            wait_kpis(run)
            receipt['restartPersisted'] = saved_hash(run.database) == expected and measured(run.database, week) == expected_measured
            if not receipt['restartPersisted'] or source_identity() != source or audit(bundle) != inventory or audit(run.bundle) != inventory:
                raise ValueError('KPI state/source/artifact changed during smoke')
            receipt['readOnlyViewsPreservedKpis'] = True
            receipt['passed'] = True
        finally:
            with resources.preserve_failure():
                try:
                    run.stop()
                except Exception as error:
                    errors.append(type(error).__name__ + ': owned shutdown failed')
                if observer:
                    try:
                        receipt['noninterference'] = observer.stop(run.pids)
                    except Exception as error:
                        errors.append(type(error).__name__ + ': observer failed')
                with contextlib.closing(readonly(database)) as original:
                    receipt['syntheticInputUnchanged'] = fingerprint(original) == run.original
                receipt['shutdownErrors'] = errors
                receipt['passed'] = receipt['passed'] and not errors and receipt['syntheticInputUnchanged']
                path = scratch / ('kpi-receipt-' + str(uuid.uuid4()) + '.json')
                private_json(path, receipt)
                print(json.dumps({'passed': receipt['passed'], 'receipt': str(path), 'source': source, 'runId': run.id}))
                if not receipt['passed']:
                    raise RuntimeError('Weekly KPI smoke failed; evidence retained')


if __name__ == '__main__':
    def interrupted(_signal, _frame):
        raise KeyboardInterrupt('Owned weekly KPI smoke interrupted')
    signal.signal(signal.SIGTERM, interrupted)
    main()
