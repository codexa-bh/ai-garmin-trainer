#!/usr/bin/env python3
"""Finite ordinary-artifact keyless setup and authored Sync; legacy live route unavailable."""

import argparse
import contextlib
from datetime import datetime, timedelta, timezone
import hashlib
import http.client
import json
import os
from pathlib import Path
import signal
import sqlite3
import stat
import smoke_resources as resources
import time
import urllib.request
import uuid
from native_smoke import (
    REPO,
    Observer,
    canonical,
    fingerprint,
    private_json,
    readonly,
    source_identity,
    listening,
)
from ordinary_smoke import OrdinaryRun, private_directory
from release_smoke import audit
from release_artifact import candidate_preparation
from history_fixture import AUTHORED_SUMMARY_IDS


def setup_modes(args):
    # Sync changes need the populated existing path, not unrelated blank onboarding.
    return (
        ['use-existing']
        if args.continuation_only or args.dependency_guidance or args.synthetic_sync
        else ['create-new', 'use-existing']
    )


def selected_tokens(selection, purpose='T0238 private copied-token smoke only'):
    selection = canonical(selection)
    info = selection.stat()
    if (
        info.st_uid != os.getuid()
        or info.st_mode & 0o777 != 0o600
        or info.st_nlink != 1
        or info.st_size > 8192
    ):
        raise ValueError('Private explicit bounded token selection required')
    value = json.loads(selection.read_text())
    if set(value) != {'tokenDirectory', 'tokenFiles', 'purpose'} or value['purpose'] != purpose:
        raise ValueError('Explicit copied-token purpose required')
    directory = private_directory(value['tokenDirectory'])
    names = value['tokenFiles']
    if (
        not isinstance(names, list)
        or len(names) != len(set(names))
        or 'garmin_tokens.json' not in names
        or not set(names) <= {'garmin_tokens.json', 'garmin_tokens.base64'}
    ):
        raise ValueError('Only known explicitly selected token files are admitted')
    return directory, names


def token_bytes(directory, name):
    if name not in ('garmin_tokens.json', 'garmin_tokens.base64'):
        raise ValueError('Known token file required')
    directory = private_directory(directory)
    parent = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        pinned = os.fstat(parent)
        fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
        with os.fdopen(fd, 'rb') as source:
            info = os.fstat(source.fileno())
            if (
                not stat.S_ISREG(info.st_mode)
                or info.st_nlink != 1
                or info.st_uid != os.getuid()
                or info.st_mode & 0o777 != 0o600
                or not 0 < info.st_size <= 1048576
            ):
                raise ValueError('Token source metadata refused; originals unchanged')
            data = source.read(1048577)

            def stable(item):
                return (
                    item.st_dev,
                    item.st_ino,
                    item.st_size,
                    item.st_mtime_ns,
                    item.st_ctime_ns,
                    item.st_nlink,
                    item.st_mode,
                    item.st_uid,
                )

            current_parent = os.stat(directory, follow_symlinks=False)
            if (
                len(data) != info.st_size
                or stable(os.fstat(source.fileno())) != stable(info)
                or stable(os.stat(name, dir_fd=parent, follow_symlinks=False)) != stable(info)
                or (current_parent.st_dev, current_parent.st_ino) != (pinned.st_dev, pinned.st_ino)
            ):
                raise ValueError('Token source changed; no ambiguous copy')
            return data
    finally:
        os.close(parent)


def copy_tokens(selection, root, purpose='T0238 private copied-token smoke only'):
    directory, names = selected_tokens(selection, purpose)
    destination = private_directory(root) / 'tokens'
    destination.mkdir(mode=0o700)
    hashes = {}
    for name in names:
        data = token_bytes(directory, name)
        hashes[name] = hashlib.sha256(data).hexdigest()
        with open(
            destination / name,
            'xb',
            opener=lambda p, flags: os.open(p, flags | os.O_NOFOLLOW, 0o600),
        ) as output:
            output.write(data)
    return directory, hashes


def tokens_unchanged(directory, hashes):
    return all(
        hashlib.sha256(token_bytes(directory, name)).hexdigest() == expected
        for name, expected in hashes.items()
    )


def _stopped_synthetic(run):
    root = private_directory(run.root)
    if run.child is not None or listening(run.config['port']):
        raise ValueError('Stopped owned synthetic run required')
    return root


def _saved(root):
    return json.loads((root / 'config/settings-v3.json').read_text())


def _publish_settings(root, saved, label):
    staged = root / ('config/synthetic-' + label + '-' + str(uuid.uuid4()) + '.json')
    private_json(staged, saved)
    os.replace(staged, root / 'config/settings-v3.json')


def _attach_fixture(run):
    """Bind this stopped run to its own loopback fixture via the private descriptor.

    Native admits the fixture origin only from launch.json, only for history-setup
    runs, and requires it whenever an isolated run holds a Garmin key.
    """
    from history_fixture import Fixture

    if getattr(run, 'fixture', None) is None:
        run.fixture = Fixture(run.root, os.urandom(32).hex()).start()
        resources.guard(run.fixture.stop)
    run.descriptor['garminFixture'] = {
        'port': run.fixture.port,
        'capability': run.fixture.capability,
    }
    run.renew_capability()  # Republish launch.json through its owned atomic path.


# Authored stand-in for an old unofficial-connector token store. Never a real
# credential; the upgrade rehearsal proves it is preserved byte-for-byte.
LEGACY_TOKEN_SENTINEL = b'{"syntheticLegacyTokenSentinel":true}'


def legacy_upgrade_state(run):
    """Closed facts about the authored old connection, for before/after comparison."""
    root = private_directory(run.root)
    saved = _saved(root)
    token = root / 'tokens/garmin_tokens.json'
    return {
        'tokenSha256': hashlib.sha256(token.read_bytes()).hexdigest() if token.exists() else None,
        'tokenMode': oct(token.stat().st_mode & 0o777) if token.exists() else None,
        'retainedFields': {
            key: saved['fields'].get(key) == value
            for key, value in (
                ('GARMIN_MCP_TOKEN_DIR', str(root / 'tokens')),
                ('GARMIN_MCP_COMMAND', 'uvx'),
            )
        },
    }


# Tables a Garmin Sync may write; every other table must be logically unchanged.
SYNC_OWNED_TABLES = frozenset(
    (
        'activity',
        'daily_health',
        'activity_detail',
        'activity_detail_availability',
        'activity_detail_attempt',
        'activity_lap',
        'activity_stream_point',
        'activity_hr_zone_time',
        # Additional evidence relations written by Sync (T0352, schema 29).
        'daily_sleep_detail',
        'daily_sleep_score_component',
        'daily_hrv_detail',
        'vo2_max_reading',
        'daily_body_battery',
        'body_battery_event',
        'daily_stress',
        'activity_extra_metrics',
        'activity_split_summary',
        'activity_snow_split',
        'activity_lap_hr_zone_time',
        'garmin_data_coverage',
        'garmin_athlete_baseline',
        'garmin_athlete_baseline_attempt',
        'garmin_body_metrics',
        'garmin_body_metric_attempt',
        'garmin_body_weight_history',
        'garmin_raw_payload',
        'sync_run',
        'sync_checkpoint',
        # Completed Sync refreshes stored KPI measurements (T0328), nothing else weekly.
        'weekly_kpi_measurement',
    )
)


EXTRA_EVIDENCE_TABLES = (
    'daily_sleep_detail',
    'daily_sleep_score_component',
    'daily_hrv_detail',
    'vo2_max_reading',
    'daily_body_battery',
    'body_battery_event',
    'daily_stress',
    'activity_extra_metrics',
    'activity_snow_split',
    'activity_lap_hr_zone_time',
    'garmin_data_coverage',
)


def unrelated_tables(database):
    """Per-table logical hashes of everything Sync does not own."""
    with contextlib.closing(readonly(database)) as db:
        names = [
            name
            for (name,) in db.execute(
                "select name from sqlite_master where type='table' and name not like 'sqlite_%' order by name"
            )
            if name not in SYNC_OWNED_TABLES and not name.startswith('__')
        ]
        result = {}
        for name in names:
            quoted = '"' + name.replace('"', '""') + '"'
            rows = sorted(repr(row) for row in db.execute('select * from ' + quoted))
            result[name] = [len(rows), hashlib.sha256('\n'.join(rows).encode()).hexdigest()]
        return result


