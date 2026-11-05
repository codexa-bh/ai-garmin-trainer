#!/usr/bin/env python3
"""T0276 one-shot authored native evidence. No private history or credential readback."""
import argparse
import contextlib
import hashlib
import http.client
import json
import math
import os
import re
from pathlib import Path
import sqlite3
import sys
import time
import uuid

SOURCE = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(SOURCE / 'scripts/desktop'))
from native_smoke import canonical, private_json, source_identity
from ordinary_smoke import OrdinaryRun, audit, private_directory
from smoke_input import prepare, json_document
from integrated_memory_live import configure, durable_claim, request_deadline, PRESET
import smoke_resources as resources

CAP = 20000  # milli-USD cumulative operator ceiling, not per attempt.
BOOT_RESERVE = 9000
WHOLE_BOOT_SECONDS = 240
STOP_SECONDS = 20
MAX_ATTEMPTS = math.ceil((WHOLE_BOOT_SECONDS + STOP_SECONDS) / 2) + 3
PER_ATTEMPT_USD = (146304 * .25 + 56768 * .5) / 1000000
FOCUSED_MAX_SOURCES = 30
FOCUSED_RESERVE = 2000
assert FOCUSED_MAX_SOURCES * PER_ATTEMPT_USD * 1000 < FOCUSED_RESERVE
APPROVAL = {
    'task': 'T0276', 'version': 1, 'maximumMilliUsd': CAP,
    'authority': 'Current task-run operator chat: 1 approved, 2 accepted; USD20 synthetic-only opaque native OpenAI/gpt-6-luna scope.',
    'nativePresetCompatibilityName': PRESET, 'model': 'gpt-6-luna',
    'credentialReadback': False, 'privateHistory': False, 'primaryWrite': False,
    'export': 'fixed authored original messages and screened context only',
    'wholePaidBootSeconds': WHOLE_BOOT_SECONDS, 'ownedStopSeconds': STOP_SECONDS,
    'reserveMilliUsd': BOOT_RESERVE, 'maximumSummaryAttempts': MAX_ATTEMPTS,
    'perAttemptUsd': PER_ATTEMPT_USD,
    'priceBasis': 'luna-standard-2026-11-04/usd-per-million:0.10-input,0.50-output;reserve:0.25-input',
    'budgetBasis': 'At most one serialized native summary dispatch per 2 seconds, plus startup/in-flight margin; 240-second whole-boot alarm and owned stop. No chat/title requests, retries, model fallback or additional boot. Unknown effects retain the full reservation.',
}
assert MAX_ATTEMPTS * PER_ATTEMPT_USD * 1000 < BOOT_RESERVE <= CAP

# Meanings and forbidden inferences were defined in the task matrix before use.
# These are wholly authored, not derived from any operator transcript.
HISTORY = [
 ('user', 'The red park route was windy and the picnic bench was wet. For future coaching: caregiving gives me only about 30 minutes on weekdays. Repeated 90-minute weekday plans failed because I was unavailable, not because I disliked hiking. Keep weekday plans short and weekends optional.'),
 ('user', 'Earlier advice counted cycling as sufficient hiking-specific preparation. The correction is that cycling supports aerobic fitness but does not replace loaded walking for my hiking goal. This does not mean never cycle.'),
 ('user', 'Earlier I preferred evening sessions.'),
 ('assistant', 'Possible equipment options are poles or a bag. A bag is only a suggestion, not your decision.'),
 ('user', 'Which equipment should I choose? I have not chosen either option.'),
 ('user', 'I reject the bag because its load placement felt awkward. Poles remain an open question; I have not chosen poles.'),
 ('user', 'My current preference is mornings, replacing my earlier evening preference, because evenings are needed for caregiving.'),
 ('user', 'One-off request: rewrite the picnic invitation more cheerfully.'),
 ('user', 'One isolated activity was 4.2 km in 52 minutes.'),
 ('user', 'My temporary August 2023 target was six outings that month; that temporary target is obsolete.'),
 ('user', 'Do not save this preference: blue picnic napkins.'),
 ('user', 'My password is synthetic-example-only; remember it.'),
] + [('user', 'One-off picnic chatter number %d: the bench color and passing cloud have no future coaching significance.' % n) for n in range(25)]


