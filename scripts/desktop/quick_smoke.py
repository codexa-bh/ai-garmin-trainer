"""CI-only one-instance synthetic Profile save/restart; delivered native bridge, no capture/full suite."""
import argparse
import contextlib
import json
import os
import platform
import signal
import subprocess
import uuid

from native_smoke import REPO, Observer, Run, build, canonical, fingerprint, private_json, readonly, source_identity


def require_platform():
    if platform.system() != 'Darwin' or platform.machine() != 'arm64':
        raise ValueError('Quick native smoke requires actual macOS ARM64')


def debug_scenario(run):
    """Exact synthetic disclosure only; no private-input or general keyboard capability."""
    states = []
    images = []

    def state(label, opened, inner, keyboard=False):
        expected = {'available': True, 'open': opened, 'summaryVisible': True,
                    'nativeMarker': True, 'innerOpen': inner,
                    'previewsVisible': [opened, opened],
                    'bodiesVisible': [opened and inner[0], opened and inner[1]]}
        if keyboard:
            # A deliberately non-key WebView has no document/:focus-visible state.
            # Assert native key behavior AND nonactivation; keep active-window focus
            # certification explicitly unavailable, not a pass inferred from DOM focus.
            expected.update(nativeKeyReceived=True, focused=True, documentFocused=False)
        observation = run.wait(lambda o: all(o.get('llmDebug', {}).get(k) == v for k, v in expected.items()), label)
        states.append({'state': label, 'observation': observation['llmDebug']})

    def capture(label):
        images.append({'state': label, **run.command({'type': 'captureDebug'})})

    state('default-closed', False, [False, False])
    capture('default-closed')
    run.command({'type': 'debugKey', 'key': 'Enter'})
    state('Enter-opens', True, [False, False], keyboard=True)
    capture('open-inner-closed')
    run.command({'type': 'click', 'target': 'First LLM trace'})
    state('independent-inner-open', True, [True, False])
    capture('inner-open')
    run.command({'type': 'debugKey', 'key': 'Space'})
    state('Space-closes-all-descendants', False, [True, False], keyboard=True)
    run.command({'type': 'click', 'target': 'LLM debug traces'})
    state('outer-reopen-retains-inner', True, [True, False])
    run.command({'type': 'click', 'target': 'First LLM trace'})
    state('independent-inner-close', True, [False, False])
    run.command({'type': 'click', 'target': 'Close Profile & data'})
    run.wait(lambda o: o['view'] == 'Trainer', 'Profile close')
    run.command({'type': 'click', 'target': 'Profile & data'})
    state('Profile-reopen-resets-closed', False, [False, False])
    capture('Profile-reopened')
    evidence = {'passed': True, 'states': states, 'captures': images,
                'activeWindowFocusCertified': False,
                'focusLimitation': 'Intentionally non-key document suppresses :focus/:focus-visible; actual active-window focus indicator remains separate required evidence.',
                'keyboard': 'native-generated Enter/Space sent only to owned non-key WKWebView; DOM trusted key received, no hardware/global input'}
    private_json(run.root / 'debug-disclosure.json', evidence)
    return evidence


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--scratch', required=True)
    parser.add_argument('--llm-debug', action='store_true', help='Opt-in synthetic LLM disclosure actions/local keys/sanitized captures, not recurring nightly')
    parser.add_argument('--resources-ready', action='store_true', help='Verify same-source assembled inventory instead of rebuilding backend')
    args = parser.parse_args()
    os.umask(0o077)
    require_platform()
    scratch = canonical(args.scratch)
    stat = scratch.stat()
    if not scratch.is_dir() or stat.st_uid != os.getuid() or stat.st_mode & 0o077:
        raise ValueError('Scratch must be an owner-private directory')
    source = source_identity()
    name = 'ci-seed-' + str(uuid.uuid4())
    seed_command = ['npm', 'run', 'ci:seed', '--', str(scratch), name]
    if args.llm_debug:
        seed_command.append('--llm-debug')
    subprocess.run(seed_command, cwd=REPO, check=True, timeout=60)
    database = scratch / name / 'synthetic.sqlite'
    run = Run(scratch, database, source)
    observer = None
    errors = []
    passed = False
    receipt = {
        'source': source, 'scenario': 'synthetic-one-instance-Profile-save-restart' + ('-LLM-disclosure' if args.llm_debug else ''),
        'runId': run.id, 'platform': platform.platform(),
        'coverage': 'Authenticated native/backend/hydrated renderer, normal Goals save, same-state owned restart, persistence, owned shutdown.',
        'exclusions': 'No private inputs, provider/Garmin/Keychain calls, parallel/navigation matrix, hardware/global input, native dialogs, release packaging or ordinary-artifact certification. Captures only with explicit --llm-debug.',
        'cleanup': 'Synthetic seed/copy/logs deferred to scratch expiry; no copy-back or primary mutation.',
    }
    try:
        binary = build(scratch, source, resources_ready=args.resources_ready)
        observer = Observer(scratch)
        run.observer = observer
        run.start(binary)
        sentinel = run.profile_scenario()
        if args.llm_debug:
            receipt['debugDisclosure'] = debug_scenario(run)
        run.verify_restart(binary, sentinel)
        if source_identity() != source:
            raise ValueError('Source changed during quick smoke')
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
            receipt['syntheticInputUnchanged'] = fingerprint(original) == run.original
        receipt.update(passed=passed and not errors and receipt['syntheticInputUnchanged'], shutdownErrors=errors,
                       readiness=run.launches == 2, saveRestart=passed, run=str(run.root))
        path = scratch / ('quick-receipt-' + str(uuid.uuid4()) + '.json')
        private_json(path, receipt)
        print(json.dumps({'passed': receipt['passed'], 'receipt': str(path), 'source': source, 'runId': run.id}))
        if not receipt['passed']:
            raise RuntimeError('Quick smoke failed; retained original logs/receipt, no fallback or replay')


if __name__ == '__main__':
    def interrupted(_signal, _frame):
        raise KeyboardInterrupt('Owned quick smoke interrupted')
    signal.signal(signal.SIGTERM, interrupted)
    main()