def settle_authored_summary_details(run):
    """Summary-only recipe rows are not activities served by the Sync fixture.

    Terminal unsupported markers are authored fixture setup, not successful file
    imports. Only the fixture's subsequently imported activities exercise detail
    draining. Refuse anything except this exact stopped/exclusive authored copy.
    """
    root = _stopped_synthetic(run)
    database = canonical(run.database)
    info = database.stat()
    if (
        database != root / 'trainer.sqlite'
        or info.st_uid != os.getuid()
        or info.st_mode & 0o777 != 0o600
        or info.st_nlink != 1
    ):
        raise ValueError('Exact private authored database required')
    with contextlib.closing(sqlite3.connect(database)) as db:
        ids = {row[0] for row in db.execute('select garmin_id from activity')}
        if (
            ids != AUTHORED_SUMMARY_IDS
            or db.execute('select count(*) from activity_detail_availability').fetchone()[0]
        ):
            raise ValueError('Exact fresh authored summaries required')
        with db:
            # An authored zero is a present effort fact, not a claim of imported
            # effort. Keep these summary-only rows out of unrelated enrichment;
            # fixture activity imports still exercise the real enrichment path.
            db.execute('update activity set training_effect=coalesce(training_effect,0)')
            db.executemany(
                "insert into activity_detail_availability(garmin_id,source,status,unavailable_reason) values(?,'authored_summary','unsupported','summary-only-fixture')",
                [(identity,) for identity in sorted(ids)],
            )


def imported_snow_snapshot(db):
    """Count only the fixture's imported snow activity, never retained seed rows."""
    from history_fixture import activity_ids

    identity = next(
        identity
        for identity, _day, sport in activity_ids('known')
        if sport == 'resort_snowboarding'
    )
    types = dict(
        db.execute(
            'select split_type,count(*) from activity_snow_split where garmin_id=? group by split_type',
            (identity,),
        )
    )
    return {
        'importedSnowSplits': sum(types.values()),
        'snowTypes': types,
        'snowCoverage': dict(
            db.execute(
                "select status,count(*) from garmin_data_coverage where data_group='snow_run_lift_splits' and subject_id=? group by status",
                (identity,),
            )
        ),
    }


def prepare_synthetic_history(run):
    """Only stopped, owned, keyless run settings; never select private input.

    Rehearses an existing-user upgrade: the copy first carries old unofficial
    connector metadata and an authored token sentinel, then gains the synthetic
    official key. Both old artefacts must survive unchanged and unused.
    """
    from history_fixture import SYNTHETIC_KEY

    root = _stopped_synthetic(run)
    saved = _saved(root)
    if saved['keys'] or saved.get('garminApiKey'):
        raise ValueError('Keyless unconnected synthetic settings required')
    tokens = root / 'tokens'
    tokens.mkdir(mode=0o700)
    with open(
        tokens / 'garmin_tokens.json',
        'xb',
        opener=lambda p, flags: os.open(p, flags | os.O_NOFOLLOW, 0o600),
    ) as output:
        output.write(LEGACY_TOKEN_SENTINEL)
    saved['fields'].update({'GARMIN_MCP_TOKEN_DIR': str(tokens), 'GARMIN_MCP_COMMAND': 'uvx'})
    # Authored synthetic key for the owned fixture only; never a real credential.
    saved['garminApiKey'] = SYNTHETIC_KEY
    saved['fields']['GARMIN_HISTORY_START_DATE'] = (
        datetime.now(timezone.utc).date() - timedelta(days=70)
    ).isoformat()
    _publish_settings(root, saved, 'history')
    _attach_fixture(run)
    prepare_latest_preset(run, 'known')
    settle_authored_summary_details(run)
    run.legacy_before = legacy_upgrade_state(run)
    run.unrelated_before = unrelated_tables(run.database)


def synthetic_calls(run):
    """Closed per-endpoint request aggregates from the owned fixture."""
    from history_fixture import ENDPOINTS

    counts = run.fixture.counts()
    if any(name not in ENDPOINTS or type(value) is not int for name, value in counts.items()):
        raise ValueError('Closed synthetic call aggregates required')
    return counts


def prepare_latest_preset(run, scenario):
    """Finite authored fixture preset only; no private or checkpoint mutation."""
    from history_fixture import PRESETS, SYNTHETIC_KEY

    root = _stopped_synthetic(run)
    saved = _saved(root)
    if (
        scenario not in PRESETS
        or saved['keys']
        or saved.get('garminApiKey') != SYNTHETIC_KEY
        or getattr(run, 'fixture', None) is None
    ):
        raise ValueError('Finite synthetic-only latest preset required')
    run.fixture.set_preset(scenario)


def prepare_automatic_history(run):
    """Stopped owned synthetic settings only: clear the authored limit.

    This is the same allowlisted field prepare_synthetic_history authored, now
    removed so the next owned boot runs automatic discovery. Checkpoints are
    untouched; only the explicit visible action may reconcile them.
    """
    from history_fixture import SYNTHETIC_KEY

    root = _stopped_synthetic(run)
    saved = _saved(root)
    if saved['keys'] or saved.get('garminApiKey') != SYNTHETIC_KEY:
        raise ValueError('Synthetic-only automatic transition required')
    if not saved['fields'].get('GARMIN_HISTORY_START_DATE'):
        raise ValueError('Authored date-limited synthetic settings required')
    del saved['fields']['GARMIN_HISTORY_START_DATE']
    _publish_settings(root, saved, 'automatic')


def prepare_mixed_sync_presentation(run, outcome):
    """Fixed authored 6/14 + no-progress history, after real scenario settlement.

    This is stopped synthetic presentation seeding, not a recovery operation or
    proof that the engine naturally produced the mixed checkpoint.
    """
    from history_fixture import SYNTHETIC_KEY

    if outcome not in ('settled', 'failed'):
        raise ValueError('Closed mixed presentation outcome required')
    run.verify_settled()
    root = private_directory(run.root)
    database = canonical(run.database)
    info = database.stat()
    if (
        database != root / 'trainer.sqlite'
        or info.st_uid != os.getuid()
        or info.st_mode & 0o777 != 0o600
        or info.st_nlink != 1
    ):
        raise ValueError('Exact private owned run database required')
    saved = _saved(root)
    if saved['keys'] or saved.get('garminApiKey') != SYNTHETIC_KEY:
        raise ValueError('Synthetic-only mixed presentation required')
    with contextlib.closing(sqlite3.connect(database)) as db:
        row = db.execute(
            "select value from sync_checkpoint where key='garmin_history_v1'"
        ).fetchone()
        if row is None:
            raise ValueError('Settled authored history required')
        history = json.loads(row[0])
        if (
            history['outcome'] not in ('settled', 'failed', 'cancelled')
            or history['remoteLowerBound'] is not None
        ):
            raise ValueError('Settled unknown-boundary authored history required')
        history.update(outcome='failed', recoveryReason='no-progress')
        latest = {
            'version': 1,
            'outcome': outcome,
            'updatedAt': datetime.now(timezone.utc).isoformat(),
            'activitiesProcessed': 6,
            'healthDaysRefreshed': 14,
        }
        operation = {
            **latest,
            'intent': 'latest',
            'stopReason': 'connector' if outcome == 'failed' else None,
            'detailsAttempted': 0,
            'detailsProcessed': 0,
            'detailsFailed': 0,
            'detailsRemaining': 0,
        }
        with db:
            db.execute(
                "insert or replace into sync_checkpoint(key,value,updated_at) values ('garmin_sync_v1',?,?)",
                (json.dumps(operation), int(time.time())),
            )
            db.execute(
                "update sync_checkpoint set value=? where key='garmin_history_v1'",
                (json.dumps(history),),
            )
            db.execute(
                "insert or replace into sync_checkpoint(key,value,updated_at) values ('garmin_latest_v1',?,?)",
                (json.dumps(latest), int(time.time())),
            )
        if (
            db.execute('pragma integrity_check').fetchone() != ('ok',)
            or db.execute('pragma foreign_key_check').fetchall()
        ):
            raise ValueError('Authored mixed fixture integrity failed')


def prepare_connection_scenario(run, scenario):
    """Finite stopped synthetic-only connection states; never a real key or service."""
    from history_fixture import SYNTHETIC_KEY

    if scenario not in ('missing-key', 'rejected-key', 'rate-limited', 'healthy'):
        raise ValueError('Closed connection scenario required')
    root = _stopped_synthetic(run)
    saved = _saved(root)
    if saved['keys'] or saved.get('garminApiKey') not in (None, SYNTHETIC_KEY):
        raise ValueError('Exact synthetic-only connection required')
    if scenario == 'missing-key':
        saved.pop('garminApiKey', None)
        run.descriptor.pop('garminFixture', None)
        _publish_settings(root, saved, 'connection')
        run.renew_capability()
        return
    saved['garminApiKey'] = SYNTHETIC_KEY
    _publish_settings(root, saved, 'connection')
    _attach_fixture(run)
    run.fixture.set_preset('known' if scenario == 'healthy' else scenario)


# Kernel-enforced for the owned app tree only: any attempt to execute a Python,
# uv, uvx or pip binary fails. Developer runners outside this tree are unaffected;
# nothing is uninstalled, renamed or hidden from the operator's system.
NO_EXTERNAL_TOOLS_PROFILE = (
    '(version 1)(allow default)'
    '(deny process-exec (regex #"/(python[0-9.]*|python[0-9.]*-config|uv|uvx|pip[0-9.]*)$"))'
)
SANDBOX_EXEC = Path('/usr/bin/sandbox-exec')