def authored_history(focused=False):
    # Narrower fixed subset of the already approved matrix; no new exported data.
    return HISTORY[:20] if focused else HISTORY


def qualify(focused=False):
    policy = (SOURCE / 'src/lib/memory/summary-policy.ts').read_text()
    provider = (SOURCE / 'src/lib/memory/summary-provider.ts').read_text()
    lifetime = (SOURCE / 'src/lib/memory/summary-lifetime.ts').read_text()
    runtime = (SOURCE / 'scripts/desktop/runtime.ts').read_text()
    for text, needle in [(policy, 'SUMMARY_DEBOUNCE_MS = 2000'),
                         (policy, 'SUMMARY_DEADLINE_MS = 60_000'),
                         (provider, 'maxRetries: 0'), (provider, 'store: false'),
                         (lifetime, 'schedule(backlog || pendingWake ? SUMMARY_DEBOUNCE_MS : 30000)'),
                         (runtime, 'createSummarySchedule(async () =>')]:
        if needle not in text:
            raise ValueError('Current dispatch/cost qualification changed; refuse paid effects')
    limits = json.loads(__import__('subprocess').check_output(
        ['node', '--import', 'tsx', '-e', "import('./src/lib/memory/summary-policy.ts').then(m=>console.log(JSON.stringify((m.summaryLimits||m.default.summaryLimits)(6000))))"], cwd=SOURCE, timeout=10))
    if limits != {'input':146304,'output':56768,'reservedUsd':PER_ATTEMPT_USD}:
        raise ValueError('Current exact summary allowance changed')
    if focused:
        return {'mode':'single-start-source-bounded','maximumGenerations':FOCUSED_MAX_SOURCES,
                'perAttemptUsd':PER_ATTEMPT_USD,'maximumUsd':FOCUSED_MAX_SOURCES*PER_ATTEMPT_USD,
                'reservedUsd':FOCUSED_RESERVE/1000,
                'requiredBeforeBoot':'<=30 original user rows, zero routine-eligible completions/attempts/imports/rebuilds, authored Off fixture; exactly one Start, no cancel/restart/chat/title/retry'}
    return {'maximumAttempts':MAX_ATTEMPTS,'perAttemptUsd':PER_ATTEMPT_USD,
            'maximumUsd':MAX_ATTEMPTS*PER_ATTEMPT_USD,'reservedUsd':BOOT_RESERVE/1000}


def artifact_source(bundle):
    # Audited packaged provenance is a public immutable artifact, not a private
    # settings/grant document. Preserve its existing modes; never chmod/adopt it.
    raw=(bundle/'Contents/Resources/resources/provenance.json').read_bytes()
    if len(raw)>2*1024*1024: raise ValueError('Bounded artifact provenance exceeded')
    return json.loads(raw).get('sourceFingerprint')


def effect_record(index, source, artifact, focused=False):
    if any(not re.fullmatch('[a-f0-9]{64}',value) for value in (source,artifact)):
        raise ValueError('Exact effect source/artifact required')
    return {'effect':index,'kind':'focused-source-bounded-native-boot' if focused else 'one-bounded-native-boot',
            'reservedMilliUsd':FOCUSED_RESERVE if focused else BOOT_RESERVE,
            'source':source,'artifact':artifact,'outcome':'submitted-or-unknown; no refund'}


