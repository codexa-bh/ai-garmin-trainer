#!/usr/bin/env python3
"""T0274 finite synthetic Luna capacity/freshness/restart proof; native alone owns keys."""
import argparse
import contextlib
import hashlib
import http.client
import json
import math
import os
from pathlib import Path
import re
import signal
import subprocess
import time
import uuid

from native_smoke import Observer, canonical, fingerprint, private_json, readonly, source_identity
from ordinary_smoke import OrdinaryRun, audit, private_directory
from smoke_input import prepare, private_file, database_state
from integrated_memory_live import durable_claim, request_deadline, pin, answer_observation
import smoke_resources as resources

PRESET = 't0274-memory-capacity-luna-5000'
CATALOG = 'entry_t0274_chat_luna'
BOOT_SECONDS = 60
SETTLEMENT_SECONDS = 40
ACTIVITY_SECONDS = 50
ADOPTIONS = 4
APPROVAL = {'purpose': PRESET, 'maximumMilliUsd': 50000, 'bootMilliUsd': 12000,
            'chatMilliUsd': 2000, 'unknownsRemainReserved': True, 'credentialReadback': False,
            'authority': 'T0274 operator chat: 50$ budget, approved go', 'syntheticOnly': True}
COSTS = {'boot': 12000, 'chat': 2000, 'boundedBoot': 9000}
POLICY = {'input': 258304, 'output': 112768, 'reservedUsd': .12096, 'debounceMs': 2000,
          'catchupMs': 8000, 'deadlineMs': 60000, 'modelContext': 1050000,
          'priceBasis': 'luna-standard-2026-11-04/usd-per-million:0.10-input,0.50-output;reserve:0.25-input'}
SMALL_TURN = ('In our fictional training discussion I choose cedar pause as my cool-down label. '
              'Give a one-sentence acknowledgement in English. No tools, saves, measurements or Garmin connection.')
QUESTION = ('Use getSyncStatus once to read this fictional copy\'s local SQLite availability metadata; '
            'do not start sync or contact Garmin. Then, using only this chat\'s pinned fictional memory, '
            'name my reminder channel, weekly rest day, and newly chosen cool-down label. '
            'Answer in two short English sentences; say unknown for absent memory facts. No writes, saves or measurements.')


def document(path):
    path, raw, _ = private_file(path, 64 * 1024)
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError('Duplicate ledger/receipt key')
            result[key] = value
        return result
    return path, json.loads(raw, object_pairs_hook=unique)


class Envelope:
    """One fixed task ledger; no unknown refund, fresh-root reset or old-task grant."""
    def __init__(self, evidence, binding, continuation=None):
        if set(binding) != {'source', 'artifact'} or any(not re.fullmatch('[a-f0-9]{64}', v) for v in binding.values()):
            raise ValueError('Exact qualified source/artifact binding required')
        self.binding, self.claims, self.total = binding, [], 0
        self.root = evidence / 't0274-capacity-usd50-ledger'
        if continuation is None:
            self.root.mkdir(mode=0o700)  # Existing/partial ledger refuses; never resets.
            durable_claim(self.root / 'approval.json', APPROVAL)
        else:
            _, receipt = document(continuation)
            if (receipt.get('purpose') != PRESET or receipt.get('scenarioPassed') is not False
                    or receipt.get('allOwnedProcessesSettled') is not True or receipt.get('inputUnchanged') is not True
                    or receipt.get('syntheticOnly') is not True or receipt.get('credentialReadback') is not False):
                raise ValueError('Exact diagnosed settled failure receipt required; no success replay')
            private_directory(self.root)
            if document(self.root / 'approval.json')[1] != APPROVAL:
                raise ValueError('New exact T0274 authority required')
            self.claims = receipt['claims']
            if len(self.claims) > 25 or set(p.name for p in self.root.iterdir()) != {'approval.json', *('claim-%03d.json' % (i + 1) for i in range(len(self.claims)))}:
                raise ValueError('Partial/unaccounted claim retained; reconcile without replay')
            for index, claim in enumerate(self.claims, 1):
                expected = COSTS.get(claim.get('kind'))
                if (claim.get('purpose') != PRESET or claim.get('sequence') != index or type(claim.get('reservedMilliUsd')) is not int
                        or expected is None or claim['reservedMilliUsd'] != expected
                        or document(self.root / ('claim-%03d.json' % index))[1] != claim):
                    raise ValueError('Immutable prior claim mismatch')
                self.total += claim['reservedMilliUsd']
            if receipt.get('reservedMilliUsd') != self.total or self.total > APPROVAL['maximumMilliUsd']:
                raise ValueError('Prior cumulative reservation mismatch')

    def claim(self, kind, run_id):
        cost = COSTS.get(kind)
        if cost is None or self.total + cost > APPROVAL['maximumMilliUsd']:
            raise ValueError('Cumulative USD50 exhausted; retain all unknowns, no effect')
        claim = {'sequence': len(self.claims) + 1, 'kind': kind, 'reservedMilliUsd': cost,
                 'binding': self.binding, 'runId': run_id, 'purpose': PRESET}
        durable_claim(self.root / ('claim-%03d.json' % claim['sequence']), claim)
        self.claims.append(claim)
        self.total += cost


