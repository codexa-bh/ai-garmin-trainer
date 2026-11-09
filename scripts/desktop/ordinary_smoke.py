#!/usr/bin/env python3
"""Unmodified outside-checkout ordinary bundles; closed keyless rendered/capture smoke only."""
import argparse
import contextlib
from dataclasses import dataclass
import fcntl
import inspect
import hashlib
import http.client
import json
import os
from pathlib import Path
import shutil
import smoke_resources as resources
import signal
import stat
import subprocess
import time
from types import CodeType, SimpleNamespace
import uuid
from native_smoke import REPO, Observer, Run, canonical, fingerprint, private_json, readonly, source_identity
from ordinary_identity import (inventory_hash, ordinary_preparation, preparation_directory,
                               source_snapshot, verify_ordinary)
from smoke_build import digest_file, preparation_lock
from release_smoke import audit


def private_directory(path):
    path = canonical(path)
    info = path.stat()
    if not path.is_dir() or info.st_uid != os.getuid() or info.st_mode & 0o777 != 0o700:
        raise ValueError('Canonical owner-private scratch required; never adopt or chmod inputs')
    return path


class OrdinaryRun(Run):
    def __init__(self, scratch, database, source, bundle, inventory, *, history_setup=None, verified=None, enroll=None):
        # Account for partial preparation before any allocation; no partial object
        # can launch. Existing direct callers need not supply an enrollment owner.
        self.child, self.root = None, None
        self.pids, self.rejected_pids, self.capture_results = [], [], []
        self.launches = 0
        self.prepared = False
        if enroll is not None:
            enroll(self)
        if history_setup not in (None, 'create-new', 'use-existing'):
            raise ValueError('Finite history setup scope required')
        # The main runner retains the lock for the entire scenario. Direct callers
        # keep their full-source admission and lock the verification/copy boundary.
        with contextlib.nullcontext() if verified else preparation_lock(preparation_directory(REPO)):
            verified = verified or verify_ordinary(REPO, bundle, source, inventory)
            if verified['current']['source'] != source:
                raise ValueError('Current driver binding mismatch')
            self.prepare_ordinary(scratch, database, bundle, inventory, verified, history_setup)
            self.prepared = True

    def prepare_ordinary(self, scratch, database, bundle, inventory, verified, history_setup):
        original = verified['provenance']
        self.build_source = original['buildSourceFingerprint']
        self.build_context = original['buildContext']
        self.driver_source = verified['current']['source']
        source = original['sourceFingerprint']
        super().__init__(scratch, database, source, ordinary=True)
        if history_setup:
            (self.root / 'config/settings-v2.json').rename(self.root / 'prepared-keyless-settings.json')
            if history_setup == 'create-new':
                self.database.rename(self.root / 'prepared-populated.sqlite')
        self.artifact = inventory_hash(inventory)
        self.boot = None
        self.previous_boot = None
        self.rejected_pids = []
        self.bundle = self.root / 'Garmin Trainer.app'
        resources.copy_tree(bundle, self.bundle)
        if audit(self.bundle) != inventory:
            raise ValueError('Ordinary bundle copy changed inventory')
        self.binary = self.bundle / 'Contents/MacOS/garmin-trainer-desktop'
        self.descriptor = {
            'schemaVersion': 2, 'runId': self.id, 'root': str(self.root),
            'sourceFingerprint': source, 'buildSourceFingerprint': self.build_source,
            'buildContext': self.build_context, 'artifactInventoryHash': self.artifact,
            'controlPort': self.config['port'], 'capability': self.config['token'],
        }
        if history_setup:
            self.descriptor['historySetup'] = history_setup
        private_json(self.root / 'launch.json', self.descriptor)
        root_info = self.root.stat()
        launch_info = (self.root / 'launch.json').stat()
        self.root_identity = (root_info.st_dev, root_info.st_ino)
        self.launch_identity = (launch_info.st_dev, launch_info.st_ino)
        self.previous_token = None
        self.capture_results = []
        private_json(self.root / 'artifact.json', {'artifactKind': 'ordinary', 'sourceFingerprint': source,
                     'artifactInventoryHash': self.artifact, 'files': len(inventory),
                     'buildSourceFingerprint': self.build_source, 'buildContext': self.build_context,
                     'currentDriverSource': self.driver_source,
                     'bundleBytesRewritten': False, 'bundleIdentityRewritten': False})

    def prepare_composer(self, eligibility=None):
        # Run-owned keyless configuration only; original DB/settings are never edited.
        base = json.loads((self.root / 'config/settings-v2.json').read_text())
        catalog = {'version': 1, 'defaultEntryId': None, 'entries': [
            {'id': 'entry_footer_long', 'provider': 'ollama', 'modelId': 'T0246/Long-local-model-name:exact-tag',
             'displayName': 'T0246 long descriptive local model selection for narrow composer footer'},
            {'id': 'entry_footer_other', 'provider': 'ollama', 'modelId': 'T0246/Alternate:Tag', 'displayName': 'T0246 alternate'}]}
        if eligibility not in [None, 'mixed', 'empty']:
            raise ValueError('Unknown finite eligibility scenario')
        if eligibility:
            cloud = [{'id': 'entry_hidden_' + str(index), 'provider': provider, 'modelId': 'T0253/Absent:' + str(index)}
                     for index, provider in enumerate(['openai', 'openai', 'deepseek', 'openrouter'])]
            catalog['entries'] = (catalog['entries'] if eligibility == 'mixed' else []) + cloud
        private_json(self.root / 'config/settings-v3.json', {**base, 'version': 3, 'chatCatalog': catalog, 'selectionCompatibility': {'database': None, 'catalog': {'version': 1, 'entries': [], 'defaultEntryId': None}}})
        self.composer_eligibility = eligibility
        if eligibility:
            # Before boot, only the exclusive writable run copy; never seed the selected original.
            import sqlite3
            with contextlib.closing(sqlite3.connect(self.database)) as database:
                if database.execute("select 1 from app_metadata where key in ('ai.chat_model.choice','ai.chat_model.v2','ai.chat_model')").fetchone():
                    raise ValueError('Existing model preference refused; never overwrite/adopt it')
                database.execute("insert into app_metadata(key,value,updated_at) values ('ai.chat_model.v2','entry_hidden_0',?)", (int(time.time()),))
                database.commit()

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
            eligibility = getattr(self, 'composer_eligibility', None)
            if eligibility:
                expected = ([] if eligibility == 'empty' else [('entry_footer_long', True), ('entry_footer_other', True)]) + [('entry_hidden_' + str(index), False) for index in range(4)]
                if value.get('version') != 3 or 'defaultEntryId' in value or [(entry['id'], entry['available']) for entry in value['options']] != expected:
                    raise ValueError('Authoritative eligibility/catalog metadata changed')
                if value['available'] != (value['selected'] == 'entry_footer_long'):
                    raise ValueError('Selected identity/eligibility changed unexpectedly')
            return value.get('selected'), value.get('status')
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
        if getattr(self, 'composer_eligibility', None):
            return self.eligibility_scenario()
        self.command({'type': 'setViewport', 'preset': 'wide'})
        self.command({'type': 'click', 'target': 'Close Profile & data'})
        self.wait(lambda value: value['view'] == 'Trainer', 'Trainer composer')
        self.composer_wait(lambda value: value['modelReady'] and value['unselectedChoice'], 'fresh explicit no-selection')
        if self.model_choice() != (None, 'unselected'):
            raise ValueError('Fresh catalog implicitly selected a model')
        before = self.chat_hash()
        self.command({'type': 'composer', 'action': 'draft'})
        self.command({'type': 'composer', 'action': 'keys'})
        images = []
        for preset in ['wide', 'narrow']:
            self.command({'type': 'setViewport', 'preset': preset})
            observed = self.command({'type': 'composer', 'action': 'observe'})
            if not observed['unselectedChoice']:
                raise ValueError('Unselected placeholder changed before explicit choice')
            self.capture_state = 'unselected'
            image = self.command({'type': 'captureView', 'view': 'composer', 'preset': preset})
            images.append({'state': 'unselected', 'preset': preset, **image, 'observation': observed})
            private_json(self.root / ('composer-capture-unselected-' + preset + '.json'), images[-1])
        self.command({'type': 'composer', 'action': 'choose'})
        self.composer_wait(lambda value: value['modelReady'] and value['savedChoice'], 'saved long entry')
        if self.model_choice() != ('entry_footer_long', 'selected'):
            raise ValueError('UI model choice did not persist')
        for state in ['saved']:
            self.capture_state = state
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
                     'explicitChoicePersisted': True, 'freshUnselected': True, 'chatDataUnchanged': True,
                     'keyboard': 'synthetic DOM Enter/Space on owned selector; not trusted/native/hardware input',
                     'providerSend': 'not invoked', 'cleanup': 'copy-only preference/draft/Goals deferred to task-scratch expiry'})

    def eligibility_scenario(self):
        self.command({'type': 'setViewport', 'preset': 'wide'})
        self.command({'type': 'click', 'target': 'Close Profile & data'})
        self.wait(lambda value: value['view'] == 'Trainer', 'Trainer eligibility')
        empty = self.composer_eligibility == 'empty'
        self.composer_wait(lambda value: value['catalogKnown'] and value['unavailableChoice'] and value['noEligibleChoices'] == empty, 'hidden saved choice')
        if self.model_choice() != ('entry_hidden_0', 'selected'):
            raise ValueError('Rendering changed hidden saved preference')
        before = self.chat_hash()
        self.command({'type': 'composer', 'action': 'draft'})
        images = []
        states = ['hidden-saved'] if empty else ['hidden-saved', 'replacement']
        for state in states:
            self.capture_state = state
            if state == 'replacement':
                self.command({'type': 'composer', 'action': 'keys'})
                self.command({'type': 'composer', 'action': 'choose'})
                self.composer_wait(lambda value: value['modelReady'] and value['savedChoice'], 'eligible explicit replacement')
                if self.model_choice() != ('entry_footer_long', 'selected'):
                    raise ValueError('Eligible replacement did not persist')
            for preset in ['wide', 'narrow']:
                self.command({'type': 'setViewport', 'preset': preset})
                observed = self.command({'type': 'composer', 'action': 'observe'})
                image = self.command({'type': 'captureView', 'view': 'composer', 'preset': preset})
                images.append({'state': state, 'preset': preset, **image, 'observation': observed})
                private_json(self.root / ('eligibility-capture-' + state + '-' + preset + '.json'), images[-1])
                if not all(observed[key] for key in ['catalogKnown', 'singleControl', 'footerOrder', 'fitsViewport', 'draftMatches', 'textareaStable']):
                    raise ValueError('Eligibility geometry/draft gate failed; inspect capture/boolean receipt')
                if observed['noEligibleChoices'] != empty or (state != 'replacement' and not observed['unavailableChoice']):
                    raise ValueError('Eligibility state changed during capture')
        if self.chat_hash() != before:
            raise ValueError('Eligibility actions changed saved chat data')
        private_json(self.root / 'eligibility-scenario.json', {'passed': True, 'scenario': self.composer_eligibility,
                     'captures': images, 'hiddenPreferencePreservedUntilExplicitAction': True,
                     'noResetOrFallback': True, 'chatDataUnchanged': True,
                     'keyboard': 'synthetic DOM only; no OS popup/trusted-input certification',
                     'providerSend': 'not invoked', 'cleanup': 'run-only preference/draft/Goals deferred to task-scratch expiry'})

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
        self.capture_state = 'restored-first'
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
        self.capture_state = 'delete-last-replacement'
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
                                    cwd=self.root, env=env, stdin=subprocess.PIPE, stdout=output, stderr=subprocess.STDOUT, start_new_session=True)

    def accept_identity(self, identity):
        boot = identity.get('boot')
        valid = (type(identity.get('schemaVersion')) is int and identity['schemaVersion'] == 1
                 and identity.get('runId') == self.id and identity.get('source') == self.config['source']
                 and identity.get('pid') == self.child.pid and identity.get('database') == str(self.database)
                 and identity.get('appIdentity') == 'com.codexa.garmin-trainer.ordinary.r' + self.id.replace('-', '')
                 and identity.get('artifactKind') == 'ordinary' and identity.get('buildMode') == 'release'
                 and identity.get('launchMode') == 'isolated' and identity.get('controlContract') == 'trainer-ordinary-isolated/v2'
                 and identity.get('buildSourceFingerprint') == self.build_source
                 and identity.get('buildContext') == self.build_context
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

    def command(self, command):
        result = super().command(command)
        if command['type'] == 'captureView':
            self.capture_results.append({'view': command['view'], 'preset': command['preset'],
                                         'group': getattr(self, 'current_group', 'direct-consumer'),
                                         'state': getattr(self, 'capture_state', command['view']),
                                         'runId': self.id, 'boot': self.boot, **result})
        return result

    def scenario(self):
        # Feature captures can leave a narrow viewport; use visible desktop nav.
        self.command({'type': 'setViewport', 'preset': 'wide'})
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
                self.capture_state = view
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

    def verify_settled(self):
        super().verify_settled()
        self.verify_run_lease_settled()

    def stop(self):
        if not self.prepared:
            if self.child is not None:
                raise RuntimeError('Partial preparation unexpectedly owns a child; preserve and reconcile')
            return  # No start occurs before complete preparation; ledger retains partial copies.
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
        run.request({'type': 'historySettings', 'action': 'open'}, str(uuid.uuid4())),
        run.request({'type': 'sync', 'action': 'start'}, str(uuid.uuid4())),
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


SUMMARY_FAMILIES = ('densify', 'overview', 'history')
BROAD_GROUPS = ('security', 'admission-denials', 'navigation-goals-restart', 'baseline-captures', 'parent-death')


def selection_plan(args):
    """Finite reviewed selection, not automatic source-impact classification."""
    scope = getattr(args, 'smoke_scope', 'full')
    impact = getattr(args, 'impact', 'unknown')
    basis = getattr(args, 'impact_basis', '')
    part = getattr(args, 'summary_part', 'all')
    families = getattr(args, 'summary_family', None)
    native_copy = getattr(args, 'summary_native_copy', False)
    if type(native_copy) is not bool or (native_copy and (not args.summary_engine or part == 'presentation')):
        raise ValueError('Native copy requires explicit summary lifecycle selection')
    if scope not in ('full', 'feature') or impact not in ('local-feature', 'summary-lifecycle', 'summary-presentation', 'shared', 'unknown'):
        raise ValueError('Unknown smoke scope/impact')
    if part not in ('all', 'lifecycle', 'presentation') or (families and (len(set(families)) != len(families) or any(f not in SUMMARY_FAMILIES for f in families))):
        raise ValueError('Unknown/duplicate summary selection')
    if args.summary_engine and (args.composer_footer or args.model_eligibility or args.conversation_selection):
        raise ValueError('Summary scenario cannot combine with other configuration presets')
    if not args.summary_engine and (part != 'all' or families):
        raise ValueError('Summary selectors require --summary-engine')
    if part == 'lifecycle' and families:
        raise ValueError('Lifecycle-only selection cannot include presentation families')
    if scope == 'feature':
        if impact in ('shared', 'unknown') or not isinstance(basis, str) or not basis.strip() or len(basis) > 1000:
            raise ValueError('Feature scope requires reviewed local impact and bounded nonempty --impact-basis; shared/unknown impact requires full')
        expected = 'summary-presentation' if part == 'presentation' else 'summary-lifecycle'
        if args.summary_engine and impact != expected:
            raise ValueError('Summary scope/impact mismatch; broaden or select the matching proof')
        if not args.summary_engine and (impact != 'local-feature' or not (args.composer_footer or args.model_eligibility or args.conversation_selection)):
            raise ValueError('Feature scope requires a named feature and matching impact')
    selected = list(BROAD_GROUPS) if scope == 'full' else []
    if args.composer_footer or args.model_eligibility:
        selected.append('model-eligibility' if args.model_eligibility else 'composer')
    if args.conversation_selection:
        selected.append('conversation')
    if args.summary_engine:
        if part != 'presentation':
            selected.append('summary-lifecycle')
        if part != 'lifecycle':
            selected.extend('summary-' + family for family in (families or SUMMARY_FAMILIES))
    universe = (*BROAD_GROUPS, 'composer', 'model-eligibility', 'conversation', 'summary-lifecycle',
                *('summary-' + family for family in SUMMARY_FAMILIES))
    configurations = ['mixed', 'empty'] if args.model_eligibility else ['summary' if args.summary_engine else 'composer' if args.composer_footer else 'keyless']
    count = 2 if scope == 'full' or args.model_eligibility else 1
    return {'scope': scope, 'impact': impact, 'impactBasis': basis, 'instances': count,
            'configurations': configurations, 'selected': selected,
            'omitted': {group: 'not selected; no pass claimed' for group in universe if group not in selected},
            'summaryNativeCopy': native_copy,
            'summaryPart': part, 'summaryFamilies': list(families or SUMMARY_FAMILIES) if args.summary_engine and part != 'lifecycle' else [],
            'prerequisites': ['current artifact/context/fixture admission at every boot', 'owned observer/preservation/final settlement',
                              'explicit Profile-close setup for composer/conversation', 'fixed family reset to actual inspection'],
            'restarts': 'full lifecycle plus feature persistence' if scope == 'full' else 'feature-owned persistence only; presentation has none',
            'captures': {group: recipe for group, recipe in {
                'baseline-captures': 'Trainer/Sync/Profile wide+narrow masked geometry',
                'composer': 'unselected/saved wide+narrow synthetic DOM',
                'model-eligibility': 'mixed unavailable/replacement and empty unavailable wide+narrow synthetic DOM',
                'conversation': 'restored-first wide+narrow, delete-last wide synthetic DOM',
                'summary-lifecycle': 'empty narrow, preflight/manual/whole-summary wide+narrow actual keyless controls',
                'summary-densify': 'ready/review/accepted/no-reduction/busy wide+narrow fixed presentation',
                'summary-overview': 'populated/editor wide+narrow; manage/confirm/editor/empty/error/Off narrow fixed presentation',
                'summary-history': 'history/results/progressive wide+narrow, unknown narrow fixed presentation; temporal DOM not engine progression',
            }.items() if group in selected}}


def deny_previous_boot(run):
    if run.previous_boot is None or run.previous_boot == run.boot:
        raise ValueError('Feature persistence requires fresh native boot')
    run.http('/identity', extra={'Authorization': 'Bearer ' + run.previous_token}, expected=403)
    run.http('/command', {**run.request({'type': 'observe'}, str(uuid.uuid4())), 'expectedBoot': run.previous_boot}, expected=400)


def composer_persistence(run, sentinel=None):
    """Shared assertions, with the existing full-mode Goals/Profile restart contract."""
    if sentinel is None:
        run.command({'type': 'setViewport', 'preset': 'wide'})
        run.command({'type': 'click', 'target': 'Profile & data'})
        run.wait(lambda value: value['profileReady'], 'feature Profile prerequisite')
    run.composer_scenario()
    expected, origin, boot = run.model_choice(), run.origin, run.boot
    if sentinel is None:
        run.stop()
        run.start(run.binary)
    else:
        run.verify_restart(run.binary, sentinel, kind='model')
    if run.origin == origin or run.boot == boot or run.model_choice() != expected:
        raise ValueError('Exact model choice/fresh origin persistence failed')
    deny_previous_boot(run)
    private_json(run.root / 'choice-restart.json', {'exactChoiceRetained': True, 'freshBoot': True})
    if sentinel is not None:
        run.command({'type': 'setViewport', 'preset': 'wide'})
        run.wait(lambda value: value['profileReady'], 'Profile after composer restart')


def composer_composition(run):
    composer_persistence(run)


def densify_composition(run):
    from summary_smoke import presentation_scenario
    presentation_scenario(run, ('densify',))


@dataclass(frozen=True)
class Scenario:
    """Reviewed intent, not permissions or a sandbox for hostile Python."""
    label: str
    action: object
    configuration: str
    expected: tuple
    evidence: str
    dependencies: tuple = ()


def scenario_identity(scenario):
    if (not isinstance(scenario, Scenario) or not isinstance(scenario.label, str)
            or not scenario.label or len(scenario.label) > 80
            or any(c not in 'abcdefghijklmnopqrstuvwxyz0123456789-_' for c in scenario.label)
            or scenario.label in (*BROAD_GROUPS, 'full')
            or scenario.configuration not in ('keyless', 'composer', 'summary')
            or not isinstance(scenario.expected, tuple) or not scenario.expected
            or any(not isinstance(value, str) or not value.strip() or len(value) > 500 for value in scenario.expected)
            or not isinstance(scenario.evidence, str) or not scenario.evidence.strip() or len(scenario.evidence) > 1000
            or not isinstance(scenario.dependencies, tuple)):
        raise ValueError('Scenario requires finite configuration, stable label, expected assertions and evidence intent')
    action = scenario.action
    if (not inspect.isfunction(action) or action.__name__ == '<lambda>' or action.__closure__ or action.__defaults__ or action.__kwdefaults__
            or list(inspect.signature(action).parameters) != ['run']):
        raise ValueError('Scenario requires a source-backed function(run), without opaque closures/defaults')
    source = inspect.getsourcefile(action)
    if not source:
        raise ValueError('Scenario source unavailable')
    paths = (Path(source), *map(Path, scenario.dependencies))
    bindings = []
    for path in paths:
        path = canonical(path)
        info = path.stat()
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_size > 1024 * 1024:
            raise ValueError('Bounded single-link scenario source/dependency required')
        data = path.read_bytes()
        if path.stat() != info:
            raise ValueError('Scenario source changed while hashing')
        bindings.append({'path': str(path), 'sha256': hashlib.sha256(data).hexdigest(),
                         'device': info.st_dev, 'inode': info.st_ino, 'mode': stat.S_IMODE(info.st_mode)})
        if path == paths[0]:
            # Compare loaded executable code with the actual current file, not just
            # a label or a newly hashed file alongside an old imported function.
            def codes(code):
                yield code
                for constant in code.co_consts:
                    if isinstance(constant, CodeType):
                        yield from codes(constant)
            compiled = compile(data, str(path), 'exec', dont_inherit=True)
            if not any(code == action.__code__ for code in codes(compiled)):
                raise ValueError('Loaded scenario function does not match current source bytes')
    return {'label': scenario.label, 'callable': action.__qualname__, 'sources': bindings,
            'configuration': scenario.configuration, 'expected': list(scenario.expected), 'evidence': scenario.evidence}


def composition_plan(scenarios, impact, basis, full):
    scenarios = tuple(scenarios)
    identities = [scenario_identity(scenario) for scenario in scenarios]
    configurations = {scenario.configuration for scenario in scenarios}
    if not scenarios or len({scenario.label for scenario in scenarios}) != len(scenarios) or len(configurations) != 1:
        raise ValueError('Nonempty unique scenarios with one compatible preparation configuration required')
    if impact not in ('local-feature', 'summary-presentation', 'shared', 'unknown') or not isinstance(basis, str) or not basis.strip() or len(basis) > 1000:
        raise ValueError('Reviewed impact and bounded nonempty basis required')
    if impact in ('shared', 'unknown') and not full:
        raise ValueError('Shared/unknown impact requires full regression plus compositions')
    configuration = next(iter(configurations))
    if not full and ((configuration == 'summary') != (impact == 'summary-presentation')):
        raise ValueError('Preparation configuration/impact mismatch')
    args = SimpleNamespace(summary_engine=configuration == 'summary', composer_footer=configuration == 'composer',
                           model_eligibility=False, conversation_selection=False, prepare_only=False,
                           smoke_scope='full', impact=impact, impact_basis=basis,
                           summary_part='presentation', summary_family=['densify'])
    # CLI flags do not define independent compositions; only reuse its broad plan.
    baseline = selection_plan(SimpleNamespace(**{**vars(args), 'summary_engine': False,
                                'composer_footer': False, 'summary_part': 'all', 'summary_family': None}))
    selected = (list(BROAD_GROUPS) if full else []) + [scenario.label for scenario in scenarios]
    plan = {**baseline, 'scope': 'full' if full else 'composition', 'instances': 2 if full else 1,
            'configurations': [configuration], 'selected': selected,
            'omitted': {group: 'not selected; no pass claimed' for group in baseline['selected'] + list(baseline['omitted']) if group not in selected},
            'compositions': identities, 'captures': {scenario.label: scenario.evidence for scenario in scenarios},
            'summaryFamilies': [], 'restarts': 'scenario-owned persistence; full retains broad restarts'}
    return args, plan


@contextlib.contextmanager
def composition_lifetime(timeout):
    """Main-thread owned cancellation/deadline; no competing timer adoption."""
    if type(timeout) not in (int, float) or not 0 < timeout <= 1800 or signal.getitimer(signal.ITIMER_REAL) != (0.0, 0.0):
        raise ValueError('Finite composition timeout up to 1800s and no active timer required')
    previous_term, previous_alarm = signal.getsignal(signal.SIGTERM), signal.getsignal(signal.SIGALRM)
    def cancelled(_signal, _frame):
        raise KeyboardInterrupt('Owned composition cancelled')
    def expired(_signal, _frame):
        raise TimeoutError('Composition lifetime expired; effects unknown, never replay')
    signal.signal(signal.SIGTERM, cancelled)  # Non-main-thread callers refuse before allocation.
    previous_mask = os.umask(0o077)
    try:
        signal.signal(signal.SIGALRM, expired)
        signal.setitimer(signal.ITIMER_REAL, timeout)
        yield
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, previous_alarm)
        signal.signal(signal.SIGTERM, previous_term)
        os.umask(previous_mask)


