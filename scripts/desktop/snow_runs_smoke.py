"""Finite authored Snow runs plus full ordinary two-instance regression."""

import argparse
from ordinary_smoke import Scenario, run_scenarios


def snow_wait(run, label):
    result = run.wait(
        lambda _value: run.command({'type': 'snowRuns', 'action': 'observe'})['ready'], label
    )
    return result


def scenario(run):
    run.command({'type': 'setViewport', 'preset': 'wide'})
    run.command({'type': 'click', 'target': 'Activities'})
    run.wait(lambda value: value['view'] == 'Activities', 'Activities reached')
    run.wait(
        lambda _value: run.command({'type': 'snowRuns', 'action': 'observe'})['choicesReady'],
        'authored snow choices',
    )
    for variant in ['populated', 'unknown', 'unsupported', 'preserved']:
        run.command({'type': 'setViewport', 'preset': 'wide'})
        run.command({'type': 'snowRuns', 'action': variant})
        snow_wait(run, variant)
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
                and variant in ['populated', 'preserved']
                and not observed['scrollable']
            ):
                raise ValueError('Narrow Snow runs must use its local table scroller')
            run.command({'type': 'captureView', 'view': 'snowRuns', 'preset': preset})
        if variant == 'populated':
            # Derived-zone Times disclosures: open for one checked capture, then closed again.
            run.command({'type': 'setViewport', 'preset': 'wide'})
            run.command({'type': 'snowRuns', 'action': 'times'})
            observed = run.command({'type': 'snowRuns', 'action': 'start'})
            if not all(
                observed[key] for key in ['ready', 'contained', 'edgeReached', 'headerVisible']
            ):
                raise ValueError('Snow Times readiness/containment/edge/header failed')
            run.command({'type': 'captureView', 'view': 'snowRuns', 'preset': 'wide'})
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
            'wide/narrow reachability and local scroll edges without page overflow',
            'activity selection/collapse/expand and Back to chat preserved',
        ),
        '11 geometry-preserving masked own-WebView captures per instance; exact authored run '
        'cells/derived HR/zone text, compact totals line and messages only, private neighbors hidden; synthetic DOM, not '
        'trusted input, real Garmin or normal-installed-app proof',
    )


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--scratch', required=True)
    parser.add_argument('--bundle', required=True)
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
    )
