"""CI-only one-instance synthetic Profile save/restart; delivered native bridge, no capture/full suite."""
import argparse
import contextlib
import json
import os
import platform
import signal
import subprocess
import uuid

from native_smoke import REPO, Observer, Run, build, canonical, fingerprint, private_json, readonly, source_identity


def require_platform():
    if platform.system() != 'Darwin' or platform.machine() != 'arm64':
        raise ValueError('Quick native smoke requires actual macOS ARM64')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--scratch', required=True)
    parser.add_argument('--resources-ready', action='store_true', help='Verify same-source assembled inventory instead of rebuilding backend')
    args = parser.parse_args()
    os.umask(0o077)
    require_platform()
    scratch = canonical(args.scratch)
    stat = scratch.stat()
    if not scratch.is_dir() or stat.st_uid != os.getuid() or stat.st_mode & 0o077:
        raise ValueError('Scratch must be an owner-private directory')
    source = source_identity()
    name = 'ci-seed-' + str(uuid.uuid4())
    subprocess.run(['npm', 'run', 'ci:seed', '--', str(scratch), name], cwd=REPO, check=True, timeout=60)
    database = scratch / name / 'synthetic.sqlite'
    run = Run(scratch, database, source)
    observer = None
    errors = []
    passed = False
    receipt = {
        'source': source, 'scenario': 'synthetic-one-instance-Profile-save-restart',
        'runId': run.id, 'platform': platform.platform(),
        'coverage': 'Authenticated native/backend/hydrated renderer, normal Goals save, same-state owned restart, persistence, owned shutdown.',
        'exclusions': 'No private inputs, provider/Garmin/Keychain calls, captures, parallel/navigation matrix, native dialogs, release packaging or production certification.',
        'cleanup': 'Synthetic seed/copy/logs deferred to scratch expiry; no copy-back or primary mutation.',
    }
    try:
        binary = build(scratch, source, resources_ready=args.resources_ready)
        observer = Observer(scratch)
        run.observer = observer
        run.start(binary)
        sentinel = run.profile_scenario()
        run.verify_restart(binary, sentinel)
        if source_identity() != source:
            raise ValueError('Source changed during quick smoke')
        passed = True
    finally:
        try:
            run.stop()
        except Exception as error:
            errors.append(type(error).__name__)
        if observer:
            try:
                receipt['noninterference'] = observer.stop(run.pids)
            except Exception as error:
                errors.append(type(error).__name__)
        with contextlib.closing(readonly(database)) as original:
            receipt['syntheticInputUnchanged'] = fingerprint(original) == run.original
        receipt.update(passed=passed and not errors and receipt['syntheticInputUnchanged'], shutdownErrors=errors,
                       readiness=run.launches == 2, saveRestart=passed, run=str(run.root))
        path = scratch / ('quick-receipt-' + str(uuid.uuid4()) + '.json')
        private_json(path, receipt)
        print(json.dumps({'passed': receipt['passed'], 'receipt': str(path), 'source': source, 'runId': run.id}))
        if not receipt['passed']:
            raise RuntimeError('Quick smoke failed; retained original logs/receipt, no fallback or replay')


if __name__ == '__main__':
    def interrupted(_signal, _frame):
        raise KeyboardInterrupt('Owned quick smoke interrupted')
    signal.signal(signal.SIGTERM, interrupted)
    main()
