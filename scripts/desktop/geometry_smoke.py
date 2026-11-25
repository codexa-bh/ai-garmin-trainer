#!/usr/bin/env python3
"""Finite native Trainer geometry proof on owned ordinary copies; no global input."""

import argparse
import time
from native_smoke import private_json
from ordinary_smoke import Scenario, run_scenarios


def assert_initial(value):
    frame, area = value['frame'], value['workArea']
    for key in ('y',):
        if abs(frame['origin'][key] - area['origin'][key]) > 2:
            raise ValueError('Initial outer frame is not at usable desktop bottom')
    if abs(frame['size']['height'] - area['size']['height']) > 2:
        raise ValueError('Initial outer height does not fill usable desktop')
    if not 0 < frame['size']['width'] <= area['size']['width'] + 2:
        raise ValueError('Initial outer width exceeds usable desktop')
    if (
        not area['origin']['x'] - 2
        <= frame['origin']['x']
        <= (area['origin']['x'] + area['size']['width'] - frame['size']['width'] + 2)
    ):
        raise ValueError('Initial outer frame is offscreen horizontally')


def assert_restored(before, after):
    for group, keys in (('origin', ('x', 'y')), ('size', ('width', 'height'))):
        for key in keys:
            if abs(before['frame'][group][key] - after['frame'][group][key]) > 2:
                raise ValueError('Normal outer frame did not survive fresh boot')


def geometry(run):
    run.wait(lambda value: value['view'] == 'Trainer', 'Trainer geometry ready')
    initial = run.command({'type': 'windowGeometry', 'action': 'observe'})
    assert_initial(initial)
    run.capture_state = 'initial-native-work-area'
    run.command({'type': 'captureView', 'view': 'trainer', 'preset': 'native'})
    arranged = run.command({'type': 'windowGeometry', 'action': 'arrange'})
    time.sleep(1.2)  # Native bounded settle interval; never replay a mutation.
    boot = run.boot
    run.stop()
    run.start(run.binary)
    if run.boot == boot:
        raise ValueError('Geometry restart did not obtain a fresh native boot')
    restored = run.command({'type': 'windowGeometry', 'action': 'observe'})
    assert_restored(arranged, restored)
    run.capture_state = 'restored-native-frame'
    run.command({'type': 'captureView', 'view': 'trainer', 'preset': 'native'})
    # Existing wide/narrow presentation must never become a normal preference.
    run.command({'type': 'setViewport', 'preset': 'narrow'})
    time.sleep(1.2)
    run.stop()
    run.start(run.binary)
    after_capture = run.command({'type': 'windowGeometry', 'action': 'observe'})
    assert_restored(arranged, after_capture)
    private_json(
        run.root / 'geometry.json',
        {
            'initial': initial,
            'arranged': arranged,
            'restored': restored,
            'afterTemporaryCapture': after_capture,
            'freshBoot': True,
            'physicalDisplayLimit': 'current attached display only',
            'inputLimit': 'owned native setFrame; not trusted drag input',
        },
    )


def geometry_scenario():
    return Scenario(
        'window-geometry',
        geometry,
        'keyless',
        (
            'initial usable outer height',
            'moved/resized normal frame survives quit/reopen',
            'temporary fixed capture viewport does not replace preference',
        ),
        'initial/restored masked native-size WebView PNGs plus AppKit outer frame/work area; no physical multi-display or trusted input claim',
    )


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--scratch', required=True)
    parser.add_argument('--bundle', required=True)
    parser.add_argument('--full', action='store_true')
    args = parser.parse_args()
    run_scenarios(
        scratch=args.scratch,
        bundle=args.bundle,
        scenarios=(geometry_scenario(),),
        impact='shared',
        impact_basis='Trainer native geometry, persistence and capture tracking',
        full=args.full,
    )
