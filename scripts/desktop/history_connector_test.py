import ast
import json
import os
from pathlib import Path
import tempfile
import subprocess
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch
from history_connector import SENTINEL, REVIEWED_ARGS, admitted, reply, preset, record_call
from history_smoke import HistoryRun, prepare_synthetic_history
from native_smoke import private_json


class SyntheticHistoryContracts(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name).resolve()
        self.root.chmod(0o700)
        (self.root / 'config').mkdir(mode=0o700)
        private_json(self.root / 'config/settings-v3.json', {'version':3, 'fields':{}, 'keys':{}})
        self.run = SimpleNamespace(root=self.root, child=None, config={'port':1})

    def tearDown(self):
        self.temporary.cleanup()

    def prepare(self):
        with patch('history_smoke.listening', return_value=False):
            prepare_synthetic_history(self.run)

    def test_only_stopped_keyless_owned_settings_select_the_authored_connector(self):
        original = json.loads((self.root / 'config/settings-v3.json').read_text())
        self.prepare()
        saved = json.loads((self.root / 'config/settings-v3.json').read_text())
        self.assertEqual(saved['keys'], {})
        self.assertEqual(saved['fields']['GARMIN_MCP_TOKEN_DIR'], str(self.root / 'tokens'))
        self.assertNotIn('GARMIN_MCP_ARGS', saved['fields'])
        self.assertEqual((self.root / 'synthetic_history_connector.py').stat().st_mode & 0o777, 0o700)
        self.assertEqual(saved['fields']['GARMIN_MCP_COMMAND'], str(self.root / 'synthetic_history_connector.py'))
        self.assertTrue(admitted(self.root))
        self.assertEqual((self.root / 'tokens/garmin_tokens.json').read_bytes(), SENTINEL)
        self.assertEqual(original['fields'], {})
        with self.assertRaises(ValueError):
            self.prepare()
        tree = ast.parse((self.root / 'synthetic_history_connector.py').read_text())
        imports = {node.names[0].name for node in ast.walk(tree) if isinstance(node, ast.Import)}
        self.assertEqual(imports, {'datetime', 'json', 'os', 'stat', 'sys', 'time'})
        self.assertFalse(any(isinstance(node, ast.ImportFrom) and node.module not in ('pathlib',) for node in ast.walk(tree)))

    def test_actual_executable_keeps_reviewed_argv_and_refuses_unknown_launch(self):
        self.prepare()
        script = str(self.root / 'synthetic_history_connector.py')
        frame = json.dumps({'jsonrpc':'2.0', 'id':1, 'method':'initialize', 'params':{}}) + '\n'
        result = subprocess.run([script, *REVIEWED_ARGS], input=frame, text=True, capture_output=True, timeout=5)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)['result']['serverInfo']['name'], 'authored-history-only')
        refused = subprocess.run([script, '--unreviewed'], input=frame, text=True, capture_output=True, timeout=5)
        self.assertNotEqual(refused.returncode, 0)
        self.assertEqual(refused.stdout, '')

    def test_preconfigured_secret_or_live_child_refuses_without_outputs(self):
        for saved in [{'keys':{'OPENAI_API_KEY':'never-open'}, 'fields':{}}, {'keys':{}, 'fields':{'GARMIN_MCP_TOKEN_DIR':'never-open'}}]:
            path = self.root / 'config/settings-v3.json'
            path.write_text(json.dumps(saved))
            with self.assertRaises(ValueError):
                self.prepare()
            self.assertFalse((self.root / 'tokens').exists())
        self.run.child = object()
        with self.assertRaises(ValueError):
            self.prepare()

    def test_alias_insecure_or_changed_sentinel_cannot_be_used_as_real_tokens(self):
        self.prepare()
        token = self.root / 'tokens/garmin_tokens.json'
        token.chmod(0o644)
        self.assertFalse(admitted(self.root))
        token.chmod(0o600)
        token.write_bytes(b'not the authored sentinel')
        self.assertFalse(admitted(self.root))
        token.write_bytes(SENTINEL)
        os.link(token, self.root / 'hardlink')
        self.assertFalse(admitted(self.root))

    def test_primary_presets_are_finite_private_stopped_and_keep_originals(self):
        from history_smoke import prepare_latest_preset
        from datetime import datetime
        self.prepare()
        original = (self.root / 'config/settings-v3.json').read_bytes()
        def devices(scenario):
            return json.loads(reply({'method':'tools/call', 'params':{'name':'get_devices', 'arguments':{}}}, scenario)['content'][0]['text'])
        self.assertEqual(preset(self.root), 'delayed')
        known = devices('known')
        delayed = devices('delayed')
        self.assertTrue(known[0]['is_primary'])
        self.assertFalse(known[1]['is_primary'])
        self.assertGreater((datetime.fromisoformat(known[0]['last_sync_time']) - datetime.fromisoformat(delayed[0]['last_sync_time'])).total_seconds(), 4 * 86400)
        self.assertIsNone(devices('unknown')[0]['last_sync_time'])
        with patch('history_smoke.listening', return_value=False):
            for scenario in ('known', 'unknown', 'delayed', 'new-activity', 'last-used'):
                prepare_latest_preset(self.run, scenario)
                self.assertEqual(preset(self.root), scenario)
            with self.assertRaises(ValueError):
                prepare_latest_preset(self.run, 'private-input')
            self.run.child = object()
            with self.assertRaises(ValueError):
                prepare_latest_preset(self.run, 'known')
        self.assertEqual((self.root / 'config/settings-v3.json').read_bytes(), original)
        path = self.root / 'synthetic-latest-preset.json'
        path.chmod(0o644)
        with self.assertRaises(ValueError):
            preset(self.root)
        path.chmod(0o600)
        alias = self.root / 'alias.json'
        path.rename(alias)
        path.symlink_to(alias)
        with self.assertRaises(OSError):
            preset(self.root)

    def test_last_used_preset_mirrors_pinned_curation_filter_and_process_zone(self):
        import time as clock
        from datetime import datetime, timezone
        def call(name, scenario):
            return json.loads(reply({'method':'tools/call', 'params':{'name':name, 'arguments':{}}}, scenario)['content'][0]['text'])
        devices = call('get_devices', 'last-used')
        self.assertIsNone(devices[0]['last_sync_time'])
        self.assertTrue(devices[0]['is_primary'])
        matched = call('get_device_last_used', 'last-used')
        self.assertEqual(matched['user_device_id'], devices[0]['device_id'])
        self.assertRegex(matched['last_upload_time'], r'^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$')
        # Every other preset names the non-primary device (a newer bike upload).
        for scenario in ('known', 'unknown', 'delayed', 'new-activity'):
            self.assertEqual(call('get_device_last_used', scenario)['user_device_id'], 2)
        self.assertIsNotNone(call('get_devices', 'known')[0]['last_sync_time'])
        with patch.dict(os.environ, {'GARMIN_ENABLED_TOOLS':'get_device_last_used'}):
            self.assertIn('user_device_id', call('get_device_last_used', 'last-used'))
            with self.assertRaises(ValueError):
                call('get_devices', 'last-used')
        with patch.dict(os.environ, {'GARMIN_ENABLED_TOOLS':'get_devices'}):
            with self.assertRaises(ValueError):
                call('get_device_last_used', 'last-used')
        with self.assertRaises(ValueError):
            reply({'method':'tools/call', 'params':{'name':'get_device_last_used', 'arguments':{'device_id':1}}}, 'last-used')
        # Rendered in the connector's local zone like the pinned code: UTC0 gives UTC text.
        previous = os.environ.get('TZ')
        try:
            os.environ['TZ'] = 'UTC0'
            clock.tzset()
            rendered = datetime.strptime(call('get_device_last_used', 'last-used')['last_upload_time'], '%Y-%m-%d %H:%M:%S').replace(tzinfo=timezone.utc)
            self.assertLess(abs((datetime.now(timezone.utc) - rendered).total_seconds()), 5)
        finally:
            if previous is None:
                os.environ.pop('TZ', None)
            else:
                os.environ['TZ'] = previous
            clock.tzset()

    def test_call_evidence_contains_only_names_and_records_boolean_not_payloads(self):
        self.prepare()
        message = {'params':{'name':'get_devices', 'arguments':{}}}
        record_call(self.root, message)
        path = self.root / 'synthetic-calls.jsonl'
        self.assertEqual(json.loads(path.read_text()), {'name':'get_devices', 'records':None})
        self.assertEqual(path.stat().st_mode & 0o777, 0o600)
        from history_smoke import synthetic_calls
        self.assertEqual(synthetic_calls(self.root), [{'name':'get_devices', 'records':None}])
        before = path.read_bytes()
        with self.assertRaises(ValueError):
            record_call(self.root, {'params':{'name':'get_activity_fit_data','arguments':{'include_records':'private-canary'}}})
        self.assertEqual(path.read_bytes(), before)
        path.write_text('{"name":"get_devices","records":"private-canary"}\n')
        with self.assertRaises(ValueError):
            synthetic_calls(self.root)
        path.write_bytes(before)
        path.chmod(0o644)
        with self.assertRaises(ValueError):
            record_call(self.root, message)
        with self.assertRaises(ValueError):
            synthetic_calls(self.root)
        path.chmod(0o600)
        target = path.with_name('preserved-calls.jsonl')
        path.rename(target)
        path.symlink_to(target)
        with self.assertRaises(ValueError):
            synthetic_calls(self.root)

    def test_closed_protocol_and_fit_reply_cannot_trigger_real_supplements(self):
        def tool(name, args):
            return reply({'method':'tools/call', 'params':{'name':name, 'arguments':args}})
        fit = json.loads(tool('get_activity_fit_data', {'activity_id':'synthetic', 'include_records':False})['content'][0]['text'])
        self.assertIn('zones_target', fit)
        self.assertEqual(fit['records'], [])
        detail = json.loads(tool('get_activity_fit_data', {'activity_id':'synthetic', 'include_records':True})['content'][0]['text'])
        self.assertEqual(len(detail['records']), 1)
        self.assertTrue({'altitude_meters', 'distance_meters', 'speed_mps'} <= set(detail['records'][0]))
        page = json.loads(tool('get_activities_by_date', {'start_date':'2026-09-01', 'end_date':'2026-09-07', 'page':0, 'page_size':100})['content'][0]['text'])
        self.assertEqual(len(page['activities']), 3)
        self.assertEqual(len({row['activityId'] for row in page['activities']}), 3)
        weekly = json.loads(tool('get_weekly_steps', {'end_date':'2001-01-07', 'weeks':52})['content'][0]['text'])
        self.assertEqual(weekly['weekly_data'], [])
        from datetime import datetime, timedelta, timezone
        today = datetime.now(timezone.utc).date()
        recent = json.loads(tool('get_weekly_steps', {'end_date':(today - timedelta(days=40)).isoformat(), 'weeks':52})['content'][0]['text'])
        self.assertGreater(recent['weeks_returned'], 0)
        self.assertEqual(recent['weeks_returned'], len(recent['weekly_data']))
        self.assertTrue(all(row['week_start'] >= (today - timedelta(days=80)).isoformat() for row in recent['weekly_data']))
        for name in ('login', 'set_weight', 'fetch', 'private'):
            with self.assertRaises(ValueError):
                tool(name, {})
        with self.assertRaises(ValueError):
            reply({'method':'tools/call', 'params':{'name':'get_stats', 'arguments':{}, 'extra':'private'}})

    def test_separate_latest_cancel_continue_and_completed_range_without_passive_replay(self):
        active, checks, history_runs, observations = False, 0, 0, 0
        mixed_outcome = None
        def seed_mixed(run, outcome):
            nonlocal mixed_outcome
            mixed_outcome = outcome
        commands = []
        settlement_order = []
        preset = 'wide'
        def command(value):
            nonlocal active, checks, history_runs, observations, preset
            commands.append(value)
            if value.get('type') == 'setViewport':
                preset = value['preset']
            if value.get('type') == 'click' and value.get('target') == 'Sync':
                self.assertEqual(preset, 'wide', 'Hidden mobile navigation must not be targeted')
            if value.get('action') == 'continue':
                self.assertFalse(active)
                active, observations = True, 0
                history_runs += 1
            elif value.get('action') == 'cancel':
                settlement_order.append('cancel')
                active = False
                checks += 12
            return {'ok':True, 'capture':'unit-only.png'}
        def summary():
            nonlocal active, checks, observations
            if mixed_outcome:
                return {'active':False, 'historicalState':'blocked', 'latestOutcome':mixed_outcome, 'remoteLowerBound':None}
            if active:
                observations += 1
                if history_runs == 2 and observations >= 2:
                    active, checks = False, 24
            return {'active':active, 'outcome':'running' if active else ('settled' if checks == 24 else 'cancelled' if checks else None),
                    'historicalState':'active' if active else 'complete' if checks == 24 else 'available',
                    'healthChecks':checks, 'batches':2 if active else 0, 'operationAttempts':90, 'activities':8, 'healthDays':20,
                    'detailsProcessed':11, 'detailsRemaining':0, 'detailsFailed':0}
        def latest_only():
            self.assertFalse(active)
            return {'before':summary(), 'after':summary(), 'historyBytesPreserved':True}
        def backend_latest():
            result = latest_only()
            for preset in ('wide', 'narrow'):
                run.sync_captures.append({'scenario':f'backend-only-busy-{preset}', 'ok':True, 'capture':'unit-only.png'})
            return result
        probes = 0
        def latest_probe(backend=False):
            nonlocal probes
            probes += 1
            result = backend_latest() if backend else latest_only()
            counts = {'get_devices':1, 'get_stats':16 if probes == 4 else 1, 'get_sleep_summary':1, 'get_body_battery':1, 'get_activities_by_date':1, 'get_body_composition':1, 'get_weigh_ins':1}
            if probes in (2, 4, 5):
                counts['get_device_last_used'] = 1
            return {**result, 'dataBefore': {'finalDays':10}, 'dataAfter': {'mutableDays':6 if probes <= 2 else 1, 'finalDays':25}, 'fitBaselineCalls':1 if probes == 6 else 0,
                    'requestCounts':counts}
        run = SimpleNamespace(root=self.root, config={'source':'unit'}, boot='unit', binary=Path('/unit'), command=command,
                              latest_probe=Mock(side_effect=latest_probe),
                              latest_only=Mock(side_effect=latest_only), backend_latest=Mock(side_effect=backend_latest), wait=Mock(), wait_sync=Mock(side_effect=lambda *args: settlement_order.append('observe')), summary=summary,
                              settle_claim=Mock(side_effect=lambda: settlement_order.append('settle')), stop=Mock(), start=Mock(),
                              automatic_discovery=Mock(return_value={'unit':'automatic'}))
        with patch('history_smoke.prepare_mixed_sync_presentation', side_effect=seed_mixed) as seed, patch('history_smoke.prepare_latest_preset') as presets:
            HistoryRun.synthetic_sync(run)
        self.assertEqual([call.args[1] for call in seed.call_args_list], ['settled', 'failed'])
        self.assertEqual([call.args[1] for call in presets.call_args_list], ['unknown', 'known', 'last-used', 'new-activity'])
        self.assertEqual(run.latest_probe.call_count, 6)
        self.assertEqual(probes, 6)
        cancelled = settlement_order.index('cancel')
        self.assertEqual(settlement_order[cancelled:cancelled+3], ['cancel', 'settle', 'observe'])
        self.assertEqual(sum(value.get('action') == 'continue' for value in commands), 2)
        self.assertEqual(sum(value.get('action') == 'cancel' for value in commands), 1)
        self.assertEqual(sum(value.get('action') == 'details' for value in commands), 6)
        self.assertEqual(run.stop.call_count, 9)
        evidence = json.loads((self.root / 'synthetic-sync.json').read_text())
        self.assertEqual(evidence['latest'][3]['openOlderDates'], 15)
        self.assertFalse(evidence['realGarminCertified'])
        self.assertEqual(evidence['maxInvocations'], 12)
        self.assertEqual(evidence['automaticDiscovery'], {'unit':'automatic'})
        run.automatic_discovery.assert_called_once_with()
        self.assertEqual(len(evidence['captures']), 26)
        self.assertEqual(evidence['settled'][-1]['after']['healthChecks'], 24)


if __name__ == '__main__':
    unittest.main()
