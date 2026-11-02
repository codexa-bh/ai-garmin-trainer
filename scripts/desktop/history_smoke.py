#!/usr/bin/env python3
"""Finite ordinary-artifact no-date setup and explicitly copied-token Sync evidence."""
import argparse
import contextlib
import hashlib
import http.client
import json
import os
from pathlib import Path
import signal
import stat
import smoke_resources as resources
import sys
import time
import urllib.request
import uuid
from native_smoke import Observer, canonical, fingerprint, private_json, readonly, source_identity, listening
from ordinary_smoke import OrdinaryRun, private_directory
from release_smoke import audit


def selected_tokens(selection, purpose='T0238 private copied-token smoke only'):
    selection = canonical(selection)
    info = selection.stat()
    if info.st_uid != os.getuid() or info.st_mode & 0o777 != 0o600 or info.st_nlink != 1 or info.st_size > 8192:
        raise ValueError('Private explicit bounded token selection required')
    value = json.loads(selection.read_text())
    if set(value) != {'tokenDirectory', 'tokenFiles', 'purpose'} or value['purpose'] != purpose:
        raise ValueError('Explicit copied-token purpose required')
    directory = private_directory(value['tokenDirectory'])
    names = value['tokenFiles']
    if not isinstance(names, list) or len(names) != len(set(names)) or 'garmin_tokens.json' not in names or not set(names) <= {'garmin_tokens.json', 'garmin_tokens.base64'}:
        raise ValueError('Only known explicitly selected token files are admitted')
    return directory, names


