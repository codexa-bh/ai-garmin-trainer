#!/usr/bin/env python3
"""Explicitly authorized finite copied-token native/API evidence, never permission itself."""
import argparse
import contextlib
import hashlib
import http.client
import json
import os
from pathlib import Path
import signal
import time
import uuid
from urllib.parse import urlsplit
from history_smoke import HistoryRun, copy_tokens, tokens_unchanged
from native_smoke import Observer, canonical, fingerprint, private_json, readonly, source_identity
from ordinary_smoke import private_directory
from release_smoke import audit

PURPOSE = 'T0260 authorized finite copied-account smoke only'
BUDGET_HEADER = {'x-trainer-sync-budget': 'finite-live-smoke'}


def operation(origin, disconnect_after_health, events=None):
    """Only the existing owned POST; drop private NDJSON immediately after projection."""
    address = urlsplit(origin)
    if address.scheme != 'http' or address.hostname != '127.0.0.1' or not address.port or address.path or address.username or address.password:
        raise ValueError('Exact native-owned loopback origin required')
    connection = http.client.HTTPConnection('127.0.0.1', address.port, timeout=185)
    progress = {'healthDaysImported': 0, 'activitiesImported': 0}
    response = None
    try:
        connection.request('POST', '/api/sync', headers=BUDGET_HEADER)
        response = connection.getresponse()
        if response.status != 200 or 'application/x-ndjson' not in response.getheader('content-type', ''):
            raise ValueError('Finite owned API Sync refused; no mutation retry')
        started = time.monotonic()
        while time.monotonic() - started <= 185:
            line = response.readline(65537)
            if not line or len(line) > 65536:
                raise ValueError('Finite Sync stream ended or exceeded frame bound; reconcile durable truth')
            event = json.loads(line)
            for key in progress:
                if isinstance(event.get(key), int) and event[key] >= 0:
                    progress[key] = event[key]
            if event.get('type') == 'result':
                discovery = event.get('discovery') or {}
                result = {'status': event.get('status'), 'attempts': (discovery.get('operation') or {}).get('attempts'),
                          'batches': (discovery.get('operation') or {}).get('batches'), **progress}
                if result['status'] not in ('completed','budget-limited','cancelled','failed') or not isinstance(result['attempts'], int) or not 0 <= result['attempts'] <= 150:
                    raise ValueError('Finite result budget/schema refused')
                if events is not None:
                    events.append(result)
                return result
            if disconnect_after_health and progress['healthDaysImported'] >= 1:
                return {'status': 'disconnect-requested', **progress}
        raise TimeoutError('Finite live stream deadline; no retry')
    finally:
        # Closing the exact streaming connection exercises real HTTP disconnect.
        if response is not None:
            response.close()
        connection.close()


def private_selector(path):
    path = canonical(path)
    info = path.stat()
    if info.st_uid != os.getuid() or info.st_mode & 0o777 != 0o600 or info.st_nlink != 1 or info.st_size > 8192:
        raise ValueError('Bounded private selector required')
    return json.loads(path.read_text())


def show_sync(run):
    if run.command({'type':'observe'})['view'] != 'Sync':
        run.command({'type': 'click', 'target': 'Sync'})
    run.wait(lambda value: value['view'] == 'Sync', 'owned Sync summary')


def capture_settled(run, label):
    run.command({'type':'setViewport', 'preset':'wide'})
    show_sync(run)
    run.command({'type': 'sync', 'action': 'refresh'})
    return {'scenario':label, **run.command({'type':'captureView', 'view':'sync', 'preset':'wide'})}