def qualify(seed):
    if (seed.get('task') != 'T0274' or seed.get('variant') != 'memory-capacity'
            or seed.get('completed') != 1 or seed.get('providerCalls') != 0
            or seed.get('manualItems') != 18 or not 12000 < seed.get('renderedCharacters', 0) <= 20000
            or seed.get('configuredCharacters') != 20000 or seed.get('budgetPolicy') != POLICY):
        raise ValueError('Exact authored fixture/current policy required; old envelope refused')
    automatic = math.ceil((BOOT_SECONDS + SETTLEMENT_SECONDS) / (POLICY['debounceMs'] / 1000)) + 1
    maximum_attempts = automatic + ADOPTIONS * 4
    summary_usd = maximum_attempts * POLICY['reservedUsd']
    # New-chat pins are deliberately unmeasured until the first real request.
    # Reserve the whole model context for three finite calls at worst long-input
    # cache-write/output prices, plus independent H/title. Never guess its count.
    chat_usd = 3 * (POLICY['modelContext'] * .50 + 4096 * .75) / 1_000_000 + .011
    if summary_usd * 1000 > COSTS['boundedBoot'] or chat_usd * 1000 > APPROVAL['chatMilliUsd']:
        raise ValueError('Changed finite effects/prices require requalification before use')
    return {'maximumSummaryAttemptsPerBoot': maximum_attempts, 'summaryWorstUsdPerBoot': summary_usd,
            'chatWorstUsd': chat_usd, 'wholeBootSeconds': BOOT_SECONDS, 'settlementTailSeconds': SETTLEMENT_SECONDS,
            'maximumAdoptionsPerBoot': ADOPTIONS, 'policy': POLICY}


