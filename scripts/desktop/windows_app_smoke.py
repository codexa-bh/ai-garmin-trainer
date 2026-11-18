#!/usr/bin/env python3
"""Finite installed Windows Server render/persistence/uninstall scenario.

Only explicit GitHub-hosted Windows invocation, authored/keyless state and the
freshly verified installer. No normal singleton, WebView download, elevation,
external machine, arbitrary script/input or release operation.
"""
import argparse
import contextlib
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import uuid

from native_smoke import REPO, Run, fingerprint, listening, port, private_json, readonly
from ordinary_identity import inventory_hash, ordinary_preparation, provenance, source_snapshot
import platform_files
import windows_package
import windows_release
import windows_smoke_evidence as evidence
import windows_smoke_state as state
import windows_smoke_process as process

PRODUCT_ID = 'com.codexa.garmin-trainer.desktop'
UNINSTALL_KEY = r'Software\Microsoft\Windows\CurrentVersion\Uninstall\Garmin Trainer'
MANUFACTURER_KEY = r'Software\codexa\Garmin Trainer'


def startup_diagnostic(root, launch, exit_code):
    """Only fixed enums/booleans/numeric exit status may reach the CI console.
    Raw native logs, paths, descriptors and capabilities remain runner-local."""
    stages = {'mode', 'descriptor-file', 'descriptor-json', 'descriptor-fields', 'root-directory', 'root-lease',
              'owner-file', 'owner-binding', 'config', 'app-data', 'profile', 'setup-profile', 'tmp', 'screenshots',
              'tokens', 'database-file', 'artifact-executable', 'artifact-layout', 'artifact-files',
              'artifact-inventory-digest', 'compiled-resource-identity', 'artifact', 'settings', 'owner-pipe', 'state-binding'}
    # Exact source-owned launch errors -> finite public enums. Unknown text is never forwarded.
    runtime_errors = {
        b'Isolated ordinary-run admission refused; no normal-state fallback.': 'isolation-integrity',
        b'Bundle resources unavailable.': 'resource-location',
        b'Private file missing or unreadable.': 'private-file-read',
        b'Private file must be bounded, owner-private, regular and unaliased.': 'private-file-safety',
        b'Private settings invalid; preserve originals and use a compatible build.': 'private-settings',
        b'Settings revision unavailable; reload before saving.': 'settings-revision',
        b'Settings validator resources unavailable. Rebuild the desktop app.': 'settings-validator-spawn',
        b'Settings invalid. Check existing current-schema database, absolute private paths, date, endpoints and advanced values.': 'settings-validator-rejected',
        b'Settings validation timed out; settings unchanged.': 'settings-validator-timeout',
        b'Settings validation failed.': 'settings-validator-protocol',
        b'Settings invalid.': 'settings-validator-invalid',
        b'Bundled Node/resources missing or not executable.': 'backend-spawn',
        b'Backend ownership could not be established.': 'backend-ownership',
        b'Backend activation interrupted.': 'backend-activation',
        b'Backend exited before readiness. Check config, schema, ownership and resources.': 'backend-exited',
        b'Backend startup exceeded 90 seconds. Check config, DB schema/ownership and resources.': 'backend-timeout',
        b'Settings or Keychain activation refused. Check required provider keys, existing database and private absolute paths; no env file is loaded.': 'backend-configuration',
        b'Database preflight refused. Check existing target, integrity and supported schema with source db:status; never auto-upgrade the primary.': 'backend-database',
        b'Database writer admission refused. Quit the other backend and inspect the exact lease/open-file owner; never steal a live lease.': 'backend-writer',
        b'Packaged resources failed. Rebuild the desktop resources and verify bundled Node/SQLite; do not install/sign to bypass this error.': 'backend-resources',
        b'Local backend startup refused. Check source doctor/status and owned listener readiness; no unrelated service was loaded.': 'backend-refused',
        b'Cannot create desktop window.': 'desktop-window',
        b'Isolated result capability unavailable': 'result-capability',
    }
    try:
        raw = state.read_file(root / f'native-{launch}.log', 64 * 1024)
    except (OSError, ValueError):
        raw, available = b'', False
    else:
        available = True
    found = re.findall(rb'Isolated admission refused at ([a-z-]{1,48})', raw)
    lower = raw.lower()
    runtime = re.findall(rb'Isolated runtime startup refused: ([^\r\n]{1,320})', raw)
    hresults = re.findall(rb'(?m)^Isolated desktop window hresult: (-?[0-9]{1,11})\r?$', raw)
    validation_codes = {b'SQLITE_BUSY', b'SQLITE_LOCKED', b'SQLITE_CANTOPEN', b'SQLITE_CORRUPT', b'SQLITE_NOTADB',
                        b'SQLITE_READONLY', b'SQLITE_ERROR', b'SQLITE_IOERR', b'MODULE_NOT_FOUND', b'ERR_DLOPEN_FAILED',
                        b'canonical-path', b'database-file', b'database-schema', b'database-integrity',
                        b'database-compatibility', b'database-control', b'unavailable'}
    validation = re.findall(rb'(?m)^Desktop settings validation: (fields|database) ([A-Za-z_-]{1,48})\r?$', raw)
    modules = {b'next', b'better-sqlite3', b'@next/env', b'@resvg/resvg-wasm', b'react', b'react-dom', b'react-is',
               b'styled-jsx', b'bindings', b'file-uri-to-path', b'@swc/helpers', b'postcss', b'caniuse-lite',
               b'baseline-browser-mapping', b'@opentelemetry/api', b'scheduler', b'client-only', b'server-only', b'unavailable'}
    loaders = re.findall(rb'(?m)^Desktop settings loader: (MODULE_NOT_FOUND|ERR_MODULE_NOT_FOUND|ERR_DLOPEN_FAILED|ERR_REQUIRE_ESM|EINVAL|EBADF|EPIPE|ENOENT|ENOTDIR|ENOTSOCK|EPERM|EACCES|ERR_INVALID_HANDLE_TYPE|ERR_INVALID_FD_TYPE|ERR_INVALID_ARG_VALUE|ERR_INVALID_ARG_TYPE|ERR_UNSUPPORTED_ESM_URL_SCHEME|ERR_UNKNOWN_FILE_EXTENSION|NODE_SYNTAX_ERROR|NODE_TYPE_ERROR|NODE_RANGE_ERROR|NODE_ASSERTION|NODE_BAD_OPTION) ([A-Za-z0-9@/._-]{1,96})\r?$', raw)
    child_exits = re.findall(rb'(?m)^Desktop settings child exit: (-?[0-9]{1,11})\r?$', raw)
    transports = re.findall(rb'(?m)^Desktop settings transport bytes: ([0-9]{1,6}) ([0-9]{1,6})\r?$', raw)
    stdout_kinds = re.findall(rb'(?m)^Desktop settings stdout kind: (validation-refusal|unexpected-success|backend-failure|unexpected-ready|other-json|non-json)\r?$', raw)
    return {'layer': 'native-startup', 'exitCode': exit_code, 'nativeLogAvailable': available,
            'validatorChildExits': [int(value) for value in child_exits[:4] if -2147483648 <= int(value) <= 2147483647],
            'validatorTransport': [{'stdoutBytes': int(out), 'stderrBytes': int(err)} for out, err in transports[:4]
                                   if int(out) <= 128 * 1024 + 1 and int(err) <= 64 * 1024 + 1],
            'validatorStdoutKinds': [value.decode('ascii') for value in stdout_kinds[:4]],
            'nativeLogBytes': len(raw) if available else None,
            'settingsLoader': [{'code': code.decode('ascii'), 'module': (module if module in modules else b'unavailable').decode('ascii')}
                               for code, module in loaders[:4]],
            'settingsValidation': [{'stage': stage.decode('ascii'), 'code': (code if code in validation_codes else b'unavailable').decode('ascii')}
                                   for stage, code in validation[:4]],
            'runtimeStartupCodes': sorted({runtime_errors[value] for value in runtime if value in runtime_errors}),
            'windowHresults': sorted({int(value) for value in hresults if -2147483648 <= int(value) < 0}),
            'admissionStages': sorted({value.decode('ascii') for value in found if value.decode('ascii') in stages}),
            'admissionRefused': b'Isolated ordinary-run admission refused' in raw,
            'runtimeStartupFailure': b'isolated startup:' in raw or b'Isolated runtime startup refused:' in raw,
            'panic': b'panicked at' in lower,
            'webviewMentioned': b'webview' in lower, 'consoleMentioned': b'console' in lower,
            'loaderDllMissing': exit_code in (0xc0000135, -1073741515)}