@resources.invocation
def run_scenarios(*, scratch, bundle, scenarios, impact, impact_basis, full=False, prepare_only=False, task_id=None, anchor=None, timeout=600):
    """Importable guarded authored-synthetic execution; callers own only scenario intent."""
    if type(full) is not bool or type(prepare_only) is not bool:
        raise ValueError('Explicit boolean full/prepare_only intent required')
    scenarios = tuple(scenarios)
    args, plan = composition_plan(scenarios, impact, impact_basis, full)
    args.prepare_only = prepare_only
    print(json.dumps({'executionPlan': plan}), flush=True)
    with composition_lifetime(timeout):
        scratch = private_directory(resources.configure(canonical(scratch)))
        from smoke_input import prepare
        # Only the existing authored recipe; private/paid direct callers stay separate.
        args.input_file = args.grant_file = args.provenance_file = None
        args.task_id = task_id or Path(os.environ.get('PIVAN_TASK_PATH', 'local')).name.split('-')[0]
        args.anchor = anchor
        prepared = prepare(scratch, args, 'ordinary')
        bundle, source = canonical(bundle), source_identity()
        with ordinary_preparation(REPO, bundle, source, scratch) as (verified, inventory):
            return execute_ordinary(args, scratch, prepared, bundle, source, verified, inventory,
                                    scenarios=scenarios, plan=plan)


