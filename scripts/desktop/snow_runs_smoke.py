"""Finite authored Snow runs plus full ordinary two-instance regression."""

import argparse
from ordinary_smoke import Scenario, image_arguments, run_scenarios


def snow_wait(run, label):
    result = run.wait(
        lambda _value: run.command({'type': 'snowRuns', 'action': 'observe'})['ready'], label
    )
    return result


def capture_selected(run, variant, preset, edge, times=False):
    compact = getattr(run, 'snow_hr_compact_captures', False)
    selected = not compact or (
        getattr(run, 'snow_hr_capture_instance', False)
        and (
            (
                variant == 'populated'
                and (
                    (times and (preset, edge) in [('wide', 'start'), ('narrow', 'end')])
                    or (not times and (preset, edge) == ('wide', 'start'))
                )
            )
            or (variant == 'preserved' and (preset, edge) == ('wide', 'start'))
        )
    )
    if selected:
        run.capture_state = variant + '-' + edge + ('-times' if times else '')
        run.command({'type': 'captureView', 'view': 'snowRuns', 'preset': preset})


def scenario(run):
    run.command({'type': 'setViewport', 'preset': 'wide'})
    run.command({'type': 'click', 'target': 'Activities'})
    run.wait(lambda value: value['view'] == 'Activities', 'Activities reached')
    run.wait(
        lambda _value: run.command({'type': 'snowRuns', 'action': 'observe'})['choicesReady'],
        'authored snow choices',
    )
    for variant in ['populated', 'unknown', 'unsupported', 'preserved', 'unproven']:
        run.command({'type': 'setViewport', 'preset': 'wide'})
        run.command({'type': 'snowRuns', 'action': variant})
        snow_wait(run, variant)
        if variant == 'populated':
            for action in ['page', 'search', 'clearSearch']:
                if not run.command({'type': 'snowRuns', 'action': action})['ready']:
                    raise ValueError('Authored search or restoration failed')
        if variant in ['populated', 'unknown']:
            for preset in ['wide', 'narrow']:
                run.command({'type': 'setViewport', 'preset': preset})
                navigation = run.command({'type': 'snowRuns', 'action': 'navigation'})
                if not all(navigation[key] for key in ['ready', 'contained']):
                    raise ValueError('Authored navigation readiness/containment failed')
                if getattr(run, 'snow_hr_capture_instance', False) or hasattr(
                    run, 'image_selection'
                ):
                    run.capture_state = variant + '-navigation'
                    run.command({'type': 'captureView', 'view': 'snowRuns', 'preset': preset})
            run.command({'type': 'setViewport', 'preset': 'wide'})
        run.command({'type': 'snowRuns', 'action': 'collapse'})
        for preset, edge in [('wide', 'start'), ('narrow', 'start'), ('narrow', 'end')]:
            if edge == 'end' and variant in ['unknown', 'unsupported']:
                continue
            run.command({'type': 'setViewport', 'preset': preset})
            observed = run.command({'type': 'snowRuns', 'action': edge})
            if not all(
                observed[key] for key in ['ready', 'contained', 'edgeReached', 'headerVisible']
            ):
                raise ValueError('Snow table readiness/containment/edge/header failed')
            if (
                preset == 'narrow'
                and variant in ['populated', 'preserved', 'unproven']
                and not observed['scrollable']
            ):
                raise ValueError('Narrow Snow runs must use its local table scroller')
            capture_selected(run, variant, preset, edge)
        if variant == 'populated':
            # Derived-zone Times disclosures: open for one checked capture, then closed again.
            run.command({'type': 'setViewport', 'preset': 'wide'})
            run.command({'type': 'snowRuns', 'action': 'times'})
            for preset, edge in [('wide', 'start'), ('narrow', 'end')]:
                run.command({'type': 'setViewport', 'preset': preset})
                observed = run.command({'type': 'snowRuns', 'action': edge})
                if not all(
                    observed[key] for key in ['ready', 'contained', 'edgeReached', 'headerVisible']
                ):
                    raise ValueError('Snow Times readiness/containment/edge/header failed')
                capture_selected(run, variant, preset, edge, times=True)
            run.command({'type': 'snowRuns', 'action': 'times'})
        run.command({'type': 'setViewport', 'preset': 'wide'})
        run.command({'type': 'snowRuns', 'action': 'expand'})
    if not run.command({'type': 'snowRuns', 'action': 'laps'})['ready']:
        raise ValueError('Adjacent lap table no longer matches authored evidence')
    run.command({'type': 'click', 'target': 'Back to chat'})
    run.wait(lambda value: value['view'] == 'Trainer', 'Back to chat preserved')


def snow_scenario():
    return Scenario(
        'snow-runs',
        scenario,
        'keyless',
        (
            'real authored selected-activity run-only cells, measured units, sample-derived Avg HR and '
            'HR-zone bar/Times, and the compact source-labelled Runs/Lifts totals line',
            'snow Lap details are absent where individual runs are stored (populated, latest-failed preserved) '
            'and retained for snow activities without runs; unknown and unsupported snow activities show no '
            'snow section; unrelated running activity keeps its lap zones',
            'proven stored UTC with MCP-only session rows and lap-file limits; unproven timezone, '
            'no-window-samples and missing activity zone limits remain honest',
            'wide/narrow HR/Times/reason reachability and local scroll edges without page overflow',
            'resort navigation uses stored runs or dash with duration; adjacent run distance remains unchanged',
            'fixed search, restored list and appended unselected resort page preserve navigation values',
            'activity selection/collapse/expand and Back to chat preserved',
        ),
        '15 Snow detail captures per instance plus four first-instance navigation captures; '
        'exact authored cells, totals and card metrics only, private neighbors hidden; compact '
        'selection is recorded separately. Synthetic DOM, not trusted input, real Garmin or '
        'normal-installed-app proof',
        capture_points=tuple(
            (variant + '-' + edge, 'snowRuns', preset)
            for variant in ('populated', 'unknown', 'unsupported', 'preserved', 'unproven')
            for preset, edge in (('wide', 'start'), ('narrow', 'start'), ('narrow', 'end'))
            if not (edge == 'end' and variant in ('unknown', 'unsupported'))
        )
        + tuple(
            (variant + '-navigation', 'snowRuns', preset)
            for variant in ('populated', 'unknown')
            for preset in ('wide', 'narrow')
        )
        + (
            ('populated-start-times', 'snowRuns', 'wide'),
            ('populated-end-times', 'snowRuns', 'narrow'),
        ),
    )


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--scratch', required=True)
    parser.add_argument('--bundle', required=True)
    parser.add_argument(
        '--compact-captures',
        action='store_true',
        help='Finite Snow HR capture-only selection; all full/two-instance assertions retained',
    )
    image_arguments(parser)
    args = parser.parse_args()
    run_scenarios(
        scratch=args.scratch,
        bundle=args.bundle,
        scenarios=(snow_scenario(),),
        impact='shared',
        impact_basis='Reviewed run read-model and shared native/controller/mask extension: full '
        'ordinary two-instance baseline plus actual Snow runs composition',
        full=True,
        timeout=1200,
        snow_hr_compact_captures=args.compact_captures,
        captures=args.capture,
        image_basis=args.image_basis,
    )
