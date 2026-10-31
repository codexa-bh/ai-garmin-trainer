#!/usr/bin/env python3
"""Owned real-native representative smoke. No OS input, secrets, server substitute or stale-PID kills."""
import argparse
import contextlib
import fcntl
import hashlib
import http.client
import json
import os
from pathlib import Path
import shutil
import signal
import socket
import sqlite3
import subprocess
import sys
import time
import uuid

REPO = Path(__file__).resolve().parents[2]


def private_json(path, value):
    with open(path, 'x', opener=lambda p, flags: os.open(p, flags, 0o600)) as output:
        json.dump(value, output, indent=2)


def canonical(path):
    path = Path(path)
    if not path.is_absolute() or path.resolve(strict=True) != path or path.is_symlink():
        raise ValueError('Explicit canonical existing input required')
    return path


def source_identity():
    names = subprocess.check_output(['git', 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], cwd=REPO).split(b'\0')
    digest = hashlib.sha256()
    for name in sorted(set(names) - {b''}):
        path = REPO / os.fsdecode(name)
        digest.update(name + b'\0')
        if path.is_symlink():
            raise ValueError('Source aliases not supported')
        digest.update(path.read_bytes() if path.is_file() else b'<deleted>')
    return digest.hexdigest()


def fingerprint(database):
    digest = hashlib.sha256()
    counts = {}
    database.execute('begin')
    try:
        for (name,) in database.execute("select name from sqlite_master where type='table' and name not like 'sqlite_%' order by name"):
            quoted = '"' + name.replace('"', '""') + '"'
            rows = sorted(repr(row) for row in database.execute('select * from ' + quoted))
            digest.update((name + '\n' + '\n'.join(rows)).encode())
            counts[name] = len(rows)
    finally:
        database.rollback()
    if database.execute('pragma integrity_check').fetchone() != ('ok',):
        raise ValueError('DB integrity refused')
    return {'logicalHash': digest.hexdigest(), 'counts': counts, 'integrity': 'ok'}


def readonly(path):
    return sqlite3.connect(path.as_uri() + '?mode=ro', uri=True)


def port():
    with socket.socket() as endpoint:
        endpoint.bind(('127.0.0.1', 0))
        return endpoint.getsockname()[1]


def listening(number):
    if not number:
        return False
    with socket.socket() as endpoint:
        endpoint.settimeout(.2)
        return endpoint.connect_ex(('127.0.0.1', number)) == 0


class Observer:
    def __init__(self, scratch):
        self.log = scratch / ('focus-' + str(uuid.uuid4()) + '.log')
        binary = scratch / ('observer-' + str(uuid.uuid4()))
        subprocess.run(['xcrun', 'swiftc', str(REPO / 'scripts/desktop/native_observer.swift'), '-o', str(binary)], check=True, capture_output=True, timeout=60)
        with self.log.open('xb') as output:
            self.child = subprocess.Popen([str(binary)], stdout=output, stderr=subprocess.DEVNULL, start_new_session=True)

    def samples(self):
        return [line.split() for line in self.log.read_text().splitlines() if len(line.split()) == 4]

    def check(self, pids):
        if self.child.poll() is not None:
            raise RuntimeError('Read-only noninterference observer exited')
        rows = self.samples()
        if any(int(row[1]) in pids for row in rows):
            raise RuntimeError('Owned native became frontmost; no focus restoration attempted')
        return rows

    def stop(self, pids):
        try:
            rows = self.check(pids)
        finally:
            if self.child.poll() is None:
                self.child.terminate()
            self.child.wait(timeout=5)
        if not rows:
            raise RuntimeError('No noninterference samples available')
        return {'samples': len(rows), 'ownedNativeFrontmost': False, 'pointerPositions': len({tuple(row[2:]) for row in rows}), 'limit': '10ms sampled read-only observation cannot exclude shorter transitions; operator pointer movement is not synthesized input'}