def composer_scenario():
    return Scenario('composer', composer_composition, 'composer',
                    ('explicit choice, draft and geometry', 'exact choice retained across fresh origin/boot; stale capabilities denied'),
                    'unselected/saved wide+narrow synthetic DOM; not provider or trusted input')


def densify_scenario():
    return Scenario('summary-densify', densify_composition, 'summary',
                    ('independent closed/wide entry', 'Densify ready/review/accepted/no-reduction/busy', 'actual inspection restored and sheet closed'),
                    'wide+narrow fixed presentation only; no engine progression or mutation persistence',
                    (str(REPO / 'scripts/desktop/summary_smoke.py'),))


def feature_scenarios(run, args, plan, perform):
    if args.summary_engine:
        from summary_smoke import scenario, presentation_scenario
        if plan['summaryPart'] != 'presentation':
            def lifecycle():
                scenario(run, presentation_families=(), native_copy=getattr(args, 'summary_native_copy', False))
                deny_previous_boot(run)
            perform('summary-lifecycle', lifecycle)
        for family in plan['summaryFamilies']:
            perform('summary-' + family, lambda family=family: presentation_scenario(run, (family,)))
    if args.composer_footer or args.model_eligibility:
        perform('model-eligibility' if args.model_eligibility else 'composer', lambda: composer_persistence(run))
    if args.conversation_selection:
        def conversation():
            run.command({'type': 'setViewport', 'preset': 'wide'})
            run.command({'type': 'click', 'target': 'Profile & data'})
            run.wait(lambda value: value['profileReady'], 'feature conversation prerequisite')
            run.conversation_scenario()
            deny_previous_boot(run)
        perform('conversation', conversation)


