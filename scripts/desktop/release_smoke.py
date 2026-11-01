#!/usr/bin/env python3
"""Audit ordinary production artifact, then separately run launch-only isolated release denial.
This does NOT claim ordinary artifact launch or authorize operator-app interaction.
"""
import argparse
import contextlib
import signal
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import time
import uuid
from native_smoke import REPO, Observer, Run, canonical, fingerprint, listening, private_json, readonly, source_identity

# Ordinary binaries contain supported opt-in control, not legacy debug admission.
# Exclude precise legacy admission/grant/probe, native-input and setup-only markers.
MARKERS = [b'Smoke must use its exact private config/HOME/temp', b'com.codexa.garmin-trainer.smoke.r',
           b'isolated-debug-result', b'allow-smoke-result', b'trainer-release-probe', b'__trainerSetupSmoke',
           b'Local key deadline: effect unknown', b'Disclosure focus refused; no key dispatched']
# Optimizers may encode CLI comparisons as instructions rather than contiguous strings.
# Require the versioned identity contract actually serialized by the live endpoint instead.
REQUIRED = [b'trainer-ordinary-isolated/v1', b'allow-isolated-result', b'__trainerOrdinaryIsolated',
            b'Isolated ordinary-run admission refused']
APP = REPO / 'src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Garmin Trainer.app'


def audit(app):
    inventory = {}
    admitted = set()
    for file in sorted(app.rglob('*')):
        if file.is_symlink():
            raise ValueError('Unexpected alias in production artifact')
        if not file.is_file():
            continue
        data = file.read_bytes()
        if any(marker in data for marker in MARKERS):
            raise ValueError('Debug/probe surface marker in ordinary production artifact: ' + str(file.relative_to(app)))
        admitted.update(marker for marker in REQUIRED if marker in data)
        inventory[str(file.relative_to(app))] = hashlib.sha256(data).hexdigest()
    if not inventory or admitted != set(REQUIRED):
        raise ValueError('Missing ordinary artifact or supported admission/control markers; static audit is not launch evidence')
    return inventory


def protect_resources(root):
    for file in root.rglob('*'):
        # Read-only does not mean non-executable: bundled Node must still run.
        file.chmod(0o500 if file.is_dir() or file.stat().st_mode & 0o111 else 0o400)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--scratch', required=True)
    parser.add_argument('--input-file', required=True)
    args = parser.parse_args()
    os.umask(0o077)
    scratch = canonical(args.scratch)
    selected = canonical(args.input_file)
    if selected.stat().st_mode & 0o077:
        raise ValueError('Input selection must be private')
    source = source_identity()
    inventory = audit(APP)
    artifact = hashlib.sha256(json.dumps(inventory, sort_keys=True).encode()).hexdigest()
    database = canonical(json.loads(selected.read_text())['database'])
    run = Run(scratch, database, source)
    private_json(run.root / 'ordinary-artifact-audit.json', {'source': source, 'artifactHash': artifact, 'files': len(inventory), 'excludedMarkers': [m.decode() for m in MARKERS], 'requiredSupportedMarkers': [m.decode() for m in REQUIRED], 'ordinaryArtifactLaunched': False})
    with (scratch / ('release-probe-build-' + str(uuid.uuid4()) + '.log')).open('xb') as log:
        subprocess.run(['cargo', 'build', '--locked', '--release', '--target', 'aarch64-apple-darwin', '--features', 'release-probe', '--manifest-path', 'src-tauri/Cargo.toml'], cwd=REPO, env={**os.environ, 'TRAINER_BUILD_SOURCE': source}, stdout=log, stderr=subprocess.STDOUT, check=True)
    if source_identity() != source:
        raise ValueError('Source changed during release probe build')
    app = run.root / 'Release Denial Probe.app'
    shutil.copytree(APP, app)
    binary = app / 'Contents/MacOS/garmin-trainer-desktop'
    shutil.copy2(REPO / 'src-tauri/target/aarch64-apple-darwin/release/garmin-trainer-desktop', binary)
    protect_resources(app / 'Contents/Resources')
    observer = Observer(scratch)
    report = None
    noninterference = None
    try:
        with (run.root / 'release-probe.log').open('xb') as log:
            run.child = subprocess.Popen([str(binary)], cwd=run.root, env={'PATH': '/usr/bin:/bin:/opt/homebrew/bin:/usr/local/bin', 'HOME': str(run.root / 'home'), 'TMPDIR': str(run.root / 'tmp'), 'TRAINER_SMOKE_CONFIG': str(run.root / 'config.json')}, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
        run.launches = 1
        run.pids.append(run.child.pid)
        deadline = time.monotonic() + 100
        while time.monotonic() < deadline:
            observer.check(run.pids)
            if listening(run.config['port']):
                raise ValueError('Release unexpectedly opened debug listener')
            if run.child.poll() is not None:
                break
            time.sleep(.05)
        evidence = run.root / 'release-denial.json'
        if run.child.poll() != 0 or not evidence.exists():
            raise RuntimeError('Release denial probe incomplete; retained log')
        report = json.loads(evidence.read_text())
        if report.get('runId') != run.id or report.get('debugCommandDenied') is not True:
            raise ValueError('Release denial did not match this owned run')
    finally:
        run.stop()
        noninterference = observer.stop(run.pids)
        with contextlib.closing(readonly(database)) as original:
            if fingerprint(original) != run.original:
                raise ValueError('Original DB integrity changed during release probe')
    if audit(APP) != inventory:
        raise ValueError('Ordinary artifact changed during separate probe build/launch')
    result = {'source': source, 'ordinaryArtifactAudit': 'passed', 'ordinaryArtifactHash': artifact, 'ordinaryArtifactLaunched': False, 'instrumentedReleaseModeDenial': report, 'noDebugListener': True, 'noninterference': noninterference, 'ownedShutdown': 'passed', 'run': str(run.root)}
    private_json(run.root / 'release-result.json', result)
    print(json.dumps(result))


if __name__ == '__main__':
    def interrupted(_signal, _frame):
        raise KeyboardInterrupt('Owned release probe interrupted')
    signal.signal(signal.SIGTERM, interrupted)
    main()
