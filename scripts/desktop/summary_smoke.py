"""Finite keyless producer lifecycle evidence; never resolves a real credential."""
import contextlib
import http.client
import json
import math
from pathlib import Path
import subprocess
import time
import uuid
from native_smoke import private_json, readonly


PRICE_BASIS = 'luna-standard-2026-11-04/usd-per-million:0.10-input,0.50-output;reserve:0.25-input'


def prepare_summary(run):
    if run.child is not None or run.origin:
        raise ValueError('Summary preparation requires a stopped new owned run')
    base = json.loads((run.root / 'config/settings-v2.json').read_text())
    if base['keys'] or base['fields']['DATABASE_PATH'] != str(run.database):
        raise ValueError('Exact keyless run configuration required')
    fields = {**base['fields'], 'SUMMARY_ENABLED': 'true', 'SUMMARY_MODEL': 'gpt-6-luna', 'SUMMARY_CHAR_LIMIT': '6000',
              'SUMMARY_CONTRACT_VERSION': '2', 'MEMORY_ENABLED': 'true', 'MEMORY_EMBEDDING_PROVIDER': 'ollama',
              'MEMORY_EMBEDDING_MODEL': 'nomic-embed-text', 'MEMORY_EMBEDDING_BASE_URL': 'http://127.0.0.1:1', 'MEMORY_EMBEDDING_DIMS': '768'}
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
    if action is not None and action not in ('clear', 'disable', 'enable', 'retry'):
        raise ValueError('Unknown summary control')
    expected = status(run)['expected'] if action is not None else None
    client = http.client.HTTPConnection('127.0.0.1', int(run.origin.rsplit(':', 1)[1]), timeout=5)
    try:
        client.request('GET' if action is None else 'POST', '/api/cross-chat-summary',
                       None if action is None else json.dumps({'version': 1, 'expected': expected, 'action': action}), {'Content-Type': 'application/json'})
        response = client.getresponse()
        raw = response.read(4097)
        if response.status != 200 or len(raw) > 4096:
            raise ValueError('Summary status/control refused or output exceeded bound')
        value = json.loads(raw)
        if set(value) != {'version', 'state', 'reason', 'revision', 'frontier', 'pending', 'items', 'characters', 'enabled', 'model', 'usedByChat', 'attemptsToday', 'reservedUsdToday', 'estimatedUsdToday', 'unknownReservedUsd', 'priceBasis', 'cap', 'publishedAt', 'expected'} or value['usedByChat'] is not False:
            raise ValueError('Unknown summary telemetry; no raw content accepted')
        if value['priceBasis'] != PRICE_BASIS or any(type(value[key]) not in (int, float) or not math.isfinite(value[key]) or value[key] < 0 for key in ('reservedUsdToday', 'estimatedUsdToday', 'unknownReservedUsd')):
            raise ValueError('Unknown summary cost accounting; no invoice claim')
        if value['version'] != 1 or set(value['expected']) != {'revision', 'privacy', 'control', 'manual'} or any(type(n) is not int or n < 0 for n in value['expected'].values()):
            raise ValueError('Unknown summary authority; no mutation authorized')
        return value
    finally:
        client.close()


def memory_wait(run, predicate, label):
    deadline = time.monotonic() + 8
    observed = None
    while time.monotonic() < deadline:
        observed = run.command({'type': 'memory', 'action': 'observe'})
        if predicate(observed):
            return observed
        time.sleep(.1)  # Bounded observation only, never repeat a mutation.
    private_json(run.root / ('memory-failure-' + str(uuid.uuid4()) + '.json'), {'assertion': label, 'observation': observed})
    raise TimeoutError('Memory assertion deadline: ' + label)