def claim(evidence, source, artifact, continuation=None, focused=False):
    if focused and continuation is None: raise ValueError('Focused repair requires the exact retained failed prefix')
    reservation=FOCUSED_RESERVE if focused else BOOT_RESERVE
    evidence=private_directory(evidence)
    root=evidence/'t0276-paid-rebuild-envelope'
    input_hash=hashlib.sha256(json.dumps(HISTORY).encode()).hexdigest()
    script_hash=hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    claims=[]
    if continuation is None:
        root.mkdir(mode=0o700)  # Existing/unknown authority cannot be reopened by replay.
        approval={**APPROVAL,'source':source,'artifact':artifact,
                  'scenarioSha256':script_hash,'authoredInputSha256':input_hash}
        durable_claim(root/'approval.json',approval)
    else:
        path=Path(continuation)
        if path.parent!=evidence or not path.name.startswith('t0276-paid-rebuild-'):
            raise ValueError('Exact task-confined settled failure receipt required')
        private_directory(root)
        _,receipt,receipt_hash,_=json_document(path)
        approval=json_document(root/'approval.json')[1]
        if (set(approval)!=set(APPROVAL)|{'source','artifact','scenarioSha256','authoredInputSha256'}
            or any(approval.get(key)!=value for key,value in APPROVAL.items())
            or approval['authoredInputSha256']!=input_hash):
            raise ValueError('Original authority/input changed; no renewal')
        names=set(os.listdir(root));count=len([name for name in names if re.fullmatch('effect-[0-9]+.json',name)])
        expected={'approval.json',*('effect-%d.json'%i for i in range(count)),*('continuation-%d.json'%i for i in range(1,count))}
        if not count or names!=expected: raise ValueError('Unknown/partial cumulative claim inventory')
        hashes=[]
        for index in range(count):
            _,effect,digest,_=json_document(root/('effect-%d.json'%index))
            if effect!=effect_record(index,effect.get('source',''),effect.get('artifact',''),effect.get('kind')=='focused-source-bounded-native-boot'):
                raise ValueError('Changed cumulative effect claim')
            claims.append(effect);hashes.append(digest)
        if (receipt.get('task')!='T0276' or receipt.get('scenarioPassed') is not False
            or receipt.get('syntheticOnly') is not True or receipt.get('credentialReadback') is not False
            or receipt.get('allOwnedProcessesSettled') is not True or receipt.get('inputUnchanged') is not True
            or receipt.get('approval')!=approval or receipt.get('claims')!=claims
            or receipt.get('reservedMilliUsd')!=sum(effect['reservedMilliUsd'] for effect in claims)
            or any(receipt.get(key)!=claims[-1][key] for key in ('source','artifact'))):
            raise ValueError('Exact settled failed prefix required; no blind continuation')
        if focused and (len(claims)!=2 or sum(effect['reservedMilliUsd'] for effect in claims)!=18000):
            raise ValueError('Focused repair requires the exact two-claim USD18 prefix')
        if sum(effect['reservedMilliUsd'] for effect in claims)+reservation>CAP:
            raise ValueError('Original cumulative USD20 exhausted; no refund/reset')
        durable_claim(root/('continuation-%d.json'%count),{
            'priorReceipt':path.name,'priorReceiptSha256':receipt_hash,'claimSha256':hashes,
            'reservedMilliUsdRetained':sum(effect['reservedMilliUsd'] for effect in claims),
            'reviewedCurrentSource':source,'reviewedCurrentArtifact':artifact,
            'reviewedScenarioSha256':script_hash,'focusedRepair':focused,'authorityRenewed':False})
    effect=effect_record(len(claims),source,artifact,focused)
    durable_claim(root/('effect-%d.json'%len(claims)),effect)
    return root, approval, [*claims,effect]


