#!/usr/bin/env python3
"""Independent admitted navigation; no preparation/launch/finalization code."""
import argparse
from ordinary_smoke import Scenario, run_scenarios


def navigation(run):
    run.command({'type': 'setViewport', 'preset': 'wide'})
    run.wait(lambda value: value['view'] == 'Trainer', 'initial Trainer')
    run.command({'type': 'click', 'target': 'Sync'})
    run.wait(lambda value: value['view'] == 'Sync', 'Sync reached')
    run.command({'type': 'click', 'target': 'Back to chat'})
    run.wait(lambda value: value['view'] == 'Trainer', 'Trainer returned')


def navigation_scenario():
    return Scenario('sync-return', navigation, 'keyless',
                    ('initial Trainer', 'Sync reached', 'Trainer returned'),
                    'asserted actual navigation only; no capture, connector execution or trusted input claim')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--scratch', required=True)
    parser.add_argument('--bundle', required=True)
    args = parser.parse_args()
    run_scenarios(scratch=args.scratch, bundle=args.bundle, scenarios=(navigation_scenario(),),
                  impact='local-feature', impact_basis='Reviewed finite Sync navigation and return only')
