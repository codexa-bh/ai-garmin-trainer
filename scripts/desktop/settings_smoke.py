"""Nonactivating keyless native Settings smoke; no credential input, auth or general controller."""
import argparse
import contextlib
import http.client
import json
import os
import re
import signal
import time
import uuid
from native_smoke import Observer, Run, build, canonical, fingerprint, private_json, readonly, source_identity
from live_provider import LiveProvider


def wait_settings(run, predicate, label):
    deadline = time.monotonic() + 8
    while time.monotonic() < deadline:
        value = run.command({'type': 'settings', 'action': 'observe'})
        if predicate(value):
            return value
        time.sleep(.1)
    private_json(run.root / ('settings-failure-' + str(uuid.uuid4()) + '.json'), {'assertion': label, 'observation': value})
    raise TimeoutError('Settings observation deadline: ' + label)


def model_settings(run, model_id=None, write=False):
    if not run.origin or not run.origin.startswith('http://127.0.0.1:'):
        raise ValueError('Exact owned backend origin required')
    client = http.client.HTTPConnection('127.0.0.1', int(run.origin.rsplit(':', 1)[1]), timeout=5)
    try:
        body = json.dumps({'modelId': model_id}) if write else None
        client.request('PATCH' if write else 'GET', '/api/model-settings', body, {'Content-Type': 'application/json'})
        response = client.getresponse()
        raw = response.read(32769)
        if response.status != 200 or len(raw) > 32768:
            raise ValueError('Owned model metadata request failed/bounded')
        value = json.loads(raw)
        if value.get('version') != 2 or not isinstance(value.get('options'), list):
            raise ValueError('Owned model metadata schema')
        return value
    finally:
        client.close()


def live_scenario(run, captures, fixture=None):
    before = run.http('/identity')
    if not isinstance(before.get('backendPid'), int):
        raise ValueError('Exact owned backend PID required')
    model_settings(run, 'entry_legacy_ollama', write=True)
    observations = []
    conversations = [str(uuid.uuid4()), str(uuid.uuid4())]
    if fixture:
        fixture.begin(run, conversations[0])
    captured_work = None
    for action in ['liveCatalog', 'liveRotate', 'liveClear', 'liveEmpty']:
        run.command({'type': 'settings', 'action': action})
        run.command({'type': 'settings', 'action': 'save'})
        observed = wait_settings(run, lambda value: value['liveApplied'], 'exact native live ack: ' + action)
        if action == 'liveCatalog' and observed['pendingRestart']:
            raise ValueError('Live-only Save falsely reports unrelated pending restart')
        active = model_settings(run)
        saved = json.loads((run.root / 'config/settings-v3.json').read_text())
        if action in ['liveCatalog', 'liveRotate']:
            suffix = 'one' if action == 'liveCatalog' else 'two'
            if saved['keys'] != {slot: 'T0257-synthetic-' + slot + '-' + suffix for slot in ['OPENAI_API_KEY', 'DEEPSEEK_API_KEY', 'OPENROUTER_API_KEY']}:
                raise ValueError('Synthetic complete-key projection mismatch')
            if not all(option['available'] for option in active['options']):
                raise ValueError('New fixed synthetic credentials not visible to compiled Next route')
            if active['effective']['entryId'] != 'entry_legacy_ollama' or active['selected'] != 'entry_legacy_ollama':
                raise ValueError('Native default change rewrote explicit preference')
            if next(option for option in active['options'] if option['provider'] == 'openai')['modelId'] != 'Synthetic/Live:one':
                raise ValueError('Compiled Next route retained startup catalog')
            if action == 'liveRotate':
                if not observed['pendingRestart'] or saved['fields']['MEMORY_EMBEDDING_DIMS'] != '2048':
                    raise ValueError('Mixed restart-only settings feedback missing')
                model_settings(run, 'entry_legacy_openai', write=True)
        else:
            if saved['keys'] or active['defaultEntryId'] is not None or active['effective']['available'] or active['selected'] != 'entry_legacy_openai':
                raise ValueError('Clear/deletion silently retained keys/default or remapped preference')
            if action == 'liveClear' and (len(active['options']) != 3 or any(option['available'] for option in active['options'] if option['provider'] != 'ollama')):
                raise ValueError('Cleared cloud credentials remained eligible')
            if action == 'liveEmpty' and active['options']:
                raise ValueError('Explicit empty catalog not active')
        if fixture and action == 'liveCatalog':
            captured_work = fixture.finish(run, conversations[1])
        after = run.http('/identity')
        if any(before[key] != after[key] for key in ['pid', 'backendPid', 'origin', 'database']):
            raise ValueError('Live Save restarted/switched owned backend')
        captures.append({'scenario': action + '-acknowledged-feedback', **run.command({'type': 'settings', 'action': 'captureLive'})})
        observations.append({'preset': action, 'liveApplied': True, 'pendingRestart': observed['pendingRestart'], 'backendPidUnchanged': True, 'compiledNextUptake': True})
        if captured_work and action == 'liveCatalog':
            observations[-1]['capturedWork'] = {**captured_work, 'taskCreatedConversations': conversations, 'cleanup': 'authored disposable copy only; deferred to task-scratch expiry'}
    model_settings(run, write=True)  # Explicit reset, not native preference mutation.
    run.command({'type': 'settings', 'action': 'stopBackend'})
    run.command({'type': 'settings', 'action': 'save'})
    wait_settings(run, lambda value: value['savedUnapplied'], 'backend absent: saved not applied, no hidden start')
    if run.http('/identity')['backendPid'] is not None:
        raise ValueError('Save unexpectedly started a backend')
    return observations


