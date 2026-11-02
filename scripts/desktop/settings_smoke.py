"""Nonactivating keyless native Settings smoke; no credential input, auth or general controller."""
import argparse
import contextlib
import json
import os
import re
import signal
import time
import uuid
import smoke_resources as resources
from native_smoke import Observer, Run, build, canonical, fingerprint, private_json, readonly, source_identity


def wait_settings(run, predicate, label):
    deadline = time.monotonic() + 8
    while time.monotonic() < deadline:
        value = run.command({'type': 'settings', 'action': 'observe'})
        if predicate(value):
            return value
        time.sleep(.1)
    private_json(run.root / ('settings-failure-' + str(uuid.uuid4()) + '.json'), {'assertion': label, 'observation': value})
    raise TimeoutError('Settings observation deadline: ' + label)


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


@resources.invocation
def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--scratch', required=True)
    parser.add_argument('--input-file', required=True)
    parser.add_argument('--resources-ready', action='store_true')
    args = parser.parse_args()
    os.umask(0o077)
    scratch = canonical(args.scratch)
    resources.configure(scratch)
    selected = canonical(args.input_file)
    if selected.stat().st_mode & 0o077:
        raise ValueError('Private selection required')
    database = canonical(json.loads(selected.read_text())['database'])
    source = source_identity()
    run = Run(scratch, database, source)
    observer = None
    passed = False
    captures = []
    errors = []
    receipt = {'source': source, 'scenario': 'populated-copy-keyless-native-Settings', 'runId': run.id,
               'exclusions': 'Debug Settings only; geometry-preserving synthetic provider sections, not unmasked full-window/default/ordinary Settings, first-run Finish, real provider/auth or trusted OS input.',
               'resourceDisposition': resources.disposition(),
               'cleanup': 'Final owned-disposal receipt records online-copy removal or retention; settings/images/logs remain; no copy-back or primary mutation.'}
    try:
        binary = build(scratch, source, resources_ready=args.resources_ready)
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
        exercised = run.command({'type': 'settings', 'action': 'catalogExercise'})
        if not exercised['catalogReady'] or not exercised['catalogExercised']:
            raise ValueError('Grouped catalog exercise incomplete')
        for viewport in ['wide', 'narrow']:
            run.command({'type': 'settings', 'action': 'catalog' + viewport.title()})
            for provider in ['Openai', 'Deepseek', 'Ollama', 'Openrouter']:
                captures.append({'scenario': 'grouped-' + viewport + '-' + provider.lower(), **run.command({'type': 'settings', 'action': 'capture' + provider})})
        run.command({'type': 'settings', 'action': 'save'})
        wait_settings(run, lambda o: o['savedForNextLaunch'], 'native Save committed next-launch-only')
        after = run.http('/identity')
        if any(before[key] != after[key] for key in ['pid', 'origin', 'database']):
            raise ValueError('Ordinary Save switched active backend or DB')
        saved = json.loads((run.root / 'config/settings-v3.json').read_text())
        if saved['version'] != 3 or (run.root / 'config/settings-v2.json').read_bytes() != original_settings:
            raise ValueError('Explicit catalog migration did not retain the original keyless settings')
        verify_catalog(saved['chatCatalog'])
        if saved['keys'] or saved['fields']['DATABASE_PATH'] != str(run.database) or saved['fields']['AI_PROVIDER'] != 'ollama' or saved['fields'].get('GARMIN_MCP_TOKEN_DIR'):
            raise ValueError('Saved settings escaped keyless copy scope')
        run.command({'type': 'settings', 'action': 'close'})
        run.stop()
        run.start(binary)
        run.command({'type': 'settings', 'action': 'open'})
        wait_settings(run, lambda o: o['ready'] and o['catalogReady'] and o['notConnected'] and o['manualControlsAbsent'] and not o['formVisible'], 'saved grouped identities survive exact-scope restart')
        if json.loads((run.root / 'config/settings-v3.json').read_text()) != saved:
            raise ValueError('Saved catalog/fields/keys changed across restart')
        if source_identity() != source:
            raise ValueError('Source changed during Settings smoke')
        captures.append({'scenario': 'concise-introduction-after-save-restart', **run.command({'type': 'settings', 'action': 'captureIntro'})})
        capture_garmin(run, captures, 'saved-reloaded-not-connected')
        receipt.update(connectLater=True, cancel=True, groupedCatalog=True, exactSavedIdentities=True, activeBackendUnchanged=True, restart=True)
        passed = True
    finally:
        with resources.preserve_failure():
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