@resources.invocation
def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--scratch', required=True)
    from smoke_input import arguments, prepare
    arguments(parser)
    parser.add_argument('--bundle', required=True, help='Actual unmodified desktop:build .app; copied outside checkout per run')
    parser.add_argument('--prepare-only', action='store_true')
    parser.add_argument('--conversation-selection', action='store_true', help='Finite keyless synthetic conversation create/select/restart/delete on empty-chat populated copies')
    parser.add_argument('--composer-footer', action='store_true', help='Finite keyless explicit choice/draft/restart and wide/narrow masked capture; no provider send')
    parser.add_argument('--model-eligibility', action='store_true', help='Opt-in fixed mixed/zero eligible catalogs with unavailable explicit choices; implies composer footer')
    parser.add_argument('--summary-engine', action='store_true', help='Finite keyless independent summary selection/scheduler/backlog/clear/Off/restart; no provider credential lookup')
    parser.add_argument('--smoke-scope', choices=('full', 'feature'), default='full')
    parser.add_argument('--impact', choices=('local-feature', 'summary-lifecycle', 'summary-presentation', 'shared', 'unknown'), default='unknown')
    parser.add_argument('--impact-basis', default='', help='Reviewed task-local impact rationale, not automatic classification or permission')
    parser.add_argument('--summary-native-copy', action='store_true', help='Opt-in real owned summary selectAll:/copy: equality; replaces clipboard with fixed synthetic text, no global input')
    parser.add_argument('--summary-part', choices=('all', 'lifecycle', 'presentation'), default='all')
    parser.add_argument('--summary-family', choices=SUMMARY_FAMILIES, action='append', help='Finite presentation families; default all')
    args = parser.parse_args()
    args.composer_footer = args.composer_footer or args.model_eligibility
    try:
        plan = selection_plan(args)
    except ValueError as error:
        parser.error(str(error))
    print(json.dumps({'executionPlan': plan}), flush=True)
    os.umask(0o077)
    scratch = private_directory(resources.configure(canonical(args.scratch)))
    prepared = prepare(scratch, args, 'ordinary', synthetic_empty_chat=args.conversation_selection)
    database = prepared.database
    bundle = canonical(args.bundle)
    source = source_identity()
    with ordinary_preparation(REPO, bundle, source, scratch) as (verified, inventory):
        execute_ordinary(args, scratch, prepared, bundle, source, verified, inventory)