class RetainedCapacity:
    """Only the settled T0274 successful-summary/small-turn prefix; never an unknown job."""
    def __init__(self, evidence, receipt_path, disposition_path):
        proof_path, proof = document(receipt_path)
        disposition_file, disposition = document(disposition_path)
        run_id = proof.get('runId')
        if (proof_path.parent != evidence or disposition_file.parent != evidence
                or proof.get('purpose') != PRESET or proof.get('scenarioPassed') is not False
                or proof.get('lastStage') != 'single-small-ordinary-turn'
                or proof.get('syntheticOnly') is not True or proof.get('credentialReadback') is not False
                or proof.get('allOwnedProcessesSettled') is not True or proof.get('inputUnchanged') is not True
                or not isinstance(run_id, str) or str(uuid.UUID(run_id)) != run_id
                or disposition.get('invocationFailed') is not True or disposition.get('evidenceRoot') != str(evidence)):
            raise ValueError('Exact settled authored successful prefix required')
        root = private_directory(resources.runtime_path(evidence / ('ordinary-' + run_id)))
        self.database = root / 'trainer.sqlite'
        if (str(root) not in disposition.get('allocationRoots', [])
                or not any(a.get('path') == str(self.database) and a.get('status') == 'retained' for a in disposition.get('artifacts', []))
                or private_file(root / 'owner', 64)[1].decode() != run_id):
            raise ValueError('Retained invocation-owned input required')
        self.metadata = []
        for path in (proof_path, disposition_file):
            self.metadata.append((path, hashlib.sha256(private_file(path, 64 * 1024)[1]).hexdigest()))
        docs = {}
        for name in ('artifact.json', 'provenance.json', 'shutdown-1.json', 'capacity-seed.json'):
            path, raw, _ = private_file(root / name, 64 * 1024)
            digest = hashlib.sha256(raw).hexdigest()
            if hashlib.sha256(private_file(evidence / ('ordinary-' + run_id) / name, 64 * 1024)[1]).hexdigest() != digest:
                raise ValueError('Retained metadata/evidence mismatch')
            self.metadata.append((path, digest)); docs[name] = json.loads(raw)
        if (docs['artifact.json'].get('sourceFingerprint') != proof.get('source')
                or docs['provenance.json'].get('source') != proof.get('source')
                or docs['provenance.json'].get('primaryWriteRequested') is not False
                or docs['shutdown-1.json'].get('nativeReaped') is not True
                or docs['shutdown-1.json'].get('endpointsAndLeaseSettled') is not True):
            raise ValueError('Unknown retained source/settlement; never adopt')
        self.seed = docs['capacity-seed.json']
        qualify(self.seed)
        lease = Path(str(self.database) + '.trainer-writer')
        if lease.exists() or lease.is_symlink():
            raise ValueError('Retained source still has a writer; refuse before SQLite')
        self.database, self.database_identity = database_state(self.database)
        self.conversation = 'T0274-' + run_id + '-capacity-1'
        self.small_turn = proof.get('smallTurn', {})
        self.snapshot = self.small_turn.get('pin')
        observed = summary(self)
        if (observed != proof.get('lastSummary') or observed.get('frontier') != 1
                or len(observed['attempts']) != 1 or observed['attempts'][0]['outcome'] != 'committed'
                or not observed['attempts'][0]['usage'] or self.small_turn.get('httpStatus') != 200
                or [c.get('purpose') for c in self.small_turn.get('providerCalls', [])] != ['direct_answer']
                or not isinstance(self.snapshot, dict) or self.snapshot.get('tokens', 0) <= 2048
                or pin(self, self.conversation) != self.snapshot):
            raise ValueError('Unknown/interrupted/changed prefix cannot be resumed')
        with contextlib.closing(readonly(self.database)) as db:
            if (db.execute('select count(*) from conversation_completion').fetchone()[0] != 2
                    or db.execute("select content from message where conversation_id=? and role='user' order by created_at,rowid desc limit 1", (self.conversation,)).fetchone()[0] != SMALL_TURN):
                raise ValueError('Exact completed small turn required; never resubmit it')
            self.original = fingerprint(db)
        self.first_summary = proof['firstSummary']
        self.proof = {'sourceReceipt': proof_path.name, 'disposition': disposition_file.name, 'runId': run_id,
                      'source': proof['source'], 'reseeded': False, 'smallTurnResubmitted': False,
                      'unknownAttemptsResumed': False}
        self.verify_current()
        resources.guard(self.verify_current)  # Borrowed input is never enrolled for deletion.

    def verify_current(self):
        lease = Path(str(self.database) + '.trainer-writer')
        if lease.exists() or lease.is_symlink() or database_state(self.database)[1] != self.database_identity:
            raise ValueError('Retained input changed or has a writer; no stopping/adoption')
        for path, digest in self.metadata:
            if hashlib.sha256(private_file(path, 64 * 1024)[1]).hexdigest() != digest:
                raise ValueError('Retained metadata changed')
        with contextlib.closing(readonly(self.database)) as db:
            if fingerprint(db) != self.original:
                raise ValueError('Borrowed input changed; never copy back')


