"""Finite synthetic Markdown tables in one unmodified ordinary native artifact; no private inputs."""
import argparse
import contextlib
import json
import os
from pathlib import Path
import signal
import subprocess
import uuid

from native_smoke import REPO, Observer, fingerprint, private_json, readonly, source_identity
from ordinary_smoke import OrdinaryRun, inventory_hash, private_directory
from release_smoke import audit


def scenario(run, scratch):
    captures = []
    for surface in ['chat', 'chat-simple', 'plan', 'review']:
        run.command({'type': 'setViewport', 'preset': 'wide'})
        if surface == 'plan':
            run.command({'type': 'click', 'target': 'Training Plan'})
        expected = 'Trainer' if surface.startswith('chat') else 'Training Plan'
        run.wait(lambda value: value['view'] == expected and value.get('tablesReady'), 'synthetic tables ' + surface)
        for preset, edge in [('wide', 'start'), ('narrow', 'start'), ('narrow', 'end')]:
            run.command({'type': 'setViewport', 'preset': preset})
            observation = run.command({'type': 'tables', 'surface': surface, 'edge': edge})
            image = run.command({'type': 'captureView', 'view': 'tables', 'preset': preset})
            # Keep actual native capture and an exclusive canonical task screenshots copy.
            source = Path(image['capture'])
            if source.parent != run.root / 'screenshots' or source.is_symlink() or source.stat().st_size > 4 * 1024 * 1024:
                raise ValueError('Capture ownership/bound refused')
            destination = scratch / 'screenshots' / (surface + '-' + preset + '-' + edge + '-' + str(uuid.uuid4()) + '.png')
            with destination.open('xb') as output:
                output.write(source.read_bytes())
            entry = {'surface': surface, 'preset': preset, 'edge': edge, 'capture': str(destination), 'nativeCapture': image['capture'], 'observation': observation}
            captures.append(entry)
            private_json(run.root / ('table-capture-' + surface + '-' + preset + '-' + edge + '.json'), entry)
            if not all(observation[key] for key in ['compact', 'proseWrapped', 'contained', 'edgeReached', 'allCells', 'headerVisible']):
                raise ValueError('Table geometry gate failed; inspect original capture and bounded receipt')
            if preset == 'narrow' and not observation['scrollable']:
                raise ValueError('Expected table-contained narrow scroll')
    return captures


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--scratch', required=True)
    parser.add_argument('--bundle', required=True)
    args = parser.parse_args()
    os.umask(0o077)
    scratch = private_directory(args.scratch)
    screenshots = scratch / 'screenshots'
    if not screenshots.exists():
        screenshots.mkdir(mode=0o700)
    private_directory(screenshots)
    bundle = Path(args.bundle)
    if bundle.resolve(strict=True) != bundle or bundle.is_symlink():
        raise ValueError('Canonical ordinary artifact required')
    source = source_identity()
    inventory = audit(bundle)
    provenance = json.loads((bundle / 'Contents/Resources/resources/provenance.json').read_text())
    if provenance.get('sourceFingerprint') != source:
        raise ValueError('Ordinary artifact/source mismatch')
    name = 'ci-seed-' + str(uuid.uuid4())
    subprocess.run(['npm', 'run', 'ci:seed', '--', str(scratch), name, '--markdown-tables'], cwd=REPO, check=True, timeout=60)
    database = scratch / name / 'synthetic.sqlite'
    run = OrdinaryRun(scratch, database, source, bundle, inventory)
    observer = None
    errors = []
    receipt = {'source': source, 'scenario': 'synthetic-Markdown-tables', 'artifactKind': 'ordinary', 'artifactInventoryHash': inventory_hash(inventory),
               'passed': False, 'run': str(run.root), 'privateInputs': 'none; fresh synthetic seed', 'providerAndGarmin': 'not invoked',
               'limits': 'Actual unmodified ordinary isolated WebView; canonical synthetic table-only geometry-preserving masks; synthetic DOM navigation, not trusted input or normal singleton certification.',
               'cleanup': 'Synthetic seed/copy/Goals/documents/captures/logs deferred to task-scratch expiry; no primary access or copy-back.'}
    try:
        observer = Observer(scratch)
        run.observer = observer
        run.start(run.binary)
        sentinel = run.profile_scenario(capture=False)
        run.verify_restart(run.binary, sentinel)
        run.command({'type': 'click', 'target': 'Close Profile & data'})
        run.wait(lambda value: value['view'] == 'Trainer', 'Trainer after restart')
        receipt['captures'] = scenario(run, scratch)
        if source_identity() != source or audit(bundle) != inventory or audit(run.bundle) != inventory:
            raise ValueError('Source/artifact changed during smoke')
        receipt['passed'] = True
    finally:
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
        path = scratch / ('table-receipt-' + str(uuid.uuid4()) + '.json')
        private_json(path, receipt)
        print(json.dumps({'passed': receipt['passed'], 'receipt': str(path), 'source': source, 'runId': run.id}))
        if not receipt['passed']:
            raise RuntimeError('Table smoke incomplete/failed; original evidence retained, no fallback or blind retry')


if __name__ == '__main__':
    def interrupted(_signal, _frame):
        raise KeyboardInterrupt('Owned table smoke interrupted')
    signal.signal(signal.SIGTERM, interrupted)
    main()
