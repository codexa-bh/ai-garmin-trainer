import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch
import summary_live as live
from native_smoke import private_json


class SummaryLiveTests(unittest.TestCase):
    def test_immutable_cumulative_envelope_never_resets_refunds_or_blindly_reopens(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder).resolve()
            envelope=live.Envelope(root)
            for kind in ['summary-case','chat','chat','summary-case','chat','chat']:
                envelope.claim(kind)
            self.assertEqual(envelope.total,72)
            envelope.claim('summary-case'); envelope.claim('chat')
            self.assertEqual(envelope.total,100)
            with self.assertRaises(ValueError): envelope.claim('chat')
            with self.assertRaises(FileExistsError): live.Envelope(root)
            self.assertEqual(len(list(envelope.root.glob('effect-*.json'))),8)
            self.assertTrue(all(claim['outcome'].startswith('submitted-or-unknown') for claim in envelope.claims))

    def test_continuation_requires_exact_settled_receipt_and_keeps_all_original_claim_bytes(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder).resolve(); envelope=live.Envelope(root); envelope.claim('summary-case')
            original=(envelope.root/'effect-0.json').read_bytes()
            proof={'purpose':live.PRESET,'scenarioPassed':False,'syntheticOnly':True,'credentialReadback':False,
                   'claims':envelope.claims,'reservedCents':20,'inputUnchanged':True,'allOwnedProcessesSettled':True,
                   'credentialSourceUnchanged':True}
            path=root/'summary-live-proof.json'; private_json(path,proof)
            resumed=live.Envelope(root,path)
            self.assertEqual(resumed.total,20);resumed.claim('chat')
            self.assertEqual((resumed.root/'effect-0.json').read_bytes(),original)
            self.assertEqual(resumed.total,28)
            with self.assertRaises(ValueError): live.Envelope(root,path)  # Old snapshot never claims fewer effects.
            proof['claims']=resumed.claims;proof['reservedCents']=28;proof['allOwnedProcessesSettled']=False
            bad=root/'summary-live-unsettled.json';private_json(bad,proof)
            with self.assertRaises(ValueError): live.Envelope(root,bad)

    def test_native_configuration_is_keyless_fixed_independent_and_scope_specific(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder).resolve();(root/'config').mkdir()
            run=SimpleNamespace(root=root,database=root/'trainer.sqlite',id='run')
            result=SimpleNamespace(stdout=json.dumps({'runId':'run','completed':4,'providerCalls':0,'variant':'live-summary','conversationId':'authored-A'}).encode())
            with patch.object(live.subprocess,'run',return_value=result) as invoke:
                self.assertEqual(live.configure(run),'authored-A')
            value=json.loads((root/'config/settings-v3.json').read_text())
            self.assertEqual(value['keys'],{})
            self.assertEqual(value['fields']['SUMMARY_MODEL'],'gpt-6-luna')
            self.assertEqual(value['fields']['MEMORY_ENABLED'],'false')
            self.assertEqual(value['chatCatalog']['entries'][0]['id'],'entry_t0270_chat_luna')
            self.assertEqual(list((root/'tokens').iterdir()),[])
            self.assertEqual(invoke.call_args.args[0][-1],'live')

    def test_paid_request_is_reserved_before_socket_and_refuses_source_or_unreserved_chat(self):
        run=SimpleNamespace(origin='http://127.0.0.1:1234',descriptor={'providerSmoke':live.PRESET},http=Mock(return_value={'providerSourceUnchanged':True}),accept_identity=lambda _:True)
        envelope=Mock(); events=[]
        envelope.claim.side_effect=lambda kind:events.append('reserve-'+kind)
        connection=Mock();connection.getresponse.return_value=SimpleNamespace(status=200,read=lambda _:b'{"assistant":{"content":"Authored"}}')
        with patch.object(live.http.client,'HTTPConnection',side_effect=lambda *a,**k:(events.append('socket') or connection)):
            live.api(run,'POST','/api/chat',{'message':'Authored'},envelope)
            self.assertEqual(events,['reserve-chat','socket'])
            self.assertEqual(connection.request.call_args.args[3]['x-trainer-turn-budget'],'finite-live-smoke')
            with self.assertRaises(ValueError): live.api(run,'POST','/api/chat',{})
        run.http.return_value={'providerSourceUnchanged':False}
        with self.assertRaises(ValueError): live.api(run,'GET','/api/cross-chat-summary')

    def test_keyless_clone_refuses_private_lookup_paid_chat_and_non_lifecycle_mutations(self):
        run=SimpleNamespace(origin='http://127.0.0.1:1234',descriptor={},keyless_lifecycle=True,http=Mock(return_value={'providerSourceUnchanged':False}),accept_identity=lambda _:True)
        with self.assertRaises(ValueError): live.api(run,'POST','/api/chat',{},Mock())
        with self.assertRaises(ValueError): live.api(run,'POST','/api/cross-chat-summary',{'action':'enable'})
        run.descriptor={'providerSmoke':live.PRESET}
        with self.assertRaises(ValueError): live.api(run,'GET','/api/model-settings')

    def test_actual_unresolved_user_stated_question_is_not_endorsement_but_nearby_bad_meanings_fail(self):
        actual={'category':'question','stance':'user-stated','text':'Has not chosen whether to try hiking poles or a lighter bag.'}
        self.assertTrue(live.unendorsed_question(actual))
        self.assertTrue(live.unendorsed_question({**actual,'stance':'discussed-not-endorsed'}))
        for bad in [{**actual,'stance':'endorsed'},{**actual,'category':'decision'},
                    {**actual,'text':'Prefers hiking poles rather than a lighter bag.'},
                    {**actual,'text':'Some unspecified options remain undecided.'}]:
            self.assertFalse(live.unendorsed_question(bad))

    def test_actual_imported_rejection_paraphrase_and_nearby_wrong_meanings(self):
        actual = {'category': 'goal', 'stance': 'user-stated', 'text':
                  'Prefers short weekday walks and a longer weekend hike (the second option), because long weekday sessions did not fit; '
                  'collects their bicycle at 18:00. Wants to hike comfortably for three hours.'}
        self.assertTrue(live.rejected_alternative(actual))
        self.assertTrue(live.rejected_alternative({**actual, 'text': 'Long weekday sessions rejected for lack of time.'}))
        for bad in [{**actual, 'text': 'Prefers long weekday sessions because they fit.'},
                    {**actual, 'text': 'If long weekday sessions did not fit, short walks might help.'},
                    {**actual, 'text': 'Long weekday sessions are planned; the bicycle did not fit.'},
                    {**actual, 'category': 'question'}, {**actual, 'stance': 'assistant-proposed'},
                    {**actual, 'text': 'Long weekend sessions did not fit.'}]:
            with self.subTest(bad=bad):
                self.assertFalse(live.rejected_alternative(bad))

    def test_meaning_oracles_require_goal_rationale_rejection_and_unendorsed_options(self):
        required=['retainsShortWeekdays','retainsTimeRationale','retainsHikingGoal','retainsRejectedAlternative','retainsUnendorsedQuestion']
        value={key:True for key in required};self.assertTrue(live.meaning_passed(value))
        for key in required:
            self.assertFalse(live.meaning_passed({**value,key:False}))