class HistoryRun(OrdinaryRun):
    no_external_tools = False

    def launch_prefix(self):
        if not self.no_external_tools:
            return []
        if not SANDBOX_EXEC.is_file():
            raise ValueError('macOS sandbox-exec required for the no-external-tools proof')
        return [str(SANDBOX_EXEC), '-p', NO_EXTERNAL_TOOLS_PROFILE]

    def settings_action(self, action):
        return self.command({'type': 'historySettings', 'action': action})

    def wait_settings(self, predicate, label):
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            value = self.settings_action('observe')
            if predicate(value):
                return value
            failure = value.get('setupFailure')
            if failure:
                if not isinstance(failure, str) or len(failure) > 512:
                    raise ValueError('Native settings failure schema refused')
                private_json(
                    self.root / ('setup-failure-' + str(uuid.uuid4()) + '.json'),
                    {'assertion': label, 'observation': value},
                )
                raise RuntimeError('Native settings operation failed: ' + failure)
            time.sleep(0.1)
        private_json(
            self.root / ('setup-failure-' + str(uuid.uuid4()) + '.json'),
            {'assertion': label, 'observation': value},
        )
        raise TimeoutError('History setup readiness assertion failed')

    def setup_start(self):
        if self.child is not None or listening(self.config['port']):
            raise ValueError('Owned root/endpoint must be stopped')
        self.launches += 1
        self.child = self.spawn(self.binary, self.root / f'native-{self.launches}.log')
        self.pids.append(self.child.pid)
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            if self.child.poll() is not None:
                raise RuntimeError(
                    'Owned native exited during first-run admission; inspect private log'
                )
            try:
                identity = self.http('/identity')
            except (OSError, http.client.HTTPException):
                time.sleep(0.1)
                continue
            if not self.accept_identity(identity) or identity['origin'] is not None:
                raise ValueError('First-run native identity or missing-settings state refused')
            self.wait_settings(
                lambda value: value.get('windowReady') is True, 'owned local Settings document'
            )
            self.settings_action('open')
            self.wait_settings(
                lambda value: value['ready'] and value['dataStep'] and value['automaticHistory'],
                'no-date first run',
            )
            return
        raise TimeoutError('First-run native identity deadline')

    def wait_backend(self):
        deadline = time.monotonic() + 100
        while time.monotonic() < deadline:
            if self.child.poll() is not None:
                raise RuntimeError('Owned native exited during Finish')
            try:
                identity = self.http('/identity')
            except TimeoutError:
                # Read-only identity may wait behind atomic native creation.
                # The overall readiness deadline still binds; HTTP403 never retries.
                continue
            if not self.accept_identity(identity):
                raise ValueError('Owned native identity changed')
            if identity['origin']:
                self.origin = identity['origin']
                if (
                    not self.origin.startswith('http://127.0.0.1:')
                    or int(self.origin.rsplit(':', 1)[1]) == self.config['port']
                ):
                    raise ValueError('Owned backend origin refused')
                if identity.get('runtimeReady') is not True:
                    time.sleep(0.1)
                    continue
                diagnostic = identity.get('rendererDiagnostic') or {}
                if all(diagnostic.get(key) is True for key in ('dashboard', 'bootstrap', 'ipc')):
                    value = self.command({'type': 'observe'})
                    if value['dashboard'] and value['hydrated']:
                        private_json(
                            self.root / f'readiness-{self.launches}.json',
                            {**identity, 'rendererRoundTrip': True},
                        )
                        return
            else:
                setup = self.settings_action('observe')
                failure = setup.get('setupFailure')
                if failure:
                    if not isinstance(failure, str) or len(failure) > 512:
                        raise ValueError('Native setup failure schema refused')
                    private_json(
                        self.root / 'native-setup-failure.json',
                        {'nativeStaticFailure': failure, 'observation': setup},
                    )
                    raise RuntimeError('Native Finish failed: ' + failure)
            time.sleep(0.1)
        raise TimeoutError('Finish/backend deadline; inspect commit state, no Finish replay')

    def onboarding(self):
        self.setup_start()
        self.settings_action(
            'createNew' if self.descriptor['historySetup'] == 'create-new' else 'useExisting'
        )
        images = [{'scenario': 'first-run-no-date-data', **self.settings_action('capture')}]
        for _ in range(3):
            self.settings_action('next')
        self.wait_settings(
            lambda value: value['reviewStep'] and value['automaticHistory'], 'no-date review'
        )
        images.append({'scenario': 'first-run-no-date-review', **self.settings_action('capture')})
        private_json(
            self.root / 'onboarding-captures.json',
            {'captures': images, 'source': self.config['source'], 'boot': self.boot},
        )
        self.settings_action(
            'finish'
        )  # Exactly once. Unknown effect must be reconciled, never retried.
        self.wait_backend()
        self.stop()
        self.start(self.binary)
        self.settings_action('open')
        self.wait_settings(
            lambda value: value['ready'] and not value['firstRun'] and value['automaticHistory'],
            'saved automatic direct launch',
        )
        return images

    def optional_limit(self):
        original_origin = self.origin
        self.settings_action('legacyLimit')
        self.settings_action('save')
        self.wait_settings(
            lambda value: value['ready'] and value['savedForNextLaunch'] and value['legacyLimit'],
            'legacy optional-limit Save',
        )
        self.settings_action('dismissRestart')
        if self.http('/identity')['origin'] != original_origin:
            raise ValueError('Save unexpectedly changed running backend')
        image = {'scenario': 'saved-optional-limit', **self.settings_action('capture')}
        self.stop()
        self.start(self.binary)
        self.settings_action('open')
        self.wait_settings(
            lambda value: value['ready'] and value['legacyLimit'],
            'limit persisted after explicit restart',
        )
        self.settings_action('automatic')
        self.settings_action('save')
        self.wait_settings(
            lambda value: (
                value['ready'] and value['savedForNextLaunch'] and value['automaticHistory']
            ),
            'clear limit Save',
        )
        self.settings_action('dismissRestart')
        self.stop()
        self.start(self.binary)
        return image

    def summary(self):
        # Fixed read from the verified owned backend; retain only bounded safe aggregates.
        with urllib.request.urlopen(self.origin + '/api/summary', timeout=12) as response:
            data = response.read(2 * 1024 * 1024 + 1)
            if len(data) > 2 * 1024 * 1024:
                raise ValueError('Summary bound')
            value = json.loads(data)
        history = value.get('history') or {}
        health = history.get('health') or {}
        outcome = history.get('outcome')
        if outcome is not None and outcome not in (
            'settled',
            'failed',
            'budget-limited',
            'cancelled',
            'running',
        ):
            raise ValueError('Unexpected safe history outcome')
        operation = (value.get('discovery') or {}).get('operation') or {}
        sync_work = (value.get('sync') or {}).get('operation') or {}
        return {
            'outcome': outcome,
            'active': value.get('syncActive') is True,
            'batches': operation.get('batches', 0),
            'operationAttempts': operation.get('attempts', 0),
            'healthChecks': health.get('checks'),
            'healthChecksWithMetrics': health.get('checksWithMetrics'),
            'nextHealthDate': health.get('nextDate'),
            'remoteLowerBound': history.get('remoteLowerBound'),
            'operations': history.get('operations'),
            'failureClass': history.get('failureClass'),
            'historicalState': ((value.get('sync') or {}).get('historical') or {}).get('state'),
            'historicalAction': ((value.get('sync') or {}).get('historical') or {}).get('action'),
            'savedLimit': ((value.get('sync') or {}).get('historical') or {}).get('savedLimit'),
            'limit': ((value.get('sync') or {}).get('historical') or {}).get('limit'),
            'expandedFrom': history.get('expandedFrom'),
            'noDataBefore': ((value.get('sync') or {}).get('historical') or {}).get('noDataBefore'),
            'latestOutcome': ((value.get('sync') or {}).get('latest') or {}).get('outcome'),
            'detailsAttempted': sync_work.get('detailsAttempted'),
            'detailsProcessed': sync_work.get('detailsProcessed'),
            'detailsFailed': sync_work.get('detailsFailed'),
            'detailsRemaining': (value.get('sync') or {}).get('detailsRemaining'),
            'stopReason': sync_work.get('stopReason'),
            'activities': value.get('activities'),
            'healthDays': value.get('healthDays'),
        }

    def wait_sync(self, predicate, seconds=195):
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            value = self.command({'type': 'sync', 'action': 'observe'})
            if predicate(value):
                return value
            time.sleep(0.25)
        private_json(
            self.root / ('sync-observation-timeout-' + str(uuid.uuid4()) + '.json'),
            {'rendered': value, 'summary': self.summary()},
        )
        raise TimeoutError('Finite Sync observation deadline; no mutation replay')

    def settle_claim(self):
        deadline = time.monotonic() + 40
        while time.monotonic() < deadline:
            if not self.summary()['active']:
                self.command({'type': 'sync', 'action': 'refresh'})
                return
            time.sleep(0.25)
        raise TimeoutError('Owned Sync claim did not settle; no duplicate continuation')

    def history_digest(self):
        with contextlib.closing(readonly(self.database)) as db:
            rows = db.execute(
                "select key,value from sync_checkpoint where key in ('garmin_history_v1','garmin_discovery_v1') order by key"
            ).fetchall()
        return hashlib.sha256(json.dumps(rows).encode()).hexdigest()

    def latest_snapshot(self):
        with contextlib.closing(readonly(self.database)) as db:
            row = db.execute(
                "select value from sync_checkpoint where key='garmin_latest_freshness_v1'"
            ).fetchone()
            freshness = json.loads(row[0]) if row else None
            days = (freshness or {}).get('days', {})
            # Refresh timestamps change on every read; the facts must not.
            weight = db.execute(
                'select date, weight_kg, source from garmin_body_weight_history order by date'
            ).fetchall()
            legacy_dates = [date for date, day in days.items() if day['source'] == 'legacy']
            legacy = [
                db.execute('select * from daily_health where date=?', (date,)).fetchone()
                for date in sorted(legacy_dates)
            ]
            return {
                'integrity': db.execute('pragma integrity_check').fetchone()[0],
                'foreignKeys': len(db.execute('pragma foreign_key_check').fetchall()),
                'finalDays': sum(day['final'] for day in days.values()),
                'mutableDays': sum(not day['final'] for day in days.values()),
                'legacyDays': len(legacy_dates),
                'legacyHash': hashlib.sha256(json.dumps(legacy).encode()).hexdigest(),
                'weightRows': len(weight),
                'weightHash': hashlib.sha256(json.dumps(weight).encode()).hexdigest(),
                'activities': db.execute('select count(*) from activity').fetchone()[0],
                'healthRows': db.execute('select count(*) from daily_health').fetchone()[0],
                'nonNullSteps': db.execute('select count(steps) from daily_health').fetchone()[0],
                'fitActivityPresent': bool((freshness or {}).get('fitActivity')),
                'coverageFinalDays': sum(
                    day['final'] and day['source'] == 'coverage' for day in days.values()
                ),
                'coverageTransition': bool((freshness or {}).get('coverageTransition')),
                'officialZoneRows': db.execute(
                    "select count(*) from activity_hr_zone_time where source like 'garmin_official%'"
                ).fetchone()[0],
                'detailRows': db.execute(
                    'select count(*) from activity_detail_availability'
                ).fetchone()[0],
                **imported_snow_snapshot(db),
                # Aggregate counts only, never values (additional groups).
                'extraRows': {
                    table: db.execute(f'select count(*) from {table}').fetchone()[0]
                    for table in EXTRA_EVIDENCE_TABLES
                },
            }

    def latest_probe(self, backend=False):
        before_calls = synthetic_calls(self)
        before = self.latest_snapshot()
        started = time.monotonic()
        result = self.backend_latest() if backend else self.latest_only()
        elapsed = time.monotonic() - started
        after_calls = synthetic_calls(self)
        counts = {
            name: after_calls[name] - before_calls.get(name, 0)
            for name in after_calls
            if after_calls[name] != before_calls.get(name, 0)
        }
        after = self.latest_snapshot()
        if (
            after['integrity'] != 'ok'
            or after['foreignKeys']
            or after['activities'] < before['activities']
            or after['healthRows'] < before['healthRows']
            or after['nonNullSteps'] < before['nonNullSteps']
        ):
            raise ValueError('Latest populated-copy preservation failed')
        if before['legacyDays'] and (
            after['legacyHash'] != before['legacyHash']
            or after['weightRows'] < before['weightRows']
        ):
            raise ValueError('Legacy health/weight preservation failed')
        evidence = {
            **result,
            'requestCounts': counts,
            'elapsedSeconds': round(elapsed, 3),
            'totalRequests': sum(counts.values()),
            'dataBefore': before,
            'dataAfter': after,
            'timingLimit': 'authored loopback fixture .4 seconds per HTTP request plus native observation/capture, not Garmin latency',
        }
        private_json(self.root / ('latest-probe-' + str(uuid.uuid4()) + '.json'), evidence)
        return evidence

    def latest_only(self):
        before, digest = self.summary(), self.history_digest()
        self.wait_sync(lambda value: value['startEnabled'], 10)
        self.command({'type': 'sync', 'action': 'start'})
        self.wait_sync(lambda value: value['running'] and value['cancelEnabled'], 15)
        if before['detailsRemaining'] > 1:
            deadline = time.monotonic() + 60
            while time.monotonic() < deadline:
                progress = self.summary()
                if progress['active'] and (progress['detailsProcessed'] or 0) >= 1:
                    break
                if not progress['active']:
                    raise ValueError('Detail progress did not remain observable; no replay')
                time.sleep(0.25)
            else:
                raise TimeoutError('Finite multi-detail progress was not observed')
            for preset in ('wide', 'narrow'):
                self.command({'type': 'setViewport', 'preset': preset})
                self.sync_captures.append(
                    {
                        'scenario': f'multi-detail-progress-{preset}',
                        **self.command({'type': 'captureView', 'view': 'sync', 'preset': preset}),
                    }
                )
        self.wait_sync(lambda value: value['completed'] and not value['running'], 90)
        self.settle_claim()
        after = self.summary()
        if (
            after['active']
            or after['latestOutcome'] != 'settled'
            or self.history_digest() != digest
            or after['historicalState'] != before['historicalState']
        ):
            raise ValueError('Latest refresh changed saved history or failed settlement')
        return {'before': before, 'after': after, 'historyBytesPreserved': True}

    def backend_latest(self):
        """One of the five synthetic operations, outside the local UI request owner.

        Same actual owned backend/connector; no response or state is injected.
        Keep the response open while summary refresh projects server activity.
        """
        before = self.summary()
        if before['active']:
            raise ValueError('Settled synthetic backend required; no overlap')
        digest = self.history_digest()
        request = urllib.request.Request(
            self.origin + '/api/sync',
            data=b'{"intent":"latest"}',
            headers={'Content-Type': 'application/json'},
            method='POST',
        )
        with urllib.request.urlopen(request, timeout=90) as response:
            self.command({'type': 'sync', 'action': 'refresh'})
            self.wait_sync(
                lambda value: (
                    value['running'] and not value['cancelEnabled'] and not value['startEnabled']
                ),
                15,
            )
            for preset in ('wide', 'narrow'):
                self.command({'type': 'setViewport', 'preset': preset})
                self.sync_captures.append(
                    {
                        'scenario': f'backend-only-busy-{preset}',
                        **self.command({'type': 'captureView', 'view': 'sync', 'preset': preset}),
                    }
                )
            data = response.read(1024 * 1024 + 1)
            if len(data) > 1024 * 1024:
                raise ValueError('Synthetic backend response bound; no retry')
            events = [json.loads(line) for line in data.splitlines() if line.strip()]
            if (
                not events
                or events[-1].get('type') != 'result'
                or events[-1].get('status') != 'completed'
            ):
                raise ValueError('Backend-only latest did not complete; no retry')
        self.settle_claim()
        self.wait_sync(lambda value: not value['running'] and value['startEnabled'], 15)
        after = self.summary()
        if (
            after['active']
            or after['latestOutcome'] != 'settled'
            or self.history_digest() != digest
            or after['historicalState'] != before['historicalState']
        ):
            raise ValueError('Backend-only latest changed history or failed settlement')
        return {
            'before': before,
            'after': after,
            'historyBytesPreserved': True,
            'backendOnly': True,
        }

    def synthetic_sync(self):
        """Official-path latest refreshes and two explicit historical operations.

        The ordinary app reads the authored loopback Personal API through its real
        HTTPS-shaped reader, FIT decoder and coverage finality. A fixed authored
        70-day selected scope (several 31-day range batches) permits actual range completion; no injected cursor,
        accelerated clock, UI reply or product-budget override.
        """
        images = self.sync_captures = []
        self.command({'type': 'setViewport', 'preset': 'wide'})
        self.command({'type': 'click', 'target': 'Sync'})
        self.wait(lambda value: value['view'] == 'Sync', 'synthetic Sync')
        if self.summary()['active']:
            raise ValueError('Passive navigation unexpectedly started sync')
        latest = [self.latest_probe()]
        first = latest[0]
        if first['after']['outcome'] is not None:
            raise ValueError('Fresh latest created historical state')
        if (
            first['after']['detailsProcessed'] <= 1
            or first['after']['detailsRemaining'] != 0
            or first['after']['detailsFailed'] != 0
        ):
            raise ValueError('Multi-detail backlog was not actually exhausted')
        # First official run over the prepared copy: transition recorded, ended
        # full days final by coverage, today (partial) stays open, older stored
        # dates retained as legacy, exact FIT HR zones stored for every activity.
        data = first['dataAfter']
        if (
            not data['coverageTransition']
            or data['coverageFinalDays'] < 10
            or data['mutableDays'] < 1
            or data['officialZoneRows'] < 15
            or first['requestCounts'].get('token') != 1
            or first['requestCounts'].get('activity-file', 0) < 3
            or data['weightRows'] < 3
        ):
            raise ValueError('Official coverage finality/FIT zone transition not observed')
        # Additional groups land through the same Sync: daily relations for the
        # read days, one VO2 read per daily block, list extras and lap zones
        # (7 buckets) for every activity file.
        extra = data['extraRows']
        if (
            min(
                extra[table]
                for table in (
                    'daily_sleep_detail',
                    'daily_hrv_detail',
                    'daily_body_battery',
                    'daily_stress',
                )
            )
            < 10
            or extra['activity_extra_metrics'] < 3
            or data['importedSnowSplits'] != 4
            or data['snowTypes'] != {'run': 2, 'lift': 2}
            or data['snowCoverage'].get('populated') != 1
            or extra['activity_lap_hr_zone_time'] < 21
            or not extra['garmin_data_coverage']
            or first['requestCounts'].get('vo2-max', 0)
            != first['requestCounts'].get('daily-summaries', 0)
        ):
            raise ValueError('Additional Garmin evidence groups were not imported by Sync')
        # Restarted repeat: no file re-download, only open (today) health re-read.
        self.stop()
        self.start(self.binary)
        self.command({'type': 'setViewport', 'preset': 'wide'})
        self.command({'type': 'click', 'target': 'Sync'})
        self.wait(lambda value: value['view'] == 'Sync', 'restarted official repeat')
        latest.append(self.latest_probe())
        repeat = latest[-1]
        if (
            repeat['requestCounts'].get('activity-file', 0)
            or repeat['dataAfter']['coverageFinalDays'] < data['coverageFinalDays']
            or repeat['after']['activities'] != first['after']['activities']
            or repeat['after']['healthDays'] != first['after']['healthDays']
        ):
            raise ValueError('Repeated official latest was not idempotent')
        settled = []
        for index in range(2):
            before = self.summary()
            for preset in ('wide', 'narrow'):
                self.command({'type': 'setViewport', 'preset': preset})
                images.append(
                    {
                        'scenario': f'historical-entry-{index}-{preset}',
                        **self.command({'type': 'captureView', 'view': 'sync', 'preset': preset}),
                    }
                )
            self.command({'type': 'setViewport', 'preset': 'wide'})
            if before['historicalState'] != 'available':
                raise ValueError('Actionable history required before explicit continuation')
            self.wait_sync(lambda value: value['startEnabled'], 10)
            self.command({'type': 'sync', 'action': 'continue'})
            self.wait_sync(
                lambda value: (
                    value['running'] and value['cancelEnabled'] and value['progressStarted']
                ),
                15,
            )
            self.command({'type': 'sync', 'action': 'details'})
            for preset in ('wide', 'narrow'):
                self.command({'type': 'setViewport', 'preset': preset})
                images.append(
                    {
                        'scenario': f'busy-expanded-{index}-{preset}',
                        **self.command({'type': 'captureView', 'view': 'sync', 'preset': preset}),
                    }
                )
            self.command({'type': 'setViewport', 'preset': 'wide'})
            self.command({'type': 'click', 'target': 'Back to chat'})
            if not self.summary()['active']:
                raise ValueError('Navigation lost operation ownership')
            self.command({'type': 'click', 'target': 'Sync'})
            self.wait(lambda value: value['view'] == 'Sync', 'return to active Sync')
            self.command({'type': 'setViewport', 'preset': 'wide'})
            images.append(
                {
                    'scenario': f'busy-disclosure-retained-{index}',
                    **self.command({'type': 'captureView', 'view': 'sync', 'preset': 'wide'}),
                }
            )
            self.command({'type': 'sync', 'action': 'details'})
            deadline = time.monotonic() + 150
            while time.monotonic() < deadline:
                current = self.summary()
                if current['outcome'] == 'failed' or current['operationAttempts'] > 150:
                    raise ValueError('Synthetic operation failed/exceeded finite evidence envelope')
                # Range reads can finish the selected scope in one batch: cancel the
                # first operation as soon as durable health progress is observed
                # while it is still active; settling first is a scenario failure.
                if (
                    index == 0
                    and current['active']
                    and (current['healthChecks'] or 0) > (before['healthChecks'] or 0)
                ):
                    break
                if index == 0 and not current['active']:
                    raise ValueError('First historical operation settled before cancellation')
                if index == 1 and not current['active']:
                    break
                time.sleep(0.25)
            else:
                raise TimeoutError(
                    'Historical advancement/settlement not observed within finite envelope'
                )
            for preset in ('wide', 'narrow'):
                self.command({'type': 'setViewport', 'preset': preset})
                images.append(
                    {
                        'scenario': f'synthetic-{index}-history-{preset}',
                        **self.command({'type': 'captureView', 'view': 'sync', 'preset': preset}),
                    }
                )
            if index == 0:
                self.command({'type': 'sync', 'action': 'cancel'})
                # Cancellation can read the still-active server claim before it
                # settles. Reconcile through the existing explicit summary refresh,
                # not a local-only busy flag or new application polling.
                self.settle_claim()
                self.wait_sync(lambda value: not value['running'] and value['paused'], 40)
            else:
                self.wait_sync(lambda value: not value['running'] and value['completed'], 20)
                self.settle_claim()
            after = self.summary()
            expected = 'cancelled' if index == 0 else 'settled'
            if (
                after['active']
                or after['outcome'] != expected
                or after['healthChecks'] <= (before['healthChecks'] or 0)
            ):
                raise ValueError('Synthetic historical progress/settlement was not durable')
            if index == 1 and (
                after['historicalState'] != 'complete' or after['detailsRemaining'] != 0
            ):
                raise ValueError('Selected scope/detail backlog did not complete')
            settled.append({'before': before, 'after': after})
            private_json(
                self.root / f'synthetic-sync-{index}.json',
                {
                    'source': self.config['source'],
                    'boot': self.boot,
                    'captures': images,
                    'settled': settled,
                },
            )
            self.stop()
            self.start(self.binary)
            self.command({'type': 'setViewport', 'preset': 'wide'})
            self.command({'type': 'click', 'target': 'Sync'})
            self.wait(lambda value: value['view'] == 'Sync', 'restart explicit historical work')
            restored = self.summary()
            if (
                restored['active']
                or restored['healthChecks'] != after['healthChecks']
                or restored['historicalState'] != after['historicalState']
            ):
                raise ValueError('Restart replayed or lost durable history')
        # History left ended dates it read; a restarted latest settles any that
        # are now whole-day covered and reads the activity list once.
        self.stop()
        self.start(self.binary)
        self.command({'type': 'setViewport', 'preset': 'wide'})
        self.command({'type': 'click', 'target': 'Sync'})
        self.wait(lambda value: value['view'] == 'Sync', 'restarted repeat after history')
        latest.append(self.latest_probe(backend=True))
        steady = latest[-1]
        if (
            steady['requestCounts'].get('activity-list') != 1
            or steady['requestCounts'].get('activity-file', 0)
            or steady['dataAfter']['mutableDays'] > 2
            or steady['dataAfter']['coverageFinalDays'] < steady['dataBefore']['coverageFinalDays']
        ):
            raise ValueError('Steady official latest did not reduce to bounded core reads')
        # An identical repeat changes nothing and re-reads only the open day.
        latest.append(self.latest_probe())
        repeat = latest[-1]
        if (
            repeat['dataAfter'] != steady['dataAfter']
            or repeat['requestCounts'].get('daily-summaries') != 1
            or repeat['requestCounts'].get('activity-file', 0)
        ):
            raise ValueError('Identical latest refresh was not idempotent')
        self.stop()
        prepare_latest_preset(self, 'new-activity')
        self.start(self.binary)
        self.command({'type': 'setViewport', 'preset': 'wide'})
        self.command({'type': 'click', 'target': 'Sync'})
        self.wait(lambda value: value['view'] == 'Sync', 'new newest activity')
        changed = self.latest_probe()
        if (
            changed['requestCounts'].get('activity-file') != 1
            or changed['dataAfter']['activities'] != changed['dataBefore']['activities'] + 1
            or changed['dataAfter']['officialZoneRows']
            != changed['dataBefore']['officialZoneRows'] + 5
            or changed['dataAfter']['extraRows']['activity_lap_hr_zone_time']
            != changed['dataBefore']['extraRows']['activity_lap_hr_zone_time'] + 7
            or changed['requestCounts'].get('profile-settings', 0)
        ):
            raise ValueError('Changed newest activity bypassed FIT/cadence contract')
        latest.append(changed)
        for preset in ('wide', 'narrow'):
            self.command({'type': 'setViewport', 'preset': preset})
            images.append(
                {
                    'scenario': f'completed-range-latest-{preset}',
                    **self.command({'type': 'captureView', 'view': 'sync', 'preset': preset}),
                }
            )
        self.command({'type': 'sync', 'action': 'details'})
        for preset in ('wide', 'narrow'):
            self.command({'type': 'setViewport', 'preset': preset})
            images.append(
                {
                    'scenario': f'technical-details-expanded-{preset}',
                    **self.command({'type': 'captureView', 'view': 'sync', 'preset': preset}),
                }
            )
        discovery = self.automatic_discovery()
        for outcome in ('settled', 'failed'):
            self.stop()
            prepare_mixed_sync_presentation(self, outcome)
            self.start(self.binary)
            self.command({'type': 'setViewport', 'preset': 'wide'})
            self.command({'type': 'click', 'target': 'Sync'})
            self.wait(lambda value: value['view'] == 'Sync', 'authored mixed Sync presentation')
            mixed = self.summary()
            if (
                mixed['active']
                or mixed['historicalState'] != 'blocked'
                or mixed['latestOutcome'] != outcome
                or mixed['remoteLowerBound'] is not None
            ):
                raise ValueError('Mixed authored presentation state not observed')
            for preset in ('wide', 'narrow'):
                self.command({'type': 'setViewport', 'preset': preset})
                images.append(
                    {
                        'scenario': f'mixed-latest-{outcome}-history-blocked-{preset}',
                        **self.command({'type': 'captureView', 'view': 'sync', 'preset': preset}),
                    }
                )
            if outcome == 'settled':
                self.command({'type': 'sync', 'action': 'details'})
                for preset in ('wide', 'narrow'):
                    self.command({'type': 'setViewport', 'preset': preset})
                    images.append(
                        {
                            'scenario': f'mixed-technical-details-{preset}',
                            **self.command(
                                {'type': 'captureView', 'view': 'sync', 'preset': preset}
                            ),
                        }
                    )
        legacy_after = legacy_upgrade_state(self)
        if (
            legacy_after != self.legacy_before
            or legacy_after['tokenSha256'] != hashlib.sha256(LEGACY_TOKEN_SENTINEL).hexdigest()
            or not all(legacy_after['retainedFields'].values())
        ):
            raise ValueError('Old connection metadata or token sentinel was not preserved')
        unrelated_after = unrelated_tables(self.database)
        if unrelated_after != self.unrelated_before:
            raise ValueError('Sync changed data outside its owned tables')
        private_json(
            self.root / 'synthetic-sync.json',
            {
                'source': self.config['source'],
                'legacyUpgrade': {
                    'before': self.legacy_before,
                    'after': legacy_after,
                    'claim': 'authored old connector metadata and token sentinel retained unchanged and unused; official key sync succeeded',
                },
                'unrelatedTablesUnchanged': sorted(unrelated_after),
                'captures': images,
                'settled': settled,
                'latest': latest,
                'automaticDiscovery': discovery,
                'maxInvocations': 12,
                'maxObservationSecondsPerOperation': 150,
                'mixedPresentation': 'stopped authored 6/14 latest settled/failed with no-progress blocked history; not engine progression',
                'transport': 'authored loopback Personal API fixture through the product official reader; not Garmin',
                'realGarminCertified': False,
            },
        )

    def automatic_discovery(self):
        """Settled date-limited progress continued by the explicit Discover action.

        Four more actual operations: latest (bytes preserved), Discover (cancel
        after older-than-limit progress), relaunch, explicit Continue (cancel),
        then latest. Remote earliest history stays unknown; no injected cursor.
        """
        images = self.sync_captures
        before = self.summary()
        limit = before['savedLimit']
        if (
            before['active']
            or before['historicalState'] != 'complete'
            or not limit
            or before['limit'] != limit
        ):
            raise ValueError('Settled date-limited authored history required')
        digest = self.history_digest()
        self.stop()
        prepare_automatic_history(self)
        self.start(self.binary)
        self.command({'type': 'setViewport', 'preset': 'wide'})
        self.command({'type': 'click', 'target': 'Sync'})
        self.wait(lambda value: value['view'] == 'Sync', 'automatic-scope Sync')
        offered = self.summary()
        if (
            offered['active']
            or offered['historicalAction'] != 'discover'
            or offered['savedLimit'] != limit
            or offered['limit'] is not None
            or offered['remoteLowerBound'] is not None
            or self.history_digest() != digest
        ):
            raise ValueError('Relaunch/passive read changed history or did not offer Discover')
        records = {'savedLimit': limit, 'offered': offered, 'latest': [self.latest_only()]}
        if records['latest'][0]['after']['historicalAction'] != 'discover':
            raise ValueError('Latest refresh changed the offered discovery action')
        for preset in ('wide', 'narrow'):
            self.command({'type': 'setViewport', 'preset': preset})
            images.append(
                {
                    'scenario': f'discover-offered-latest-success-{preset}',
                    **self.command({'type': 'captureView', 'view': 'sync', 'preset': preset}),
                }
            )
        self.command({'type': 'sync', 'action': 'details'})
        for preset in ('wide', 'narrow'):
            self.command({'type': 'setViewport', 'preset': preset})
            images.append(
                {
                    'scenario': f'discover-offered-details-{preset}',
                    **self.command({'type': 'captureView', 'view': 'sync', 'preset': preset}),
                }
            )
        self.command({'type': 'sync', 'action': 'details'})
        self.command({'type': 'setViewport', 'preset': 'wide'})
        records['operations'] = []
        # Discover (cancel after older progress), relaunch, then Continue until
        # automatic discovery finds the authored data start and stops itself.
        for index, action in enumerate(('discover', 'continue')):
            start = self.summary()
            if start['historicalAction'] != action:
                raise ValueError('Unexpected historical action before explicit operation')
            self.wait_sync(lambda value: value['startEnabled'], 10)
            self.command({'type': 'sync', 'action': 'continue'})  # Exactly one visible action.
            self.wait_sync(
                lambda value: (
                    value['running'] and value['cancelEnabled'] and value['progressStarted']
                ),
                15,
            )
            deadline = time.monotonic() + 150
            while time.monotonic() < deadline:
                current = self.summary()
                if current['outcome'] == 'failed' or current['operationAttempts'] > 150:
                    raise ValueError('Discovery failed/exceeded finite evidence envelope')
                if index == 0:
                    older = (
                        current['nextHealthDate'] is not None and current['nextHealthDate'] < limit
                    )
                    if current['active'] and older and current['batches'] >= 1:
                        break
                elif not current['active']:
                    break
                time.sleep(0.25)
            else:
                raise TimeoutError('Older progress/settlement not observed within finite envelope')
            if index == 0:
                for preset in ('wide', 'narrow'):
                    self.command({'type': 'setViewport', 'preset': preset})
                    images.append(
                        {
                            'scenario': f'{action}-active-{preset}',
                            **self.command(
                                {'type': 'captureView', 'view': 'sync', 'preset': preset}
                            ),
                        }
                    )
                self.command({'type': 'setViewport', 'preset': 'wide'})
                self.command({'type': 'sync', 'action': 'cancel'})
                self.settle_claim()
                self.wait_sync(lambda value: not value['running'] and value['paused'], 40)
            else:
                self.settle_claim()
                self.wait_sync(lambda value: not value['running'] and value['completed'], 40)
            after = self.summary()
            if (
                after['active']
                or after['savedLimit'] is not None
                or after['expandedFrom'] != limit
                or after['healthChecks'] <= (start['healthChecks'] or 0)
                or not after['nextHealthDate'] < limit
            ):
                raise ValueError('Transition/progress was not durable under automatic scope')
            if index == 0 and after['outcome'] != 'cancelled':
                raise ValueError('Discover cancellation was not durable')
            if index == 1 and (
                after['outcome'] != 'settled'
                or after['historicalState'] != 'complete'
                or after['historicalAction'] is not None
                or not after['noDataBefore']
                or not after['noDataBefore'] < limit
                or after['remoteLowerBound'] is not None
            ):
                raise ValueError('Automatic discovery did not stop at the authored data start')
            for preset in ('wide', 'narrow'):
                self.command({'type': 'setViewport', 'preset': preset})
                label = 'cancelled' if index == 0 else 'no-older-data'
                images.append(
                    {
                        'scenario': f'{action}-{label}-{preset}',
                        **self.command({'type': 'captureView', 'view': 'sync', 'preset': preset}),
                    }
                )
            self.stop()
            self.start(self.binary)
            self.command({'type': 'setViewport', 'preset': 'wide'})
            self.command({'type': 'click', 'target': 'Sync'})
            self.wait(lambda value: value['view'] == 'Sync', 'relaunch after explicit discovery')
            restored = self.summary()
            expected = 'continue' if index == 0 else None
            if (
                restored['active']
                or restored['healthChecks'] != after['healthChecks']
                or restored['historicalAction'] != expected
            ):
                raise ValueError('Relaunch replayed, lost progress or re-offered work')
            records['operations'].append({'action': action, 'before': start, 'after': after})
        records['latest'].append(self.latest_only())
        return records

    def dependency_guidance(self):
        """Connection recovery guidance: missing/rejected key, rate limit, healthy.

        No external tool exists to be missing any more; the failure states are the
        official reader's closed vocabulary against the owned authored fixture.
        """
        images = self.sync_captures = []
        for scenario in ('missing-key', 'rejected-key', 'rate-limited', 'healthy'):
            prepare_connection_scenario(self, scenario)
            self.start(self.binary)
            self.command({'type': 'click', 'target': 'Sync'})
            self.wait(lambda value: value['view'] == 'Sync', 'connection Sync')
            if self.summary()['active']:
                raise ValueError('Passive navigation started an integration')
            self.wait_sync(lambda value: value['startEnabled'], 10)
            self.command(
                {'type': 'sync', 'action': 'start'}
            )  # Once per changed scenario, never failure retry.
            if scenario == 'healthy':
                self.wait_sync(lambda value: value['running'] and value['progressStarted'], 15)
                # Initial rendered log only proves the click; admission is the owned
                # fixture actually serving the token exchange plus a data read.
                before = synthetic_calls(self)
                deadline = time.monotonic() + 15
                while time.monotonic() < deadline:
                    healthy = self.summary()
                    served = synthetic_calls(self)
                    reads = sum(served.values()) - sum(before.values())
                    if (
                        healthy['active']
                        and served.get('token', 0) > before.get('token', 0)
                        and reads >= 2
                    ):
                        break
                    time.sleep(0.1)
                else:
                    private_json(self.root / 'healthy-admission-timeout.json', healthy)
                    raise TimeoutError(
                        'Healthy synthetic fixture admission not observed; no Cancel/replay'
                    )
                self.command({'type': 'sync', 'action': 'cancel'})
                # Reconcile the settled server claim through the existing explicit
                # summary refresh before reading the rendered paused state.
                self.settle_claim()
                self.wait_sync(lambda value: value['paused'] and not value['running'], 40)
            else:
                self.wait_sync(lambda value: value['failed'] and not value['running'], 15)
            self.settle_claim()
            if scenario != 'healthy':
                # Closed persisted classification; the screenshot shows its guidance.
                expected = {
                    'missing-key': None,  # Blocked before any reader: 409 preflight.
                    'rejected-key': 'auth',
                    'rate-limited': 'rate-limit',
                }[scenario]
                if self.summary()['stopReason'] != expected:
                    raise ValueError('Closed connection failure classification not observed')
            for preset in ('wide', 'narrow'):
                self.command({'type': 'setViewport', 'preset': preset})
                images.append(
                    {
                        'scenario': 'connection-' + scenario + '-' + preset,
                        **self.command({'type': 'captureView', 'view': 'sync', 'preset': preset}),
                    }
                )
            private_json(
                self.root / ('connection-' + scenario + '-evidence.json'),
                {
                    'captures': images,
                    'summary': self.summary(),
                    'source': self.config['source'],
                    'boot': self.boot,
                    'realGarminCertified': False,
                },
            )
            self.command({'type': 'setViewport', 'preset': 'wide'})
            self.command({'type': 'click', 'target': 'Back to chat'})
            self.wait(lambda value: value['view'] == 'Trainer', 'saved offline Trainer')
            self.command({'type': 'click', 'target': 'Health'})
            self.wait(lambda value: value['view'] == 'Health', 'saved offline Health')
            self.stop()

    def continue_once(self):
        """One explicitly selected checkpoint continuation; never replay Cancel/start."""
        self.command({'type': 'setViewport', 'preset': 'wide'})
        self.command({'type': 'click', 'target': 'Sync'})
        self.wait(lambda value: value['view'] == 'Sync', 'Sync continuation')
        before = self.summary()
        if before['active'] or before['outcome'] not in (
            'failed',
            'cancelled',
            'budget-limited',
            'settled',
        ):
            raise ValueError('Stopped explicit prior discovery checkpoint required')
        images = self.sync_captures = []
        self.wait_sync(lambda value: value['startEnabled'], 40)
        self.command({'type': 'sync', 'action': 'continue'})  # Exactly one mutation.
        started = self.wait_sync(lambda value: value['running'] or value['failed'], 15)
        if not started['failed']:
            images.append(
                {
                    'scenario': 'single-continuation-progress',
                    **self.command({'type': 'captureView', 'view': 'sync', 'preset': 'wide'}),
                }
            )
            private_json(
                self.root / 'single-continuation-progress.json',
                {'captures': images, 'source': self.config['source'], 'boot': self.boot},
            )
            result = self.wait_sync(
                lambda value: (
                    not value['running']
                    and (value['paused'] or value['completed'] or value['failed'])
                )
            )
        else:
            result = started
        self.settle_claim()
        after = self.summary()
        images.append(
            {
                'scenario': 'single-continuation-settled',
                **self.command({'type': 'captureView', 'view': 'sync', 'preset': 'wide'}),
            }
        )
        private_json(
            self.root / 'single-continuation.json',
            {
                'before': before,
                'after': after,
                'rendered': result,
                'captures': images,
                'maxInvocations': 1,
                'maxRemoteAttempts': 96,
                'maxSeconds': 180,
                'source': self.config['source'],
                'boot': self.boot,
                'remoteLowerBoundProven': False,
            },
        )
        if result['failed']:
            raise ValueError('Single continuation failed; no retry or login')

    def real_sync(self):
        self.command({'type': 'setViewport', 'preset': 'wide'})
        self.command({'type': 'click', 'target': 'Sync'})
        self.wait(lambda value: value['view'] == 'Sync', 'Sync')
        before = self.summary()
        images = self.sync_captures = []
        self.command({'type': 'sync', 'action': 'start'})
        self.wait_sync(
            lambda value: value['running'] and value['cancelEnabled'] and value['progressStarted'],
            15,
        )
        images.append(
            {
                'scenario': 'real-sync-progress',
                **self.command({'type': 'captureView', 'view': 'sync', 'preset': 'wide'}),
            }
        )
        private_json(
            self.root / 'real-sync-progress.json',
            {
                'captures': images,
                'before': before,
                'source': self.config['source'],
                'boot': self.boot,
            },
        )
        self.command({'type': 'sync', 'action': 'cancel'})
        cancelled = self.wait_sync(
            lambda value: (
                not value['running'] and (value['paused'] or value['completed'] or value['failed'])
            ),
            40,
        )
        if cancelled['failed']:
            raise ValueError('Real copied-token Sync failed; no automatic login or retry')
        self.settle_claim()
        images.append(
            {
                'scenario': 'real-sync-cancelled',
                **self.command({'type': 'captureView', 'view': 'sync', 'preset': 'wide'}),
            }
        )
        private_json(
            self.root / 'real-sync-cancelled.json',
            {
                'captures': images,
                'cancelled': cancelled,
                'summary': self.summary(),
                'source': self.config['source'],
                'boot': self.boot,
            },
        )
        settled = []
        for _ in range(2):  # Two explicit finite continuations, never automatic background work.
            self.wait_sync(lambda value: value['startEnabled'], 40)
            self.command({'type': 'sync', 'action': 'continue'})
            started = self.wait_sync(lambda value: value['running'] or value['failed'], 15)
            if started['failed']:
                private_json(
                    self.root / 'real-sync-failure.json',
                    {
                        'before': before,
                        'summary': self.summary(),
                        'rendered': started,
                        'cancelled': cancelled,
                        'captures': images,
                    },
                )
                raise ValueError(
                    'Real copied-token continuation failed during start; no login/retry'
                )
            result = self.wait_sync(
                lambda value: (
                    not value['running']
                    and (value['paused'] or value['completed'] or value['failed'])
                )
            )
            self.settle_claim()
            settled.append({'rendered': result, 'summary': self.summary()})
            if result['failed']:
                private_json(
                    self.root / 'real-sync-failure.json',
                    {
                        'before': before,
                        'settled': settled,
                        'cancelled': cancelled,
                        'captures': images,
                    },
                )
                raise ValueError(
                    'Real copied-token continuation failed; preserve error, no login/retry'
                )
        images.append(
            {
                'scenario': 'real-sync-continued',
                **self.command({'type': 'captureView', 'view': 'sync', 'preset': 'wide'}),
            }
        )
        private_json(
            self.root / 'real-sync.json',
            {
                'before': before,
                'cancelled': cancelled,
                'settled': settled,
                'maxInvocations': 3,
                'maxRemoteAttempts': 288,
                'maxSeconds': 540,
                'remoteLowerBoundProven': False,
            },
        )
        return images


