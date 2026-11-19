#!/usr/bin/env python3
"""Finite synthetic Windows packaged-backend smoke for CI (no window/installer).

Drives the packaged node.exe + runtime.cjs exactly as the native host does:
fresh-only database initialization over the private pipe, a synthetic
activation frame (authored placeholder key, offline), nonce-bound loopback
readiness, writer-lease admission, a second-writer refusal while held, then
stdin-EOF graceful stop with lease settlement and no orphaned process. No
network service, credential, private data, installer or native window is used.
Readiness is reported separately from the behaviour checks.
"""

import argparse
import http.client
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import uuid

TIMEOUT = 90


def system_env():
    keys = ['SystemRoot', 'SystemDrive', 'windir', 'TEMP', 'TMP', 'TMPDIR']
    return {key: os.environ[key] for key in keys if key in os.environ}


def run_initializer(node, runtime):
    result = subprocess.run(
        [str(node), str(runtime / 'runtime.cjs'), '--initialize-database'],
        cwd=runtime,
        input=b'{"version":1}\n',
        capture_output=True,
        timeout=60,
        env={**system_env(), 'NODE_ENV': 'production'},
    )
    if result.returncode or not result.stdout.startswith(b'SQLite format 3\0'):
        raise AssertionError('Packaged fresh-only initializer failed')
    return result.stdout


def request(port, path, nonce, method='GET'):
    connection = http.client.HTTPConnection('127.0.0.1', port, timeout=15)
    try:
        connection.request(
            method, path, headers={'x-trainer-identity': nonce, 'Host': f'127.0.0.1:{port}'}
        )
        response = connection.getresponse()
        return response.status, dict(response.getheaders()), response.read(64 * 1024)
    finally:
        connection.close()


def start(node, runtime, frame, root):
    nonce = str(uuid.uuid4())
    env = {
        **system_env(),
        'TRAINER_DESKTOP_NONCE': nonce,
        'NODE_ENV': 'production',
        'NEXT_TELEMETRY_DISABLED': '1',
        'USERPROFILE': str(root),
        'LOCALAPPDATA': str(root),
        'APPDATA': str(root),
        'HOME': str(root),
        'PATH': str(Path(os.environ.get('SystemRoot', r'C:\Windows')) / 'System32')
        if os.name == 'nt'
        else '/usr/bin:/bin',
    }
    child = subprocess.Popen(
        [str(node), str(runtime / 'runtime.cjs')],
        cwd=runtime,
        env=env,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
    )
    child.stdin.write(json.dumps(frame).encode() + b'\n')
    child.stdin.flush()
    line = child.stdout.readline(64 * 1024)
    message = json.loads(line) if line.startswith(b'{') else {}
    return child, nonce, message


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--resources', type=Path, required=True)
    args = parser.parse_args()
    resources = args.resources.resolve(strict=True)
    # The same packaged-runtime contract on either target (bundled node[.exe]).
    node = resources / ('node.exe' if os.name == 'nt' else 'node')
    runtime = resources / 'runtime'
    outcome = {
        'scope': 'synthetic packaged backend; no window, installer or services',
        'host': sys.platform,
        'readiness': 'not reached',
        'checks': {},
    }
    with tempfile.TemporaryDirectory(prefix='trainer-backend-') as temporary:
        root = Path(temporary).resolve()
        database = root / 'trainer.sqlite'
        database.write_bytes(run_initializer(node, runtime))
        outcome['checks']['freshInitializer'] = 'passed'
        frame = {
            'version': 1,
            'fields': {
                'DATABASE_PATH': str(database),
                'AI_PROVIDER': 'openai',
                'GARMIN_HISTORY_START_DATE': '2025-01-01',
            },
            'secrets': {'OPENAI_API_KEY': 'test-only-no-network'},
        }
        child, nonce, ready = start(node, runtime, frame, root)
        try:
            if ready.get('type') != 'ready' or not ready.get('port'):
                raise AssertionError('Backend did not report readiness: ' + json.dumps(ready)[:200])
            port = ready['port']
            outcome['readiness'] = 'ready on owned 127.0.0.1 listener'
            status, headers, _ = request(port, '/__desktop/ready', nonce)
            if status != 200 or headers.get('x-trainer-identity') != nonce:
                raise AssertionError('Nonce-bound readiness identity refused')
            status, _, _ = request(port, '/__desktop/ready', 'wrong-' + nonce)
            if status == 200:
                raise AssertionError('Foreign identity accepted')
            outcome['checks']['nonceIdentity'] = 'passed'
            lease = Path(str(database) + '.trainer-writer')
            if json.loads(lease.read_text()).get('pid') != child.pid:
                raise AssertionError('Writer lease not owned by the backend')
            status, _, body = request(port, '/api/summary', nonce)
            if status != 200:
                raise AssertionError('Persisted summary route failed: ' + str(status))
            outcome['checks']['writerLeaseAndPersistedRead'] = 'passed'
            second, _, refused = start(node, runtime, frame, root)
            try:
                second_code = second.wait(timeout=TIMEOUT)
            finally:
                if second.poll() is None:
                    second.kill()
            if refused.get('type') == 'ready' or second_code == 0:
                raise AssertionError('Second writer admitted while the lease was held')
            outcome['checks']['secondWriterRefused'] = refused.get('code', 'refused')
            # Native graceful stop on Windows: close the liveness pipe.
            child.stdin.close()
            code = child.wait(timeout=TIMEOUT)
            if lease.exists():
                raise AssertionError('Lease not settled on graceful stop')
            outcome['checks']['gracefulStopSettlement'] = f'passed (exit {code})'
            restarted, _, again = start(node, runtime, frame, root)
            try:
                if again.get('type') != 'ready':
                    raise AssertionError('Restart after settlement did not reach readiness')
                outcome['checks']['restartAfterSettlement'] = 'passed'
            finally:
                restarted.stdin.close()
                restarted.wait(timeout=TIMEOUT)
        finally:
            if child.poll() is None:
                child.kill()
                child.wait()
        time.sleep(0.5)
    print(json.dumps(outcome, indent=2))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(
            json.dumps({'failed': type(error).__name__, 'detail': str(error)[:400]}),
            file=sys.stderr,
        )
        raise