class Run:
    def __init__(self, scratch, database, source):
        self.id = str(uuid.uuid4())
        self.root = scratch / ('native-' + self.id)
        self.root.mkdir(mode=0o700)
        for name in ['home', 'tmp', 'profile', 'config', 'screenshots']:
            (self.root / name).mkdir(mode=0o700)
        (self.root / 'owner').write_text(self.id)
        (self.root / 'owner').chmod(0o600)
        self.database = self.root / 'trainer.sqlite'
        with contextlib.closing(readonly(database)) as original:
            self.original = fingerprint(original)
            with contextlib.closing(sqlite3.connect(self.database)) as copy:
                original.backup(copy)
                if fingerprint(copy) != self.original:
                    raise ValueError('Online backup mismatch')
        self.database.chmod(0o600)
        self.config = {'runId': self.id, 'token': os.urandom(32).hex(), 'root': str(self.root), 'source': source, 'port': port()}
        private_json(self.root / 'config.json', self.config)
        private_json(self.root / 'config/settings-v1.json', {'version': 1, 'keys': {}, 'fields': {
            'DATABASE_PATH': str(self.database), 'AI_PROVIDER': 'ollama', 'MEMORY_ENABLED': 'false', 'GARMIN_HISTORY_START_DATE': '2024-01-01'}})
        private_json(self.root / 'provenance.json', {'source': source, 'original': self.original, 'copy': 'SQLite online backup', 'primaryWriteRequested': False})
        self.child = None
        self.origin = None
        self.launches = 0
        self.pids = []
        self.commands = []
        self.observer = None

    def start(self, binary, timeout=100):
        if self.child is not None or listening(self.config['port']):
            raise ValueError('Run live/endpoint occupied; no fallback or occupant kill')
        self.launches += 1
        env = {'PATH': '/usr/bin:/bin:/opt/homebrew/bin:/usr/local/bin', 'HOME': str(self.root / 'home'),
               'TMPDIR': str(self.root / 'tmp'), 'TRAINER_SMOKE_CONFIG': str(self.root / 'config.json')}
        log = self.root / f'native-{self.launches}.log'
        with open(log, 'xb', opener=lambda p, flags: os.open(p, flags, 0o600)) as output:
            self.child = subprocess.Popen([str(binary)], cwd=self.root, env=env, stdout=output, stderr=subprocess.STDOUT, start_new_session=True)
        self.pids.append(self.child.pid)
        deadline = time.monotonic() + timeout
        failures = set()
        while time.monotonic() < deadline:
            if self.child.poll() is not None:
                raise RuntimeError(f'Owned native exited: {log}')
            try:
                identity = self.http('/identity')
                if identity['runId'] != self.id or identity['source'] != self.config['source'] or identity['pid'] != self.child.pid or identity['database'] != str(self.database) or identity['appIdentity'] != 'com.codexa.garmin-trainer.smoke.r' + self.id.replace('-', ''):
                    raise ValueError('Native source/run/app/PID/database mismatch')
                if identity['origin']:
                    evidence = self.root / f'native-identity-{self.launches}.json'
                    if not evidence.exists():
                        private_json(evidence, identity)
                    self.origin = identity['origin']
                    if not self.origin.startswith('http://127.0.0.1:') or int(self.origin.rsplit(':', 1)[1]) == self.config['port']:
                        raise ValueError('Invalid backend origin')
                    observation = self.command({'type': 'observe'})
                    if observation['dashboard'] and observation['hydrated']:
                        private_json(self.root / f'readiness-{self.launches}.json', {**identity, 'rendererRoundTrip': True})
                        return
            except (OSError, http.client.HTTPException, RuntimeError, KeyError) as error:
                # Preserve distinct bounded failures; read-only readiness only, never mutation replay.
                failure = (type(error).__name__ + ': ' + str(error))[:240]
                if failure not in failures and len(failures) < 20:
                    failures.add(failure)
                    private_json(self.root / f'readiness-failure-{self.launches}-{len(failures)}.json', {'failure': failure})
            time.sleep(.1)
        raise TimeoutError('Native + renderer readiness deadline; retained run logs')

    def http(self, path, body=None, extra=None, expected=200):
        headers = {'Authorization': 'Bearer ' + self.config['token'], 'X-Smoke-Run': self.id}
        if body is not None:
            headers['Content-Type'] = 'application/json'
        headers.update(extra or {})
        client = http.client.HTTPConnection('127.0.0.1', self.config['port'], timeout=12)
        try:
            client.request('GET' if body is None else 'POST', path, None if body is None else json.dumps(body), headers)
            response = client.getresponse()
            raw = response.read(2 * 1024 * 1024 + 1)
            if len(raw) > 2 * 1024 * 1024:
                raise ValueError('Output bound exceeded')
            value = json.loads(raw)
            if response.status != expected:
                raise RuntimeError(f'Bridge status {response.status}: {value.get("error", value.get("result", {}).get("error", "failed"))}')
            return value
        finally:
            client.close()

    def command(self, command):
        if self.observer:
            self.observer.check(self.pids)
        request_id = str(uuid.uuid4())
        result = self.http('/command', {'requestId': request_id, 'expectedRunId': self.id, 'command': command})
        if result.get('requestId') != request_id or result.get('result', {}).get('ok') is not True:
            raise ValueError('Uncorrelated/failed command; effect unknown, no replay')
        self.commands.append({'type': command['type'], 'target': command.get('target'), 'ok': True})
        return result['result']

    def wait(self, predicate, label):
        deadline = time.monotonic() + 8
        while time.monotonic() < deadline:
            value = self.command({'type': 'observe'})
            if predicate(value):
                return value
            time.sleep(.1)
        private_json(self.root / ('failed-observation-' + str(uuid.uuid4()) + '.json'), {'assertion': label, 'observation': value, 'launch': self.launches})
        raise TimeoutError('Rendered assertion deadline: ' + label)

    def other_profile_fields(self):
        if not self.origin:
            raise ValueError('Verified owned origin required')
        client = http.client.HTTPConnection('127.0.0.1', int(self.origin.rsplit(':', 1)[1]), timeout=5)
        try:
            client.request('GET', '/api/profile')
            response = client.getresponse()
            raw = response.read(128 * 1024 + 1)
            if response.status != 200 or len(raw) > 128 * 1024:
                raise ValueError('Owned Profile read failed/bounded')
            profile = json.loads(raw)
            return hashlib.sha256(json.dumps({key: profile.get(key) for key in ['sports', 'constraints', 'preferences']}, sort_keys=True).encode()).hexdigest()
        finally:
            client.close()

    def scenario(self):
        other_fields = self.other_profile_fields()
        self.wait(lambda o: o['view'] == 'Trainer', 'Trainer')
        for view in ['Activities', 'Health', 'Training Plan', 'Sync']:
            self.command({'type': 'click', 'target': view})
            self.wait(lambda o: o['view'] == view, view)
            self.command({'type': 'click', 'target': 'Back to chat'})
            self.wait(lambda o: o['view'] == 'Trainer', 'Trainer return')
        self.command({'type': 'click', 'target': 'Data & settings'})
        self.wait(lambda o: o['view'] == 'Settings' and o['profileReady'], 'Settings/Profile readiness')
        sentinel = 'T0231-smoke-' + self.id
        self.command({'type': 'input', 'target': 'Goals', 'value': sentinel})
        self.wait(lambda o: not o['profileSaved'], 'React-controlled dirty state')
        self.command({'type': 'click', 'target': 'Save Profile'})
        self.wait(lambda o: o['profileSaved'], 'Persisted Profile save')
        self.command({'type': 'assert', 'target': 'Goals', 'value': sentinel})
        capture = self.command({'type': 'capture'})
        if self.other_profile_fields() != other_fields:
            raise ValueError('Non-Goals copied Profile fields changed')
        self.other_profile_hash = other_fields
        private_json(self.root / 'scenario.json', {'navigation': 'passed', 'goalsSave': 'passed', 'otherProfileFieldsUnchanged': True, 'sentinel': sentinel, 'capture': capture, 'commands': self.commands, 'cleanup': 'copy-only Profile sentinel retained until scratch expiry; never copied back'})
        return sentinel

    def verify_restart(self, binary, sentinel):
        self.stop()
        self.start(binary)
        self.command({'type': 'click', 'target': 'Data & settings'})
        self.wait(lambda o: o['profileReady'] and o['profileSaved'], 'Relaunched persisted Profile')
        self.command({'type': 'assert', 'target': 'Goals', 'value': sentinel})
        if self.other_profile_fields() != self.other_profile_hash:
            raise ValueError('Non-Goals Profile fields changed across restart')
        private_json(self.root / 'restart.json', {'otherProfileFieldsUnchanged': True, 'passed': True, 'sameOwnedCopy': True, 'newNativePid': self.pids[-1] != self.pids[-2]})

    def stop(self):
        child = self.child
        if child is None:
            return
        # Only this live child handle authorizes signaling, never a stored PID/receipt.
        if child.poll() is None:
            os.killpg(child.pid, signal.SIGTERM)
            try:
                child.wait(timeout=15)
            except subprocess.TimeoutExpired:
                if child.poll() is None:
                    os.killpg(child.pid, signal.SIGKILL)
                child.wait(timeout=5)
        self.child = None
        backend_port = int(self.origin.rsplit(':', 1)[1]) if self.origin else None
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline and (listening(self.config['port']) or listening(backend_port) or Path(str(self.database) + '.trainer-writer').exists()):
            time.sleep(.1)
        settled = not listening(self.config['port']) and not listening(backend_port) and not Path(str(self.database) + '.trainer-writer').exists()
        private_json(self.root / f'shutdown-{self.launches}.json', {'nativeReaped': True, 'endpointsAndLeaseSettled': settled, 'exitCode': child.returncode})
        if not settled:
            raise RuntimeError('Owned shutdown incomplete; no stale-PID cleanup attempted')