def memory_controls(run):
    before = run.chat_hash()
    action = lambda name: run.command({'type': 'memory', 'action': name})
    action('open')
    memory_wait(run, lambda value: value['loaded'] and not value['hasManual'], 'empty canonical summary')
    action('rebuild-preflight')
    memory_wait(run, lambda value: value['rebuildVisible'] and value['rebuildStartDisabled'] and value['rebuildCancelDisabled'], 'keyless rebuild is visible and refuses generation')
    rebuild_images = []
    for preset in ['wide', 'narrow']:
        run.command({'type': 'setViewport', 'preset': preset})
        action('rebuild-preflight')
        image = run.command({'type': 'captureView', 'view': 'memory', 'preset': preset})
        rebuild_images.append({'state': 'rebuild-keyless-preflight', 'preset': preset, **image})
        private_json(run.root / ('rebuild-capture-' + preset + '.json'), rebuild_images[-1])
    action('add')
    memory_wait(run, lambda value: value['editing'], 'manual editor')
    action('draft')
    action('save')
    memory_wait(run, lambda value: value['loaded'] and value['hasManual'] and not value['editing'], 'manual saved')
    images = []
    for preset in ['wide', 'narrow']:
        run.command({'type': 'setViewport', 'preset': preset})
        image = run.command({'type': 'captureView', 'view': 'memory', 'preset': preset})
        images.append({'state': 'manual-saved', 'preset': preset, **image})
        private_json(run.root / ('memory-capture-' + preset + '.json'), images[-1])
    action('edit')
    memory_wait(run, lambda value: value['editing'], 'manual edit')
    action('draft-update')
    action('save')
    memory_wait(run, lambda value: value['loaded'] and value['updatedManual'] and not value['editing'], 'manual correction saved')
    action('close')
    run.stop()
    run.start(run.binary)
    action('open')
    memory_wait(run, lambda value: value['loaded'] and value['updatedManual'], 'manual survives owned restart')
    action('forget')
    memory_wait(run, lambda value: value['loaded'] and not value['hasManual'], 'forget committed')
    action('disable')
    memory_wait(run, lambda value: value['loaded'] and value['off'], 'Off committed')
    action('enable')
    memory_wait(run, lambda value: value['loaded'] and not value['off'], 'explicit Enable')
    before_clear = status(run)['expected']
    action('clear')
    deadline = time.monotonic() + 8
    while status(run)['expected'] == before_clear:
        if time.monotonic() >= deadline:
            raise TimeoutError('Clear authority did not commit; no retry')
        time.sleep(.1)
    memory_wait(run, lambda value: value['loaded'] and not value['hasManual'], 'Clear committed')
    action('close')
    if run.chat_hash() != before:
        raise ValueError('Memory controls changed original conversation/message bytes')
    private_json(run.root / 'integrated-memory-controls.json', {
        'task': 'T0272', 'runId': run.id, 'source': run.config['source'],
        'manualEditForgetClearOffEnableRestart': True, 'originalChatsPreserved': True,
        'providerCalls': 0, 'captures': images, 'rebuildCaptures': rebuild_images,
        'rebuildPreflightKeylessRefusal': True,
        'rebuildSuccess': 'unavailable without separate native provider/model/export/cumulative-cost approval',
        'input': 'finite synthetic DOM; not trusted OS input',
        'limitations': 'Static controls only revealed; no hidden-content, semantic-provider, qualified pin projection or primary activation certification',
    })


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
    memory_controls(run)
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
        'task': 'T0272', 'runId': run.id, 'source': run.config['source'],
        'sharedSummaryTitleSelection': True, 'scheduledMissingKeyObserved': True,
        'inactiveLegacyEnabledWithoutEmbeddingKeyOrDaemonControl': True,
        'backlogAndFailureSurviveRestart': True, 'noBlindReplay': True,
        'clearIncludesIncompleteSource': True, 'offSurvivesRestart': True, 'explicitEnableRecovery': True,
        'originalMessagesPreserved': True, 'providerCalls': 0,
        'generationSuccess': 'unavailable: no separately authorized opaque native provider credential',
        'screenshot': 'ordinary captures cover adjacent rendered geometry, not hidden engine semantics or native settings controls',
    })