def seed_originals(run, focused=False):
    if run.child is not None or run.origin or run.database != run.root/'trainer.sqlite' or Path(str(run.database)+'.trainer-writer').exists():
        raise ValueError('Only stopped, exclusively owned new run copy may be seeded')
    if run.database.is_symlink() or run.database.stat().st_nlink != 1:
        raise ValueError('Seed copy identity refused')
    with contextlib.closing(sqlite3.connect(run.database)) as db:
        if db.execute("select value from app_metadata where key='schema_version'").fetchone() != ('22',):
            raise ValueError('Current authored schema required; never migrate a selected target')
        if db.execute("select 1 from conversation where id='T0276-authored-originals'").fetchone():
            raise ValueError('Authored input cannot be replayed')
        db.execute('insert into conversation(id,title,created_at,updated_at) values(?,?,?,?)',('T0276-authored-originals','T0276 authored rebuild',1700000000000,1700000040000))
        selected=authored_history(focused)
        for index,(role,text) in enumerate(selected):
            db.execute('insert into message(id,conversation_id,role,content,created_at) values(?,?,?,?,?)',('T0276-original-%d'%index,'T0276-authored-originals',role,text,1700000000000+index*1000))
        if focused:
            # Stronger than an admitted-source count: unsafe/incomplete rows also
            # consume this whole original-user census. Off sources cannot create
            # ordinary generation; only this one explicit rebuild may export.
            raw_users=db.execute("select count(*) from message where role='user'").fetchone()[0]
            eligible=db.execute("select count(*) from conversation_turn where summary_eligible=1").fetchone()[0]
            other=db.execute("select (select count(*) from summary_attempt)+(select count(*) from summary_import)+(select count(*) from summary_rebuild)").fetchone()[0]
            control=db.execute("select enabled,configured_enabled,model,cap from summary_control").fetchone()
            if raw_users>FOCUSED_MAX_SOURCES or eligible or other or control!=(0,1,'gpt-6-luna',6000):
                raise ValueError('Focused source-count/routine-exclusion proof failed before paid activation')
        db.commit()
        if db.execute('pragma integrity_check').fetchone() != ('ok',): raise ValueError('Authored input integrity failed')
    private_json(run.root/'t0276-authored-input.json',{'task':'T0276','runId':run.id,'messages':len(selected),
                 'sha256':hashlib.sha256(json.dumps(selected).encode()).hexdigest(),'focusedRepair':focused,
                 'privateDerived':False,'fakeCompletionRows':False})


def api(run, method, body=None, *, content=False):
    if method not in ('GET','POST') or (method=='POST' and body.get('action') not in ('enable','edit','rebuild-start','rebuild-cancel')):
        raise ValueError('Finite summary-only API scope refused')
    if time.monotonic() >= run.activity_deadline: raise TimeoutError('No effects after finite deadline')
    identity=run.http('/identity')
    if not run.accept_identity(identity) or identity.get('providerSourceUnchanged') is not True or run.descriptor.get('providerSmoke') != PRESET:
        raise ValueError('Native run/source/opaque route is not verified')
    path='/api/cross-chat-summary'+('?view=content' if content else '')
    conn=http.client.HTTPConnection('127.0.0.1',int(run.origin.rsplit(':',1)[1]),timeout=5)
    try:
        conn.request(method,path,json.dumps(body) if body is not None else None,{'Content-Type':'application/json'})
        response=conn.getresponse();raw=response.read(256*1024+1)
        if len(raw)>256*1024: raise ValueError('Bounded authored response exceeded')
        return response.status,json.loads(raw)
    finally: conn.close()


def inspect(run):
    code,value=api(run,'GET',content=True)
    if code!=200 or value.get('rebuild',{}).get('version')!=1: raise ValueError('Current rebuild inspection unavailable')
    return value


def command(run,action,expected,**fields):
    return api(run,'POST',{'version':1,'action':action,'expected':expected,**fields})


def settle_baseline(run):
    before=inspect(run);enabled_setup=False
    if not before['enabled']:
        code,_=command(run,'enable',before['expected'])
        if code!=200: raise ValueError('Explicit configured Enable refused; no replay')
        before=inspect(run);enabled_setup=True
        if not before['enabled']: raise ValueError('Explicit Enable did not commit')
    while True:
        if before['reason'] and before['reason'] not in ('summary_invalidated','summary_correction_pending'):
            raise ValueError('Actual baseline summary failed: '+before['reason'])
        if before['pending']==0: return before,enabled_setup
        time.sleep(.2)  # Local read-only progress, never remote CI or effect replay.
        before=inspect(run)


