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
    def __init__(self, scratch, database, source, *, ordinary=False):
        self.id = str(uuid.uuid4())
        self.root = scratch / (('ordinary-' if ordinary else 'native-') + self.id)
        self.root.mkdir(mode=0o700)
        for name in (['app-data', 'setup-profile'] if ordinary else ['home']) + ['tmp', 'profile', 'config', 'screenshots']:
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
        if not ordinary:
            private_json(self.root / 'config.json', self.config)
        private_json(self.root / 'config/settings-v2.json', {'version': 2, 'keys': {}, 'fields': {
            'DATABASE_PATH': str(self.database), 'AI_PROVIDER': 'ollama', 'MEMORY_ENABLED': 'false', 'GARMIN_HISTORY_START_DATE': '2024-01-01'}})
        private_json(self.root / 'provenance.json', {'source': source, 'original': self.original, 'copy': 'SQLite online backup', 'primaryWriteRequested': False})
        self.child = None
        self.shutdown_failure = None
        self.origin = None
        self.launches = 0
        self.pids = []
        self.commands = []
        self.observer = None

    def spawn(self, binary, log):
        env = {'PATH': '/usr/bin:/bin:/opt/homebrew/bin:/usr/local/bin', 'HOME': str(self.root / 'home'),
               'TMPDIR': str(self.root / 'tmp'), 'TRAINER_SMOKE_CONFIG': str(self.root / 'config.json')}
        with open(log, 'xb', opener=lambda p, flags: os.open(p, flags, 0o600)) as output:
            return subprocess.Popen([str(binary)], cwd=self.root, env=env, stdout=output, stderr=subprocess.STDOUT, start_new_session=True)

    def accept_identity(self, identity):
        return (identity['runId'] == self.id and identity['source'] == self.config['source']
                and identity['pid'] == self.child.pid and identity['database'] == str(self.database)
                and identity['appIdentity'] == 'com.codexa.garmin-trainer.smoke.r' + self.id.replace('-', ''))

    def start(self, binary, timeout=100):
        if self.child is not None or listening(self.config['port']):
            raise ValueError('Run live/endpoint occupied; no fallback or occupant kill')
        self.launches += 1
        log = self.root / f'native-{self.launches}.log'
        self.child = self.spawn(binary, log)
        self.pids.append(self.child.pid)
        deadline = time.monotonic() + timeout
        failures = set()
        while time.monotonic() < deadline:
            if self.child.poll() is not None:
                raise RuntimeError(f'Owned native exited: {log}')
            try:
                identity = self.http('/identity')
                if not self.accept_identity(identity):
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

    def request(self, command, request_id):
        return {'requestId': request_id, 'expectedRunId': self.id, 'command': command}

    def command(self, command):
        if self.observer:
            self.observer.check(self.pids)
        request_id = str(uuid.uuid4())
        result = self.http('/command', self.request(command, request_id))
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

    def prepare_health_comparison(self):
        """One opt-in, prelaunch missing slot on the owned online copy, never input."""
        from datetime import date, datetime, timedelta, timezone
        if self.launches or self.child is not None or (self.root / 'health-preparation.json').exists() or canonical(self.database).parent != canonical(self.root):
            raise ValueError('Health preparation requires an unlaunched owned copy')
        if self.database.stat().st_nlink != 1 or self.database.stat().st_uid != os.getuid():
            raise ValueError('Health copy identity refused')
        with contextlib.closing(sqlite3.connect(self.database)) as copy:
            dates = [row[0] for row in copy.execute('select date from daily_health where date <= ? order by date desc limit 15', (datetime.now(timezone.utc).date().isoformat(),))]
            if len(dates) != 15 or any(date.fromisoformat(value).isoformat() != value for value in dates):
                raise ValueError('Health comparison requires fifteen recent eligible source dates')
            latest = date.fromisoformat(dates[0])
            if any(date.fromisoformat(value) != latest - timedelta(days=index) for index, value in enumerate(dates)):
                raise ValueError('Health preparation requires consecutive source dates')
            if not copy.execute("select count(*) from daily_health where date between ? and ? and availability='partial'", (dates[13], dates[7])).fetchone()[0]:
                raise ValueError('Historical Health page lacks a partial source record')
            before = fingerprint(copy)
            changed = copy.execute('delete from daily_health where date=?', (dates[10],)).rowcount
            copy.commit()
            after = fingerprint(copy)
            expected = {**before['counts'], 'daily_health': before['counts']['daily_health'] - 1}
            if changed != 1 or after['counts'] != expected or copy.execute('pragma foreign_key_check').fetchall():
                raise ValueError('Bounded Health copy preparation failed')
        private_json(self.root / 'health-preparation.json', {'copyOnly': True, 'removedDailyRowCount': 1, 'sourcePartialCoverageRetained': True, 'inputUnmodified': True, 'limit': 'Missing date is an intentional copy-only omission, not evidence the selected source had a missing date; no values fabricated or copied back.'})

    def health_scenario(self):
        self.wait(lambda o: o['healthReady'], 'Daily seven-date chart readiness')
        # Fail honestly if the selected input cannot exercise real range browsing.
        if not self.command({'type': 'observe'})['healthPreviousEnabled']:
            raise ValueError('Selected input lacks older eligible Daily history for range smoke')
        self.command({'type': 'health', 'action': 'previous'})
        self.wait(lambda o: o['healthNextEnabled'], 'Previous calendar page')
        self.command({'type': 'health', 'action': 'next'})
        self.wait(lambda o: o['healthReady'] and not o['healthLatestEnabled'], 'Next returns to latest page')
        self.command({'type': 'health', 'action': 'previous'})
        self.wait(lambda o: o['healthLatestEnabled'] and o['healthMissingRecord'] and o['healthPartialRecord'], 'Historical calendar page with copy-only missing date and source partial coverage')
        self.command({'type': 'health', 'action': 'remember-range'})
        for mode in ['weekly', 'monthly', 'daily']:
            self.command({'type': 'health', 'action': mode})
            self.wait(lambda o: o['healthMode'] == mode and o['healthReady'] == (mode == 'daily'), 'Health tab ' + mode)
        self.command({'type': 'health', 'action': 'assert-range'})
        self.command({'type': 'click', 'target': 'Back to chat'})
        self.wait(lambda o: o['view'] == 'Trainer', 'Health away')
        self.command({'type': 'click', 'target': 'Health'})
        self.wait(lambda o: o['healthReady'], 'Health return')
        self.command({'type': 'health', 'action': 'assert-range'})
        images = {size: self.command({'type': 'health', 'action': 'capture-' + size}) for size in ['narrow', 'wide']}
        self.command({'type': 'health', 'action': 'latest'})
        self.wait(lambda o: o['healthReady'] and not o['healthLatestEnabled'], 'Explicit Latest reset')
        private_json(self.root / 'health-scenario.json', {'passed': True, 'rangeTabsAwayBack': True, 'missingCopyDateAndSourcePartialObserved': True, 'captures': images, 'limit': 'Masked actual chart geometry only; dates, values and data marks hidden. Exact values proven with synthetic DOM tests. Missing date was prepared only in disposable copy; image inspection remains required.'})

    def scenario(self, health_comparison=False):
        other_fields = self.other_profile_fields()
        self.wait(lambda o: o['view'] == 'Trainer', 'Trainer')
        for view in ['Activities', 'Health', 'Training Plan', 'Sync']:
            self.command({'type': 'click', 'target': view})
            self.wait(lambda o: o['view'] == view, view)
            if view == 'Health' and health_comparison:
                self.health_scenario()
            self.command({'type': 'click', 'target': 'Back to chat'})
            self.wait(lambda o: o['view'] == 'Trainer', 'Trainer return')
        return self.profile_scenario(capture=True, other_fields=other_fields)

    def profile_scenario(self, capture=False, other_fields=None):
        if other_fields is None:
            other_fields = self.other_profile_fields()
        self.command({'type': 'click', 'target': 'Profile & data'})
        self.wait(lambda o: o['view'] == 'Profile & data' and o['profileReady'], 'Profile & data readiness')
        sentinel = 'T0231-smoke-' + self.id
        self.command({'type': 'input', 'target': 'Goals', 'value': sentinel})
        self.wait(lambda o: not o['profileSaved'], 'React-controlled dirty state')
        self.command({'type': 'click', 'target': 'Save Profile'})
        self.wait(lambda o: o['profileSaved'], 'Persisted Profile save')
        self.command({'type': 'assert', 'target': 'Goals', 'value': sentinel})
        image = self.command({'type': 'capture'}) if capture else None
        if self.other_profile_fields() != other_fields:
            raise ValueError('Non-Goals copied Profile fields changed')
        self.other_profile_hash = other_fields
        private_json(self.root / 'scenario.json', {'navigation': 'passed' if capture else 'not enrolled: quick Profile only', 'goalsSave': 'passed', 'otherProfileFieldsUnchanged': True, 'sentinel': sentinel, 'capture': image, 'commands': self.commands, 'cleanup': 'copy-only Profile sentinel retained until scratch expiry; never copied back'})
        return sentinel

    def verify_restart(self, binary, sentinel):
        self.stop()
        self.start(binary)
        self.command({'type': 'click', 'target': 'Profile & data'})
        self.wait(lambda o: o['view'] == 'Profile & data' and o['profileReady'] and o['profileSaved'], 'Relaunched persisted Profile')
        self.command({'type': 'assert', 'target': 'Goals', 'value': sentinel})
        if self.other_profile_fields() != self.other_profile_hash:
            raise ValueError('Non-Goals Profile fields changed across restart')
        private_json(self.root / 'restart.json', {'otherProfileFieldsUnchanged': True, 'passed': True, 'sameOwnedCopy': True, 'newNativePid': self.pids[-1] != self.pids[-2]})

    def stop(self):
        child = self.child
        if child is None:
            if getattr(self, 'shutdown_failure', None):
                raise RuntimeError(self.shutdown_failure)
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
            self.shutdown_failure = 'Owned shutdown incomplete; no stale-PID cleanup attempted'
            raise RuntimeError(self.shutdown_failure)
        self.shutdown_failure = None