def inventory(root):
    state.canonical(root)
    result = {}
    for path in sorted(root.rglob('*')):
        state.canonical(path)
        if path.is_dir():
            continue
        if not path.is_file() or path.stat().st_nlink != 1:
            raise ValueError('Unexpected installed/state object')
        result[path.relative_to(root).as_posix()] = windows_package.digest(path)
    if not result or len(result) > 50000:
        raise ValueError('Empty/overbound inventory')
    return result


def installed_payload(program, expected):
    actual = inventory(program)
    if set(actual) != set(expected) | {'uninstall.exe'} or any(actual.get(key) != value for key, value in expected.items()):
        raise ValueError('Installed payload differs from verified installer')
    if windows_package.pe_machine(program / 'uninstall.exe') not in (0x14c, 0x8664):
        raise ValueError('Generated NSIS uninstaller is not PE')
    return actual


def registration():
    import winreg
    result = {}
    for hive_name, hive in [('user', winreg.HKEY_CURRENT_USER), ('machine', winreg.HKEY_LOCAL_MACHINE)]:
        for view in (winreg.KEY_WOW64_32KEY, winreg.KEY_WOW64_64KEY):
            for name, path in [('uninstall', UNINSTALL_KEY), ('manufacturer', MANUFACTURER_KEY)]:
                try:
                    key = winreg.OpenKey(hive, path, 0, winreg.KEY_READ | view)
                except FileNotFoundError:
                    continue
                with key:
                    values = {}
                    for index in range(winreg.QueryInfoKey(key)[1]):
                        field, value, kind = winreg.EnumValue(key, index)
                        if kind not in (winreg.REG_SZ, winreg.REG_DWORD):
                            raise ValueError('Unexpected product registration type')
                        values[field] = value
                result[f'{hive_name}-{view}-{name}'] = values
    return result