def exercise(run, claim_root, start_index=0):
    # Admission is exclusive. A diagnosed repair may consume only the still-unused
    # second effect; it never removes/replaces a claim or replays operation0.
    if start_index == 0:
        private_json(claim_root / 'live-envelope-claim.json', {'run':str(run.root), 'maxOperations':2, 'maxAttempts':300, 'maxOperationSeconds':360})
    elif start_index != 1 or not (claim_root / 'live-envelope-claim.json').is_file() or not (claim_root / 'live-operation-0-started.json').is_file() or (claim_root / 'live-operation-1-started.json').exists():
        raise ValueError('Exactly one unused second effect required; no envelope reset')
    stages = []
    for index in range(start_index, 2):
        show_sync(run)
        before = run.summary()
        if before['active']:
            raise ValueError('Live owner exists; no overlapping account test')
        private_json(claim_root / f'live-operation-{index}-started.json', {'run':str(run.root), 'operation':index, 'maxAttempts':150, 'maxSeconds':180})
        result = operation(run.origin, disconnect_after_health=index == 0)
        run.settle_claim()
        after = run.summary()
        if after['operationAttempts'] > 150 or after['active']:
            raise ValueError('Finite live settlement refused')
        stage = {'operation':index, 'before':before, 'result':result, 'after':after}
        stages.append(stage)
        run.sync_captures.append(capture_settled(run, f'live-api-{index}-settled'))
        private_json(run.root / f'live-operation-{index}.json', stage)
        if after['outcome'] == 'failed' or result['status'] == 'failed':
            raise ValueError('Live Garmin operation failed; preserve result, no automatic retry/login')
        if index == 0:
            if result['status'] != 'disconnect-requested' or after['outcome'] != 'cancelled':
                raise ValueError('Real HTTP disconnect did not settle cancellation')
            run.stop()
            run.start(run.binary)
            restored = run.summary()
            if restored['active'] or restored['healthChecks'] != after['healthChecks']:
                raise ValueError('Native restart lost progress or passively started account work')
    if stages[-1]['after']['batches'] < 2:
        raise ValueError('Live evidence did not reach multiple internal batches')
    return stages


