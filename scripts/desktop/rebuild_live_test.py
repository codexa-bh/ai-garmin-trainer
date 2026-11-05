from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

import rebuild_live as paid

class Contracts(unittest.TestCase):
    def test_current_allowance_and_monotonic_dispatch_envelope_fit_fresh_authority(self):
        limits=paid.qualify()
        self.assertEqual(limits['perAttemptUsd'],.06496)
        self.assertEqual(limits['maximumAttempts'],133)
        self.assertLess(limits['maximumUsd'],limits['reservedUsd'])
        self.assertLess(paid.BOOT_RESERVE,paid.CAP)
        self.assertEqual(paid.CAP,20000)
        self.assertEqual(paid.APPROVAL['model'],'gpt-6-luna')
        self.assertFalse(paid.APPROVAL['credentialReadback'])
        self.assertFalse(paid.APPROVAL['privateHistory'])
    def test_audited_public_artifact_provenance_is_not_treated_as_private_settings_or_chmodded(self):
        with tempfile.TemporaryDirectory() as folder:
            bundle=Path(folder);parent=bundle/'Contents/Resources/resources';parent.mkdir(parents=True,mode=0o755)
            path=parent/'provenance.json';path.write_text('{"sourceFingerprint":"authored"}');path.chmod(0o644)
            self.assertEqual(paid.artifact_source(bundle),'authored')
            self.assertEqual(path.stat().st_mode & 0o777,0o644)
            self.assertEqual(parent.stat().st_mode & 0o777,0o755)
    def test_fresh_claim_is_exclusive_and_never_renews_or_refunds(self):
        with tempfile.TemporaryDirectory() as root:
            root=Path(root).resolve()
            folder,approval,claims=paid.claim(root,'a'*64,'b'*64)
            effect=claims[0]
            before={path.name:path.read_bytes() for path in folder.iterdir()}
            with self.assertRaises(FileExistsError): paid.claim(root,'a'*64,'b'*64)
            self.assertEqual(before,{path.name:path.read_bytes() for path in folder.iterdir()})
            self.assertEqual(effect['reservedMilliUsd'],9000)
            self.assertIn('unknown',effect['outcome'])
            self.assertIn('1 approved, 2 accepted',approval['authority'])
    def failed_receipt(self,root,approval,claims,name='t0276-paid-rebuild-unit.json'):
        path=root/name
        paid.private_json(path,{'task':'T0276','scenarioPassed':False,'syntheticOnly':True,'credentialReadback':False,
            'allOwnedProcessesSettled':True,'inputUnchanged':True,'approval':approval,'claims':claims,
            'source':claims[-1]['source'],'artifact':claims[-1]['artifact'],
            'reservedMilliUsd':sum(effect['reservedMilliUsd'] for effect in claims)})
        return path
    def test_exact_diagnosed_continuation_preserves_original_claims_and_refuses_over_budget(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder).resolve();scope,approval,claims=paid.claim(root,'a'*64,'b'*64)
            original=(scope/'approval.json').read_bytes(),(scope/'effect-0.json').read_bytes()
            receipt=self.failed_receipt(root,approval,claims)
            _,retained,continued=paid.claim(root,'c'*64,'d'*64,receipt)
            self.assertEqual(retained,approval);self.assertEqual(continued[:1],claims)
            self.assertEqual(sum(effect['reservedMilliUsd'] for effect in continued),18000)
            self.assertEqual(original,((scope/'approval.json').read_bytes(),(scope/'effect-0.json').read_bytes()))
            receipt2=self.failed_receipt(root,approval,continued,'t0276-paid-rebuild-second.json')
            with self.assertRaisesRegex(ValueError,'exhausted'):paid.claim(root,'e'*64,'f'*64,receipt2)
            self.assertFalse((scope/'effect-2.json').exists())
            _,same,final=paid.claim(root,'e'*64,'f'*64,receipt2,focused=True)
            self.assertEqual(same,approval)
            self.assertEqual(sum(effect['reservedMilliUsd'] for effect in final),20000)
            self.assertEqual(final[-1]['kind'],'focused-source-bounded-native-boot')
            self.assertEqual(final[-1]['reservedMilliUsd'],2000)
    def test_continuation_refuses_unknown_unsettled_and_changed_prefix(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder).resolve();scope,approval,claims=paid.claim(root,'a'*64,'b'*64)
            receipt=self.failed_receipt(root,approval,claims)
            value=__import__('json').loads(receipt.read_text());value['allOwnedProcessesSettled']=False
            receipt.write_text(__import__('json').dumps(value))
            with self.assertRaisesRegex(ValueError,'settled'):paid.claim(root,'c'*64,'d'*64,receipt)
            self.assertFalse((scope/'effect-1.json').exists())
            value['allOwnedProcessesSettled']=True;receipt.write_text(__import__('json').dumps(value))
            changed={**claims[0],'reservedMilliUsd':9001}
            (scope/'effect-0.json').write_text(__import__('json').dumps(changed))
            with self.assertRaisesRegex(ValueError,'Changed cumulative'):paid.claim(root,'c'*64,'d'*64,receipt)
    def test_off_fixture_uses_one_explicit_configured_enable_before_waiting(self):
        off={'enabled':False,'expected':{'revision':0},'reason':'summary_invalidated','pending':4}
        on={**off,'enabled':True,'pending':0}
        with patch.object(paid,'inspect',side_effect=[off,on]),patch.object(paid,'command',return_value=(200,{})) as command:
            result,changed=paid.settle_baseline(object())
            self.assertEqual(result,on);self.assertTrue(changed)
            self.assertEqual(command.call_args.args[1:3],('enable',off['expected']))
            self.assertEqual(command.call_count,1)
    def test_unreviewed_api_actions_or_deadline_never_open_a_socket(self):
        run=SimpleNamespace(activity_deadline=0,http=Mock())
        with patch.object(paid.http.client,'HTTPConnection') as connect:
            for action in ['retry','clear','disable','chat','export','refresh']:
                with self.assertRaises(ValueError):paid.api(run,'POST',{'action':action})
            with self.assertRaises(TimeoutError):paid.api(run,'GET')
            run.http.assert_not_called();connect.assert_not_called()
    def test_native_opaque_source_binding_is_required_before_api(self):
        run=SimpleNamespace(activity_deadline=float('inf'),http=Mock(return_value={'providerSourceUnchanged':False}),accept_identity=Mock(return_value=True),descriptor={'providerSmoke':paid.PRESET})
        with patch.object(paid.http.client,'HTTPConnection') as connect:
            with self.assertRaises(ValueError):paid.api(run,'GET')
            connect.assert_not_called()
    def test_focused_profile_is_a_narrower_fixed_subset_with_strict_remaining_budget(self):
        bounds=paid.qualify(True)
        self.assertEqual(bounds['maximumGenerations'],30)
        self.assertLess(bounds['maximumUsd'],2)
        self.assertEqual(paid.authored_history(True),paid.HISTORY[:20])
        self.assertTrue(all(item in paid.HISTORY for item in paid.authored_history(True)))
        with tempfile.TemporaryDirectory() as folder:
            with self.assertRaisesRegex(ValueError,'exact retained'):paid.claim(Path(folder).resolve(),'a'*64,'b'*64,focused=True)
    def test_focused_seed_refuses_excess_original_users_before_activation(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder).resolve();database=root/'trainer.sqlite'
            with paid.sqlite3.connect(database) as db:
                db.executescript("create table app_metadata(key text,value text);insert into app_metadata values('schema_version','22');create table conversation(id text,title text,created_at integer,updated_at integer);create table message(id text,conversation_id text,role text,content text,created_at integer);create table conversation_turn(summary_eligible integer);create table summary_attempt(id text);create table summary_import(id text);create table summary_rebuild(id text);create table summary_control(enabled integer,configured_enabled integer,model text,cap integer);insert into summary_control values(0,1,'gpt-6-luna',6000);")
                for n in range(31): db.execute("insert into message values(?,null,'user','authored',1)",(str(n),))
            run=SimpleNamespace(child=None,origin=None,root=root,database=database)
            with self.assertRaisesRegex(ValueError,'source-count'):paid.seed_originals(run,True)
    def test_api_has_only_fixed_summary_route_and_no_chat_title_credential_endpoint(self):
        run=SimpleNamespace(activity_deadline=float('inf'),http=Mock(return_value={'providerSourceUnchanged':True}),accept_identity=Mock(return_value=True),descriptor={'providerSmoke':paid.PRESET},origin='http://127.0.0.1:1')
        connection=Mock();connection.getresponse.return_value=SimpleNamespace(status=200,read=Mock(return_value=b'{}'))
        with patch.object(paid.http.client,'HTTPConnection',return_value=connection):
            self.assertEqual(paid.api(run,'GET',content=True),(200,{}))
            self.assertEqual(connection.request.call_args.args[1],'/api/cross-chat-summary?view=content')
        connection.close.assert_called_once()
    def test_seed_rejects_unowned_or_active_target_before_sqlite_open(self):
        run=SimpleNamespace(child=object(),origin=None,database=Path('/not-opened'),root=Path('/not-opened-root'))
        with patch.object(paid.sqlite3,'connect') as connect:
            with self.assertRaises(ValueError):paid.seed_originals(run)
            connect.assert_not_called()
    def test_authored_matrix_contains_positive_negative_and_role_temporal_cases(self):
        text=' '.join(text for role,text in paid.HISTORY)
        for required in ['caregiving','does not replace loaded walking','mornings','reject the bag','Do not save','obsolete']:
            self.assertIn(required,text)
        self.assertEqual(sum(role=='assistant' for role,text in paid.HISTORY),1)
        self.assertGreater(sum(role=='user' for role,text in paid.HISTORY),20)

if __name__=='__main__':unittest.main()