def configure(run, *, retained_seed=None):
    (run.root / 'tokens').mkdir(mode=0o700)
    private_json(run.root / 'config/settings-v3.json', {'version': 3, 'keys': {}, 'fields': {
        'DATABASE_PATH': str(run.database), 'GARMIN_MCP_TOKEN_DIR': str(run.root / 'tokens'),
        'AI_PROVIDER': 'openai', 'AI_MODEL': 'gpt-6-luna', 'MEMORY_ENABLED': 'true',
        'SUMMARY_ENABLED': 'true', 'SUMMARY_MODEL': 'gpt-6-luna', 'SUMMARY_CHAR_LIMIT': '20000',
        'SUMMARY_CONTRACT_VERSION': '2', 'MEMORY_EMBEDDING_PROVIDER': 'ollama',
        'MEMORY_EMBEDDING_MODEL': 'nomic-embed-text', 'MEMORY_EMBEDDING_BASE_URL': 'http://127.0.0.1:1',
        'MEMORY_EMBEDDING_DIMS': '768'}, 'chatCatalog': {'version': 1, 'defaultEntryId': None,
        'entries': [{'id': CATALOG, 'provider': 'openai', 'modelId': 'gpt-6-luna'}]}})
    run.descriptor['providerSmoke'] = PRESET
    run.capacity_conversations = set()
    if retained_seed is not None:
        return qualify(retained_seed)
    result = subprocess.run(['npm', 'run', '--silent', 'smoke:summary:seed', '--', str(run.root), 'capacity'],
                            cwd=Path(__file__).resolve().parents[2], capture_output=True, timeout=30, check=True)
    if len(result.stdout) > 2048:
        raise ValueError('Seed output bound exceeded')
    seed = json.loads(result.stdout)
    if seed.get('runId') != run.id:
        raise ValueError('Exact owned seed required')
    qualified = qualify(seed)
    private_json(run.root / 'capacity-seed.json', seed)
    return qualified


def api(run, method, path, body=None, envelope=None):
    if time.monotonic() >= run.activity_deadline:
        raise TimeoutError('No new effects after activity deadline')
    allowed = {('GET', '/api/cross-chat-summary'), ('POST', '/api/conversations'),
               ('POST', '/api/cross-chat-summary'), ('PATCH', '/api/model-settings'), ('POST', '/api/chat')}
    if (method, path) not in allowed:
        raise ValueError('Unsupported finite capacity route')
    if method == 'PATCH' and body != {'modelId': CATALOG}:
        raise ValueError('Only exact Luna catalog entry allowed')
    if path == '/api/conversations' and (method != 'POST' or not isinstance(body, dict)
            or body not in [{'id': 'T0274-' + run.id + '-capacity-' + str(number),
                             'title': 'Authored T0274 capacity ' + str(number)} for number in (1, 2)]):
        raise ValueError('Only exact authored owned new chats allowed')
    if path == '/api/chat' and (method != 'POST' or envelope is None or not isinstance(body, dict)
            or set(body) != {'conversationId', 'message', 'stream'} or body['stream'] is not False
            or body['conversationId'] not in run.capacity_conversations or body['message'] not in (SMALL_TURN, QUESTION)):
        raise ValueError('Only reserved authored owned chat allowed')
    adoption = method == 'POST' and path in ('/api/conversations', '/api/cross-chat-summary')
    if path == '/api/cross-chat-summary' and method == 'POST' and (not isinstance(body, dict)
            or set(body) != {'version', 'expected', 'action', 'conversationId', 'segmentRevision'}
            or body.get('version') != 1 or body.get('action') != 'refresh'
            or body.get('conversationId') not in run.capacity_conversations):
        raise ValueError('Only one bounded explicit owned Refresh allowed')
    if adoption and run.adoptions >= ADOPTIONS:
        raise ValueError('Finite adoption bound exhausted; no manual Continue loop')
    identity = run.http('/identity')
    if (not run.accept_identity(identity) or identity.get('providerSourceUnchanged') is not True
            or run.descriptor.get('providerSmoke') != PRESET):
        raise ValueError('Exact native scope/source preservation required')
    if time.monotonic() >= run.activity_deadline:
        raise TimeoutError('Activity ended during identity check')
    if adoption:
        run.adoptions += 1  # Unknown effects consume the technical opportunity.
    if path == '/api/chat':
        envelope.claim('chat', run.id)  # Durable before opening the paid-effect socket.
    connection = http.client.HTTPConnection('127.0.0.1', int(run.origin.rsplit(':', 1)[1]), timeout=60)
    try:
        connection.request(method, path, json.dumps(body) if body is not None else None,
                           {'Content-Type': 'application/json', **({'x-trainer-turn-budget': 'finite-live-smoke'} if path == '/api/chat' else {})})
        response = connection.getresponse()
        raw = response.read(512 * 1024 + 1)
        if len(raw) > 512 * 1024:
            raise ValueError('Bounded response exceeded')
        return response.status, json.loads(raw)
    finally:
        connection.close()