def shortcuts():
    # /NS promises no shortcut creation; check these exact product paths only.
    return [Path(os.environ['USERPROFILE']) / 'Desktop/Garmin Trainer.lnk',
            Path(os.environ['APPDATA']) / 'Microsoft/Windows/Start Menu/Programs/Garmin Trainer.lnk',
            Path(os.environ['APPDATA']) / 'Microsoft/Windows/Start Menu/Programs/Garmin Trainer/Garmin Trainer.lnk']


def prerequisite():
    if (not platform_files.WINDOWS or os.environ.get('GITHUB_ACTIONS') != 'true'
            or os.environ.get('RUNNER_ENVIRONMENT') != 'github-hosted'
            or os.environ.get('PROCESSOR_ARCHITECTURE') != 'AMD64'):
        raise ValueError('Explicit ephemeral GitHub-hosted Windows x64 runner required')
    source = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=REPO, text=True).strip()
    if source != os.environ.get('TESTED_SOURCE') or not re.fullmatch('[0-9a-f]{40}', source):
        raise ValueError('Dispatch/build source differs from actual checkout')
    if subprocess.check_output(['git', 'status', '--porcelain', '--untracked-files=all'], cwd=REPO):
        raise ValueError('Dirty source refused')
    config = json.loads((REPO / 'src-tauri/tauri.conf.json').read_text())
    if config['identifier'] != PRODUCT_ID or config.get('bundle', {}).get('publisher') is not None:
        raise ValueError('Installer registration schema changed; review finite ownership first')
    if registration() or any(path.exists() for path in shortcuts()):
        raise ValueError('Pre-existing registration/shortcut; no foreign installation adoption')
    appdata = Path(os.environ['APPDATA']) / PRODUCT_ID
    if os.path.lexists(appdata) or os.path.lexists(Path(os.environ['LOCALAPPDATA']) / 'Garmin Trainer'):
        raise ValueError('Pre-existing product app-data/program path refused')
    import winreg
    runtime = None
    key = r'SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
    for hive in (winreg.HKEY_CURRENT_USER, winreg.HKEY_LOCAL_MACHINE):
        try:
            with winreg.OpenKey(hive, key, 0, winreg.KEY_READ | winreg.KEY_WOW64_32KEY) as opened:
                value = winreg.QueryValueEx(opened, 'pv')[0]
                if re.fullmatch(r'[0-9]+(?:\.[0-9]+){3}', value) and value != '0.0.0.0':
                    runtime = value
        except FileNotFoundError:
            pass
    if not runtime:
        raise ValueError('WebView2 unavailable; no prerequisite install/download')
    if sys.getwindowsversion().product_type != 3:
        raise ValueError('Selected hosted Windows Server environment required')
    return source, runtime, appdata


