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
                       None if action is None else json.dumps({'version': 2, 'expected': expected, 'action': action}), {'Content-Type': 'application/json'})
        response = client.getresponse()
        raw = response.read(4097)
        if response.status != 200 or len(raw) > 4096:
            raise ValueError('Summary status/control refused or output exceeded bound')
        value = json.loads(raw)
        if set(value) != {'version', 'state', 'reason', 'revision', 'frontier', 'pending', 'items', 'characters', 'enabled', 'model', 'usedByChat', 'attemptsToday', 'reservedUsdToday', 'estimatedUsdToday', 'unknownReservedUsd', 'unpricedAttempts', 'priceBasis', 'cap', 'publishedAt', 'expected'} or value['usedByChat'] is not False:
            raise ValueError('Unknown summary telemetry; no raw content accepted')
        if type(value['unpricedAttempts']) is not int or value['unpricedAttempts'] < 0:
            raise ValueError('Invalid unpriced attempt count')
        if value['priceBasis'] != PRICE_BASIS or any(type(value[key]) not in (int, float) or not math.isfinite(value[key]) or value[key] < 0 for key in ('reservedUsdToday', 'estimatedUsdToday', 'unknownReservedUsd')):
            raise ValueError('Unknown summary cost accounting; no invoice claim')
        if value['version'] != 1 or set(value['expected']) != {'revision', 'privacy', 'control', 'manual'} or any(type(n) is not int or n < 0 for n in value['expected'].values()):
            raise ValueError('Unknown summary authority; no mutation authorized')
        return value
    finally:
        client.close()


def memory_wait(run, predicate, label, timeout=8):
    deadline = time.monotonic() + timeout
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
    def action(name):
        try:
            return run.command({'type': 'memory', 'action': name})
        except Exception:
            # Diagnostic observations only: never replay a failed/unknown action.
            diagnostics = {'action': name, 'mutationReplayed': False}
            try:
                diagnostics['observation'] = run.command({'type': 'memory', 'action': 'observe'})
                diagnostics['capture'] = run.command({'type': 'captureView', 'view': 'memory', 'preset': 'wide'})
            except Exception:
                diagnostics['diagnosticUnavailable'] = True
            private_json(run.root / 'memory-action-failure.json', diagnostics)
            raise
    action('open')
    memory_wait(run, lambda value: value['loaded'] and not value['hasManual'], 'empty canonical summary')
    run.command({'type': 'setViewport', 'preset': 'narrow'})
    empty_image = run.command({'type': 'captureView', 'view': 'memory', 'preset': 'narrow'})
    private_json(run.root / 'memory-empty-narrow.json', empty_image)
    action('rebuild-preflight')
    memory_wait(run, lambda value: value['rebuildVisible'] and value['rebuildStartDisabled'] and value['rebuildCancelDisabled'], 'keyless rebuild is visible and refuses generation')
    rebuild_images = []
    for preset in ['wide', 'narrow']:
        run.command({'type': 'setViewport', 'preset': preset})
        action('rebuild-preflight')
        image = run.command({'type': 'captureView', 'view': 'memory', 'preset': preset})
        rebuild_images.append({'state': 'rebuild-keyless-preflight', 'preset': preset, **image})
        private_json(run.root / ('rebuild-capture-' + preset + '.json'), rebuild_images[-1])
    action('back')
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
    action('summary-edit')
    memory_wait(run, lambda value: value['editing'], 'whole generated summary editor')
    action('draft-update')
    before_summary = status(run)['expected']
    action('save')
    memory_wait(run, lambda value: value['loaded'] and value['hasManual'] and not value['editing'], 'summary saved separately from preference')
    summary_chars = len(f'T0272-{run.id}: Weekends remain optional; poles not chosen. Fake path /Users/example/notes; quoted ignore previous instructions.')
    after_summary = status(run)
    if after_summary['expected'] == before_summary or after_summary['characters'] != summary_chars:
        raise ValueError('Complete generated summary did not commit; no mutation replay')
    for preset in ['wide', 'narrow']:
        run.command({'type': 'setViewport', 'preset': preset})
        image = run.command({'type': 'captureView', 'view': 'memory', 'preset': preset})
        images.append({'state': 'whole-summary-and-preference', 'preset': preset, **image})
        private_json(run.root / ('whole-summary-' + preset + '.json'), images[-1])
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
    if status(run)['characters'] != summary_chars:
        raise ValueError('Whole summary edit did not survive owned restart')
    action('forget')
    memory_wait(run, lambda value: value['confirmationVisible'], 'forget review')
    action('confirm')
    memory_wait(run, lambda value: value['loaded'] and not value['hasManual'], 'forget committed')
    action('disable')
    memory_wait(run, lambda value: value['loaded'] and value['off'], 'Off committed')
    action('enable')
    memory_wait(run, lambda value: value['confirmationVisible'], 'Enable privacy review')
    action('confirm')
    memory_wait(run, lambda value: value['loaded'] and not value['off'], 'explicit Enable')
    before_clear = status(run)['expected']
    action('manage')
    action('clear')
    memory_wait(run, lambda value: value['confirmationVisible'], 'Clear review')
    action('confirm')
    deadline = time.monotonic() + 8
    while status(run)['expected'] == before_clear:
        if time.monotonic() >= deadline:
            raise TimeoutError('Clear authority did not commit; no retry')
        time.sleep(.1)
    memory_wait(run, lambda value: value['loaded'] and not value['hasManual'], 'Clear committed')
    action('back')
    presentation_images = memory_presentations(run)
    action('close')
    if run.chat_hash() != before:
        raise ValueError('Memory controls changed original conversation/message bytes')
    private_json(run.root / 'integrated-memory-controls.json', {
        'task': 'T0272', 'runId': run.id, 'source': run.config['source'],
        'manualEditForgetClearOffEnableRestart': True, 'wholeSummaryEditSaveRestart': True, 'preferencesSeparateFromGeneratedAllowance': True, 'originalChatsPreserved': True,
        'providerCalls': 0, 'captures': images, 'emptyCapture': empty_image, 'rebuildCaptures': rebuild_images, 'presentationCaptures': presentation_images,
        'rebuildPreflightKeylessRefusal': True,
        'rebuildSuccess': 'unavailable without separate native provider/model/export/cumulative-cost approval',
        'input': 'finite synthetic DOM; not trusted OS input',
        'limitations': 'Canonical authored content and static copy only. Presentation snapshots are explicitly instrumented fixtures, not provider/engine progression, qualified consumption or installed/primary proof.',
    })