def token_bytes(directory, name):
    if name not in ('garmin_tokens.json', 'garmin_tokens.base64'):
        raise ValueError('Known token file required')
    directory = private_directory(directory)
    parent = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        pinned = os.fstat(parent)
        fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
        with os.fdopen(fd, 'rb') as source:
            info = os.fstat(source.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_uid != os.getuid() or info.st_mode & 0o777 != 0o600 or not 0 < info.st_size <= 1048576:
                raise ValueError('Token source metadata refused; originals unchanged')
            data = source.read(1048577)
            def stable(item):
                return (item.st_dev, item.st_ino, item.st_size, item.st_mtime_ns, item.st_ctime_ns, item.st_nlink, item.st_mode, item.st_uid)
            current_parent = os.stat(directory, follow_symlinks=False)
            if len(data) != info.st_size or stable(os.fstat(source.fileno())) != stable(info) or stable(os.stat(name, dir_fd=parent, follow_symlinks=False)) != stable(info) or (current_parent.st_dev, current_parent.st_ino) != (pinned.st_dev, pinned.st_ino):
                raise ValueError('Token source changed; no ambiguous copy')
            return data
    finally:
        os.close(parent)


def copy_tokens(selection, root, purpose='T0238 private copied-token smoke only'):
    directory, names = selected_tokens(selection, purpose)
    destination = private_directory(root) / 'tokens'
    destination.mkdir(mode=0o700)
    hashes = {}
    for name in names:
        data = token_bytes(directory, name)
        hashes[name] = hashlib.sha256(data).hexdigest()
        with open(destination / name, 'xb', opener=lambda p, flags: os.open(p, flags | os.O_NOFOLLOW, 0o600)) as output:
            output.write(data)
    return directory, hashes


def tokens_unchanged(directory, hashes):
    return all(hashlib.sha256(token_bytes(directory, name)).hexdigest() == expected for name, expected in hashes.items())


def prepare_synthetic_history(run):
    """Only stopped, owned, keyless run settings; never select private input."""
    from history_connector import SENTINEL
    root = private_directory(run.root)
    if run.child is not None or listening(run.config['port']):
        raise ValueError('Stopped owned synthetic run required')
    path = root / 'config/settings-v3.json'
    saved = json.loads(path.read_text())
    if saved['keys'] or saved['fields'].get('GARMIN_MCP_TOKEN_DIR'):
        raise ValueError('Keyless unconnected synthetic settings required')
    python = str(Path(sys.executable).resolve())
    script = root / 'synthetic_history_connector.py'
    if any(char.isspace() for char in str(script)):
        raise ValueError('Synthetic connector arguments require a whitespace-free owned path')
    (root / 'tokens').mkdir(mode=0o700)
    if any(char.isspace() for char in python):
        raise ValueError('Unambiguous Python shebang required')
    connector = b'#!' + python.encode() + b'\n' + Path(__file__).with_name('history_connector.py').read_bytes().split(b'\n', 1)[1]
    for target, data, mode in [(script, connector, 0o700), (root / 'tokens/garmin_tokens.json', SENTINEL, 0o600)]:
        with open(target, 'xb', opener=lambda p, flags: os.open(p, flags | os.O_NOFOLLOW, mode)) as output:
            output.write(data)
    # Only an existing allowlisted executable field; reviewed package arguments
    # remain immutable. The authored executable validates that exact argv.
    saved['fields'].update({'GARMIN_MCP_COMMAND': str(script), 'GARMIN_MCP_TOKEN_DIR': str(root / 'tokens')})
    staged = root / 'config/synthetic-history-settings.json'
    private_json(staged, saved)
    os.replace(staged, path)


def prepare_dependency_scenario(run, scenario):
    """Finite stopped synthetic-only variants; never change a live executable/config."""
    if scenario not in ('missing', 'unknown', 'healthy'):
        raise ValueError('Closed dependency scenario required')
    root = private_directory(run.root)
    if run.child is not None or listening(run.config['port']):
        raise ValueError('Stopped owned dependency run required')
    path = root / 'config/settings-v3.json'
    saved = json.loads(path.read_text())
    from history_connector import SENTINEL
    if saved['keys'] or (root / 'tokens/garmin_tokens.json').read_bytes() != SENTINEL or saved['fields'].get('GARMIN_MCP_TOKEN_DIR') != str(root / 'tokens'):
        raise ValueError('Exact synthetic-only connection required')
    if scenario == 'unknown':
        script = root / 'unknown_connector.py'
        with open(script, 'xb', opener=lambda p, flags: os.open(p, flags | os.O_NOFOLLOW, 0o700)) as output:
            output.write(b'#!' + str(Path(sys.executable).resolve()).encode() + b'\nraise SystemExit(2)\n')
    else:
        script = root / ('missing_uvx' if scenario == 'missing' else 'synthetic_history_connector.py')
        if scenario == 'missing':
            # Existing canonical paths are required by unchanged Settings validation.
            # A nonexecutable fixture resolves to the product's unavailable-tool sentinel.
            with open(script, 'xb', opener=lambda p, flags: os.open(p, flags | os.O_NOFOLLOW, 0o600)) as output:
                output.write(b'synthetic nonexecutable launcher\n')
    saved['fields']['GARMIN_MCP_COMMAND'] = str(script)
    staged = root / ('config/dependency-' + scenario + '.json')
    private_json(staged, saved)
    os.replace(staged, path)


class HistoryRun(OrdinaryRun):
    def settings_action(self, action):
        return self.command({'type': 'historySettings', 'action': action})

    def wait_settings(self, predicate, label):
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            value = self.settings_action('observe')
            if predicate(value):
                return value
            failure = value.get('setupFailure')
            if failure:
                if not isinstance(failure, str) or len(failure) > 512:
                    raise ValueError('Native settings failure schema refused')
                private_json(self.root / ('setup-failure-' + str(uuid.uuid4()) + '.json'), {'assertion':label,'observation':value})
                raise RuntimeError('Native settings operation failed: ' + failure)
            time.sleep(.1)
        private_json(self.root / ('setup-failure-' + str(uuid.uuid4()) + '.json'), {'assertion': label, 'observation': value})
        raise TimeoutError('History setup readiness assertion failed')

    def setup_start(self):
        if self.child is not None or listening(self.config['port']):
            raise ValueError('Owned root/endpoint must be stopped')
        self.launches += 1
        self.child = self.spawn(self.binary, self.root / f'native-{self.launches}.log')
        self.pids.append(self.child.pid)
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            if self.child.poll() is not None:
                raise RuntimeError('Owned native exited during first-run admission; inspect private log')
            try:
                identity = self.http('/identity')
            except (OSError, http.client.HTTPException):
                time.sleep(.1)
                continue
            if not self.accept_identity(identity) or identity['origin'] is not None:
                raise ValueError('First-run native identity or missing-settings state refused')
            self.wait_settings(lambda value: value.get('windowReady') is True, 'owned local Settings document')
            self.settings_action('open')
            self.wait_settings(lambda value: value['ready'] and value['dataStep'] and value['automaticHistory'], 'no-date first run')
            return
        raise TimeoutError('First-run native identity deadline')

    def wait_backend(self):
        deadline = time.monotonic() + 100
        while time.monotonic() < deadline:
            if self.child.poll() is not None:
                raise RuntimeError('Owned native exited during Finish')
            try:
                identity = self.http('/identity')
            except TimeoutError:
                # Read-only identity may wait behind atomic native creation.
                # The overall readiness deadline still binds; HTTP403 never retries.
                continue
            if not self.accept_identity(identity):
                raise ValueError('Owned native identity changed')
            if identity['origin']:
                self.origin = identity['origin']
                if not self.origin.startswith('http://127.0.0.1:') or int(self.origin.rsplit(':', 1)[1]) == self.config['port']:
                    raise ValueError('Owned backend origin refused')
                if identity.get('runtimeReady') is not True:
                    time.sleep(.1)
                    continue
                diagnostic = identity.get('rendererDiagnostic') or {}
                if all(diagnostic.get(key) is True for key in ('dashboard', 'bootstrap', 'ipc')):
                    value = self.command({'type': 'observe'})
                    if value['dashboard'] and value['hydrated']:
                        private_json(self.root / f'readiness-{self.launches}.json', {**identity, 'rendererRoundTrip': True})
                        return
            else:
                setup = self.settings_action('observe')
                failure = setup.get('setupFailure')
                if failure:
                    if not isinstance(failure, str) or len(failure) > 512:
                        raise ValueError('Native setup failure schema refused')
                    private_json(self.root / 'native-setup-failure.json', {'nativeStaticFailure':failure,'observation':setup})
                    raise RuntimeError('Native Finish failed: ' + failure)
            time.sleep(.1)
        raise TimeoutError('Finish/backend deadline; inspect commit state, no Finish replay')

    def onboarding(self):
        self.setup_start()
        self.settings_action('createNew' if self.descriptor['historySetup'] == 'create-new' else 'useExisting')
        images = [{'scenario': 'first-run-no-date-data', **self.settings_action('capture')}]
        for _ in range(3):
            self.settings_action('next')
        self.wait_settings(lambda value: value['reviewStep'] and value['automaticHistory'], 'no-date review')
        images.append({'scenario': 'first-run-no-date-review', **self.settings_action('capture')})
        private_json(self.root / 'onboarding-captures.json', {'captures':images, 'source':self.config['source'], 'boot':self.boot})
        self.settings_action('finish')  # Exactly once. Unknown effect must be reconciled, never retried.
        self.wait_backend()
        self.stop()
        self.start(self.binary)
        self.settings_action('open')
        self.wait_settings(lambda value: value['ready'] and not value['firstRun'] and value['automaticHistory'], 'saved automatic direct launch')
        return images

    def optional_limit(self):
        original_origin = self.origin
        self.settings_action('legacyLimit')
        self.settings_action('save')
        self.wait_settings(lambda value: value['ready'] and value['savedForNextLaunch'] and value['legacyLimit'], 'legacy optional-limit Save')
        self.settings_action('dismissRestart')
        if self.http('/identity')['origin'] != original_origin:
            raise ValueError('Save unexpectedly changed running backend')
        image = {'scenario': 'saved-optional-limit', **self.settings_action('capture')}
        self.stop()
        self.start(self.binary)
        self.settings_action('open')
        self.wait_settings(lambda value: value['ready'] and value['legacyLimit'], 'limit persisted after explicit restart')
        self.settings_action('automatic')
        self.settings_action('save')
        self.wait_settings(lambda value: value['ready'] and value['savedForNextLaunch'] and value['automaticHistory'], 'clear limit Save')
        self.settings_action('dismissRestart')
        self.stop()
        self.start(self.binary)
        return image

    def summary(self):
        # Fixed read from the verified owned backend; retain only bounded safe aggregates.
        with urllib.request.urlopen(self.origin + '/api/summary', timeout=12) as response:
            data = response.read(2 * 1024 * 1024 + 1)
            if len(data) > 2 * 1024 * 1024:
                raise ValueError('Summary bound')
            value = json.loads(data)
        history = value.get('history') or {}
        health = history.get('health') or {}
        outcome = history.get('outcome')
        if outcome is not None and outcome not in ('settled', 'failed', 'budget-limited', 'cancelled', 'running'):
            raise ValueError('Unexpected safe history outcome')
        operation = (value.get('discovery') or {}).get('operation') or {}
        return {'outcome': outcome, 'active': value.get('syncActive') is True,
                'batches': operation.get('batches', 0), 'operationAttempts': operation.get('attempts', 0),
                'healthChecks': health.get('checks'), 'healthChecksWithMetrics': health.get('checksWithMetrics'),
                'nextHealthDate': health.get('nextDate'), 'remoteLowerBound': history.get('remoteLowerBound'),
                'operations': history.get('operations'), 'failureClass': history.get('failureClass')}

    def wait_sync(self, predicate, seconds=195):
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            value = self.command({'type': 'sync', 'action': 'observe'})
            if predicate(value):
                return value
            time.sleep(.25)
        private_json(self.root / ('sync-observation-timeout-' + str(uuid.uuid4()) + '.json'), {'rendered':value, 'summary':self.summary()})
        raise TimeoutError('Finite Sync observation deadline; no mutation replay')

    def settle_claim(self):
        deadline = time.monotonic() + 40
        while time.monotonic() < deadline:
            if not self.summary()['active']:
                self.command({'type': 'sync', 'action': 'refresh'})
                return
            time.sleep(.25)
        raise TimeoutError('Owned Sync claim did not settle; no duplicate continuation')

    def synthetic_sync(self):
        """Two explicit operations, each cancelled after two durable batches.

        No product budget override, time acceleration or fabricated UI response.
        The actual app owns SQL/NDJSON/renderer/cancel; only stdio data is authored.
        """
        images = self.sync_captures = []
        self.command({'type':'setViewport', 'preset':'wide'})
        self.command({'type':'click', 'target':'Sync'})
        self.wait(lambda value: value['view'] == 'Sync', 'synthetic Sync')
        initial = self.summary()
        if initial['active']:
            raise ValueError('Passive navigation unexpectedly started sync')
        settled = []
        for index in range(2):
            before = self.summary()
            self.wait_sync(lambda value: value['startEnabled'], 10)
            self.command({'type':'sync', 'action':'start' if index == 0 else 'continue'})
            self.wait_sync(lambda value: value['running'] and value['cancelEnabled'] and value['progressStarted'], 15)
            # Hiding Sync must retain the exact operation rather than replay POST.
            self.command({'type':'click', 'target':'Back to chat'})
            if not self.summary()['active']:
                raise ValueError('Navigation lost operation ownership')
            self.command({'type':'click', 'target':'Sync'})
            self.wait(lambda value: value['view'] == 'Sync', 'return to active Sync')
            deadline = time.monotonic() + 150
            while time.monotonic() < deadline:
                current = self.summary()
                if current['outcome'] == 'failed' or current['operationAttempts'] > 150:
                    raise ValueError('Synthetic operation failed/exceeded finite evidence envelope')
                if current['batches'] >= 2:
                    break
                time.sleep(.25)
            else:
                raise TimeoutError('Two automatic batches not observed within finite envelope')
            for preset in ('wide', 'narrow'):
                self.command({'type':'setViewport', 'preset':preset})
                images.append({'scenario':f'synthetic-{index}-automatic-batches-{preset}', **self.command({'type':'captureView', 'view':'sync', 'preset':preset})})
            self.command({'type':'sync', 'action':'cancel'})
            self.wait_sync(lambda value: not value['running'] and value['paused'], 40)
            self.settle_claim()
            after = self.summary()
            if after['active'] or after['outcome'] != 'cancelled' or after['healthChecks'] <= (before['healthChecks'] or 0):
                raise ValueError('Synthetic cancellation/progress was not durable')
            images.append({'scenario':f'synthetic-{index}-cancelled', **self.command({'type':'captureView', 'view':'sync', 'preset':'narrow'})})
            settled.append({'before':before, 'after':after})
            private_json(self.root / f'synthetic-sync-{index}.json', {'source':self.config['source'], 'boot':self.boot, 'captures':images, 'settled':settled})
            self.stop()
            self.start(self.binary)
            self.command({'type':'click', 'target':'Sync'})
            self.wait(lambda value: value['view'] == 'Sync', 'restart explicit Resume')
            restored = self.summary()
            if restored['active'] or restored['healthChecks'] != after['healthChecks']:
                raise ValueError('Restart replayed or lost durable history')
        private_json(self.root / 'synthetic-sync.json', {'source':self.config['source'], 'captures':images, 'settled':settled, 'maxInvocations':2, 'maxObservationSecondsPerOperation':150, 'realGarminCertified':False})

    def dependency_guidance(self):
        images = self.sync_captures = []
        for scenario in ('missing', 'unknown', 'healthy'):
            prepare_dependency_scenario(self, scenario)
            self.start(self.binary)
            self.command({'type':'click', 'target':'Sync'})
            self.wait(lambda value: value['view'] == 'Sync', 'dependency Sync')
            if self.summary()['active']:
                raise ValueError('Passive no-tool navigation started an integration')
            self.wait_sync(lambda value: value['startEnabled'], 10)
            self.command({'type':'sync', 'action':'start'})  # Once per changed scenario, never failure retry.
            if scenario == 'healthy':
                self.wait_sync(lambda value: value['running'] and value['progressStarted'], 15)
                # Initial rendered log only proves the click, not server/connector admission.
                deadline = time.monotonic() + 15
                while time.monotonic() < deadline:
                    healthy = self.summary()
                    if healthy['active'] and healthy['operationAttempts'] >= 2:
                        break
                    time.sleep(.1)
                else:
                    private_json(self.root / 'healthy-admission-timeout.json', healthy)
                    raise TimeoutError('Healthy synthetic connector admission not observed; no Cancel/replay')
                self.command({'type':'sync', 'action':'cancel'})
                self.wait_sync(lambda value: value['paused'] and not value['running'], 40)
            else:
                self.wait_sync(lambda value: value['failed'] and not value['running'], 15)
            self.settle_claim()
            for preset in ('wide', 'narrow'):
                self.command({'type':'setViewport', 'preset':preset})
                images.append({'scenario':'dependency-' + scenario + '-' + preset, **self.command({'type':'captureView', 'view':'sync', 'preset':preset})})
            private_json(self.root / ('dependency-' + scenario + '-evidence.json'), {'captures':images, 'summary':self.summary(), 'source':self.config['source'], 'boot':self.boot, 'realGarminCertified':False})
            self.command({'type':'setViewport', 'preset':'wide'})
            self.command({'type':'click', 'target':'Back to chat'})
            self.wait(lambda value: value['view'] == 'Trainer', 'saved offline Trainer')
            self.command({'type':'click', 'target':'Health'})
            self.wait(lambda value: value['view'] == 'Health', 'saved offline Health')
            self.stop()

    def continue_once(self):
        """One explicitly selected checkpoint continuation; never replay Cancel/start."""
        self.command({'type': 'setViewport', 'preset': 'wide'})
        self.command({'type': 'click', 'target': 'Sync'})
        self.wait(lambda value: value['view'] == 'Sync', 'Sync continuation')
        before = self.summary()
        if before['active'] or before['outcome'] not in ('failed', 'cancelled', 'budget-limited', 'settled'):
            raise ValueError('Stopped explicit prior discovery checkpoint required')
        images = self.sync_captures = []
        self.wait_sync(lambda value: value['startEnabled'], 40)
        self.command({'type': 'sync', 'action': 'continue'})  # Exactly one mutation.
        started = self.wait_sync(lambda value: value['running'] or value['failed'], 15)
        if not started['failed']:
            images.append({'scenario': 'single-continuation-progress', **self.command({'type': 'captureView', 'view': 'sync', 'preset': 'wide'})})
            private_json(self.root / 'single-continuation-progress.json', {'captures':images, 'source':self.config['source'], 'boot':self.boot})
            result = self.wait_sync(lambda value: not value['running'] and (value['paused'] or value['completed'] or value['failed']))
        else:
            result = started
        self.settle_claim()
        after = self.summary()
        images.append({'scenario': 'single-continuation-settled', **self.command({'type': 'captureView', 'view': 'sync', 'preset': 'wide'})})
        private_json(self.root / 'single-continuation.json', {'before':before, 'after':after, 'rendered':result,
                     'captures':images, 'maxInvocations':1, 'maxRemoteAttempts':96, 'maxSeconds':180,
                     'source':self.config['source'], 'boot':self.boot, 'remoteLowerBoundProven':False})
        if result['failed']:
            raise ValueError('Single continuation failed; no retry or login')

    def real_sync(self):
        self.command({'type': 'setViewport', 'preset': 'wide'})
        self.command({'type': 'click', 'target': 'Sync'})
        self.wait(lambda value: value['view'] == 'Sync', 'Sync')
        before = self.summary()
        images = self.sync_captures = []
        self.command({'type': 'sync', 'action': 'start'})
        self.wait_sync(lambda value: value['running'] and value['cancelEnabled'] and value['progressStarted'], 15)
        images.append({'scenario': 'real-sync-progress', **self.command({'type': 'captureView', 'view': 'sync', 'preset': 'wide'})})
        private_json(self.root / 'real-sync-progress.json', {'captures': images, 'before': before,
                     'source': self.config['source'], 'boot': self.boot})
        self.command({'type': 'sync', 'action': 'cancel'})
        cancelled = self.wait_sync(lambda value: not value['running'] and (value['paused'] or value['completed'] or value['failed']), 40)
        if cancelled['failed']:
            raise ValueError('Real copied-token Sync failed; no automatic login or retry')
        self.settle_claim()
        images.append({'scenario': 'real-sync-cancelled', **self.command({'type': 'captureView', 'view': 'sync', 'preset': 'wide'})})
        private_json(self.root / 'real-sync-cancelled.json', {'captures': images, 'cancelled': cancelled,
                     'summary': self.summary(), 'source': self.config['source'], 'boot': self.boot})
        settled = []
        for _ in range(2):  # Two explicit finite continuations, never automatic background work.
            self.wait_sync(lambda value: value['startEnabled'], 40)
            self.command({'type': 'sync', 'action': 'continue'})
            started = self.wait_sync(lambda value: value['running'] or value['failed'], 15)
            if started['failed']:
                private_json(self.root / 'real-sync-failure.json', {'before': before, 'summary': self.summary(), 'rendered': started, 'cancelled': cancelled, 'captures': images})
                raise ValueError('Real copied-token continuation failed during start; no login/retry')
            result = self.wait_sync(lambda value: not value['running'] and (value['paused'] or value['completed'] or value['failed']))
            self.settle_claim()
            settled.append({'rendered': result, 'summary': self.summary()})
            if result['failed']:
                private_json(self.root / 'real-sync-failure.json', {'before': before, 'settled': settled, 'cancelled': cancelled, 'captures': images})
                raise ValueError('Real copied-token continuation failed; preserve error, no login/retry')
        images.append({'scenario': 'real-sync-continued', **self.command({'type': 'captureView', 'view': 'sync', 'preset': 'wide'})})
        private_json(self.root / 'real-sync.json', {'before': before, 'cancelled': cancelled, 'settled': settled,
                     'maxInvocations': 3, 'maxRemoteAttempts': 288, 'maxSeconds': 540, 'remoteLowerBoundProven': False})
        return images


@resources.invocation
def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--scratch', required=True)
    parser.add_argument('--input-file', required=True)
    parser.add_argument('--bundle', required=True)
    parser.add_argument('--dependency-guidance', action='store_true', help='Three fixed synthetic launcher scenarios, no account calls')
    parser.add_argument('--synthetic-sync', action='store_true', help='Finite authored stdio data on stopped owned copies; no account calls')
    parser.add_argument('--token-input', help='Explicit private selector; never normal-settings discovery')
    parser.add_argument('--continuation-only', action='store_true', help='One explicitly selected prior-checkpoint continuation; no repeated Cancel/start batch')
    args = parser.parse_args()
    if args.dependency_guidance and (args.synthetic_sync or args.token_input or args.continuation_only):
        parser.error('Dependency evidence is synthetic-only and cannot combine execution scopes')
    if args.synthetic_sync and (args.token_input or args.continuation_only):
        parser.error('Synthetic history cannot consume private tokens or legacy continuation authority')
    if args.token_input:
        parser.error('The historical T0238 live envelope cannot authorize the new interactive operation. Independently approve and review a finite live envelope before use; no private input opened.')
    if args.continuation_only and not args.token_input:
        parser.error('--continuation-only requires explicitly selected copied tokens')
    os.umask(0o077)
    scratch = private_directory(resources.configure(canonical(args.scratch)))
    selection = canonical(args.input_file)
    info = selection.stat()
    if info.st_mode & 0o777 != 0o600 or info.st_nlink != 1 or info.st_uid != os.getuid() or info.st_size > 8192:
        raise ValueError('Private bounded database selection required')
    value = json.loads(selection.read_text())
    if set(value) != {'database'}:
        raise ValueError('Explicit database-only input required')
    database = canonical(value['database'])
    bundle = canonical(args.bundle)
    source = source_identity()
    inventory = audit(bundle)
    if json.loads((bundle / 'Contents/Resources/resources/provenance.json').read_text()).get('sourceFingerprint') != source:
        raise ValueError('Build current final source before history evidence')
    runs = []
    observer = None
    token_source = None
    receipt = {'scenarioPassed': False, 'source': source, 'artifactKind': 'ordinary',
               'syntheticDomInput': True, 'normalDefaultModeCertified': False,
               'captures': [], 'cleanup': 'private copy-only state/captures retained to task-scratch expiry; no copy-back'}
    try:
        observer = Observer(scratch)
        for mode in (['use-existing'] if args.continuation_only or args.dependency_guidance else ['create-new', 'use-existing']):
            run = HistoryRun(scratch, database, source, bundle, inventory, history_setup=mode)
            runs.append(run)
            run.observer = observer
            receipt['captures'].extend(run.onboarding())
            if not args.dependency_guidance:
                receipt['captures'].append(run.optional_limit())
            run.stop()
        run = runs[-1]
        if args.dependency_guidance:
            prepare_synthetic_history(run)
            run.dependency_guidance()
            receipt['dependencyGuidance'] = 'actual missing/unknown/healthy synthetic launcher actions; offline navigation retained; no real sign-in/interpreter failure certification'
            receipt['realGarmin'] = 'unavailable: no private input or fresh login authority'
        elif args.synthetic_sync:
            prepare_synthetic_history(run)
            run.start(run.binary)
            run.synthetic_sync()
            receipt['syntheticHistory'] = 'two explicit operations with automatic batches, cancel, passive navigation, restart and explicit Resume; authored stdio only'
            receipt['realGarmin'] = 'unavailable: no current private-input or finite live account authority'
        elif args.token_input:
            token_source, token_hashes = copy_tokens(args.token_input, run.root)
            # This is our own keyless settings, not operator/native settings or provider discovery.
            path = run.root / 'config/settings-v3.json'
            saved = json.loads(path.read_text())
            if saved['keys']:
                raise ValueError('History runner never copies provider keys')
            saved['fields']['GARMIN_MCP_TOKEN_DIR'] = str(run.root / 'tokens')
            staged = run.root / 'config/copied-token-settings.json'
            private_json(staged, saved)
            os.replace(staged, path)
            run.start(run.binary)
            if args.continuation_only:
                run.continue_once()
                receipt['realGarmin'] = 'one explicit copied-token native-owned checkpoint continuation passed; no new Cancel/start batch'
            else:
                run.real_sync()  # finally retains partial captures even when continuation refuses.
                receipt['realGarmin'] = 'copied-token native-owned Sync/cancel/two explicit continuations passed'
        else:
            receipt['realGarmin'] = 'unavailable: no explicit private copied-token input'
            run.start(run.binary)
            run.command({'type': 'setViewport', 'preset': 'wide'})
            run.command({'type': 'click', 'target': 'Sync'})
            run.wait(lambda value: value['view'] == 'Sync', 'keyless Sync view')
            receipt['captures'].append({'scenario': 'keyless-sync-idle', **run.command({'type': 'captureView', 'view': 'sync', 'preset': 'wide'})})
        if source_identity() != source or audit(bundle) != inventory or any(audit(run.bundle) != inventory for run in runs):
            raise ValueError('Source/artifact changed during evidence')
        receipt['scenarioPassed'] = True
    finally:
        errors = []
        for run in runs:
            try:
                run.stop()
            except Exception:
                errors.append('Owned shutdown failed; inspect private run evidence')
        if observer:
            try:
                receipt['noninterference'] = observer.stop([pid for run in runs for pid in run.pids])
            except Exception:
                errors.append('Noninterference observer failed; inspect private evidence')
        with contextlib.closing(readonly(database)) as original:
            receipt['originalDatabaseUnchanged'] = all(fingerprint(original) == run.original for run in runs)
        receipt['originalTokensUnchanged'] = tokens_unchanged(token_source, token_hashes) if token_source else (None if args.token_input else True)
        receipt['captures'].extend(capture for run in runs for capture in getattr(run, 'sync_captures', []))
        receipt.update({'runs': [str(run.root) for run in runs], 'shutdownErrors': errors})
        private_json(scratch / ('history-receipt-' + str(uuid.uuid4()) + '.json'), receipt)
        if errors or not receipt['originalDatabaseUnchanged'] or not receipt['originalTokensUnchanged']:
            raise RuntimeError('Original preservation/owned shutdown gate failed; private evidence retained')
    print(json.dumps(receipt))


if __name__ == '__main__':
    def interrupted(_signal, _frame):
        raise KeyboardInterrupt('Owned history smoke interrupted')
    signal.signal(signal.SIGTERM, interrupted)
    main()