def summary(run):
    with contextlib.closing(readonly(run.database)) as db:
        state = db.execute('select revision,frontier,payload from summary_state where id=1').fetchone()
        value = json.loads(state[2])
        attempts = [{'outcome': row[0], 'sourceCount': len(json.loads(row[1])), 'upper': row[2],
                     'usage': json.loads(row[3]) if row[3] else None, 'reservedUsd': row[4], 'priceBasis': row[5]}
                    for row in db.execute('select outcome,source_ids_json,upper_event,usage_json,reserved_usd,price_basis from summary_attempt order by started_at,job_id')]
        return {'revision': state[0], 'frontier': state[1], 'characters': len(value['text']),
                'payloadSha256': hashlib.sha256(state[2].encode()).hexdigest(), 'itemCount': len(value['items']),
                'hasFreshLabel': 'cedar pause' in value['text'].lower(), 'attempts': attempts}


def wait_summary(run, frontier):
    started = time.monotonic()
    while time.monotonic() < run.activity_deadline:
        status, meta = api(run, 'GET', '/api/cross-chat-summary')
        observed = summary(run)
        if status != 200:
            raise ValueError('Summary metadata unavailable')
        if observed['frontier'] >= frontier:
            return {'summary': observed, 'metadata': meta, 'observedWaitSeconds': round(time.monotonic() - started, 3)}
        if meta.get('reason') not in (None, 'summary_invalidated', 'summary_correction_pending'):
            raise ValueError('Summary unavailable; preserve adverse metadata, never replay')
        time.sleep(.25)  # Read-only bounded observation, never an inference retry.
    raise TimeoutError('Summary publication deadline')


def new_chat(run, number):
    conversation = 'T0274-' + run.id + '-capacity-' + str(number)
    started = time.monotonic()
    status, value = api(run, 'POST', '/api/conversations', {'id': conversation, 'title': 'Authored T0274 capacity ' + str(number)})
    if status != 200 or value.get('conversation', {}).get('id') != conversation:
        raise ValueError('Owned new-chat adoption failed')
    run.capacity_conversations.add(conversation)
    return conversation, {'secondsToPin': round(time.monotonic() - started, 3), 'pin': pin(run, conversation)}


def large_pin(run, conversation):
    projected = pin(run, conversation)
    if type(projected['tokens']) is not int or not 2048 < projected['tokens'] <= POLICY['modelContext'] or projected['omitted'] != 0:
        raise ValueError('Full measured above-old-cap consumption required')
    return projected