def assert_preserved(database, before, config, settings, appdata, markers):
    with contextlib.closing(readonly(database)) as opened:
        if fingerprint(opened) != before:
            raise ValueError('Saved synthetic Goals/DB changed during uninstall')
    if inventory(appdata) != markers or inventory(config) != settings:
        raise ValueError('Real app-data marker or run settings lost/changed during uninstall')


def execute_installer(executable, arguments, *, cwd, timeout=120):
    # Direct executable, no shell/elevation. NSIS /D= is the last argument.
    code = process.execute(executable, arguments, cwd=cwd, timeout=timeout)
    if code:
        raise ValueError('Installer/uninstaller returned nonzero: ' + str(code))
    return code


def webview_processes(profile):
    # Read-only ownership observation, never PID/name-based shutdown. The fixed
    # profile path is passed as private process environment, never interpolated JS
    # or shell source; no process command lines are retained.
    script = "$ErrorActionPreference='Stop'; @(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -and $_.CommandLine.IndexOf($env:OWNED_WEBVIEW_PROFILE, [StringComparison]::OrdinalIgnoreCase) -ge 0 }).Count"
    executable = Path(os.environ['SystemRoot']) / 'System32/WindowsPowerShell/v1.0/powershell.exe'
    result = subprocess.run([str(executable), '-NoProfile', '-NonInteractive', '-Command', script],
                            env={**os.environ, 'OWNED_WEBVIEW_PROFILE': str(profile)}, capture_output=True, timeout=15, check=True)
    return int(result.stdout.decode('utf8').strip())


