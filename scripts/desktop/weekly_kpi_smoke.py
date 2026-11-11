"""Finite authored weekly KPI/Progress proof in an isolated ordinary artifact."""
import argparse
import contextlib
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
    for view in ['current', 'previous', 'progress', 'measurement']:
        progress_view = view in ['progress', 'measurement']
        if view != 'current':
            run.command({'type': 'weeklyKpis', 'action': view})
            wait_kpis(run, progress_view)
        for preset in ['wide', 'narrow']:
            run.command({'type': 'setViewport', 'preset': preset})
            observed = wait_kpis(run, progress_view)
            run.command({'type': 'weeklyKpis', 'action': 'frame'})
            image = run.command({'type': 'captureView', 'view': 'weeklyKpis', 'preset': preset})
            captures.append({'view': view, 'preset': preset, 'observation': observed, **image})
            if not observed['contained'] or (progress_view and not observed['gaps']):
                raise ValueError('Weekly KPI geometry/gap proof failed; inspect retained capture')
    run.command({'type': 'weeklyKpis', 'action': 'reload'})
    wait_kpis(run, True)
    # Explicit entry must reset the retained Progress selection without a restart.
    # Reload above remains in-view and must not reset it. Use desktop navigation:
    # narrow Trainer exposes Training Plan through the mobile menu instead.
    run.command({'type': 'setViewport', 'preset': 'wide'})
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
        receipt = {'source': source, 'scenario': 'T0321-latest-plan-grid-achievement-continuity', 'artifactKind': 'ordinary', 'artifactInventoryHash': inventory_hash(inventory), 'passed': False, 'run': str(run.root), 'privateInputs': 'none; independently authored KPI state', 'providerAndGarmin': 'not invoked', 'limits': 'Actual isolated ordinary WebView; only exact authored/static KPI text revealed at actual geometry. Synthetic DOM input, not trusted input, real trainer/provider writes or production migration.', 'resourceDisposition': resources.disposition()}
        try:
            observer = Observer(scratch, preparation_locked=True)
            run.observer = observer
            run.start(run.binary)
            receipt['captures'] = scenario(run)
            run.command({'type': 'setViewport', 'preset': 'wide'})
            run.command({'type': 'click', 'target': 'Back to chat'})
            run.wait(lambda value: value['view'] == 'Trainer', 'Trainer before owned Profile restart proof')
            sentinel = run.profile_scenario(capture=False)
            run.verify_restart(run.binary, sentinel)
            run.command({'type': 'click', 'target': 'Close Profile & data'})
            run.command({'type': 'click', 'target': 'Training Plan'})
            wait_kpis(run)
            receipt['restartPersisted'] = saved_hash(run.database) == expected
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