def verify_resources(source):
    resources = REPO / 'src-tauri/resources'
    if resources.resolve(strict=True) != resources or resources.is_symlink():
        raise ValueError('Canonical resource root required')
    provenance = json.loads((resources / 'provenance.json').read_text())
    if provenance.get('sourceFingerprint') != source:
        raise ValueError('Prepared resource source mismatch; assemble after same-input production build')
    files = provenance['files']
    expected = {item['path']: item['sha256'] for item in files}
    if len(expected) != len(files):
        raise ValueError('Duplicate resource inventory')
    actual = {}
    for path in resources.rglob('*'):
        if path.is_symlink():
            raise ValueError('Resource aliases refused')
        relative = path.relative_to(resources).as_posix()
        if path.is_file() and relative not in ('provenance.json', 'THIRD-PARTY-NOTICES.txt'):
            actual[relative] = hashlib.sha256(path.read_bytes()).hexdigest()
    if actual != expected:
        raise ValueError('Prepared resource inventory mismatch')


def build(scratch, source, resources_ready=False):
    (REPO / 'dist').mkdir(exist_ok=True)
    with (REPO / 'dist/native-smoke.lock').open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if source_identity() != source:
            raise ValueError('Source changed before preparation')
        if resources_ready:
            verify_resources(source)
        steps = [] if resources_ready else [('resources', ['npm', 'run', 'desktop:resources'])]
        steps.append(('debug', ['cargo', 'build', '--locked', '--manifest-path', 'src-tauri/Cargo.toml']))
        for label, args in steps:
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
    parser.add_argument('--health-comparison', action='store_true', help='Finite Daily range/tab/away-back and masked wide/narrow capture scenario; selected input must include older Health history')
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
            run = Run(scratch, database, source)
            runs.append(run)
            if args.health_comparison:
                run.prepare_health_comparison()
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
            sentinel = run.scenario(health_comparison=args.health_comparison)
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
