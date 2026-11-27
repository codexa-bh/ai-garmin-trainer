#!/usr/bin/env python3
"""Full ordinary regression plus public About rendering/lifecycle; no global input/browser."""

import argparse
import time
from native_smoke import private_json
from ordinary_smoke import Scenario, run_scenarios


def wait_about(run, field, expected):
    deadline = time.monotonic() + 8
    while time.monotonic() < deadline:
        value = run.command({'type': 'about', 'action': 'observe'})
        if value.get(field) is expected:
            return value
        time.sleep(0.1)
    private_json(run.root / 'about-failure.json', {'field': field, 'observation': value})
    raise TimeoutError('About observation deadline; no mutation replay')


def about(run):
    run.command({'type': 'about', 'action': 'open'})
    initial = wait_about(run, 'ready', True)
    if not initial['visible'] or not initial['closeFocused']:
        raise ValueError('About must be visible with Close focused inside its own WebView')
    run.command({'type': 'about', 'action': 'open'})  # Reuse existing window.
    capture = run.command({'type': 'about', 'action': 'capture'})
    run.capture_results.append(
        {'view': 'about', 'state': 'opened', 'runId': run.id, 'boot': run.boot, **capture}
    )
    # Explicit DOM link activation reaches native IPC but isolated admission must
    # refuse the operator-browser side effect. This is not browser handoff proof.
    run.command({'type': 'about', 'action': 'repository'})
    wait_about(run, 'linkRefused', True)
    run.command({'type': 'about', 'action': 'licence'})
    wait_about(run, 'linkRefused', True)
    run.command({'type': 'about', 'action': 'escape'})
    wait_about(run, 'visible', False)
    run.command({'type': 'about', 'action': 'open'})
    reopened = wait_about(run, 'ready', True)
    if not reopened['closeFocused']:
        raise ValueError('About reopen focus failed')
    run.command({'type': 'about', 'action': 'close'})
    wait_about(run, 'visible', False)
    run.wait(lambda value: value['view'] == 'Trainer', 'Trainer remains usable after About')
    private_json(
        run.root / 'about.json',
        {
            'initial': initial,
            'reopened': reopened,
            'capture': capture,
            'metadataComparedToRunningBundle': True,
            'browserActions': 'explicit activation refused in isolated run; real browser handoff untested',
            'inputLimit': 'local DOM/native owner only; no OS menu clicks or hardware keyboard input',
        },
    )


def about_scenario():
    return Scenario(
        'about-dialog',
        about,
        'keyless',
        (
            'bundle metadata matches rendered content',
            'repeat-open, Escape, reopen and Close',
            'isolated browser refusal; Trainer preserved',
        ),
        'Public About WebView capture; no OS chrome, actual menu click, browser handoff or trusted input proof',
    )


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--scratch', required=True)
    parser.add_argument('--bundle', required=True)
    args = parser.parse_args()
    run_scenarios(
        scratch=args.scratch,
        bundle=args.bundle,
        scenarios=(about_scenario(),),
        impact='shared',
        impact_basis='macOS app menu plus independent read-only About window',
        full=True,
    )