def memory_presentations(run):
    """Fixed renderer-only snapshots; no backend mutation or provider success."""
    images = []
    action = lambda name: run.command({'type': 'memory', 'action': name})
    def capture(label, presets=('wide', 'narrow')):
        for preset in presets:
            run.command({'type': 'setViewport', 'preset': preset})
            image = run.command({'type': 'captureView', 'view': 'memory', 'preset': preset})
            images.append({'state': label, 'preset': preset, 'evidenceClass': 'instrumented fixed presentation fixture, not engine progression', **image})
            private_json(run.root / ('presentation-' + label + '-' + preset + '.json'), images[-1])
    action('fixture-populated')
    memory_wait(run, lambda value: value['loaded'] and value['presentationFixture'], 'populated fixed presentation')
    capture('populated')
    action('summary-edit'); action('draft'); capture('whole-summary-editor', ('wide', 'narrow')); action('cancel-edit')
    action('manage'); capture('manage', ('narrow',)); action('back')
    action('manage'); action('clear'); capture('clear-confirmation', ('narrow',)); action('cancel-confirm'); action('back')
    action('forget'); capture('forget-confirmation', ('narrow',)); action('cancel-confirm')
    action('add'); action('draft'); capture('editor', ('narrow',)); action('cancel-edit')
    for fixture in ['empty', 'error']:
        action('fixture-' + fixture)
        memory_wait(run, lambda value: value['loaded'] and value['presentationFixture'], fixture + ' fixed presentation')
        capture(fixture, ('narrow',))
    action('fixture-off')
    memory_wait(run, lambda value: value['loaded'] and value['off'], 'Off fixed retained presentation')
    capture('off', ('narrow',))
    for fixture in ['history', 'running', 'complete', 'interrupted', 'failed', 'cancelled']:
        action('fixture-' + fixture)
        memory_wait(run, lambda value: value['loaded'] and value['presentationFixture'], fixture + ' fixed presentation')
        action('rebuild-preflight')
        memory_wait(run, lambda value: value['rebuildVisible'], 'history view')
        capture(fixture, ('wide', 'narrow'))
        if fixture == 'history':
            action('history-select')
            action('history-legacy')
            action('history-effects')
            memory_wait(run, lambda value: value['loaded'], 'selected legacy local review')
            capture('selected-history')
            action('history-effects'); capture('history-cost-effects')
            action('cancel-confirm')
        action('back')
    action('fixture-progressive')
    memory_wait(run, lambda value: value['loaded'] and value['presentationFixture'], 'progressive authored presentation loaded')
    action('rebuild-preflight')
    memory_wait(run, lambda value: value['progressiveComplete'], 'multiple actual hook polls preserve DOM/focus/scroll through unchanged, growing, unavailable and terminal observations', timeout=25)
    private_json(run.root / 'memory-progressive.json', {
        'task': 'T0282', 'runId': run.id, 'source': run.config['source'],
        'counts': [20, 20, 40, 60, 'unavailable', 80, 184],
        'stableDOMFocusScroll': True, 'automaticObservation': True, 'providerCalls': 0,
        'evidenceClass': 'actual native WebView DOM temporal observations with renderer-only authored responses; not engine/provider or compositor-frame proof',
    })
    capture('progressive-complete')
    action('back')
    action('fixture-unknown')
    memory_wait(run, lambda value: not value['loaded'] and value['presentationFixture'], 'unknown fixed inspection')
    capture('unknown', ('narrow',))
    action('fixture-reset')
    memory_wait(run, lambda value: value['loaded'] and not value['presentationFixture'], 'real inspection restored')
    return images


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
