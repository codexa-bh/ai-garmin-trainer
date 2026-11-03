"""Finite keyless producer lifecycle evidence; never resolves a real credential."""
import contextlib
import http.client
import json
from pathlib import Path
import subprocess
import time
import uuid
from native_smoke import private_json, readonly


def prepare_summary(run):
    if run.child is not None or run.origin:
        raise ValueError('Summary preparation requires a stopped new owned run')
    base = json.loads((run.root / 'config/settings-v2.json').read_text())
    if base['keys'] or base['fields']['DATABASE_PATH'] != str(run.database):
        raise ValueError('Exact keyless run configuration required')
    fields = {**base['fields'], 'SUMMARY_ENABLED': 'true', 'SUMMARY_MODEL': 'gpt-6-luna', 'SUMMARY_CHAR_LIMIT': '6000'}
    private_json(run.root / 'config/settings-v3.json', {
        'version': 3, 'fields': fields, 'keys': {},
        'chatCatalog': {'version': 1, 'entries': [], 'defaultEntryId': None},
        'selectionCompatibility': {'database': None, 'catalog': {'version': 1, 'entries': [], 'defaultEntryId': None}},
    })
    result = subprocess.run(['npm', 'run', '--silent', 'smoke:summary:seed', '--', str(run.root)],
                            cwd=Path(__file__).resolve().parents[2], capture_output=True, timeout=30, check=True)
    if len(result.stdout) > 2048:
        raise ValueError('Summary seed output bound exceeded')
    value = json.loads(result.stdout)
    if value.get('runId') != run.id or value.get('completed') != 4 or value.get('providerCalls') != 0:
        raise ValueError('Summary authored source preparation failed')
    private_json(run.root / 'summary-seed.json', value)


def status(run, action=None):
    if run.child is None or not run.origin:
        raise ValueError('Verified live owned backend required')
    client = http.client.HTTPConnection('127.0.0.1', int(run.origin.rsplit(':', 1)[1]), timeout=5)
    try:
        client.request('GET' if action is None else 'POST', '/api/cross-chat-summary',
                       None if action is None else json.dumps({'action': action}), {'Content-Type': 'application/json'})
        response = client.getresponse()
        raw = response.read(4097)
        if response.status != 200 or len(raw) > 4096:
            raise ValueError('Summary status/control refused or output exceeded bound')
        value = json.loads(raw)
        if set(value) != {'version', 'state', 'reason', 'revision', 'frontier', 'pending', 'items', 'characters', 'enabled', 'model', 'usedByChat', 'attemptsToday', 'reservedUsdToday'} or value['usedByChat'] is not False:
            raise ValueError('Unknown summary telemetry; no raw content accepted')
        return value
    finally:
        client.close()


def scenario(run):
    deadline = time.monotonic() + 45
    observed = status(run)
    while observed['reason'] != 'summary_missing_key' and time.monotonic() < deadline:
        time.sleep(.25)  # Read-only local due-work observation, never a mutation retry.
        observed = status(run)
    if observed['reason'] != 'summary_missing_key' or observed['frontier'] != 0 or observed['pending'] != 4 or observed['model'] != 'gpt-6-luna' or observed['attemptsToday'] != 0:
        raise ValueError('Actual keyless scheduler/missing-key/coverage contract failed')
    with contextlib.closing(readonly(run.database)) as db:
        attempts_before = db.execute('select count(*) from summary_attempt').fetchone()[0]
        messages_before = db.execute('select count(*) from message').fetchone()[0]
    run.stop()
    run.start(run.binary)
    recovered = status(run)
    with contextlib.closing(readonly(run.database)) as db:
        if db.execute('select count(*) from summary_attempt').fetchone()[0] != attempts_before:
            raise ValueError('Restart silently replayed deterministic failure')
    if recovered['reason'] != 'summary_missing_key' or recovered['pending'] != 4:
        raise ValueError('Durable summary backlog/failure lost across native restart')
    cleared = status(run, 'clear')
    disabled = status(run, 'disable')
    if cleared['items'] != 0 or cleared['characters'] != 0 or disabled['enabled']:
        raise ValueError('Clear/disable did not apply')
    run.stop()
    run.start(run.binary)
    final = status(run)
    with contextlib.closing(readonly(run.database)) as db:
        cutoff = db.execute('select cutoff from summary_control where id=1').fetchone()[0]
        if cutoff != 5 or db.execute('select count(*) from message').fetchone()[0] != messages_before:
            raise ValueError('Clear lost originals or failed to include pre-clear incomplete source')
    if final['state'] != 'disabled' or final['items'] != 0:
        raise ValueError('Native startup re-enabled immediate Off or resurrected derived text')
    if status(run, 'enable')['enabled'] is not True or status(run, 'disable')['enabled'] is not False:
        raise ValueError('Explicit configured Enable/Disable recovery failed')
    private_json(run.root / ('summary-keyless-' + str(uuid.uuid4()) + '.json'), {
        'task': 'T0270', 'runId': run.id, 'source': run.config['source'],
        'independentSelection': True, 'scheduledMissingKeyObserved': True,
        'backlogAndFailureSurviveRestart': True, 'noBlindReplay': True,
        'clearIncludesIncompleteSource': True, 'offSurvivesRestart': True, 'explicitEnableRecovery': True,
        'originalMessagesPreserved': True, 'providerCalls': 0,
        'generationSuccess': 'unavailable: no separately authorized opaque native provider credential',
        'screenshot': 'ordinary captures cover adjacent rendered geometry, not hidden engine semantics or native settings controls',
    })