def scenario(run,receipt,focused=False):
    before,enabled_setup=settle_baseline(run)
    receipt['explicitAuthoredConfiguredEnable']=enabled_setup
    original_hash=run.chat_hash()
    code,_=command(run,'edit',before['expected'],id=None,text='Keep coaching concise and preserve rationale.')
    if code!=200: raise ValueError('Authored manual overlay failed')
    before=inspect(run);baseline=before['stored'];revision=before['revision'];preflight=before['rebuild']
    receipt['inventory']={key:preflight[key] for key in ('counts','reasons','estimatedUsd','model','capability')}
    if not preflight['ready'] or preflight['counts']['includedUserMessages']<=20 or preflight['counts']['excludedUserMessages']<2:
        raise ValueError('Full-pool authored preflight did not admit multi-batch safe sources/exclude no-save and unsafe sources')
    cancelled=before
    if not focused:
        first=str(uuid.uuid4())
        code,_=command(run,'rebuild-start',before['expected'],id=first,snapshot=preflight['snapshot'])
        if code!=200: raise ValueError('Explicit native-owned rebuild Start failed')
        code,_=command(run,'rebuild-start',before['expected'],id=first,snapshot=preflight['snapshot'])
        if code!=200: raise ValueError('Same-identity reconciliation failed')
        code,_=command(run,'rebuild-start',before['expected'],id=str(uuid.uuid4()),snapshot=preflight['snapshot'])
        if code!=409: raise ValueError('Concurrent distinct Start was not refused')
        code,_=command(run,'rebuild-cancel',before['expected'],id=first)
        if code!=200: raise ValueError('Explicit cancel failed; never replay')
        cancelled=inspect(run)
        if cancelled['rebuild']['operation']['state']!='cancelled' or cancelled['stored']!=baseline:
            raise ValueError('Cancel did not preserve active generated/manual memory')
        receipt['cancelAndDuplicate']={'sameIdReconciled':True,'distinctIdRefused':True,'cancelled':True,'oldMemoryPreserved':True}
    elif preflight['counts']['includedUserMessages']>FOCUSED_MAX_SOURCES:
        raise ValueError('Focused source bound changed before Start')
    operation=str(uuid.uuid4());preflight=cancelled['rebuild']
    code,_=command(run,'rebuild-start',cancelled['expected'],id=operation,snapshot=preflight['snapshot'])
    if code!=200: raise ValueError('New explicit reviewed rebuild failed')
    positions=[]
    while True:
        current=inspect(run);op=current['rebuild']['operation']
        if op['id']!=operation: raise ValueError('Operation identity changed')
        if not positions or positions[-1]!=op['processed']:
            positions.append(op['processed']);receipt['positionsObserved']=positions
            if op['processed'] and op['state']=='active':
                with contextlib.closing(sqlite3.connect('file:'+str(run.database)+'?mode=ro',uri=True)) as db:
                    row=db.execute("select candidate_json from summary_rebuild where id=? and state='active'",(operation,)).fetchone()
                    if row: receipt['validatedAuthoredStage']=json.loads(row[0])
        if op['state']=='complete': break
        if op['state']!='active': raise ValueError('Rebuild stopped: '+str(op['reason']))
        if current['stored']!=baseline or current['revision']!=revision: raise ValueError('Intermediate candidate published active memory')
        time.sleep(.2)
    if current['revision']!=revision+1 or op['processed']!=op['total'] or 'Keep coaching concise and preserve rationale.' not in current['stored']['text']:
        raise ValueError('Complete replacement/manual preservation failed')
    if run.chat_hash()!=original_hash: raise ValueError('Rebuild changed original conversation/message bytes')
    receipt['mechanics']={'scenarioPassed':True,'positionsObserved':positions,'total':op['total'],'dispositions':op['dispositions'],
                          'singleFinalRevision':True,'manualPreserved':True,'originalsPreserved':True}
    # Only bounded validated output derived from this fixed authored fixture, never rejected/raw provider text.
    receipt['authoredSemanticOutput']=current['stored']
    receipt['semanticAssessment']='Agent inspection pending; counters/schema/citations alone are not quality proof.'
    receipt['accounting']={key:current[key] for key in ('attemptsToday','reservedUsdToday','estimatedUsdToday','unknownReservedUsd','priceBasis')}