@resources.invocation
def main():
    parser = argparse.ArgumentParser(
        description=__doc__,
        epilog='Discovery: npm run smoke:help -- search sync. Build/run card: docs/synthetic-sync-smoke.md; setup and independent live authority: docs/smoke/sync.md. Run plain npm from the canonical physical task checkout. Outputs include scenario/capture and owned-disposition evidence; synthetic DOM is not trusted input or real Garmin proof.',
    )
    parser.add_argument(
        '--scratch',
        required=True,
        help='Canonical allocator-returned task root, not its evidence/disposable child',
    )
    parser.add_argument(
        '--input-file',
        required=True,
        help='Owner-private database-only selection.json from smoke:prepare; no token discovery',
    )
    parser.add_argument(
        '--bundle',
        required=True,
        help='Current full ordinary desktop:build .app from the same physical source/invocation context',
    )
    parser.add_argument(
        '--release-record',
        type=Path,
        help='Selected final DMG record; original bundle admission remains required',
    )
    parser.add_argument(
        '--dependency-guidance',
        action='store_true',
        help='Four fixed synthetic connection-recovery scenarios against the owned fixture, no account calls',
    )
    parser.add_argument(
        '--synthetic-sync',
        action='store_true',
        help='Finite authored loopback Personal API data on stopped owned copies; no account calls',
    )
    parser.add_argument(
        '--no-external-tools',
        action='store_true',
        help='macOS: launch the owned app where executing Python/uv/uvx/pip is denied (synthetic scopes only)',
    )
    parser.add_argument(
        '--token-input',
        help='UNAVAILABLE legacy route: always refuses before private input access; old T0238 authority does not apply',
    )
    parser.add_argument(
        '--continuation-only',
        action='store_true',
        help='UNAVAILABLE legacy route: requires --token-input, which is refused; not a supported continuation recipe',
    )
    args = parser.parse_args()
    if args.dependency_guidance and (
        args.synthetic_sync or args.token_input or args.continuation_only
    ):
        parser.error('Dependency evidence is synthetic-only and cannot combine execution scopes')
    if args.synthetic_sync and (args.token_input or args.continuation_only):
        parser.error(
            'Synthetic history cannot consume private tokens or legacy continuation authority'
        )
    if args.no_external_tools and not (args.synthetic_sync or args.dependency_guidance):
        parser.error('--no-external-tools applies only to the synthetic Sync scopes')
    if args.token_input:
        parser.error(
            'The historical T0238 live envelope cannot authorize the new interactive operation. Independently approve and review a finite live envelope before use; no private input opened.'
        )
    if args.continuation_only and not args.token_input:
        parser.error('--continuation-only requires explicitly selected copied tokens')
    os.umask(0o077)
    scratch = private_directory(resources.configure(canonical(args.scratch)))
    selection = canonical(args.input_file)
    info = selection.stat()
    if (
        info.st_mode & 0o777 != 0o600
        or info.st_nlink != 1
        or info.st_uid != os.getuid()
        or info.st_size > 8192
    ):
        raise ValueError('Private bounded database selection required')
    value = json.loads(selection.read_text())
    if set(value) != {'database'}:
        raise ValueError('Explicit database-only input required')
    database = canonical(value['database'])
    bundle = canonical(args.bundle)
    source = source_identity()
    with candidate_preparation(REPO, bundle, source, scratch, args.release_record) as (
        bundle,
        verify_current,
        verified,
        inventory,
        release_record,
    ):
        history_scenario(
            args,
            scratch,
            database,
            bundle,
            source,
            verified,
            inventory,
            verify_current,
            release_record,
        )