def answer(run, conversation, message, envelope, *, facts=False):
    adopted = pin(run, conversation)
    if adopted['revision'] is None or adopted['omitted'] != 0:
        raise ValueError('Exact full adopted snapshot required before chat')
    started = time.monotonic()
    status, body = api(run, 'POST', '/api/chat', {'conversationId': conversation, 'message': message, 'stream': False}, envelope)
    observed = answer_observation(status, body, time.monotonic() - started)
    # The actual turn owner performs and persists exact SDK measurement once.
    try:
        projected = large_pin(run, conversation)
    except ValueError:
        observed['measuredPinUnavailable'] = True
        return observed, False
    text = body.get('assistant', {}).get('content', '').lower()
    observed['capacityMeaning'] = {'reminder': 'paper postcard' in text, 'restDay': 'thursday' in text, 'freshLabel': 'cedar pause' in text}
    observed['pin'] = projected
    if (status != 200 or not text or projected['revision'] != adopted['revision']
            or (observed.get('context') or {}).get('summaryRevision') != projected['revision']
            or (facts and not all(observed['capacityMeaning'].values()))):
        return observed, False
    calls = observed['providerCalls']
    consumed = {call.get('purpose') for call in calls if isinstance((call.get('tokenUsage') or {}).get('inputTokens'), int)
                and call['tokenUsage']['inputTokens'] >= projected['tokens']}
    expected = {'planner', 'final_synthesis'} if facts else {'direct_answer'}
    tools_match = observed['tools'] == [{'tool': 'getSyncStatus', 'status': 'succeeded'}] if facts else not observed['tools']
    return observed, expected.issubset(consumed) and tools_match


def boot(run, envelope, receipt, action):
    envelope.claim('boundedBoot', run.id)
    try:
        # One alarm bounds startup, all reads/slow trickles, SQLite/renderer work
        # and activity. No competing nested timer or unbounded helper runs.
        with request_deadline(BOOT_SECONDS):
            receipt['credentialSourceUnchanged'] = 'unavailable-during-activation'
            run.start(run.binary, timeout=100)
            receipt['credentialSourceUnchanged'] = 'unavailable-after-activation'
            run.activity_deadline = time.monotonic() + ACTIVITY_SECONDS
            run.adoptions = 0
            status, _ = api(run, 'PATCH', '/api/model-settings', {'modelId': CATALOG})
            if status != 200:
                raise ValueError('Explicit exact Luna selection failed')
            action()
            identity = run.http('/identity')
            receipt['credentialSourceUnchanged'] = run.accept_identity(identity) and identity.get('providerSourceUnchanged') is True
            if not receipt['credentialSourceUnchanged']:
                raise ValueError('Credential source changed; no further effects')
    finally:
        # First action after an alarm/failure: stop only this live owned handle.
        # Do not perform potentially slow observations before provider settlement.
        run.stop()
        run.verify_settled()