class InstalledRun(Run):
    def __init__(self, scratch, program, verified, installed, verify_current):
        # Reuse the existing finite app interaction/HTTP readiness owner, but no
        # macOS Run constructor, HOME replacement, bundle copy or signal-group use.
        self.id = str(uuid.uuid4())
        self.root = state.mkdir(scratch / ('ordinary-' + self.id))
        self.pin = state.PinnedRoot(self.root)
        for name in ['config', 'app-data', 'profile', 'setup-profile', 'tmp', 'screenshots']:
            state.mkdir(self.root / name)
        state.write_file(self.root / 'owner', self.id.encode())
        self.database = self.root / 'trainer.sqlite'
        node = REPO / 'node_modules/.bin/tsx.cmd'
        result = subprocess.run([str(node), str(REPO / 'scripts/desktop/windows_smoke_seed.ts'), datetime.now(timezone.utc).date().isoformat()],
                                cwd=REPO, capture_output=True, timeout=60)
        if result.returncode or not result.stdout.startswith(b'SQLite format 3\0') or len(result.stdout) > 16 * 1024 * 1024:
            raise ValueError('Existing authored synthetic recipe refused')
        state.write_file(self.database, result.stdout)
        with contextlib.closing(readonly(self.database)) as database:
            self.original = fingerprint(database)
        private_json(self.root / 'config/settings-v2.json', {'version': 2, 'keys': {}, 'fields': {
            'DATABASE_PATH': str(self.database), 'AI_PROVIDER': 'ollama', 'MEMORY_ENABLED': 'false'}})
        self.config = {'runId': self.id, 'root': str(self.root), 'source': verified['provenance']['sourceFingerprint'],
                       'token': os.urandom(32).hex(), 'port': port()}
        self.build_source = verified['provenance']['buildSourceFingerprint']
        self.build_context = verified['context']
        self.artifact = inventory_hash(installed)
        self.program, self.installed, self.verify_current = program, installed, verify_current
        self.binary = program / windows_package.BINARY
        self.boot, self.previous_boot, self.previous_token = None, None, None
        self.child, self.origin, self.observer, self.shutdown_failure = None, None, None, None
        self.backend_handles = []
        self.launches, self.pids, self.commands = 0, [], []
        self.before_start = self.check_current
        self.descriptor_path = self.root / 'launch.json'
        self.descriptor = {'schemaVersion': 2, 'runId': self.id, 'root': str(self.root),
                           'sourceFingerprint': self.config['source'], 'buildSourceFingerprint': self.build_source,
                           'buildContext': self.build_context, 'artifactInventoryHash': self.artifact,
                           'controlPort': self.config['port'], 'capability': self.config['token']}
        state.write_file(self.descriptor_path, json.dumps(self.descriptor).encode())
        self.descriptor_bytes = state.read_file(self.descriptor_path, 16 * 1024)

    def start(self, binary, timeout=100):
        try:
            super().start(binary, timeout)
        except BaseException:
            diagnostic = startup_diagnostic(self.root, self.launches, self.child.poll() if self.child else None)
            if self.child is None:
                diagnostic['layer'] = 'prelaunch-verification'
            print(json.dumps(diagnostic), flush=True)
            raise
        identity = self.http('/identity')
        self.backend_handles.append(state.PinnedProcess(identity['backendPid'], self.program / 'resources/node.exe'))
        if webview_processes(self.root / 'profile') < 1:
            raise ValueError('Own profile WebView processes not observable; settlement cannot be certified')

    def check_current(self):
        self.pin.verify()
        self.verify_current()
        if inventory(self.program) != self.installed or state.read_file(self.descriptor_path, 16 * 1024) != self.descriptor_bytes:
            raise ValueError('Installed program or pinned descriptor changed')

    def spawn(self, binary, log):
        if Path(binary) != self.binary:
            raise ValueError('Only the verified installed executable may launch')
        with self.pin.lease():
            self.previous_token = self.config['token']
            self.config['token'] = os.urandom(32).hex()
            self.descriptor['capability'] = self.config['token']
            staged = self.root / ('.launch-' + str(uuid.uuid4()))
            state.write_file(staged, json.dumps(self.descriptor).encode())
            os.replace(staged, self.descriptor_path)
            self.descriptor_bytes = state.read_file(self.descriptor_path, 16 * 1024)
        self.previous_boot, self.boot = self.boot, None
        # Preserve HOME/USERPROFILE. Explicit native roots own settings/app-data,
        # WebView and tmp. No ambient smoke/credential environment is inherited.
        keys = ['SystemRoot', 'SystemDrive', 'windir', 'USERPROFILE', 'HOME', 'APPDATA', 'LOCALAPPDATA']
        env = {key: os.environ[key] for key in keys if key in os.environ}
        env.update({'PATH': str(Path(os.environ['SystemRoot']) / 'System32'), 'TEMP': str(self.root / 'tmp'), 'TMP': str(self.root / 'tmp')})
        with log.open('xb') as output:
            return subprocess.Popen([str(binary), '--isolated-smoke-run', str(self.descriptor_path)], cwd=self.root,
                                    env=env, stdin=subprocess.PIPE, stdout=output, stderr=subprocess.STDOUT)

    def accept_identity(self, value):
        expected = {'schemaVersion': 1, 'runId': self.id, 'source': self.config['source'], 'pid': self.child.pid,
                    'database': str(self.database), 'appIdentity': 'com.codexa.garmin-trainer.ordinary.r' + self.id.replace('-', ''),
                    'artifactKind': 'ordinary', 'buildMode': 'release', 'launchMode': 'isolated',
                    'controlContract': 'trainer-ordinary-isolated/v2', 'artifactInventoryHash': self.artifact,
                    'buildSourceFingerprint': self.build_source, 'buildContext': self.build_context}
        if any(value.get(key) != expected for key, expected in expected.items()):
            return False
        boot = value.get('boot')
        evidence.identifier(boot)
        if boot == self.previous_boot or (self.boot is not None and self.boot != boot):
            raise ValueError('Stale or changed native boot')
        self.boot = boot
        return True

    def request(self, command, request_id):
        if self.boot is None:
            raise ValueError('Verified native boot required')
        return {**super().request(command, request_id), 'expectedBoot': self.boot}

    def stop(self):
        if self.child is not None:
            child = self.child
            if child.poll() is None:
                child.stdin.close()  # Native ownership pipe, never taskkill/name/PID cleanup.
            try:
                child.wait(timeout=30)
            except subprocess.TimeoutExpired:
                self.shutdown_failure = 'Owned native failed bounded pipe shutdown; no uninstaller admitted'
                raise
            self.child = None
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            backend_port = int(self.origin.rsplit(':', 1)[1]) if self.origin else None
            if (not listening(self.config['port']) and not listening(backend_port)
                    and not Path(str(self.database) + '.trainer-writer').exists()
                    # Include the hidden setup-profile WebView as well as trainer.
                    and webview_processes(self.root) == 0
                    and all(handle.settled() for handle in self.backend_handles)):
                with self.pin.lease():
                    pass
                self.shutdown_failure = None
                private_json(self.root / ('shutdown-' + str(uuid.uuid4()) + '.json'), {
                    'nativeReaped': True, 'endpointsWriterAndRunLeaseSettled': True, 'ownedRunWebviewsRemaining': 0})
                return
            time.sleep(.2)
        self.shutdown_failure = 'Owned native/backend/WebView/lease settlement incomplete'
        raise RuntimeError(self.shutdown_failure)

    def denials(self):
        for extra in [{'Authorization': 'Bearer wrong'}, {'X-Smoke-Run': str(uuid.uuid4())}, {'Origin': 'null'}]:
            self.http('/identity', extra=extra, expected=403)
        request = self.request({'type': 'observe'}, str(uuid.uuid4()))
        # Boot/run mismatch is the existing native closed-request 400, distinct
        # from header/bearer authorization 403 (same contract as ordinary_smoke).
        self.http('/command', {**request, 'expectedBoot': str(uuid.uuid4())}, expected=400)
        if self.previous_boot:
            self.http('/identity', extra={'Authorization': 'Bearer ' + self.previous_token}, expected=403)
            self.http('/command', {**request, 'expectedBoot': self.previous_boot}, expected=400)

    def captures(self, staging):
        self.command({'type': 'click', 'target': 'Close Profile & data'})
        self.wait(lambda o: o['view'] == 'Trainer', 'Trainer before captures')
        images = []
        for view, rendered in [('trainer', 'Trainer'), ('sync', 'Sync'), ('profile', 'Profile & data')]:
            self.command({'type': 'setViewport', 'preset': 'wide'})
            if view == 'sync':
                self.command({'type': 'click', 'target': 'Sync'})
            elif view == 'profile':
                self.command({'type': 'click', 'target': 'Back to chat'})
                self.wait(lambda o: o['view'] == 'Trainer', 'Trainer return')
                self.command({'type': 'click', 'target': 'Profile & data'})
            self.wait(lambda o: o['view'] == rendered, 'Capture view')
            for preset, dimensions in evidence.PRESETS.items():
                if preset != 'wide':
                    self.command({'type': 'setViewport', 'preset': preset})
                diagnostic = self.http('/identity')['rendererDiagnostic']
                if (diagnostic.get('width'), diagnostic.get('height')) != dimensions:
                    raise ValueError('Actual logical viewport disagrees with fixed preset')
                result = self.command({'type': 'captureView', 'view': view, 'preset': preset})
                if result.get('boundary') != 'geometry-preserving redacted own-WebView':
                    raise ValueError('Capture is not eligible masked own-WebView evidence')
                path = Path(result['capture'])
                if path.parent != self.root / 'screenshots' or not re.fullmatch(r'capture-[0-9a-f-]{36}\.png', path.name):
                    raise ValueError('Capture path/provenance refused')
                content = state.read_file(path, 4 * 1024 * 1024)
                evidence.png(content, dimensions)
                name = f'{view}-{preset}.png'
                state.write_file(staging / name, content)
                images.append({'file': name, 'sha256': hashlib.sha256(content).hexdigest(), 'view': view, 'preset': preset,
                               'width': dimensions[0], 'height': dimensions[1], 'runId': self.id, 'bootId': self.boot,
                               'captureMethod': 'webview2-capture-preview', 'inputMethod': 'synthetic-dom', 'masked': True})
        return images


