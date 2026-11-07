"""Finite authored Terrain through actual storage/API/analyzer and ordinary native UI."""
import argparse
import contextlib
import json
import os
from pathlib import Path
import signal
import subprocess
import time
import uuid
import smoke_resources as resources
from native_smoke import REPO, Observer, canonical, fingerprint, private_json, readonly, source_identity
from ordinary_smoke import OrdinaryRun, private_directory
from ordinary_identity import ordinary_preparation, inventory_hash
from release_smoke import audit


def terrain_wait(run, predicate, label):
    deadline = time.monotonic() + 8
    while time.monotonic() < deadline:
        result = run.command({'type': 'terrain', 'action': 'observe'})
        if predicate(result):
            return result
        time.sleep(.1)  # Read-only bounded readiness; never repeat an action.
    private_json(run.root / ('terrain-failure-' + str(uuid.uuid4()) + '.json'), {'assertion': label, 'observation': result})
    raise TimeoutError('Terrain readiness: ' + label)


def scenario(run):
    captures = []
    run.command({'type': 'click', 'target': 'Activities'})
    run.wait(lambda value: value['view'] == 'Activities', 'Activities')
    terrain_wait(run, lambda value: value['choicesReady'], 'authored choices')
    for variant in ['supported', 'partial', 'capped']:
        run.command({'type': 'setViewport', 'preset': 'wide'})
        run.command({'type': 'terrain', 'action': variant})
        result = terrain_wait(run, lambda value: value['ready'], variant)
        if result['selected'] or result['highlighted'] or not result['compact']:
            raise ValueError('Terrain activity reset/compactness failed')
        run.command({'type': 'terrain', 'action': 'start'})
        run.command({'type': 'terrain', 'action': 'toggle'})
        terrain_wait(run, lambda value: value['selected'] and value['highlighted'], 'row/elevation selected')
        run.command({'type': 'terrain', 'action': 'toggle'})
        terrain_wait(run, lambda value: not value['selected'] and not value['highlighted'], 'row/elevation toggled off')
        # Leave selected for the next activity reset proof.
        run.command({'type': 'terrain', 'action': 'toggle'})
        terrain_wait(run, lambda value: value['selected'] and value['highlighted'], 'selected before reset')
        run.command({'type': 'terrain', 'action': 'collapse'})
        for preset, edge in [('wide', 'start'), ('medium', 'start'), ('narrow', 'start'), ('narrow', 'end')]:
            run.command({'type': 'setViewport', 'preset': preset})
            observed = run.command({'type': 'terrain', 'action': edge})
            image = run.command({'type': 'captureView', 'view': 'terrain', 'preset': preset})
            entry = {'variant': variant, 'preset': preset, 'edge': edge, 'observation': observed, **image}
            captures.append(entry)
            private_json(run.root / ('terrain-' + variant + '-' + preset + '-' + edge + '.json'), entry)
            if not all(observed[key] for key in ['ready', 'compact', 'contained', 'paragraphVisible', 'headerVisible', 'gridValues', 'singleLine', 'gapVisible', 'edgeReached']):
                raise ValueError('Terrain geometry gate failed; original capture retained')
            if preset != 'narrow' and observed['tableWidth'] > observed['contentWidth'] + 1:
                raise ValueError('Terrain desktop fit failed; original capture retained')
            if observed['partial'] != (variant != 'supported') or observed['capped'] != (variant == 'capped'):
                raise ValueError('Terrain quality/cap presentation failed')
        run.command({'type': 'terrain', 'action': 'expand'})
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
        allocation = resources.directory(resources.runtime_path(scratch / ('terrain-seed-' + str(uuid.uuid4()))))
        name = 'ci-seed-' + str(uuid.uuid4())
        subprocess.run(['npm', 'run', 'ci:seed', '--', str(allocation), name, '--terrain'], cwd=REPO, check=True, timeout=60)
        database = allocation / name / 'synthetic.sqlite'
        resources.file_created(database)
        run = OrdinaryRun(scratch, database, source, bundle, inventory, verified=verified)
        observer = None
        errors = []
        receipt = {'source': source, 'scenario': 'T0294-authored-terrain-grid', 'artifactKind': 'ordinary', 'artifactInventoryHash': inventory_hash(inventory), 'passed': False, 'run': str(run.root), 'privateInputs': 'none; three authored hikes, 1227 normalized points, no GPS', 'providerAndGarmin': 'not invoked', 'limits': 'Actual unmodified ordinary isolated WebView; exact synthetic projected grid/paragraph/headers/controls/notes revealed only after full matrix validation, unrelated adjacent UI hidden at unchanged geometry. Real selector collapsed for 1280/1024/420 fit captures. Synthetic DOM actions, not trusted input/default-window or real-service proof.', 'resourceDisposition': resources.disposition()}
        try:
            observer = Observer(scratch, preparation_locked=True)
            run.observer = observer
            run.start(run.binary)
            receipt['captures'] = scenario(run)
            if source_identity() != source or audit(bundle) != inventory or audit(run.bundle) != inventory:
                raise ValueError('Source/artifact changed during Terrain smoke')
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
                path = scratch / ('terrain-receipt-' + str(uuid.uuid4()) + '.json')
                private_json(path, receipt)
                print(json.dumps({'passed': receipt['passed'], 'receipt': str(path), 'source': source, 'runId': run.id}))
                if not receipt['passed']:
                    raise RuntimeError('Terrain smoke failed; evidence retained, no fallback or blind retry')


if __name__ == '__main__':
    def interrupted(_signal, _frame):
        raise KeyboardInterrupt('Owned Terrain smoke interrupted')
    signal.signal(signal.SIGTERM, interrupted)
    main()