def verify_catalog(catalog):
    providers = ['openai', 'deepseek', 'ollama', 'openrouter']
    if set(catalog) != {'version', 'entries', 'defaultEntryId'} or catalog['version'] != 1 or catalog['defaultEntryId'] != 'entry_legacy_ollama' or len(catalog['entries']) != 8:
        raise ValueError('Not exact synthetic catalog')
    ids = set()
    for index, entry in enumerate(catalog['entries']):
        provider = providers[index % 4]
        first = index < 4
        expected = {'id': entry['id'], 'provider': provider, 'modelId': f'synthetic/{provider}:' + ('Case' if first else 'Second')}
        if first:
            expected['displayName'] = 'Synthetic model'
        if entry != expected or entry['id'] in ids or (first and entry['id'] != f'entry_legacy_{provider}') or (not first and not re.fullmatch(r'entry_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}', entry['id'])):
            raise ValueError('Synthetic catalog identity/order/content changed')
        ids.add(entry['id'])


def capture_garmin(run, captures, scenario):
    for action, size in [('captureWide', 'wide'), ('captureNarrow', 'narrow')]:
        captures.append({'scenario': scenario + '-' + size,
                         **run.command({'type': 'settings', 'action': action})})


def verify_keys(keys, edited=False):
    expected = {'OPENAI_API_KEY': 'synthetic-openai-replacement'} if edited else {
        'OPENAI_API_KEY': 'synthetic-openai-original', 'DEEPSEEK_API_KEY': 'synthetic-deepseek-original'}
    if keys != expected:
        raise ValueError('Synthetic provider persistence contract failed')