def remaining_input(scratch, claim_root):
    claim = private_selector(claim_root / 'live-envelope-claim.json')
    if set(claim) != {'run','maxOperations','maxAttempts','maxOperationSeconds'} or [claim['maxOperations'],claim['maxAttempts'],claim['maxOperationSeconds']] != [2,300,360] or not (claim_root / 'live-operation-0-started.json').is_file() or (claim_root / 'live-operation-1-started.json').exists():
        raise ValueError('Existing exact envelope has no unclaimed second operation')
    first = private_selector(claim_root / 'live-operation-0-started.json')
    if first != {'run':claim['run'], 'operation':0, 'maxAttempts':150, 'maxSeconds':180}:
        raise ValueError('First effect does not match exact envelope')
    old_root = private_directory(canonical(claim['run']))
    if old_root.parent != scratch or old_root.name != 'ordinary-' + (old_root / 'owner').read_text():
        raise ValueError('Recorded task-owned run identity refused')
    database = canonical(old_root / 'trainer.sqlite')
    if Path(str(database) + '.trainer-writer').exists():
        raise ValueError('Prior copy still has writer ownership; do not recover by PID')
    with contextlib.closing(readonly(database)) as copy:
        row = copy.execute("select value from sync_checkpoint where key='garmin_discovery_v1'").fetchone()
        operation_state = json.loads(row[0]).get('operation') if row else None
        if not operation_state or operation_state['outcome'] != 'cancelled' or not 0 <= operation_state['attempts'] <= 150:
            raise ValueError('Prior effect not durably cancelled; reconcile unknown outcome')
        if fingerprint(copy)['integrity'] != 'ok':
            raise ValueError('Prior cancelled-copy integrity refused')
    provenance = private_selector(old_root / 'provenance.json')
    return database, provenance['original']


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--scratch', required=True)
    parser.add_argument('--input-file', required=True, help='Operator-authorized database-only private selection')
    parser.add_argument('--token-input', required=True, help='Current T0260 explicit copied-token selector')
    parser.add_argument('--settings-integrity', required=True, help='Private selected-settings hash and optional saved history limit; no provider values')
    parser.add_argument('--bundle', required=True)
    parser.add_argument('--remaining-envelope', action='store_true', help='Diagnosed repair only: reconcile cancelled first effect and consume only unused operation1')
    args = parser.parse_args()
    os.umask(0o077)
    scratch = private_directory(args.scratch)
    selection = private_selector(Path(args.input_file))
    if set(selection) != {'database'}:
        raise ValueError('Database-only selection required')
    production_database = canonical(selection['database'])
    database = production_database
    integrity = private_selector(Path(args.settings_integrity))
    if set(integrity) != {'settings','settingsSha256','historyLimit','authority'}:
        raise ValueError('Exact metadata-only settings integrity record required')
    settings = canonical(integrity['settings'])
    settings_hash = lambda: hashlib.sha256(settings.read_bytes()).hexdigest()
    if settings_hash() != integrity['settingsSha256']:
        raise ValueError('Selected production settings changed; do not reselect silently')
    claim_root = private_directory(Path(args.token_input).parent)
    expected_production = None
    if args.remaining_envelope:
        database, expected_production = remaining_input(scratch, claim_root)
        with contextlib.closing(readonly(production_database)) as original:
            if fingerprint(original) != expected_production:
                raise ValueError('Original production DB changed since first effect; retain provenance')
    elif (claim_root / 'live-envelope-claim.json').exists():
        raise ValueError('Live envelope already claimed; inspect outcomes, never blindly retry')
    bundle = canonical(args.bundle)
    source = source_identity()
    inventory = audit(bundle)
    if json.loads((bundle / 'Contents/Resources/resources/provenance.json').read_text()).get('sourceFingerprint') != source:
        raise ValueError('Current-source ordinary artifact required')
    receipt = {'scenarioPassed':False, 'source':source, 'artifactKind':'ordinary', 'realGarmin':True,
               'maxOperations':2, 'maxAttempts':300, 'maxOperationSeconds':360, 'captures':[],
               'normalDefaultModeCertified':False, 'cleanup':'Private account-derived copies/captures retained to task-scratch expiry; no primary copy-back'}
    run = observer = token_source = None
    token_hashes = {}
    try:
        observer = Observer(scratch)
        run = HistoryRun(scratch, database, source, bundle, inventory, history_setup='use-existing')
        run.observer = observer
        run.sync_captures = []
        receipt['captures'].extend(run.onboarding())
        run.stop()
        token_source, token_hashes = copy_tokens(args.token_input, run.root, PURPOSE)
        path = run.root / 'config/settings-v3.json'
        saved = json.loads(path.read_text())
        if saved['keys']:
            raise ValueError('Run must remain provider-keyless')
        saved['fields'].update({'GARMIN_MCP_TOKEN_DIR':str(run.root / 'tokens'), 'GARMIN_HISTORY_START_DATE':integrity['historyLimit']})
        staged = run.root / 'config/live-token-settings.json'
        private_json(staged, saved)
        os.replace(staged, path)
        run.start(run.binary)
        receipt['stages'] = exercise(run, claim_root, start_index=1 if args.remaining_envelope else 0)
        receipt['resumedExistingEnvelope'] = args.remaining_envelope
        if source_identity() != source or audit(bundle) != inventory or audit(run.bundle) != inventory:
            raise ValueError('Source/artifact changed during live evidence')
        receipt['scenarioPassed'] = True
    finally:
        errors = []
        if run:
            try:
                run.stop()
            except Exception:
                errors.append('Owned shutdown failed; retain private evidence')
            receipt['captures'].extend(run.sync_captures)
            with contextlib.closing(readonly(database)) as original:
                receipt['originalDatabaseUnchanged'] = fingerprint(original) == run.original
            receipt['run'] = str(run.root)
        if observer:
            receipt['noninterference'] = observer.stop(run.pids if run else [])
        if expected_production:
            with contextlib.closing(readonly(production_database)) as original:
                receipt['productionDatabaseUnchanged'] = fingerprint(original) == expected_production
        receipt['originalTokensUnchanged'] = tokens_unchanged(token_source, token_hashes) if token_source else True
        receipt['originalSettingsUnchanged'] = settings_hash() == integrity['settingsSha256']
        receipt['shutdownErrors'] = errors
        private_json(scratch / ('history-live-receipt-' + str(uuid.uuid4()) + '.json'), receipt)
        if errors or receipt.get('originalDatabaseUnchanged') is False or receipt.get('productionDatabaseUnchanged') is False or not receipt['originalTokensUnchanged'] or not receipt['originalSettingsUnchanged']:
            raise RuntimeError('Live preservation/owned shutdown gate failed; private evidence retained')
    print(json.dumps({'scenarioPassed':receipt['scenarioPassed'], 'source':source, 'operations':len(receipt['stages']), 'originalsPreserved':True, 'captures':len(receipt['captures']), 'realGarmin':True}))


if __name__ == '__main__':
    def interrupted(_signal, _frame):
        raise KeyboardInterrupt('Owned finite live smoke interrupted')
    signal.signal(signal.SIGTERM, interrupted)
    main()