@resources.invocation
def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--scratch', required=True)
    parser.add_argument('--bundle', required=True)
    parser.add_argument('--approved-t0274-synthetic-luna-usd50', action='store_true', required=True,
                        help='Flag records actual scoped operator consent, never supplies it')
    parser.add_argument('--continue-receipt', help='Diagnosed settled failure only; every immutable prior reservation retained')
    parser.add_argument('--resume-capacity-receipt', help='Exact first successful-summary/small-turn prefix; never an unknown attempt')
    parser.add_argument('--resume-capacity-disposition', help='Its exact retained invocation resource disposition')
    args = parser.parse_args()
    os.umask(0o077)
    evidence = private_directory(resources.configure(canonical(args.scratch)))
    bundle = canonical(args.bundle)
    inventory, source = audit(bundle), source_identity()
    if json.loads((bundle / 'Contents/Resources/resources/provenance.json').read_text()).get('sourceFingerprint') != source:
        raise ValueError('Exact current-source ordinary artifact required')
    artifact = hashlib.sha256(json.dumps(inventory, sort_keys=True).encode()).hexdigest()
    envelope = Envelope(evidence, {'source': source, 'artifact': artifact}, args.continue_receipt)
    resuming = args.resume_capacity_receipt is not None
    if resuming != (args.resume_capacity_disposition is not None) or (resuming and not args.continue_receipt):
        raise ValueError('Exact successful prefix/disposition and cumulative ledger continuation required')
    if envelope.total + 2 * COSTS['boundedBoot'] + (2 if resuming else 3) * COSTS['chat'] > APPROVAL['maximumMilliUsd']:
        raise ValueError('Insufficient cumulative budget for complete case; no partial relaunch')
    prepared = (RetainedCapacity(evidence, args.resume_capacity_receipt, args.resume_capacity_disposition) if resuming else
                prepare(evidence, argparse.Namespace(task_id='T0274', input_file=None, grant_file=None, provenance_file=None, anchor=None), 'ordinary'))
    receipt = {'purpose': PRESET, 'source': source, 'artifact': artifact, 'scenarioPassed': False, 'syntheticOnly': True,
               'credentialReadback': False, 'credentialSourceUnchanged': 'unavailable-before-activation', 'captures': [],
               'notProved': ['primary activation/private history', 'trusted OS input', 'invoice accuracy or cache savings',
                             'provider generated all manual prior facts', 'live service outage or every-fact recall']}
    run, observer = None, None
    stage = 'preparation'
    snapshots = {}
    try:
        run = OrdinaryRun(evidence, prepared.database, source, bundle, inventory)
        receipt['runId'] = run.id
        run.before_start = prepared.verify_current
        if resuming and run.original != prepared.original:
            raise ValueError('Online copy differs from verified retained source')
        receipt['qualifiedEnvelope'] = configure(run, retained_seed=prepared.seed if resuming else None)
        if resuming:
            receipt['retainedPrefix'] = prepared.proof
            receipt['firstSummary'] = prepared.first_summary
            receipt['smallTurn'] = prepared.small_turn
            snapshots['first'] = (prepared.conversation, prepared.snapshot)
            run.capacity_conversations.add(prepared.conversation)
        observer = Observer(evidence)
        run.observer = observer

        def first():
            nonlocal stage
            stage = 'large-prior-maintenance'
            if not resuming:
                receipt['firstSummary'] = wait_summary(run, 1)
            initial = receipt['firstSummary']['summary']
            committed = [a for a in initial['attempts'] if a['outcome'] == 'committed']
            if not 12000 < initial['characters'] <= 20000 or not committed or not any((a['usage'] or {}).get('input', 0) > 8000 for a in committed):
                raise ValueError('Actual above-old-input-cap maintenance/usage proof failed')
            if not resuming:
                conversation, receipt['firstNewChat'] = new_chat(run, 1)
                stage = 'single-small-ordinary-turn'
                receipt['smallTurn'], passed = answer(run, conversation, SMALL_TURN, envelope)
                if not passed:
                    raise ValueError('Small-turn actual direct-answer consumption failed')
                snapshots['first'] = (conversation, large_pin(run, conversation))
            elif pin(run, prepared.conversation) != prepared.snapshot:
                raise ValueError('Retained consumed prefix changed at owned reopen')
            conversation, receipt['catchUpNewChat'] = new_chat(run, 2)
            frozen = pin(run, conversation)
            receipt['singleTurnCatchUp'] = wait_summary(run, 2)
            if pin(run, conversation) != frozen:
                raise ValueError('Late publication silently changed an established pin')
            if frozen['revision'] != receipt['singleTurnCatchUp']['summary']['revision']:
                stage = 'one-explicit-refresh-after-honest-catchup-timeout'
                status, meta = api(run, 'GET', '/api/cross-chat-summary')
                with contextlib.closing(readonly(run.database)) as db:
                    segment = db.execute('select revision from conversation_segment where conversation_id=?', (conversation,)).fetchone()[0]
                status, _ = api(run, 'POST', '/api/cross-chat-summary', {'version': 1, 'expected': meta['expected'],
                                   'action': 'refresh', 'conversationId': conversation, 'segmentRevision': segment})
                if status != 200:
                    raise ValueError('One explicit post-timeout Refresh failed')
                receipt['oneExplicitRefreshAfterTimeout'] = True
            if not receipt['singleTurnCatchUp']['summary']['hasFreshLabel']:
                raise ValueError('Fresh fictional label missing; preserve semantic failure without replay')
            stage = 'large-pin-fresh-answer'
            receipt['freshAnswer'], passed = answer(run, conversation, QUESTION, envelope, facts=True)
            if not passed:
                raise ValueError('Representative actual freshness/large-pin answer failed')
            snapshots['second'] = (conversation, large_pin(run, conversation))
            receipt['afterAnswerPublication'] = wait_summary(run, 3)
            if any(pin(run, cid) != saved for cid, saved in snapshots.values()):
                raise ValueError('Ordinary publication replaced stable consumed pins')
            receipt['stableAcrossPublications'] = True

        boot(run, envelope, receipt, first)

        def second():
            nonlocal stage
            stage = 'actual-opaque-native-restart'
            if any(pin(run, cid) != saved for cid, saved in snapshots.values()):
                raise ValueError('Restart changed sealed snapshots')
            receipt['restartRetainsExactPins'] = True
            conversation, _ = snapshots['second']
            receipt['restartAnswer'], passed = answer(run, conversation, QUESTION, envelope, facts=True)
            if not passed:
                raise ValueError('Actual restarted planner/synthesis consumption failed')
            receipt['afterRestartPublication'] = wait_summary(run, 4)
            if any(pin(run, cid) != saved for cid, saved in snapshots.values()):
                raise ValueError('Restart publication replaced stable pins')
            stage = 'sanitized-ordinary-trainer-captures'
            for preset in ('wide', 'narrow'):
                run.command({'type': 'setViewport', 'preset': preset})
                receipt['captures'].append({'preset': preset, **run.command({'type': 'captureView', 'view': 'trainer', 'preset': preset})})

        boot(run, envelope, receipt, second)
        if source_identity() != source or audit(bundle) != inventory:
            raise ValueError('Tested source/artifact changed')
        receipt['scenarioPassed'] = True
    finally:
        with resources.preserve_failure():
            receipt['lastStage'] = stage
            receipt['claims'], receipt['reservedMilliUsd'] = envelope.claims, envelope.total
            errors = []
            if run:
                try:
                    run.stop(); run.verify_settled()
                except Exception as error:
                    errors.append(type(error).__name__)
                try:
                    receipt['lastSummary'] = summary(run)
                except Exception:
                    receipt['lastSummaryUnavailable'] = True
            if observer:
                receipt['noninterference'] = observer.stop(run.pids if run else [])
            prepared.verify_current()
            with contextlib.closing(readonly(prepared.database)) as db:
                receipt['inputUnchanged'] = fingerprint(db) == prepared.original
            receipt['allOwnedProcessesSettled'] = not errors
            if errors or not receipt['inputUnchanged'] or receipt['credentialSourceUnchanged'] is not True:
                receipt['scenarioPassed'] = False
            path = evidence / ('capacity-memory-live-' + str(uuid.uuid4()) + '.json')
            private_json(path, receipt)
            print(json.dumps({'receipt': str(path), 'scenarioPassed': receipt['scenarioPassed'], 'reservedMilliUsd': envelope.total, 'credentialReadback': False}))
            if errors:
                raise RuntimeError('Owned settlement failed; retain diagnostics')
    if not receipt['scenarioPassed']:
        raise RuntimeError('Capacity/freshness/preservation proof incomplete')


if __name__ == '__main__':
    signal.signal(signal.SIGTERM, lambda *_: (_ for _ in ()).throw(KeyboardInterrupt('Owned T0274 test interrupted')))
    try:
        main()
    except Exception as error:
        print('Finite T0274 case failed: ' + type(error).__name__ + '; retain receipt/claims, diagnose before any continuation.')
        raise SystemExit(1) from None