def capture_providers(run, captures, scenario):
    for viewport in ['wide', 'narrow']:
        run.command({'type': 'settings', 'action': 'catalog' + viewport.title()})
        for provider in ['Openai', 'Deepseek', 'Ollama', 'Openrouter']:
            captures.append({'scenario': scenario + '-' + viewport + '-' + provider.lower(),
                             **run.command({'type': 'settings', 'action': 'capture' + provider})})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--scratch', required=True)
    parser.add_argument('--input-file', required=True)
    parser.add_argument('--resources-ready', action='store_true')
    scenario = parser.add_mutually_exclusive_group()
    scenario.add_argument('--live-settings', action='store_true', help='Finite synthetic live settings and task-owned local stream fixture; no real provider calls')
    scenario.add_argument('--provider-fields', action='store_true', help='Finite authored synthetic provider presence/edit/clear/stale-save scenario; no caller key input')
    args = parser.parse_args()
    os.umask(0o077)
    scratch = canonical(args.scratch)
    selected = canonical(args.input_file)
    if selected.stat().st_mode & 0o077:
        raise ValueError('Private selection required')
    database = canonical(json.loads(selected.read_text())['database'])
    source = source_identity()
    run = Run(scratch, database, source, synthetic_provider_fields=args.provider_fields)
    observer = None
    fixture = None
    passed = False
    captures = []
    errors = []
    receipt = {'source': source, 'scenario': 'populated-copy-keyless-native-Settings', 'runId': run.id,
               'exclusions': 'Debug Settings only; geometry-preserving synthetic provider sections, not unmasked full-window/default/ordinary Settings, first-run Finish, real provider/auth or trusted OS input.',
               'cleanup': 'Task-owned online backup/settings/images/logs deferred to scratch expiry; no copy-back or primary mutation.'}
    try:
        binary = build(scratch, source, resources_ready=args.resources_ready)
        if args.live_settings:
            fixture = LiveProvider()  # Exclusive fixed loopback bind or fail; no daemon reuse.
            with open(run.root / 'live-provider', 'x', opener=lambda path, flags: os.open(path, flags, 0o600)) as marker:
                marker.write(run.id)
            authored = run.root / 'config/settings-v2.json'
            initial_fields = json.loads(authored.read_text())
            initial_fields['fields']['OLLAMA_BASE_URL'] = 'http://127.0.0.1:11435/v1'
            authored.write_text(json.dumps(initial_fields))
        observer = Observer(scratch)
        run.observer = observer
        run.start(binary)
        before = run.http('/identity')
        original_settings = (run.root / 'config/settings-v2.json').read_bytes()
        run.command({'type': 'settings', 'action': 'open'})
        initial = wait_settings(run, lambda o: o['ready'], 'initial setup ready')
        if not initial['notConnected'] or not initial['manualControlsAbsent'] or initial['formVisible'] or not initial['privateActionsDenied']:
            raise ValueError('Initial Garmin settings state incorrect')
        captures.append({'scenario': 'concise-static-introduction', **run.command({'type': 'settings', 'action': 'captureIntro'})})
        capture_garmin(run, captures, 'not-connected-connect-later')
        run.command({'type': 'settings', 'action': 'connect'})
        wait_settings(run, lambda o: o['formVisible'], 'Connect reveals private form without login')
        capture_garmin(run, captures, 'connect-form-no-login')
        run.command({'type': 'settings', 'action': 'later'})
        wait_settings(run, lambda o: not o['formVisible'] and o['notConnected'], 'Connect later preserves selection')
        run.command({'type': 'settings', 'action': 'cancel'})
        wait_settings(run, lambda o: o['ready'] and not o['formVisible'], 'Cancel reconciles saved state')
        if not args.live_settings:
            exercised = run.command({'type': 'settings', 'action': 'catalogExercise'})
            if not exercised['catalogReady'] or not exercised['catalogExercised']:
                raise ValueError('Grouped catalog exercise incomplete')
            capture_providers(run, captures, 'configured-fields' if args.provider_fields else 'grouped')
        if args.provider_fields:
            if not initial['keysReady']:
                raise ValueError('Synthetic initial key metadata missing')
            run.command({'type': 'settings', 'action': 'keysExercise'})
            wait_settings(run, lambda o: o['keysEdited'], 'pending replacement/removal')
            capture_providers(run, captures, 'pending-fields')
            run.command({'type': 'settings', 'action': 'cancel'})
            wait_settings(run, lambda o: o['keysReady'], 'cancel restores presence without writing')
            if (run.root / 'config/settings-v2.json').read_bytes() != original_settings:
                raise ValueError('Cancel wrote provider state')
            run.command({'type': 'settings', 'action': 'catalogExercise'})
            run.command({'type': 'settings', 'action': 'keysExercise'})
            # Same bytes, changed metadata revision: native must reject this stale form.
            os.utime(run.root / 'config/settings-v2.json', None)
            run.command({'type': 'settings', 'action': 'save'})
            wait_settings(run, lambda o: o['keysRejected'] and o['keysReady'], 'stale Save refuses and clears replacement')
            if (run.root / 'config/settings-v2.json').read_bytes() != original_settings or (run.root / 'config/settings-v3.json').exists():
                raise ValueError('Stale Save published settings')
            run.command({'type': 'settings', 'action': 'keysExercise'})
        run.command({'type': 'settings', 'action': 'save'})
        wait_settings(run, lambda o: o['liveApplied'], 'native Save committed and live fields acknowledged')
        after = run.http('/identity')
        if any(before[key] != after[key] for key in ['pid', 'origin', 'database']):
            raise ValueError('Ordinary Save switched active backend or DB')
        saved = json.loads((run.root / 'config/settings-v3.json').read_text())
        if saved['version'] != 3 or (run.root / 'config/settings-v2.json').read_bytes() != original_settings:
            raise ValueError('Explicit catalog migration did not retain the original keyless settings')
        if args.live_settings:
            if len(saved['chatCatalog']['entries']) != 4 or saved['chatCatalog']['defaultEntryId'] != 'entry_legacy_ollama':
                raise ValueError('Live scenario requires exact legacy baseline')
        else:
            verify_catalog(saved['chatCatalog'])
        if args.provider_fields:
            verify_keys(saved['keys'], edited=True)
        if (not args.provider_fields and saved['keys']) or saved['fields']['DATABASE_PATH'] != str(run.database) or saved['fields']['AI_PROVIDER'] != 'ollama' or saved['fields'].get('GARMIN_MCP_TOKEN_DIR'):
            raise ValueError('Saved settings escaped keyless copy scope')
        if args.live_settings:
            receipt['liveSettings'] = live_scenario(run, captures, fixture)
            saved = json.loads((run.root / 'config/settings-v3.json').read_text())
        run.command({'type': 'settings', 'action': 'close'})
        run.stop()
        run.start(binary)
        run.command({'type': 'settings', 'action': 'open'})
        wait_settings(run, lambda o: o['ready'] and (args.live_settings or o['catalogReady']) and o['notConnected'] and o['manualControlsAbsent'] and not o['formVisible'], 'saved grouped identities survive exact-scope restart')
        if json.loads((run.root / 'config/settings-v3.json').read_text()) != saved:
            raise ValueError('Saved catalog/fields/keys changed across restart')
        if source_identity() != source:
            raise ValueError('Source changed during Settings smoke')
        captures.append({'scenario': 'concise-introduction-after-save-restart', **run.command({'type': 'settings', 'action': 'captureIntro'})})
        capture_garmin(run, captures, 'saved-reloaded-not-connected')
        if args.provider_fields:
            capture_providers(run, captures, 'saved-restarted-fields')
        receipt.update(connectLater=True, cancel=True, groupedCatalog=not args.live_settings, exactSavedIdentities=True, activeBackendUnchanged=True, restart=True, syntheticProviderFields=args.provider_fields, staleSaveRefused=args.provider_fields)
        passed = True
    finally:
        try:
            run.stop()
        except Exception as error:
            errors.append(type(error).__name__)
        if fixture:
            receipt['syntheticProvider'] = {'models': fixture.models, 'responses': fixture.observations, 'taskCreatedConversations': fixture.conversations}
            try:
                fixture.stop()
                receipt['syntheticProviderStopped'] = True
            except Exception as error:
                errors.append(type(error).__name__)
        if observer:
            try:
                receipt['noninterference'] = observer.stop(run.pids)
            except Exception as error:
                errors.append(type(error).__name__)
        with contextlib.closing(readonly(database)) as original:
            receipt['originalUnchanged'] = fingerprint(original) == run.original
        receipt.update(passed=passed and not errors and receipt['originalUnchanged'], shutdownErrors=errors, captures=captures, run=str(run.root))
        path = scratch / ('settings-receipt-' + str(uuid.uuid4()) + '.json')
        private_json(path, receipt)
        print(json.dumps({'passed': receipt['passed'], 'receipt': str(path), 'runId': run.id}))
        if not receipt['passed']:
            raise RuntimeError('Settings smoke failed; retained evidence, no automatic mutation replay')


if __name__ == '__main__':
    def interrupted(_signal, _frame):
        raise KeyboardInterrupt('Owned Settings smoke interrupted')
    signal.signal(signal.SIGTERM, interrupted)
    main()
