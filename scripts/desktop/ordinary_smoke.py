#!/usr/bin/env python3
"""Unmodified outside-checkout ordinary bundles; closed keyless rendered/capture smoke only."""
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
import stat
import subprocess
import time
import uuid
from native_smoke import Observer, Run, canonical, fingerprint, private_json, readonly, source_identity
from release_smoke import audit


def inventory_hash(inventory):
    digest = hashlib.sha256()
    for path, content in sorted(inventory.items()):
        if any(char in path for char in '\x00\r\n'):
            raise ValueError('Unrepresentable inventory path')
        digest.update((path + '\x00' + content + '\n').encode())
    return digest.hexdigest()


def private_directory(path):
    path = canonical(path)
    info = path.stat()
    if not path.is_dir() or info.st_uid != os.getuid() or info.st_mode & 0o777 != 0o700:
        raise ValueError('Canonical owner-private scratch required; never adopt or chmod inputs')
    return path


class OrdinaryRun(Run):
    def __init__(self, scratch, database, source, bundle, inventory):
        super().__init__(scratch, database, source, ordinary=True)
        self.artifact = inventory_hash(inventory)
        self.boot = None
        self.previous_boot = None
        self.rejected_pids = []
        self.bundle = self.root / 'Garmin Trainer.app'
        shutil.copytree(bundle, self.bundle)
        if audit(self.bundle) != inventory:
            raise ValueError('Ordinary bundle copy changed inventory')
        self.binary = self.bundle / 'Contents/MacOS/garmin-trainer-desktop'
        self.descriptor = {
            'schemaVersion': 1, 'runId': self.id, 'root': str(self.root),
            'sourceFingerprint': source, 'artifactInventoryHash': self.artifact,
            'controlPort': self.config['port'], 'capability': self.config['token'],
        }
        private_json(self.root / 'launch.json', self.descriptor)
        root_info = self.root.stat()
        launch_info = (self.root / 'launch.json').stat()
        self.root_identity = (root_info.st_dev, root_info.st_ino)
        self.launch_identity = (launch_info.st_dev, launch_info.st_ino)
        self.previous_token = None
        private_json(self.root / 'artifact.json', {'artifactKind': 'ordinary', 'sourceFingerprint': source,
                     'artifactInventoryHash': self.artifact, 'files': len(inventory),
                     'bundleBytesRewritten': False, 'bundleIdentityRewritten': False})

    def prepare_composer(self):
        # Run-owned keyless configuration only; original DB/settings are never edited.
        base = json.loads((self.root / 'config/settings-v2.json').read_text())
        catalog = {'version': 1, 'defaultEntryId': 'entry_footer_other', 'entries': [
            {'id': 'entry_footer_long', 'provider': 'ollama', 'modelId': 'T0246/Long-local-model-name:exact-tag',
             'displayName': 'T0246 long descriptive local model selection for narrow composer footer'},
            {'id': 'entry_footer_other', 'provider': 'ollama', 'modelId': 'T0246/Alternate:Tag', 'displayName': 'T0246 alternate'}]}
        private_json(self.root / 'config/settings-v3.json', {**base, 'version': 3, 'chatCatalog': catalog})

    def composer_wait(self, predicate, label):
        deadline = time.monotonic() + 8
        while time.monotonic() < deadline:
            observed = self.command({'type': 'composer', 'action': 'observe'})
            if predicate(observed):
                return observed
            time.sleep(.1)  # Bounded read-only rendered readiness, never mutation retry.
        private_json(self.root / ('composer-failure-' + str(uuid.uuid4()) + '.json'), {'assertion': label, 'observation': observed})
        raise TimeoutError('Composer assertion deadline: ' + label)

    def model_choice(self):
        if not self.origin:
            raise ValueError('Verified owned backend required')
        client = http.client.HTTPConnection('127.0.0.1', int(self.origin.rsplit(':', 1)[1]), timeout=5)
        try:
            client.request('GET', '/api/model-settings')
            response = client.getresponse()
            raw = response.read(32 * 1024 + 1)
            if response.status != 200 or len(raw) > 32 * 1024:
                raise ValueError('Owned model metadata read failed/bounded')
            value = json.loads(raw)
            return value.get('selected'), value.get('effective', {}).get('source')
        finally:
            client.close()

    def chat_hash(self):
        with contextlib.closing(readonly(self.database)) as database:
            digest = hashlib.sha256()
            for table in ['conversation', 'message']:
                for row in sorted(repr(row) for row in database.execute('select * from ' + table)):
                    digest.update(row.encode())
            return digest.hexdigest()

    def composer_scenario(self):
        self.command({'type': 'setViewport', 'preset': 'wide'})
        self.command({'type': 'click', 'target': 'Close Profile & data'})
        self.wait(lambda value: value['view'] == 'Trainer', 'Trainer composer')
        self.composer_wait(lambda value: value['modelReady'], 'catalog ready')
        before = self.chat_hash()
        self.command({'type': 'composer', 'action': 'draft'})
        self.command({'type': 'composer', 'action': 'keys'})
        self.command({'type': 'composer', 'action': 'choose'})
        self.composer_wait(lambda value: value['modelReady'] and value['savedChoice'], 'saved long entry')
        if self.model_choice() != ('entry_footer_long', 'saved'):
            raise ValueError('UI model choice did not persist')
        images = []
        for state in ['saved', 'default']:
            if state == 'default':
                self.command({'type': 'composer', 'action': 'reset'})
                self.composer_wait(lambda value: value['modelReady'] and value['defaultChoice'], 'configured default reset')
                if self.model_choice() != (None, 'env'):
                    raise ValueError('UI model reset did not persist')
            for preset in ['wide', 'narrow']:
                self.command({'type': 'setViewport', 'preset': preset})
                observed = self.command({'type': 'composer', 'action': 'observe'})
                image = self.command({'type': 'captureView', 'view': 'composer', 'preset': preset})
                images.append({'state': state, 'preset': preset, **image, 'observation': observed})
                private_json(self.root / ('composer-capture-' + state + '-' + preset + '.json'), images[-1])
                if not all(observed[key] for key in ['singleControl', 'footerOrder', 'fitsViewport', 'draftMatches', 'textareaStable', 'keysNoSend']):
                    raise ValueError('Composer geometry/draft/key gate failed; inspect capture/boolean receipt')
        if self.chat_hash() != before:
            raise ValueError('Selector/draft actions changed saved chat data')
        private_json(self.root / 'composer-scenario.json', {'passed': True, 'captures': images,
                     'modelChoiceAndResetPersisted': True, 'chatDataUnchanged': True,
                     'keyboard': 'synthetic DOM Enter/Space on owned selector; not trusted/native/hardware input',
                     'providerSend': 'not invoked', 'cleanup': 'copy-only preference/draft/Goals deferred to task-scratch expiry'})

    def conversation_state(self):
        # Only bounded booleans/counts leave the run-owned disposable DB.
        with contextlib.closing(readonly(self.database)) as database:
            rows = database.execute('select id,title from conversation').fetchall()
            saved = database.execute("select value from app_metadata where key='chat.active_conversation.v1'").fetchone()
            titles = {identifier: title for identifier, title in rows}
            chosen = titles.get(saved[0]) if saved else None
            first = 'T0250-first-' + self.id.replace('-', '')
            second = 'T0250-second-' + self.id.replace('-', '')
            return {'count': len(rows), 'savedFirst': chosen == first, 'savedSecond': chosen == second,
                    'savedNew': chosen == 'New chat', 'messagesEmpty': database.execute('select count(*) from message').fetchone()[0] == 0,
                    'onlySynthetic': all(title in [first, second, 'New chat'] for title in titles.values()),
                    'defaultAbsent': 'default' not in titles}

    def conversation_wait(self, predicate, label):
        deadline = time.monotonic() + 8
        observed = {}
        while time.monotonic() < deadline:
            observed = self.command({'type': 'conversation', 'action': 'observe'})
            state = self.conversation_state()
            if predicate(observed, state):
                return observed
            time.sleep(.1)  # Read-only bounded observation; never retry a mutation.
        private_json(self.root / ('conversation-failure-' + str(uuid.uuid4()) + '.json'), {'assertion': label, 'observation': observed, 'state': state})
        raise TimeoutError('Conversation assertion deadline: ' + label)

    def conversation_open_history(self):
        ui = self.command({'type': 'conversation', 'action': 'observe'})
        if not ui['historyVisible']:
            if not ui['historyExpanded']:
                if not ui['historyToggleVisible']:
                    self.command({'type': 'conversation', 'action': 'open-menu'})
                    self.conversation_wait(lambda ui, db: ui['historyToggleVisible'], 'mobile history toggle')
                self.command({'type': 'conversation', 'action': 'open-history'})
                self.conversation_wait(lambda ui, db: ui['historyExpanded'], 'history open intent')
            self.command({'type': 'conversation', 'action': 'settle-history'})
            self.conversation_wait(lambda ui, db: ui['historyVisible'], 'visible history')

    def conversation_create(self, slot):
        if slot not in ['first', 'second']:
            raise ValueError('Finite synthetic slot required')
        self.conversation_open_history()
        self.command({'type': 'conversation', 'action': 'new'})
        self.conversation_wait(lambda ui, db: ui['newSelected'] and db['savedNew'], 'explicit New committed')
        self.command({'type': 'conversation', 'action': 'menu-new'})
        self.conversation_wait(lambda ui, db: ui['menuReady'], 'New menu')
        self.command({'type': 'conversation', 'action': 'rename-new'})
        self.conversation_wait(lambda ui, db: ui['renameReady'], 'New rename dialog')
        self.command({'type': 'conversation', 'action': 'title-' + slot})
        self.conversation_wait(lambda ui, db: ui['renameDraftReady'], 'fixed synthetic title draft')
        self.command({'type': 'conversation', 'action': 'save-title'})
        self.conversation_wait(lambda ui, db: ui[slot + 'Selected'] and db['saved' + slot.title()] and not ui['renameReady'], 'synthetic title saved')

    def conversation_delete(self, slot):
        if slot not in ['first', 'second']:
            raise ValueError('Finite synthetic slot required')
        self.conversation_open_history()
        self.command({'type': 'conversation', 'action': 'menu-' + slot})
        self.conversation_wait(lambda ui, db: ui['menuReady'], 'synthetic delete menu')
        self.command({'type': 'conversation', 'action': 'delete-' + slot})

    def conversation_scenario(self):
        self.command({'type': 'setViewport', 'preset': 'wide'})
        self.command({'type': 'click', 'target': 'Close Profile & data'})
        self.wait(lambda value: value['view'] == 'Trainer', 'Trainer conversations')
        self.conversation_open_history()
        self.conversation_wait(lambda ui, db: ui['selectionReady'] and ui['empty'] and db['count'] == 0, 'non-creating empty startup')
        self.conversation_create('first')
        self.conversation_wait(lambda ui, db: ui['firstSelected'] and db['savedFirst'], 'explicit first saved')
        self.conversation_create('second')
        self.conversation_wait(lambda ui, db: ui['secondSelected'] and db['savedSecond'], 'explicit second saved')
        self.command({'type': 'conversation', 'action': 'choose-first'})
        self.conversation_wait(lambda ui, db: ui['firstSelected'] and db['savedFirst'], 'older first saved')
        self.command({'type': 'click', 'target': 'Sync'})
        self.wait(lambda value: value['view'] == 'Sync', 'Sync while selection retained')
        self.command({'type': 'click', 'target': 'Back to chat'})
        self.conversation_wait(lambda ui, db: ui['firstSelected'] and db['savedFirst'], 'selection after navigation')
        origin, boot = self.origin, self.boot
        self.stop()
        self.start(self.binary)
        if self.origin == origin or self.boot == boot:
            raise ValueError('Conversation restart did not use a fresh native origin/boot')
        self.conversation_wait(lambda ui, db: ui['selectionReady'] and ui['firstSelected'] and ui['secondPresent'] and db['savedFirst'], 'restored older first on new origin')
        images = []
        for preset in ['wide', 'narrow']:
            self.command({'type': 'setViewport', 'preset': preset})
            self.conversation_open_history()
            image = self.command({'type': 'captureView', 'view': 'conversation', 'preset': preset})
            images.append({'state': 'restored-first', 'preset': preset, **image})
        self.command({'type': 'setViewport', 'preset': 'wide'})
        self.conversation_delete('second')
        self.conversation_wait(lambda ui, db: ui['firstSelected'] and not ui['secondPresent'] and db['savedFirst'], 'non-active delete preserves first')
        self.conversation_create('second')
        self.conversation_wait(lambda ui, db: ui['secondSelected'] and db['savedSecond'], 'second recreated explicitly')
        self.conversation_delete('second')
        self.conversation_wait(lambda ui, db: ui['firstSelected'] and db['savedFirst'], 'active delete falls back to first')
        self.conversation_delete('first')
        self.conversation_wait(lambda ui, db: ui['newSelected'] and not ui['firstPresent'] and not ui['secondPresent'] and db['savedNew'] and db['count'] == 1, 'delete-last normal replacement')
        images.append({'state': 'delete-last-replacement', 'preset': 'wide', **self.command({'type': 'captureView', 'view': 'conversation', 'preset': 'wide'})})
        state = self.conversation_state()
        if not all(state[key] for key in ['onlySynthetic', 'messagesEmpty', 'defaultAbsent']):
            raise ValueError('Conversation privacy/non-resurrection gate failed')
        private_json(self.root / 'conversation-scenario.json', {'passed': True, 'freshOriginAndBoot': True,
                     'restoredOlderSelection': True, 'emptyStartupNonCreating': True, 'navigationAndDeletes': True,
                     'state': state, 'captures': images, 'input': 'synthetic DOM actions and exact task-created confirmation; not native/hardware input or dialog certification',
                     'cleanup': 'task-created copy-only chats/selection/Goals/captures deferred to scratch expiry; no copy-back'})

    def renew_capability(self):
        # Pin our original private root and hold its lifetime namespace lease while
        # exclusively staging/atomically replacing only our known descriptor.
        fd = os.open(self.root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        temporary = '.launch-' + str(uuid.uuid4())
        created = False
        try:
            root_info = os.fstat(fd)
            if (root_info.st_dev, root_info.st_ino) != self.root_identity or root_info.st_uid != os.getuid() or root_info.st_mode & 0o777 != 0o700:
                raise ValueError('Run root changed; no descriptor publication')
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            prior = os.stat('launch.json', dir_fd=fd, follow_symlinks=False)
            if (prior.st_dev, prior.st_ino) != self.launch_identity or not stat.S_ISREG(prior.st_mode) or prior.st_nlink != 1 or prior.st_uid != os.getuid() or prior.st_mode & 0o777 != 0o600:
                raise ValueError('Run descriptor changed; preserve and reconcile')
            token = os.urandom(32).hex()
            descriptor = {**self.descriptor, 'capability': token}
            staged = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=fd)
            created = True
            with os.fdopen(staged, 'w') as output:
                staged_info = os.fstat(output.fileno())
                json.dump(descriptor, output, indent=2)
                output.flush()
                os.fsync(output.fileno())
            os.replace(temporary, 'launch.json', src_dir_fd=fd, dst_dir_fd=fd)
            created = False
            os.fsync(fd)
            current = os.stat('launch.json', dir_fd=fd, follow_symlinks=False)
            if (current.st_dev, current.st_ino) != (staged_info.st_dev, staged_info.st_ino) or current.st_nlink != 1:
                raise ValueError('Descriptor publication changed; preserve and reconcile')
            self.launch_identity = (current.st_dev, current.st_ino)
            self.previous_token = self.config['token']
            self.config['token'] = token
            self.descriptor = descriptor
        finally:
            try:
                if created:
                    os.unlink(temporary, dir_fd=fd)
            finally:
                os.close(fd)  # Releases only this descriptor's acquired lease.

    def spawn(self, binary, log):
        if Path(binary) != self.binary:
            raise ValueError('Exact owned ordinary bundle required')
        self.renew_capability()
        self.previous_boot = self.boot
        self.boot = None
        env = {'PATH': '/usr/bin:/bin:/opt/homebrew/bin:/usr/local/bin', 'TMPDIR': str(self.root / 'tmp')}
        if 'HOME' in os.environ:
            env['HOME'] = os.environ['HOME']  # Retain, never replace or inspect normal HOME contents.
        with open(log, 'xb', opener=lambda p, flags: os.open(p, flags, 0o600)) as output:
            return subprocess.Popen([str(binary), '--isolated-smoke-run', str(self.root / 'launch.json')],
                                    cwd=self.root, env=env, stdout=output, stderr=subprocess.STDOUT, start_new_session=True)

    def accept_identity(self, identity):
        boot = identity.get('boot')
        valid = (identity.get('runId') == self.id and identity.get('source') == self.config['source']
                 and identity.get('pid') == self.child.pid and identity.get('database') == str(self.database)
                 and identity.get('appIdentity') == 'com.codexa.garmin-trainer.ordinary.r' + self.id.replace('-', '')
                 and identity.get('artifactKind') == 'ordinary' and identity.get('buildMode') == 'release'
                 and identity.get('launchMode') == 'isolated' and identity.get('controlContract') == 'trainer-ordinary-isolated/v1'
                 and identity.get('artifactInventoryHash') == self.artifact
                 and isinstance(boot, str) and str(uuid.UUID(boot)) == boot and boot != self.previous_boot)
        if valid:
            if self.boot is not None and self.boot != boot:
                raise ValueError('Boot changed within a live child')
            self.boot = boot
        return valid

    def request(self, command, request_id):
        if self.boot is None:
            raise ValueError('Verified native boot required')
        return {**super().request(command, request_id), 'expectedBoot': self.boot}

    def scenario(self):
        self.wait(lambda value: value['view'] == 'Trainer', 'Trainer')
        for view in ['Activities', 'Health', 'Training Plan', 'Sync']:
            self.command({'type': 'click', 'target': view})
            self.wait(lambda value: value['view'] == view, view)
            self.command({'type': 'click', 'target': 'Back to chat'})
            self.wait(lambda value: value['view'] == 'Trainer', 'Trainer return')
        sentinel = self.profile_scenario(capture=False)
        private_json(self.root / 'ordinary-scenario.json', {'navigation': 'passed', 'goalsSave': 'passed',
                     'inputFidelity': 'synthetic React DOM events, not trusted native input',
                     'otherProfileFieldsUnchanged': True, 'boot': self.boot})
        return sentinel

    def captures(self):
        self.command({'type': 'click', 'target': 'Close Profile & data'})
        self.wait(lambda value: value['view'] == 'Trainer', 'Trainer before capture')
        images = []
        for view, rendered in [('trainer', 'Trainer'), ('sync', 'Sync'), ('profile', 'Profile & data')]:
            # Choose destinations using their real visible desktop navigation; never click hidden mobile controls.
            self.command({'type': 'setViewport', 'preset': 'wide'})
            if view == 'sync':
                self.command({'type': 'click', 'target': 'Sync'})
            elif view == 'profile':
                self.command({'type': 'click', 'target': 'Back to chat'})
                self.wait(lambda value: value['view'] == 'Trainer', 'Trainer before Profile')
                self.command({'type': 'click', 'target': 'Profile & data'})
            self.wait(lambda value: value['view'] == rendered, 'capture view ' + view)
            for preset in ['wide', 'narrow']:
                try:
                    if preset == 'narrow':
                        self.command({'type': 'setViewport', 'preset': preset})
                except Exception:
                    # Fixed schema-validated non-secret geometry diagnostics; never DOM/field dumps.
                    identity = self.http('/identity')
                    private_json(self.root / ('viewport-failure-' + str(uuid.uuid4()) + '.json'),
                                 {'view': view, 'preset': preset, 'rendererDiagnostic': identity.get('rendererDiagnostic')})
                    raise
                result = self.command({'type': 'captureView', 'view': view, 'preset': preset})
                images.append({'view': view, 'preset': preset, **result, 'inspection': 'required separately; not certified by runner'})
        private_json(self.root / 'captures.json', images)
        return images

    def verify_admission_denials(self):
        for label, descriptor in [('same-live-root', self.root / 'launch.json'), ('missing-descriptor', self.root / 'missing.json')]:
            env = {'PATH': '/usr/bin:/bin', 'TMPDIR': str(self.root / 'tmp')}
            if 'HOME' in os.environ:
                env['HOME'] = os.environ['HOME']
            with (self.root / ('denial-' + label + '.log')).open('xb') as output:
                child = subprocess.Popen([str(self.binary), '--isolated-smoke-run', str(descriptor)], cwd=self.root,
                                         env=env, stdout=output, stderr=subprocess.STDOUT, start_new_session=True)
                self.rejected_pids.append(child.pid)
                try:
                    status = child.wait(timeout=15)
                finally:
                    if child.poll() is None:
                        child.terminate()
                        try:
                            child.wait(timeout=5)
                        except subprocess.TimeoutExpired:
                            child.kill()
                            child.wait(timeout=5)
            if self.observer:
                self.observer.check(self.pids + self.rejected_pids)
            if status == 0:
                raise ValueError('Invalid ordinary admission unexpectedly succeeded')
        private_json(self.root / 'admission-denials.json', {'sameLiveRootDenied': True, 'missingDescriptorDenied': True, 'normalFallbackRequested': False})

    def verify_parent_death(self, sentinel):
        child = self.child
        if child is None or child.poll() is not None:
            raise ValueError('Live owned native required for parent-death scenario')
        boot = self.boot
        child.kill()  # Deliberate abrupt failure of this retained live child only, never an occupant PID.
        child.wait(timeout=5)
        self.stop()  # Existing bounded endpoint/DB/run-lease settlement must pass without stale-PID cleanup.
        self.start(self.binary)
        self.http('/identity', extra={'Authorization': 'Bearer ' + self.previous_token}, expected=403)
        if self.boot == boot:
            raise ValueError('Parent-death restart reused native boot')
        self.command({'type': 'click', 'target': 'Profile & data'})
        self.wait(lambda value: value['profileReady'] and value['profileSaved'], 'parent-death persisted Profile')
        self.command({'type': 'assert', 'target': 'Goals', 'value': sentinel})
        if self.other_profile_fields() != self.other_profile_hash:
            raise ValueError('Parent-death restart changed non-Goals Profile')
        private_json(self.root / 'parent-death.json', {'abruptNativeExit': -signal.SIGKILL,
                     'endpointsDatabaseAndRunLeaseSettled': True, 'restartedWithFreshBoot': True,
                     'persistedGoalsAndOtherProfileFields': True, 'rollbackClaimed': False})

    def verify_run_lease_settled(self):
        # Read-only verification, never unlink/steal a lease or signal a recorded PID.
        fd = os.open(self.root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            fcntl.flock(fd, fcntl.LOCK_UN)
        finally:
            os.close(fd)

    def stop(self):
        super().stop()
        self.verify_run_lease_settled()


def security(run, other):
    for extra in [{'Authorization': 'Bearer wrong'}, {'Origin': 'null'}, {'Sec-Fetch-Site': 'same-origin'}, {'X-Smoke-Run': other.id}, {'Host': 'localhost'}]:
        run.http('/identity', extra=extra, expected=403)
    for request in [
        {**run.request({'type': 'observe'}, str(uuid.uuid4())), 'expectedRunId': other.id},
        {**run.request({'type': 'observe'}, str(uuid.uuid4())), 'expectedBoot': str(uuid.uuid4())},
        run.request({'type': 'click', 'target': 'Garmin sign-in'}, str(uuid.uuid4())),
        run.request({'type': 'captureView', 'view': 'setup', 'preset': 'wide'}, str(uuid.uuid4())),
        run.request({'type': 'debugKey', 'key': 'Enter'}, str(uuid.uuid4())),
        run.request({'type': 'captureDebug'}, str(uuid.uuid4())),
        run.request({'type': 'health', 'action': 'daily'}, str(uuid.uuid4())),
        run.request({'type': 'health', 'action': 'capture-wide'}, str(uuid.uuid4())),
        run.request({'type': 'settings', 'action': 'open'}, str(uuid.uuid4())),
        run.request({'type': 'conversation', 'action': 'delete-all'}, str(uuid.uuid4())),
        run.request({'type': 'conversation', 'action': 'choose-first', 'id': 'private'}, str(uuid.uuid4())),
        run.request({'type': 'click', 'target': 'LLM debug traces'}, str(uuid.uuid4())),
        run.request({'type': 'click', 'target': 'First LLM trace'}, str(uuid.uuid4())),
    ]:
        run.http('/command', request, expected=400)
    request = run.request({'type': 'observe'}, str(uuid.uuid4()))
    observation = run.http('/command', request)
    if set(observation.get('result', {})) & {'llmDebug', 'healthMode', 'healthReady', 'healthMissingRecord', 'healthPartialRecord', 'healthPreviousEnabled', 'healthNextEnabled', 'healthLatestEnabled'}:
        raise ValueError('Ordinary mode exposed debug-only observations')
    run.http('/command', request, expected=409)
    private_json(run.root / 'security.json', {'browserCrossRunPrivateControlAndStaleBootDenied': True, 'duplicatesDenied': True})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--scratch', required=True)
    from smoke_input import arguments, prepare
    arguments(parser)
    parser.add_argument('--bundle', required=True, help='Actual unmodified desktop:build .app; copied outside checkout per run')
    parser.add_argument('--prepare-only', action='store_true')
    parser.add_argument('--conversation-selection', action='store_true', help='Finite keyless synthetic conversation create/select/restart/delete on empty-chat populated copies')
    parser.add_argument('--composer-footer', action='store_true', help='Finite keyless composer selection/reset/draft and wide/narrow masked capture; no provider send')
    args = parser.parse_args()
    os.umask(0o077)
    scratch = private_directory(args.scratch)
    prepared = prepare(scratch, args, 'ordinary')
    database = prepared.database
    bundle = canonical(args.bundle)
    source = source_identity()
    inventory = audit(bundle)
    provenance = json.loads((bundle / 'Contents/Resources/resources/provenance.json').read_text())
    if provenance.get('sourceFingerprint') != source:
        raise ValueError('Ordinary bundle/source mismatch; build current final inputs first')
    runs = []
    observer = None
    receipt = {'source': source, 'inputRoute': prepared.provenance['route'], 'preparation': str(prepared.root), 'artifactKind': 'ordinary', 'artifactInventoryHash': inventory_hash(inventory),
               'scenarioPassed': False, 'conversationSelectionRequested': args.conversation_selection, 'composerFooterRequested': args.composer_footer, 'providerAndGarmin': 'unavailable: no separately authored run-native keys or explicit private token copy',
               'defaultMode': 'native routing/admission tests plus separately labeled release-probe regression; normal operator app not launched/targeted',
               'screenshots': 'redacted geometry only; required independent inspection; synthetic events, not trusted native input',
               'cleanup': 'copy-only Goals and fixtures deferred to private task-scratch expiry; no copy-back'}
    errors = []
    try:
        for _ in range(2):
            prepared.verify_current()
            runs.append(OrdinaryRun(scratch, database, source, bundle, inventory))
            runs[-1].before_start = prepared.verify_current
            if args.composer_footer:
                runs[-1].prepare_composer()
        if args.prepare_only:
            receipt['preparedOnly'] = True
            return
        observer = Observer(scratch)
        for run in runs:
            prepared.verify_current()
            run.observer = observer
            run.start(run.binary)
        if runs[0].origin == runs[1].origin or runs[0].boot == runs[1].boot:
            raise ValueError('Parallel native/backend namespace collision')
        for run, other in [(runs[0], runs[1]), (runs[1], runs[0])]:
            prepared.verify_current()
            security(run, other)
            run.verify_admission_denials()
            sentinel = run.scenario()
            old_boot = run.boot
            run.verify_restart(run.binary, sentinel)
            run.http('/identity', extra={'Authorization': 'Bearer ' + run.previous_token}, expected=403)
            run.http('/command', {**run.request({'type': 'observe'}, str(uuid.uuid4())), 'expectedBoot': old_boot}, expected=400)
            run.captures()
            if args.composer_footer:
                run.composer_scenario()
                run.command({'type': 'setViewport', 'preset': 'wide'})
                run.command({'type': 'click', 'target': 'Profile & data'})
                run.wait(lambda value: value['profileReady'], 'Profile after composer')
            if args.conversation_selection:
                run.conversation_scenario()
                run.command({'type': 'click', 'target': 'Profile & data'})
                run.wait(lambda value: value['profileReady'], 'Profile after conversations')
            run.verify_parent_death(sentinel)
        if source_identity() != source or audit(bundle) != inventory or any(audit(run.bundle) != inventory for run in runs):
            raise ValueError('Source/artifact changed during execution')
        receipt['scenarioPassed'] = True
    finally:
        for run in runs:
            try:
                run.stop()
            except Exception as error:
                errors.append(type(error).__name__ + ': owned shutdown failed; inspect private run evidence')
        if observer:
            try:
                receipt['noninterference'] = observer.stop([pid for run in runs for pid in run.pids + run.rejected_pids])
            except Exception as error:
                errors.append(type(error).__name__ + ': observer failed')
        with contextlib.closing(readonly(database)) as original:
            receipt['inputUnchanged'] = all(fingerprint(original) == run.original for run in runs)
        receipt.update({'runs': [str(run.root) for run in runs], 'shutdownErrors': errors})
        private_json(scratch / ('ordinary-receipt-' + str(uuid.uuid4()) + '.json'), receipt)
        if errors or not receipt['inputUnchanged']:
            raise RuntimeError('Original preservation/owned shutdown gate failed; retained private evidence')
        if args.prepare_only:
            print(json.dumps(receipt))
    print(json.dumps(receipt))


if __name__ == '__main__':
    def interrupted(_signal, _frame):
        raise KeyboardInterrupt('Owned ordinary smoke interrupted')
    signal.signal(signal.SIGTERM, interrupted)
    main()