def history_scenario(
    args, scratch, database, bundle, source, verified, inventory, verify_current, release_record
):
    runs = []
    observer = None
    token_source = None
    receipt = {
        'scenarioPassed': False,
        'source': source,
        'artifactKind': 'ordinary',
        'syntheticDomInput': True,
        'normalDefaultModeCertified': False,
        'releaseTransport': release_record,
        'captures': [],
        'cleanup': 'private copy-only state/captures retained to task-scratch expiry; no copy-back',
        'externalToolsDenied': (
            'Python/uv/uvx/pip execution denied to the owned app tree by sandbox-exec'
            if args.no_external_tools
            else False
        ),
    }
    try:
        observer = Observer(scratch, preparation_locked=True)
        for mode in setup_modes(args):
            run = HistoryRun(
                scratch,
                database,
                source,
                bundle,
                inventory,
                history_setup=mode,
                verified=verified,
                macos_metadata=bool(release_record),
            )
            run.before_start = verify_current
            run.no_external_tools = args.no_external_tools
            runs.append(run)
            run.observer = observer
            receipt['captures'].extend(run.onboarding())
            if mode == 'create-new':
                # This exact run had an absent target and native exclusively
                # published it. Enroll that new inode, not the preparation copy.
                resources.file_created(run.database)
            if not args.dependency_guidance:
                receipt['captures'].append(run.optional_limit())
            run.stop()
        run = runs[-1]
        if args.dependency_guidance:
            prepare_synthetic_history(run)
            run.dependency_guidance()
            receipt['dependencyGuidance'] = (
                'actual missing-key/rejected-key/rate-limited/healthy official-path Sync against the owned authored fixture; offline navigation retained; not real key validity'
            )
            receipt['realGarmin'] = 'unavailable: no private input or fresh login authority'
        elif args.synthetic_sync:
            prepare_synthetic_history(run)
            run.start(run.binary)
            run.synthetic_sync()
            receipt['syntheticHistory'] = (
                'official-path latest refreshes (coverage transition, restart repeat, new activity) preserve history bytes; two historical operations cancel then complete the selected range across restart; authored loopback Personal API only'
            )
            receipt['realGarmin'] = (
                'unavailable: no current private-input or finite live account authority'
            )
        elif args.token_input:
            token_source, token_hashes = copy_tokens(args.token_input, run.root)
            # This is our own keyless settings, not operator/native settings or provider discovery.
            path = run.root / 'config/settings-v3.json'
            saved = json.loads(path.read_text())
            if saved['keys']:
                raise ValueError('History runner never copies provider keys')
            saved['fields']['GARMIN_MCP_TOKEN_DIR'] = str(run.root / 'tokens')
            staged = run.root / 'config/copied-token-settings.json'
            private_json(staged, saved)
            os.replace(staged, path)
            run.start(run.binary)
            if args.continuation_only:
                run.continue_once()
                receipt['realGarmin'] = (
                    'one explicit copied-token native-owned checkpoint continuation passed; no new Cancel/start batch'
                )
            else:
                run.real_sync()  # finally retains partial captures even when continuation refuses.
                receipt['realGarmin'] = (
                    'copied-token native-owned Sync/cancel/two explicit continuations passed'
                )
        else:
            receipt['realGarmin'] = 'unavailable: no explicit private copied-token input'
            run.start(run.binary)
            run.command({'type': 'setViewport', 'preset': 'wide'})
            run.command({'type': 'click', 'target': 'Sync'})
            run.wait(lambda value: value['view'] == 'Sync', 'keyless Sync view')
            receipt['captures'].append(
                {
                    'scenario': 'keyless-sync-idle',
                    **run.command({'type': 'captureView', 'view': 'sync', 'preset': 'wide'}),
                }
            )
        if (
            source_identity() != source
            or audit(bundle) != inventory
            or any(audit(run.bundle) != inventory for run in runs)
        ):
            raise ValueError('Source/artifact changed during evidence')
        receipt['scenarioPassed'] = True
    finally:
        errors = []
        for run in runs:
            try:
                run.stop()
            except Exception:
                errors.append('Owned shutdown failed; inspect private run evidence')
        if observer:
            try:
                receipt['noninterference'] = observer.stop(
                    [pid for run in runs for pid in run.pids]
                )
            except Exception:
                errors.append('Noninterference observer failed; inspect private evidence')
        with contextlib.closing(readonly(database)) as original:
            receipt['originalDatabaseUnchanged'] = all(
                fingerprint(original) == run.original for run in runs
            )
        receipt['originalTokensUnchanged'] = (
            tokens_unchanged(token_source, token_hashes)
            if token_source
            else (None if args.token_input else True)
        )
        receipt['captures'].extend(
            capture for run in runs for capture in getattr(run, 'sync_captures', [])
        )
        receipt.update({'runs': [str(run.root) for run in runs], 'shutdownErrors': errors})
        private_json(scratch / ('history-receipt-' + str(uuid.uuid4()) + '.json'), receipt)
        if (
            errors
            or not receipt['originalDatabaseUnchanged']
            or not receipt['originalTokensUnchanged']
        ):
            raise RuntimeError(
                'Original preservation/owned shutdown gate failed; private evidence retained'
            )
    print(json.dumps(receipt))


if __name__ == '__main__':

    def interrupted(_signal, _frame):
        raise KeyboardInterrupt('Owned history smoke interrupted')

    signal.signal(signal.SIGTERM, interrupted)
    main()
