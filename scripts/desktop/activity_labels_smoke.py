"""Finite authored Activity type labels in the actual isolated ordinary WebView."""
import argparse
import contextlib
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


def wait_labels(run, key):
    deadline = time.monotonic() + 8
    while time.monotonic() < deadline:
        value = run.command({'type': 'activityLabels', 'action': 'observe'})
        if value[key]:
            return value
        time.sleep(.1)  # Read-only polling only.
    private_json(run.root / ('labels-failure-' + str(uuid.uuid4()) + '.json'), {'key': key, 'observation': value})
    raise TimeoutError('Activity labels readiness: ' + key)


def scenario(run):
    captures = []
    run.command({'type': 'click', 'target': 'Activities'})
    run.wait(lambda value: value['view'] == 'Activities', 'Activities')
    wait_labels(run, 'choicesReady')
    for variant in ['strength', 'gravel', 'hiking']:
        run.command({'type': 'setViewport', 'preset': 'wide'})
        run.command({'type': 'activityLabels', 'action': variant})
        wait_labels(run, 'ready')
        for preset in ['wide', 'narrow']:
            run.command({'type': 'setViewport', 'preset': preset})
            run.command({'type': 'activityLabels', 'action': 'list'})
            observed = wait_labels(run, 'ready')
            image = run.command({'type': 'captureView', 'view': 'activityLabels', 'preset': preset})
            entry = {'variant': variant, 'preset': preset, 'observation': observed, **image}
            captures.append(entry)
            private_json(run.root / ('labels-' + variant + '-' + preset + '.json'), entry)
            if not observed['contained']:
                raise ValueError('Activity labels overflow; capture retained')
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
        allocation = resources.directory(resources.runtime_path(scratch / ('labels-seed-' + str(uuid.uuid4()))))
        name = 'ci-seed-' + str(uuid.uuid4())
        subprocess.run(['npm', 'run', 'ci:seed', '--', str(allocation), name, '--activity-labels'], cwd=REPO, check=True, timeout=60)
        database = allocation / name / 'synthetic.sqlite'
        resources.file_created(database)
        run = OrdinaryRun(scratch, database, source, bundle, inventory, verified=verified)
        observer = None
        errors = []
        receipt = {'source': source, 'scenario': 'T0295-authored-labels', 'artifactKind': 'ordinary', 'artifactInventoryHash': inventory_hash(inventory), 'passed': False, 'run': str(run.root), 'privateInputs': 'none; three authored activities', 'providerAndGarmin': 'not invoked', 'limits': 'Actual isolated ordinary WebView; only exact synthetic labels revealed at actual geometry. Synthetic DOM actions, not trusted input/default-window or real-service proof.', 'resourceDisposition': resources.disposition()}
        try:
            observer = Observer(scratch, preparation_locked=True)
            run.observer = observer
            run.start(run.binary)
            receipt['captures'] = scenario(run)
            if source_identity() != source or audit(bundle) != inventory or audit(run.bundle) != inventory:
                raise ValueError('Source/artifact changed during Activity labels smoke')
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
                path = scratch / ('labels-receipt-' + str(uuid.uuid4()) + '.json')
                private_json(path, receipt)
                print(json.dumps({'passed': receipt['passed'], 'receipt': str(path), 'source': source, 'runId': run.id}))
                if not receipt['passed']:
                    raise RuntimeError('Activity labels smoke failed; evidence retained')


if __name__ == '__main__':
    def interrupted(_signal, _frame):
        raise KeyboardInterrupt('Owned Activity labels smoke interrupted')
    signal.signal(signal.SIGTERM, interrupted)
    main()
