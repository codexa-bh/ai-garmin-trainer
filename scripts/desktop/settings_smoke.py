"""Nonactivating keyless native Settings smoke; no credential input, auth or general controller."""
import argparse
import contextlib
import json
import os
import signal
import time
import uuid
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


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--scratch', required=True)
    parser.add_argument('--input-file', required=True)
    parser.add_argument('--resources-ready', action='store_true')
    args = parser.parse_args()
    os.umask(0o077)
    scratch = canonical(args.scratch)
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
               'exclusions': 'No ordinary artifact, full-window layout, first-run Finish, provider/token credentials, login/MFA, real integrations or OS input.',
               'cleanup': 'Task-owned online backup/settings/images/logs deferred to scratch expiry; no copy-back or primary mutation.'}
    try:
        binary = build(scratch, source, resources_ready=args.resources_ready)
        observer = Observer(scratch)
        run.observer = observer
        run.start(binary)
        before = run.http('/identity')
        run.command({'type': 'settings', 'action': 'open'})
        initial = wait_settings(run, lambda o: o['ready'], 'initial setup ready')
        if not initial['notConnected'] or not initial['manualControlsAbsent'] or initial['formVisible'] or not initial['privateActionsDenied']:
            raise ValueError('Initial Garmin settings state incorrect')
        captures.append({'scenario': 'not-connected-connect-later', **run.command({'type': 'settings', 'action': 'capture'})})
        run.command({'type': 'settings', 'action': 'connect'})
        wait_settings(run, lambda o: o['formVisible'], 'Connect reveals private form without login')
        captures.append({'scenario': 'connect-form-no-login', **run.command({'type': 'settings', 'action': 'capture'})})
        run.command({'type': 'settings', 'action': 'later'})
        wait_settings(run, lambda o: not o['formVisible'] and o['notConnected'], 'Connect later preserves selection')
        run.command({'type': 'settings', 'action': 'cancel'})
        wait_settings(run, lambda o: o['ready'] and not o['formVisible'], 'Cancel reconciles saved state')
        run.command({'type': 'settings', 'action': 'save'})
        wait_settings(run, lambda o: o['savedForNextLaunch'], 'native Save committed next-launch-only')
        after = run.http('/identity')
        if any(before[key] != after[key] for key in ['pid', 'origin', 'database']):
            raise ValueError('Ordinary Save switched active backend or DB')
        saved = json.loads((run.root / 'config/settings-v2.json').read_text())
        if saved['keys'] or saved['fields']['DATABASE_PATH'] != str(run.database) or saved['fields']['AI_PROVIDER'] != 'ollama' or saved['fields'].get('GARMIN_MCP_TOKEN_DIR'):
            raise ValueError('Saved settings escaped keyless copy scope')
        run.command({'type': 'settings', 'action': 'close'})
        run.stop()
        run.start(binary)
        run.command({'type': 'settings', 'action': 'open'})
        wait_settings(run, lambda o: o['ready'] and o['notConnected'] and o['manualControlsAbsent'] and not o['formVisible'], 'saved defaults survive exact-scope restart')
        if source_identity() != source:
            raise ValueError('Source changed during Settings smoke')
        receipt.update(connectLater=True, cancel=True, savedKeylessDefaults=True, activeBackendUnchanged=True, restart=True)
        passed = True
    finally:
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