def execute_ordinary(args, scratch, prepared, bundle, source, verified, inventory, *, scenarios=(), plan=None):
    plan = selection_plan(args) if plan is None else plan
    database = prepared.database
    def verify_current():
        prepared.verify_current()
        verify_ordinary(REPO, bundle, source, inventory)
        if scenarios and [scenario_identity(scenario) for scenario in scenarios] != plan['compositions']:
            raise ValueError('Scenario source/declaration changed during execution')
    runs = []
    observer = None
    receipt = {'source': source, 'currentDriver': verified['current'],
               'artifactOriginalSource': verified['provenance']['sourceFingerprint'],
               'artifactBuildSource': verified['provenance']['buildSourceFingerprint'],
               'buildContext': verified['context'], 'artifactReused': True,
               'buildStageRequests': {'nextBuild': 0, 'resourceAssembly': 0, 'nativeBuild': 0},
               'fixtureIdentity': {'databaseSha256': digest_file(database), 'logical': prepared.original,
                                   'preparationSha256': digest_file(prepared.root / 'preparation.json'),
                                   'selectionSha256': digest_file(prepared.root / 'selection.json')},
               'inputRoute': prepared.provenance['route'], 'preparation': str(prepared.root), 'artifactKind': 'ordinary', 'artifactInventoryHash': inventory_hash(inventory),
               'selection': plan, 'groupOutcomes': [],
               'scenarioClaim': 'declared selected scope only, not omitted/full proof',
               'assertionsPassed': False, 'scenarioPassed': False, 'summaryEngineKeylessRequested': args.summary_engine, 'conversationSelectionRequested': args.conversation_selection, 'composerFooterRequested': args.composer_footer, 'modelEligibilityRequested': args.model_eligibility, 'providerAndGarmin': 'unavailable: no separately authored run-native keys or explicit private token copy',
               'defaultMode': 'native routing/admission tests plus separately labeled release-probe regression; normal operator app not launched/targeted',
               'screenshots': 'redacted geometry only; required independent inspection; synthetic events, not trusted native input',
               'resourceDisposition': resources.disposition(),
               'cleanup': 'Final owned-disposal receipt records removed/retained copies; compact diagnostics/PNG remain; no copy-back'}
    errors = []
    def enroll(run):
        runs.append(run)
        receipt['groupOutcomes'].append({'run': None, 'groups': {group: 'not-run' for group in plan['selected']}})
    try:
        for index in range(plan['instances']):
            prepared.verify_current()
            verify_current()
            OrdinaryRun(scratch, database, source, bundle, inventory, verified=verified, enroll=enroll)
            receipt['groupOutcomes'][-1]['run'] = str(runs[-1].root)
            runs[-1].before_start = verify_current
            if args.summary_engine:
                from summary_smoke import prepare_summary
                prepare_summary(runs[-1])
            if args.composer_footer:
                runs[-1].prepare_composer(('mixed' if index == 0 else 'empty') if args.model_eligibility else None)
        if args.prepare_only:
            resources.retain('prepare-only outputs promised for later use; zero launches')
            receipt['preparedOnly'] = True
            return
        observer = Observer(scratch, preparation_locked=True)
        for run in runs:
            prepared.verify_current()
            run.observer = observer
            run.start(run.binary)
        if len(runs) == 2 and (runs[0].origin == runs[1].origin or runs[0].boot == runs[1].boot):
            raise ValueError('Parallel native/backend namespace collision')
        for index, run in enumerate(runs):
            prepared.verify_current()
            outcomes = receipt['groupOutcomes'][index]
            def perform(group, action):
                run.current_group = group
                outcomes['groups'][group] = 'failed'
                result = action()
                outcomes['groups'][group] = 'passed'
                return result
            if scenarios:
                for scenario in scenarios:
                    verify_current()
                    perform(scenario.label, lambda scenario=scenario: scenario.action(run))
                if plan['scope'] != 'full':
                    continue
                run.command({'type': 'setViewport', 'preset': 'wide'})
            elif plan['scope'] == 'feature':
                feature_scenarios(run, args, plan, perform)
                continue
            other = runs[1 - index]
            if args.summary_engine and not scenarios:
                from summary_smoke import scenario as summary_scenario, presentation_scenario
                if 'summary-lifecycle' in plan['selected']:
                    perform('summary-lifecycle', lambda: summary_scenario(run, presentation_families=()))
                for family in plan['summaryFamilies']:
                    perform('summary-' + family, lambda family=family: presentation_scenario(run, (family,)))
            perform('security', lambda: security(run, other))
            perform('admission-denials', run.verify_admission_denials)
            run.current_group = 'navigation-goals-restart'
            outcomes['groups']['navigation-goals-restart'] = 'failed'
            sentinel = run.scenario()
            old_boot = run.boot
            run.verify_restart(run.binary, sentinel)
            run.http('/identity', extra={'Authorization': 'Bearer ' + run.previous_token}, expected=403)
            run.http('/command', {**run.request({'type': 'observe'}, str(uuid.uuid4())), 'expectedBoot': old_boot}, expected=400)
            outcomes['groups']['navigation-goals-restart'] = 'passed'
            perform('baseline-captures', run.captures)
            if args.composer_footer and not scenarios:
                perform('model-eligibility' if args.model_eligibility else 'composer', lambda: composer_persistence(run, sentinel))
            if args.conversation_selection:
                run.current_group = 'conversation'
                outcomes['groups']['conversation'] = 'failed'
                run.conversation_scenario()
                run.command({'type': 'click', 'target': 'Profile & data'})
                run.wait(lambda value: value['profileReady'], 'Profile after conversations')
                outcomes['groups']['conversation'] = 'passed'
            perform('parent-death', lambda: run.verify_parent_death(sentinel))
        if source_identity() != source or audit(bundle) != inventory or any(audit(run.bundle) != inventory for run in runs):
            raise ValueError('Source/artifact changed during execution')
        verify_current()
        receipt['assertionsPassed'] = True
    except BaseException as error:
        receipt['scenarioFailure'] = type(error).__name__ + ': fresh scenario did not pass; inspect retained run evidence'
        raise
    finally:
        with resources.preserve_failure():
            def finalize(label, action):
                try:
                    return action()
                except BaseException as error:
                    errors.append(type(error).__name__ + ': ' + label + ' failed; inspect retained evidence')
                    return None
            for run in runs:
                finalize('owned shutdown', run.stop)
            if observer:
                receipt['noninterference'] = finalize('observer', lambda: observer.stop([pid for run in runs for pid in run.pids + run.rejected_pids]))
            finalize('current input/artifact/scenario verification', verify_current)
            receipt['currentDriverUnchanged'] = finalize('driver verification', lambda: source_snapshot(REPO) == verified['current'])
            receipt['fixtureBytesUnchanged'] = finalize('fixture bytes', lambda: digest_file(database) == receipt['fixtureIdentity']['databaseSha256'])
            def input_unchanged():
                with contextlib.closing(readonly(database)) as original:
                    return fingerprint(original) == prepared.original and all(fingerprint(original) == run.original for run in runs if getattr(run, 'prepared', False))
            receipt['inputUnchanged'] = finalize('input preservation', input_unchanged)
            def verify_copy(run):
                if audit(run.bundle) != inventory:
                    raise ValueError('Copied artifact changed')
            for run in runs:
                if getattr(run, 'prepared', False):
                    finalize('copied artifact preservation', lambda run=run: verify_copy(run))
            for run, outcome in zip(runs, receipt['groupOutcomes']):
                outcome['run'] = str(run.root) if run.root else None
            receipt.update({'runs': [str(run.root) if run.root else None for run in runs], 'shutdownErrors': errors,
                            'execution': [{'run': str(run.root) if run.root else None, 'prepared': run.prepared, 'starts': run.launches,
                                           'restarts': max(0, run.launches - 1),
                                           'admissionDenialStarts': len(run.rejected_pids),
                                           'configuration': ('mixed' if index == 0 else 'empty') if args.model_eligibility else plan['configurations'][0],
                                           'captures': run.capture_results} for index, run in enumerate(runs)]})
            preserved = all(receipt[key] is True for key in ('inputUnchanged', 'currentDriverUnchanged', 'fixtureBytesUnchanged'))
            receipt['scenarioPassed'] = receipt['assertionsPassed'] and preserved and not errors
            # No successful aggregate receipt can precede required finalization.
            # If writing itself fails, invocation retains resources and the primary error.
            private_json(scratch / ('ordinary-receipt-' + str(uuid.uuid4()) + '.json'), receipt)
            if errors or not preserved:
                raise RuntimeError('Original preservation/owned shutdown gate failed; retained private evidence')
            if args.prepare_only:
                print(json.dumps(receipt))
    print(json.dumps(receipt))
    return receipt


if __name__ == '__main__':
    def interrupted(_signal, _frame):
        raise KeyboardInterrupt('Owned ordinary smoke interrupted')
    signal.signal(signal.SIGTERM, interrupted)
    main()