def scenario(args):
    source, runtime, appdata = prerequisite()
    runner_temp = state.canonical(Path(os.environ['RUNNER_TEMP']))
    if any(str(path.parent) != str(runner_temp) for path in (args.scratch, args.evidence)):
        raise ValueError('Only exclusive direct children of canonical RUNNER_TEMP may be allocated')
    scratch = state.mkdir(args.scratch)
    staging = state.mkdir(args.evidence)
    outcomes = {key: 'not-run' for key in evidence.STAGES}
    started = time.monotonic()
    phase_started = started
    durations = {}
    def completed(label, *stages):
        nonlocal phase_started
        now = time.monotonic()
        durations[label] = round(now - phase_started, 2)
        phase_started = now
        for stage in stages:
            outcomes[stage] = 'passed'
        print(json.dumps({'stage': label, 'outcome': 'passed', 'elapsedSeconds': durations[label]}), flush=True)
    run = None
    try:
        snapshot = source_snapshot(REPO)['source']
        with ordinary_preparation(REPO, args.producer, snapshot, scratch) as (verified, producer_inventory):
            with windows_release.transported(REPO, args.producer, snapshot, verified, producer_inventory, args.record, scratch) as (installer, verify_current, record):
                expected = windows_package.expected(args.producer, args.producer / 'resources')
                program = scratch / 'program'
                # Refresh fresh ownership after potentially expensive producer verification.
                if registration() or os.path.lexists(program) or os.path.lexists(appdata) or any(path.exists() for path in shortcuts()):
                    raise ValueError('Install target/registration/data changed before installer execution')
                execute_installer(installer, ['/S', '/NS', '/D=' + str(program)], cwd=installer.parent)
                installed = installed_payload(program, expected)
                registered = registration()
                if not registered or any(path.exists() for path in shortcuts()):
                    raise ValueError('Installer registration/shortcut contract failed')
                for key, values in registered.items():
                    if key.endswith('-uninstall') and (values.get('DisplayName') != 'Garmin Trainer'
                            or values.get('Publisher') != 'codexa' or values.get('InstallLocation', '').strip('"') != str(program)
                            or values.get('UninstallString') != '"' + str(program / 'uninstall.exe') + '"'):
                        raise ValueError('Installer registration does not name owned program')
                completed('artifactVerificationAndInstall', 'install')
                state.mkdir(appdata)
                marker = appdata / 'T0341-synthetic-preservation.txt'
                state.write_file(marker, ('T0341-' + str(uuid.uuid4())).encode())
                marker_inventory = inventory(appdata)
                run = InstalledRun(scratch, program, verified, installed, verify_current)
                run.start(run.binary)
                completed('nativeAdmissionAndHydration', 'identity', 'hydration')
                run.denials()
                run.command({'type': 'click', 'target': 'Sync'})
                run.wait(lambda o: o['view'] == 'Sync', 'Hydrated Sync navigation')
                run.command({'type': 'click', 'target': 'Back to chat'})
                run.wait(lambda o: o['view'] == 'Trainer', 'Hydrated Trainer return')
                completed('navigation', 'navigation')
                sentinel = run.profile_scenario()
                completed('goalsSave', 'goalsSave')
                run.verify_restart(run.binary, sentinel)
                run.denials()
                completed('restartReadback', 'restartReadback')
                images = run.captures(staging)
                completed('captureRestore', 'captureRestore')
                run.stop()
                run.check_current()
                completed('ownedSettlement', 'settlement')
                with contextlib.closing(readonly(run.database)) as database:
                    preserved = fingerprint(database)
                settings = inventory(run.root / 'config')
                # No _?= override: NSIS copies itself to runner TEMP and can remove
                # its installed uninstaller. The invocation-owned job waits for
                # that forwarded child too, not merely the exiting parent.
                execute_installer(program / 'uninstall.exe', ['/S'], cwd=scratch)
                deadline = time.monotonic() + 60
                while time.monotonic() < deadline and (program.exists() or any(key.endswith('-uninstall') for key in registration())):
                    time.sleep(.2)
                if program.exists() or any(key.endswith('-uninstall') for key in registration()) or any(path.exists() for path in shortcuts()):
                    raise ValueError('Uninstaller program/registration/shortcut settlement failed')
                remaining = registration()
                expected_remaining = {key: values for key, values in registered.items() if key.endswith('-manufacturer')}
                if remaining != expected_remaining:
                    raise ValueError('Unexpected registry effects after uninstall')
                completed('uninstall', 'uninstall')
                run.stop()
                assert_preserved(run.database, preserved, run.root / 'config', settings, appdata, marker_inventory)
                completed('dataPreservation', 'dataPreservation')
                # Literal/finite public claims only. No private receipt/log bag.
                manifest = {'schemaVersion': 1, 'sourceSha': source, 'githubRunId': os.environ['GITHUB_RUN_ID'],
                            'githubAttempt': os.environ['GITHUB_RUN_ATTEMPT'], 'os': 'Windows Server 2025',
                            'image': os.environ['ImageVersion'], 'osBuild': str(sys.getwindowsversion().build),
                            'architecture': 'x64', 'webview2Version': runtime, 'installerSha256': record['artifact']['sha256'],
                            'payloadSha256': record['payloadIdentity'], 'outcomes': outcomes, 'limits': evidence.LIMITS, 'images': images}
                private_json(staging / 'manifest.json', manifest)
                evidence.validate(staging, expected_source=source, expected_run=os.environ['GITHUB_RUN_ID'], expected_attempt=os.environ['GITHUB_RUN_ATTEMPT'])
        print(json.dumps({'scenario': 'passed', 'outcomes': outcomes, 'elapsedSeconds': round(time.monotonic() - started, 2),
                          'stageDurationsSeconds': durations, 'images': 6, 'inspection': 'not performed by runner; download and inspect individually',
                          'registry': 'uninstall registration removed; NSIS manufacturer install-location metadata retained unchanged',
                          'resources': 'authored synthetic data/marker retained only until ephemeral runner expiry; no primary access/copy-back'}))
    finally:
        if run is not None:
            try:
                run.stop()
            finally:
                for handle in run.backend_handles:
                    handle.close()
                run.pin.close()
        private_json(scratch / ('outcome-' + str(uuid.uuid4()) + '.json'), {
            'sourceSha': source, 'outcomes': outcomes, 'elapsedSeconds': round(time.monotonic() - started, 2),
            'stageDurationsSeconds': durations,
            'publicationEligible': all(value == 'passed' for value in outcomes.values()),
            'inputMethod': 'synthetic DOM; trusted/native input and menus unavailable',
            'primaryAccessed': False, 'disposition': 'job-local synthetic state expires with runner; not uploaded'})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['producer', 'record', 'scratch', 'evidence']:
        parser.add_argument('--' + name, type=Path, required=True)
    args = parser.parse_args()
    state.canonical(args.producer)
    state.canonical(args.record)
    scenario(args)


if __name__ == '__main__':
    main()