def build(scratch, source):
    (REPO / 'dist').mkdir(exist_ok=True)
    with (REPO / 'dist/native-smoke.lock').open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if source_identity() != source:
            raise ValueError('Source changed before preparation')
        for label, args in [('resources', ['npm', 'run', 'desktop:resources']), ('debug', ['cargo', 'build', '--locked', '--manifest-path', 'src-tauri/Cargo.toml'])]:
            with (scratch / (label + '-' + str(uuid.uuid4()) + '.log')).open('xb') as log:
                subprocess.run(args, cwd=REPO, env={**os.environ, 'TRAINER_BUILD_SOURCE': source}, stdout=log, stderr=subprocess.STDOUT, check=True)
        if source_identity() != source:
            raise ValueError('Source changed during preparation')
        destination = scratch / ('native-binary-' + str(uuid.uuid4()))
        shutil.copy2(REPO / 'src-tauri/target/debug/garmin-trainer-desktop', destination)
        destination.chmod(0o700)
        return destination


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--scratch', required=True)
    parser.add_argument('--input-file', required=True, help='Private JSON with explicitly selected canonical database; no env/settings discovery')
    parser.add_argument('--prepare-only', action='store_true')
    args = parser.parse_args()
    os.umask(0o077)
    scratch = canonical(args.scratch)
    input_file = canonical(args.input_file)
    if input_file.stat().st_mode & 0o077:
        raise ValueError('Input selection must be private')
    database = canonical(json.loads(input_file.read_text())['database'])
    source = source_identity()
    runs = []
    observer = None
    noninterference = None
    try:
        for _ in range(2):
            runs.append(Run(scratch, database, source))
        if args.prepare_only:
            print(json.dumps({'prepared': [str(run.root) for run in runs], 'integrity': 'ok', 'launches': 0}))
            return
        binary = build(scratch, source)
        observer = Observer(scratch)
        for run in runs:
            run.observer = observer
            run.start(binary)
        if runs[0].origin == runs[1].origin:
            raise ValueError('Parallel backend collision')
        for run in runs:
            # Admission failures are real transport observations, not successful commands.
            for extra in [{'Authorization': 'Bearer wrong'}, {'Origin': 'null'}, {'X-Smoke-Run': str(uuid.uuid4())}, {'Host': 'localhost'}]:
                run.http('/identity', extra=extra, expected=403)
            sentinel = run.scenario()
            run.verify_restart(binary, sentinel)
        if source_identity() != source:
            raise ValueError('Source changed during execution')
    finally:
        errors = []
        for run in runs:
            try:
                run.stop()
            except Exception as error:
                errors.append(str(error))
        with contextlib.closing(readonly(database)) as original:
            unchanged = all(fingerprint(original) == run.original for run in runs)
        if observer:
            try:
                noninterference = observer.stop([pid for run in runs for pid in run.pids])
            except Exception as error:
                errors.append(str(error))
                if observer.child.poll() is None:
                    observer.child.terminate()
                    observer.child.wait(timeout=5)
        receipt = {'source': source, 'runs': [str(run.root) for run in runs], 'primaryUnchanged': unchanged, 'shutdownErrors': errors, 'noninterference': noninterference, 'providerAndGarmin': 'not exercised; keyless offline representative flow'}
        private_json(scratch / ('native-receipt-' + str(uuid.uuid4()) + '.json'), receipt)
        if not unchanged or errors:
            raise RuntimeError('Original integrity/shutdown gate failed; retained evidence')
    print(json.dumps({'passed': True, **receipt}))


if __name__ == '__main__':
    def interrupted(_signal, _frame):
        raise KeyboardInterrupt('Owned smoke interrupted')
    signal.signal(signal.SIGTERM, interrupted)
    main()
