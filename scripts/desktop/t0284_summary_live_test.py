"""Authored stand-ins only. No real approval, private DB, credential or paid dispatch."""
import json
import contextlib
import fcntl
import shutil
import sqlite3
import uuid
from pathlib import Path
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch
import t0284_summary_live as live


class T0284Tests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name).resolve()
        self.binding = {'task': live.TASK, 'provider': 'openai', 'model': 'gpt-6-luna', 'ceilingCents': 5000,
                        'source': 'authored-source', 'artifact': 'authored-artifact', 'planSha256': 'authored-not-consent', 'maxMainCalls': 10}

    def tearDown(self):
        self.temp.cleanup()

    def test_actual_sized_batch_and_one_quality_call_fit_conservative_maxima(self):
        self.assertEqual(live.qualify(185, 0), 10)
        self.assertEqual((10 + 1) * live.CALL_CENTS, 1507)
        maximum = 1_050_000 * 1.10 / 1_000_000 + 128_000 * 1.65 / 1_000_000
        self.assertGreaterEqual(live.CALL_CENTS / 100, maximum)
        self.assertLess((10 + 1) * live.CALL_CENTS, live.CEILING_CENTS)

    def test_unknown_extra_backlog_route_or_overbudget_scope_refuses_before_any_native_owner(self):
        with patch.object(live, 'OrdinaryRun') as native:
            for count, pending, model in [(0, 0, 'gpt-6-luna'), (True, 0, 'gpt-6-luna'), (185, None, 'gpt-6-luna'),
                                           (185, False, 'gpt-6-luna'), (185, 1, 'gpt-6-luna'), (10000, 0, 'gpt-6-luna'),
                                           (185, 0, 'other'), (185, 0, 'GPT-6-LUNA')]:
                with self.assertRaises(ValueError): live.qualify(count, pending, model)
            native.assert_not_called()

    def test_immutable_main_then_quality_claims_include_every_unknown_effect_without_refund(self):
        self.assertEqual(live.claim(self.root, self.binding, 'main', 10), 1370)
        original = (self.root / 't0284-live-budget/main-claim.json').read_bytes()
        self.assertEqual(live.claim(self.root, self.binding, 'quality', 1), 1507)
        self.assertEqual((self.root / 't0284-live-budget/main-claim.json').read_bytes(), original)
        with self.assertRaisesRegex(ValueError, 'already claimed'): live.claim(self.root, self.binding, 'main', 10)
        self.assertEqual((self.root / 't0284-live-budget/main-claim.json').read_bytes(), original)

    def test_changed_source_scope_missing_partial_altered_or_foreign_claims_never_reset(self):
        live.claim(self.root, self.binding, 'main', 10)
        directory = self.root / 't0284-live-budget'
        for changed in [{**self.binding, 'source': 'different'}, {**self.binding, 'planSha256': 'altered'}]:
            with self.assertRaises(ValueError): live.claim(self.root, changed, 'quality', 1)
        path = directory / 'main-claim.json'
        original = path.read_bytes()
        path.write_text('{partial')
        with self.assertRaises(ValueError): live.claim(self.root, self.binding, 'quality', 1)
        self.assertEqual(path.read_text(), '{partial')
        path.write_bytes(original)
        modified = json.loads(original); modified['reservedCents'] = 0
        path.write_text(json.dumps(modified))
        with self.assertRaises(ValueError): live.claim(self.root, self.binding, 'quality', 1)
        self.assertEqual(json.loads(path.read_text())['reservedCents'], 0)

    def test_duplicates_out_of_order_effects_unknown_files_and_insufficient_balance_refuse(self):
        with self.assertRaises(ValueError): live.claim(self.root, self.binding, 'quality', 1)
        with self.assertRaises(ValueError): live.claim(self.root, self.binding, 'main', 9)
        directory = self.root / 't0284-live-budget'
        (directory / 'unknown.json').write_text('{}')
        with self.assertRaises(ValueError): live.claim(self.root, self.binding, 'main', 10)
        with tempfile.TemporaryDirectory() as separate:
            with self.assertRaises(ValueError): live.claim(Path(separate).resolve(), {**self.binding, 'maxMainCalls': 37}, 'main', 37)

    def test_scoped_claims_preserve_unknown_legacy_reservation_and_refuse_before_new_scope_creation(self):
        binding={**self.binding,'maxMainCalls':32}
        live.claim(self.root,binding,'main',32)
        scope=str(uuid.uuid4())
        with self.assertRaises(ValueError):live.scoped_claim(self.root,binding,'main',32,scope)
        self.assertFalse((self.root/'t0284-live-budget'/scope).exists())

    def test_new_scope_and_quality_have_one_cumulative_ceiling_and_no_replay(self):
        scope=str(uuid.uuid4())
        self.assertEqual(live.scoped_claim(self.root,self.binding,'main',10,scope),1370)
        self.assertEqual(live.scoped_claim(self.root,self.binding,'quality',1,scope),1507)
        with self.assertRaises(ValueError):live.scoped_claim(self.root,self.binding,'main',10,scope)
        self.assertEqual(live.scoped_claim(self.root,self.binding,'main',10,str(uuid.uuid4())),2877)
        self.assertEqual(live.scoped_claim(self.root,self.binding,'main',10,str(uuid.uuid4())),4247)
        with self.assertRaises(ValueError):live.scoped_claim(self.root,self.binding,'main',10,str(uuid.uuid4()))
        with self.assertRaises(ValueError):live.scoped_claim(self.root,self.binding,'main',10,'foreign')

    def test_genuine_d3_amendment_carries_old_claims_without_reset_and_rejects_other_changes(self):
        old={**self.binding,'ceilingCents':2000,'planSha256':'authored-old-plan'}
        live.claim(self.root,old,'main',10)
        budget=self.root/'t0284-live-budget'; original=(budget/'main-claim.json').read_bytes()
        approval={'operatorReply':'approved.. $50','resumeReply':'resume work','task':live.TASK,'previousCeilingCents':2000,'ceilingCents':5000,'previousPlanSha256':old['planSha256'],'priorAuthoritySha256':[live.digest((budget/'authority.json').read_bytes())]}
        live.exclusive(self.root/'d3-approved-grant.json',approval)
        live.exclusive(self.root/'d3-current-plan.json',{'planSha256':self.binding['planSha256'],'approvalSha256':live.digest((self.root/'d3-approved-grant.json').read_bytes())})
        scope=str(uuid.uuid4())
        self.assertEqual(live.scoped_claim(self.root,self.binding,'main',10,scope),2740)
        self.assertEqual(live.scoped_claim(self.root,self.binding,'quality',1,scope),2877)
        self.assertEqual((budget/'main-claim.json').read_bytes(),original)
        for changed in [{**self.binding,'planSha256':'unapproved-plan'},{**self.binding,'ceilingCents':6000},{**self.binding,'provider':'fallback'}]:
            with self.assertRaises(ValueError):live.scoped_claim(self.root,changed,'main',10,str(uuid.uuid4()))
        approval['priorAuthoritySha256']=[]
        (self.root/'d3-approved-grant.json').write_text(json.dumps(approval))
        with self.assertRaises(ValueError):live.scoped_claim(self.root,self.binding,'main',10,str(uuid.uuid4()))

    def test_scoped_lock_refuses_concurrent_claim_and_partial_or_changed_prior_records(self):
        budget=self.root/'t0284-live-budget';budget.mkdir(mode=0o700)
        with (budget/'budget.lock').open('w') as held:
            (budget/'budget.lock').chmod(0o600);fcntl.flock(held,fcntl.LOCK_EX|fcntl.LOCK_NB)
            with self.assertRaises(BlockingIOError):live.scoped_claim(self.root,self.binding,'main',10,str(uuid.uuid4()))
        partial=budget/str(uuid.uuid4());partial.mkdir(mode=0o700)
        live.exclusive(partial/'authority.json',self.binding)
        with self.assertRaises(ValueError):live.scoped_claim(self.root,self.binding,'main',10,str(uuid.uuid4()))

    def settlement_fixture(self):
        evidence=self.root/'evidence';evidence.mkdir(mode=0o700)
        disposable=self.root/'disposable';disposable.mkdir(mode=0o700)
        reference=disposable/'authored-reference.sqlite'
        with contextlib.closing(sqlite3.connect(reference)) as db:
            db.executescript('create table conversation(id text);create table message(id text,conversation_id text,role text,content text,created_at integer);create table summary_attempt(job_id text,outcome text,usage_json text);create table conversation_title_attempt(id text);create table summary_rebuild(state text);insert into conversation values("authored");insert into message values("u","authored","user","Authored original, not private.",1);')
            db.commit();self.binding['inputLogicalHash']=live.fingerprint(db)['logicalHash']; history=live.original_history(db)
        reference.chmod(0o600)
        run=disposable/('ordinary-'+str(uuid.uuid4()));run.mkdir(mode=0o700)
        target=run/'trainer.sqlite';shutil.copyfile(reference,target);target.chmod(0o600)
        with contextlib.closing(sqlite3.connect(target)) as db:
            for n,(i,o) in enumerate([(1695,285),(2989,876),(2735,1148),(3516,1355)]):
                db.execute('insert into summary_attempt values(?,?,?)',(str(n),'staged' if n<3 else 'summary_invalid_output',json.dumps({'input':i,'output':o,'cached':0})))
            db.commit()
        receipt=evidence/('t0284-real-history-'+str(uuid.uuid4())+'.json')
        live.exclusive(receipt,{'source':self.binding['source'],'artifact':self.binding['artifact'],'allOwnedProcessesSettled':True,'primaryWrite':False,'originalHistorySha256':history})
        live.exclusive(run/'native-identity-1.json',{'runId':run.name[9:],'source':self.binding['source'],'artifactInventoryHash':self.binding['artifact'],'providerSourceUnchanged':True,'database':str(target)})
        live.exclusive(run/'shutdown-1.json',{'nativeReaped':True,'endpointsAndLeaseSettled':True})
        live.exclusive(evidence/'actual-history-review.json',{'copy':str(reference)})
        return evidence,run,{'runRoot':str(run),'receipt':str(receipt)}

    def test_known_returned_usage_settles_prospective_reservation_without_refunding_failed_calls(self):
        evidence,run,observation=self.settlement_fixture()
        verified=live.known_main_settlement(evidence,self.binding,observation)
        self.assertEqual((verified['attempts'],verified['inputTokens'],verified['outputTokens'],verified['upperCents']),(4,10935,3664,2))
        live.claim(evidence,self.binding,'main',10)
        original=(evidence/'t0284-live-budget/main-claim.json').read_bytes()
        live.exclusive(evidence/'t0284-live-budget/settlement.json',verified)
        changed={**self.binding,'source':'new reviewed prompt source','artifact':'new qualified artifact'}
        scope=str(uuid.uuid4())
        self.assertEqual(live.scoped_claim(evidence,changed,'main',10,scope),1372)
        self.assertEqual(live.scoped_claim(evidence,changed,'quality',1,scope),1509)
        self.assertEqual((evidence/'t0284-live-budget/main-claim.json').read_bytes(),original)

    def test_changed_settlement_unknown_usage_unsettled_native_or_original_mutation_never_reduce_liability(self):
        evidence,run,observation=self.settlement_fixture()
        verified=live.known_main_settlement(evidence,self.binding,observation)
        live.claim(evidence,self.binding,'main',10)
        live.exclusive(evidence/'t0284-live-budget/settlement.json',{**verified,'upperCents':0})
        with self.assertRaises(ValueError):live.scoped_claim(evidence,self.binding,'main',10,str(uuid.uuid4()))
        with contextlib.closing(sqlite3.connect(run/'trainer.sqlite')) as db:
            db.execute("update summary_attempt set usage_json=null where job_id='3'");db.commit()
        with self.assertRaises(ValueError):live.known_main_settlement(evidence,self.binding,observation)
        shutdown=run/'shutdown-1.json';before=shutdown.read_bytes();shutdown.write_text(json.dumps({'nativeReaped':True,'endpointsAndLeaseSettled':False}))
        with self.assertRaises(ValueError):live.known_main_settlement(evidence,self.binding,observation)
        shutdown.write_bytes(before)
        with contextlib.closing(sqlite3.connect(run/'trainer.sqlite')) as db:
            db.execute('update message set content="Changed original"');db.commit()
        with self.assertRaises(ValueError):live.known_main_settlement(evidence,self.binding,observation)

    def test_title_effects_and_provider_substitution_refuse_known_settlement_or_new_scope(self):
        evidence,run,observation=self.settlement_fixture()
        with contextlib.closing(sqlite3.connect(run/'trainer.sqlite')) as db:
            db.execute('insert into conversation_title_attempt values("extra")');db.commit()
        with self.assertRaises(ValueError):live.known_main_settlement(evidence,self.binding,observation)
        live.claim(evidence,self.binding,'main',10)
        with self.assertRaises(ValueError):live.scoped_claim(evidence,{**self.binding,'provider':'other'},'main',10,str(uuid.uuid4()))

    def test_private_records_refuse_duplicates_aliases_or_extra_unbounded_data(self):
        path = self.root / 'record.json'
        live.exclusive(path, {'a': 1})
        self.assertEqual(live.document(path), {'a': 1})
        path.write_text('{"a":1,"a":2}')
        with self.assertRaises(ValueError): live.document(path)
        alias = self.root / 'alias.json'; alias.symlink_to(path)
        with self.assertRaises(ValueError): live.document(alias)
        path.write_text('x' * (128 * 1024 + 1))
        with self.assertRaises(ValueError): live.document(path)
        path.write_text('[]')
        with self.assertRaises(ValueError): live.document(path)

    def test_current_stop_pause_changed_plan_and_wrong_task_refuse_without_native_dispatch(self):
        epic = self.root / 'E0007-ai-garmin-connect-trainer'; epic.mkdir()
        task = epic / live.TASK; task.mkdir()
        # Structural stand-in, NOT genuine operator consent or a callable real grant.
        (task / 'plan.md').write_text('authored test only: actual Garmin Trainer SQLite database; direct OpenAI `gpt-6-luna` ONLY; USD50 TOTAL; approved.. $50; whole batch of messages must succeed')
        controls = {'modeType':'Dispatcher-managed','autonomyLevel':'A3','ownerSession':None,
                    'forbiddenActions':[],'stopConditions':[],'guardrails':[],'timeBudget':None,
                    'scheduler': {'runState': 'running', 'runId': 'authored', 'stopRequested': None, 'pauseRequested': None},
                    'hitlGates': {'deployRelease': False, 'qaManualSmoke': False, 'reviewPr': False}}
        path = task / 'kanban.json'; path.write_text(json.dumps(controls))
        initial = live.authority(task)
        for flag in ('stopRequested', 'pauseRequested'):
            changed = json.loads(json.dumps(controls)); changed['scheduler'][flag] = 'operator-request'
            path.write_text(json.dumps(changed))
            with self.assertRaises(ValueError): live.authority(task)
        path.write_text(json.dumps(controls)); (task / 'plan.md').write_text('missing real input/export/spend contract')
        with self.assertRaises(ValueError): live.authority(task)
        with self.assertRaises(ValueError): live.authority(self.root)
        self.assertEqual(initial['model'], 'gpt-6-luna')

    def test_finite_api_denies_other_routes_fields_narrowed_history_and_wrong_identity_before_socket(self):
        run = SimpleNamespace(activity_deadline=float('inf'), http=Mock(), accept_identity=Mock(return_value=False), descriptor={'providerSmoke': live.PRESET})
        with patch.object(live, 'authority', return_value=self.binding), patch.object(live.http.client, 'HTTPConnection') as socket:
            for action, fields in [('chat', {}), ('retry', {}), ('enable', {'expected': {}, 'force': True}),
                                    ('rebuild-review', {'expected': {}, 'selection': {'version': 1, 'conversationIds': ['subset'], 'includeLegacy': True}})]:
                with self.assertRaises(ValueError): live.api(run, self.root, self.binding, action, **fields)
            run.http.assert_not_called()
            with self.assertRaises(ValueError): live.api(run, self.root, self.binding)
            socket.assert_not_called()


if __name__ == '__main__':
    unittest.main()