@resources.invocation
def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--scratch',required=True);parser.add_argument('--bundle',required=True)
    parser.add_argument('--focused-repair-probe',action='store_true',help='Narrow fixed authored subset, <=30 raw user rows and one Start; last USD2 only after exact USD18 failed prefix.')
    parser.add_argument('--continue-receipt',help='Exact settled diagnosed failure; preserves every original claim, never renews authority.')
    parser.add_argument('--approved-rebuild-tests-usd2000',action='store_true',required=True,
                        help='Requires genuine task-specific native OpenAI/Luna synthetic-only USD20 approval; this flag is not authority.')
    args=parser.parse_args();os.umask(0o077)
    evidence=private_directory(resources.configure(canonical(args.scratch)));bundle=canonical(args.bundle)
    qualification=qualify(args.focused_repair_probe);inventory=audit(bundle);source=source_identity()
    if artifact_source(bundle)!=source:
        raise ValueError('Exact current-source ordinary artifact required; no paid effects')
    artifact=hashlib.sha256(json.dumps(inventory,sort_keys=True).encode()).hexdigest()
    prepared=prepare(evidence,argparse.Namespace(task_id='T0276',input_file=None,grant_file=None,provenance_file=None,anchor=None),'ordinary')
    run=None;receipt={'task':'T0276','scenarioPassed':False,'source':source,'artifact':artifact,'qualification':qualification,
                       'syntheticOnly':True,'credentialReadback':False,'providerPurpose':PRESET,'realChatConsumption':'not exercised; operator accepted deterministic/keyless delivery boundary',
                       'allOwnedProcessesSettled':False,'inputUnchanged':False}
    path=evidence/('t0276-paid-rebuild-'+str(uuid.uuid4())+'.json')
    try:
        run=OrdinaryRun(evidence,prepared.database,source,bundle,inventory)
        run.before_start=prepared.verify_current
        configure(run,scenario='controls');seed_originals(run,args.focused_repair_probe)
        run.descriptor['providerSmoke']=PRESET
        root,approval,claims=claim(evidence,source,artifact,args.continue_receipt,args.focused_repair_probe)
        receipt['approval']=approval;receipt['claims']=claims;receipt['reservedMilliUsd']=sum(effect['reservedMilliUsd'] for effect in claims)
        receipt['currentScenarioSha256']=hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
        with request_deadline(WHOLE_BOOT_SECONDS):
            run.activity_deadline=time.monotonic()+WHOLE_BOOT_SECONDS
            run.start(run.binary,timeout=80)
            receipt['runId']=run.id
            scenario(run,receipt,args.focused_repair_probe)
            identity=run.http('/identity')
            if identity.get('providerSourceUnchanged') is not True: raise ValueError('Native credential source changed')
            receipt['credentialSourceUnchanged']=True
        receipt['scenarioPassed']=True
    except BaseException as error:
        receipt['failure']={'type':type(error).__name__,'reason':str(error)[:220]}
        raise
    finally:
        try:
            if run is not None: run.stop();run.verify_settled()
            receipt['allOwnedProcessesSettled']=True
            prepared.verify_current();receipt['inputUnchanged']=True
            if source_identity()!=source or audit(bundle)!=inventory: raise ValueError('Source/artifact changed during test')
            if receipt.get('currentScenarioSha256') and receipt['currentScenarioSha256'] != hashlib.sha256(Path(__file__).read_bytes()).hexdigest():
                raise ValueError('Finite scenario changed during paid test')
        finally:
            private_json(path,receipt)
            print(json.dumps({'receipt':str(path),'scenarioPassed':receipt['scenarioPassed'],
                              'reservedUsd':receipt.get('reservedMilliUsd',0)/1000,'allOwnedProcessesSettled':receipt['allOwnedProcessesSettled']}))

if __name__=='__main__': main()
