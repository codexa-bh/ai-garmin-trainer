#!/usr/bin/env python3
"""T0272 finite authored lineage proof. Native alone owns the opaque OpenAI slot."""
import argparse
import contextlib
import hashlib
import http.client
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import time
import uuid

from native_smoke import Observer, canonical, fingerprint, private_json, readonly, source_identity
from ordinary_smoke import OrdinaryRun, audit, private_directory
from smoke_input import prepare, json_document, private_file, database_state
from summary_live import observe_summary, meaning_passed
import smoke_resources as resources

PRESET = 't0272-integrated-memory-luna-200'
CATALOG_ID = 'entry_t0272_chat_luna'
APPROVAL = {'purpose': PRESET, 'maximumMilliUsd': 2000,
            'maximumBoots': 4, 'maximumChats': 12, 'maximumTitles': 12,
            'bootMilliUsd': 200, 'chatMilliUsd': 80, 'titleMilliUsd': 1,
            'activitySeconds': 300, 'tailSeconds': 100,
            'source': 'T0272 operator approved the exact synthetic opaque OpenAI/Luna USD2 proposal',
            'unknownsRemainReserved': True, 'credentialReadback': False}
AMENDMENT = {'version': 1, 'purpose': PRESET, 'maximumMilliUsd': 5000,
             'maximumBoots': 7, 'maximumChats': 7, 'maximumTitles': 7,
             'bootMilliUsd': 200, 'chatMilliUsd': 80, 'titleMilliUsd': 1,
             'activitySeconds': 300, 'tailSeconds': 100,
             'authorization': 'T0272 operator approved seven/seven and USD5 total if needed',
             'unknownsRemainReserved': True, 'credentialReadback': False}

BUDGET_ONLY = {**AMENDMENT, 'version': 2, 'maximumBoots': None, 'maximumChats': None,
               'maximumTitles': None,
               'authorization': 'T0272 operator: dude only limit you have is not spend over $5.'}


BUDGET_100 = {**BUDGET_ONLY, 'version': 3, 'maximumMilliUsd': 100000,
              'authorization': 'T0272 operator explicitly approved USD100 cumulative on Luna; no count caps'}


def read_receipt(path, expected_hash=None, *, allow_success=False):
    # Cumulative per-round usage is larger than a settings/grant document. Keep
    # that existing 8KiB boundary unchanged; only this fixed evidence accepts64KiB.
    path, data, _ = private_file(path, 64 * 1024)
    digest = hashlib.sha256(data).hexdigest()
    if expected_hash is not None and digest != expected_hash:
        raise ValueError('Retained receipt changed')
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError('Duplicate receipt key')
            result[key] = value
        return result
    value = json.loads(data, object_pairs_hook=unique)
    required = {'purpose': PRESET, 'syntheticOnly': True,
                'credentialReadback': False, 'credentialSourceUnchanged': True,
                'inputUnchanged': True, 'allOwnedProcessesSettled': True}
    if (not isinstance(value, dict) or not path.name.startswith('integrated-memory-live-')
            or type(value.get('scenarioPassed')) is not bool
            or (value['scenarioPassed'] and not allow_success)
            or any(value.get(key) != expected for key, expected in required.items())):
        raise ValueError('Exact settled receipt and explicit success-continuation scope required')
    return path, value, digest


QUESTION = ('Using only our remembered fictional discussion, explain the chosen weekday/weekend approach, '
            'why it was chosen, the rejected alternative, our hiking-duration goal, and which equipment options '
            'remain undecided. Do not infer an equipment preference or fitness measurement. Reply in English '
            'in at most 120 words. No tools, saves or Garmin connection. ')
SEED_COMPLETIONS = 184  # 4 meaning-bearing + 180 explicitly authored neutral sources.
ANSWER_ROUNDS = (1, 5, 10)


def durable_claim(path, value):
    """Exclusive reservation, durable before any effect; partial files remain unknown."""
    with open(path, 'x', opener=lambda p, flags: os.open(p, flags | os.O_NOFOLLOW, 0o600)) as output:
        json.dump(value, output, sort_keys=True)
        output.flush()
        os.fsync(output.fileno())
    descriptor = os.open(path.parent, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


class Envelope:
    def __init__(self, evidence, binding, continuation=None, approved_reallocation=False, *, allow_settled_success=False, budget_only=False, approved_usd100=False):
        if set(binding) != {'source', 'artifact'} or any(not re.fullmatch('[a-f0-9]{64}', value) for value in binding.values()):
            raise ValueError('Exact source/artifact binding required')
        self.root = evidence / 't0272-integrated-memory-approved-usd200'
        self.binding = dict(binding)
        self.claims = []
        self.amendment = None
        self.budget_amendment = None
        self.budget_100 = None
        if approved_usd100 and not budget_only:
            raise ValueError('USD100 approval must retain the dollar-only authority chain')
        self.limits = BUDGET_100 if approved_usd100 else (BUDGET_ONLY if budget_only else (AMENDMENT if approved_reallocation else APPROVAL))
        if budget_only and (not approved_reallocation or continuation is None):
            raise ValueError('Budget-only approval must preserve existing authority and claims')
        if allow_settled_success and (continuation is None or not approved_reallocation):
            raise ValueError('Successful continuation requires existing additive scope and receipt')
        if approved_reallocation and continuation is None:
            raise ValueError('Additive approval must chain an exact retained receipt')
        if continuation is None:
            # Never recreate or automatically reopen a prior/unknown envelope.
            self.root.mkdir(mode=0o700)
            self.approval = {**APPROVAL, **self.binding}
            durable_claim(self.root / 'approval.json', self.approval)
        else:
            private_directory(self.root)
            path, receipt, digest = read_receipt(continuation, allow_success=allow_settled_success)
            if (path.parent != evidence or not isinstance(receipt.get('claims'), list)):
                raise ValueError('Exact settled diagnosed failure receipt required')
            self.claims = receipt['claims']
            for index, claim in enumerate(self.claims):
                if (not isinstance(claim, dict) or claim.get('kind') not in ('boot', 'chat')
                        or any(not isinstance(claim.get(key), str) or not re.fullmatch('[a-f0-9]{64}', claim[key]) for key in ('source', 'artifact'))
                        or claim != self.record(index, claim['kind'], {key: claim[key] for key in ('source', 'artifact')})):
                    raise ValueError('Unknown or modified retained claim')
            if (not self.claims or self.claims[0]['kind'] != 'boot'
                    or not self.has_capacity(0, 0)
                    or receipt.get('reservedMilliUsd') != self.total or self.total > self.limits['maximumMilliUsd']
                    or any(receipt.get(key) != self.claims[-1][key] for key in ('source', 'artifact'))):
                raise ValueError('Retained cumulative scope mismatch')
            self.approval = {**APPROVAL, **{key: self.claims[0][key] for key in ('source', 'artifact')}}
        info = self.root.stat()
        self.identity = (info.st_dev, info.st_ino)
        amendment_path = self.root / 'amendment-v1.json'
        if approved_reallocation and (amendment_path.exists() or amendment_path.is_symlink()):
            self.amendment = json_document(amendment_path)[1]
            prior_name = self.amendment.get('priorReceipt')
            if not isinstance(prior_name, str) or Path(prior_name).name != prior_name:
                raise ValueError('Invalid amendment receipt reference')
            prior_path, prior, prior_digest = read_receipt(evidence / prior_name)
            if self.amendment != self.amendment_record(prior_path, prior, prior_digest):
                raise ValueError('Changed additive approval/claim chain')
        budget_path = self.root / 'amendment-v2-budget-only.json'
        if budget_only and (budget_path.exists() or budget_path.is_symlink()):
            self.budget_amendment = json_document(budget_path)[1]
            prior_name = self.budget_amendment.get('priorReceipt')
            if not isinstance(prior_name, str) or Path(prior_name).name != prior_name:
                raise ValueError('Invalid budget-only receipt reference')
            prior_path, prior, prior_digest = read_receipt(evidence / prior_name, allow_success=True)
            if self.budget_amendment != self.budget_record(prior_path, prior, prior_digest):
                raise ValueError('Changed budget-only authority/claim chain')
        raised_path = self.root / 'amendment-v3-usd100.json'
        if approved_usd100 and (raised_path.exists() or raised_path.is_symlink()):
            self.budget_100 = json_document(raised_path)[1]
            prior_name = self.budget_100.get('priorReceipt')
            if not isinstance(prior_name, str) or Path(prior_name).name != prior_name:
                raise ValueError('Invalid USD100 receipt reference')
            prior_path, prior, prior_digest = read_receipt(evidence / prior_name, allow_success=True)
            if self.budget_100 != self.raised_budget_record(prior_path, prior, prior_digest):
                raise ValueError('Changed USD100 authority/claim chain')
        self.verify()
        if approved_reallocation and self.amendment is None:
            # The old inventory must validate BEFORE exclusive amendment publication.
            self.amendment = self.amendment_record(path, receipt, digest)
            durable_claim(amendment_path, self.amendment)
            self.verify()
        if budget_only and self.budget_amendment is None:
            self.budget_amendment = self.budget_record(path, receipt, digest)
            durable_claim(budget_path, self.budget_amendment)
            self.verify()
        if approved_usd100 and self.budget_100 is None:
            self.budget_100 = self.raised_budget_record(path, receipt, digest)
            durable_claim(raised_path, self.budget_100)
            self.verify()
        if continuation is not None:
            durable_claim(evidence / ('integrated-memory-reconciliation-' + str(uuid.uuid4()) + '.json'),
                          {'priorReceipt': path.name, 'priorReceiptSha256': digest,
                           'reservedMilliUsdRetained': self.total, 'claimsRetained': len(self.claims),
                           'priorScenarioPassed': receipt['scenarioPassed'],
                           'approvalRenewed': False, 'approvalSource': APPROVAL['source'],
                           'reviewedCurrentBinding': self.binding})

    def amendment_record(self, path, receipt, digest):
        prior = receipt.get('claims')
        if (not isinstance(prior, list) or not prior or prior != self.claims[:len(prior)]
                or receipt.get('reservedMilliUsd') != sum(c['reservedMilliUsd'] for c in prior)
                or sum(c['kind'] == 'boot' for c in prior) > APPROVAL['maximumBoots']
                or sum(c['kind'] == 'chat' for c in prior) > APPROVAL['maximumChats']):
            raise ValueError('Amendment must retain original bounded claims')
        return {**AMENDMENT, 'priorReceipt': path.name, 'priorReceiptSha256': digest,
                'originalApprovalSha256': json_document(self.root / 'approval.json')[2],
                'priorClaimSha256': [json_document(self.root / ('effect-' + str(i) + '.json'))[2] for i in range(len(prior))],
                'priorReservedMilliUsd': receipt['reservedMilliUsd']}

    def budget_record(self, path, receipt, digest):
        prior = receipt.get('claims')
        if (self.amendment is None or not isinstance(prior, list) or not prior
                or prior != self.claims[:len(prior)]
                or receipt.get('reservedMilliUsd') != sum(c['reservedMilliUsd'] for c in prior)
                or sum(c['kind'] == 'boot' for c in prior) > AMENDMENT['maximumBoots']
                or sum(c['kind'] == 'chat' for c in prior) > AMENDMENT['maximumChats']):
            raise ValueError('Budget-only amendment must retain the prior approved chain')
        return {**BUDGET_ONLY, 'priorReceipt': path.name, 'priorReceiptSha256': digest,
                'priorAmendmentSha256': json_document(self.root / 'amendment-v1.json')[2],
                'priorClaimSha256': [json_document(self.root / ('effect-' + str(i) + '.json'))[2] for i in range(len(prior))],
                'priorReservedMilliUsd': receipt['reservedMilliUsd']}

    def raised_budget_record(self, path, receipt, digest):
        prior = receipt.get('claims')
        if (self.budget_amendment is None or not isinstance(prior, list) or not prior
                or prior != self.claims[:len(prior)]
                or receipt.get('reservedMilliUsd') != sum(c['reservedMilliUsd'] for c in prior)
                or receipt['reservedMilliUsd'] > BUDGET_ONLY['maximumMilliUsd']):
            raise ValueError('USD100 amendment must preserve the existing USD5 chain')
        return {**BUDGET_100, 'priorReceipt': path.name, 'priorReceiptSha256': digest,
                'priorAmendmentSha256': json_document(self.root / 'amendment-v2-budget-only.json')[2],
                'priorReservedMilliUsd': receipt['reservedMilliUsd']}

    def has_capacity(self, boots, chats):
        if any(type(n) is not int or n < 0 for n in (boots, chats)):
            raise ValueError('Nonnegative integer effect inventory required')
        for kind, extra, key in [('boot', boots, 'maximumBoots'), ('chat', chats, 'maximumChats')]:
            cap = self.limits[key]
            if cap is not None and sum(c['kind'] == kind for c in self.claims) + extra > cap:
                return False
        return self.total + boots * 200 + chats * 81 <= self.limits['maximumMilliUsd']

    @staticmethod
    def record(index, kind, binding):
        parts = {'boot': 200} if kind == 'boot' else {'chat': 80, 'title': 1}
        return {'effect': index, 'kind': kind, 'reservedMilliUsd': sum(parts.values()),
                'partsMilliUsd': parts, **binding,
                'outcome': 'submitted-or-unknown; never refunded automatically'}

    @property
    def total(self):
        return sum(claim['reservedMilliUsd'] for claim in self.claims)

    def verify(self):
        private_directory(self.root)
        info = self.root.stat()
        if (info.st_dev, info.st_ino) != self.identity:
            raise ValueError('Replaced approval directory')
        expected = {'approval.json', *('effect-' + str(i) + '.json' for i in range(len(self.claims)))}
        if self.amendment is not None:
            expected.add('amendment-v1.json')
            if json_document(self.root / 'amendment-v1.json')[1] != self.amendment:
                raise ValueError('Changed additive approval')
            json_document(self.root / 'approval.json', self.amendment['originalApprovalSha256'])
            for index, digest in enumerate(self.amendment['priorClaimSha256']):
                json_document(self.root / ('effect-' + str(index) + '.json'), digest)
        if self.budget_amendment is not None:
            expected.add('amendment-v2-budget-only.json')
            if json_document(self.root / 'amendment-v2-budget-only.json')[1] != self.budget_amendment:
                raise ValueError('Changed budget-only approval')
            json_document(self.root / 'amendment-v1.json', self.budget_amendment['priorAmendmentSha256'])
            read_receipt(self.root.parent / self.budget_amendment['priorReceipt'],
                         self.budget_amendment['priorReceiptSha256'], allow_success=True)
            for index, digest in enumerate(self.budget_amendment['priorClaimSha256']):
                json_document(self.root / ('effect-' + str(index) + '.json'), digest)
        if self.budget_100 is not None:
            expected.add('amendment-v3-usd100.json')
            if json_document(self.root / 'amendment-v3-usd100.json')[1] != self.budget_100:
                raise ValueError('Changed USD100 approval')
            json_document(self.root / 'amendment-v2-budget-only.json', self.budget_100['priorAmendmentSha256'])
            _, prior, digest = read_receipt(self.root.parent / self.budget_100['priorReceipt'],
                                          self.budget_100['priorReceiptSha256'], allow_success=True)
            if self.budget_100 != self.raised_budget_record(self.root.parent / self.budget_100['priorReceipt'], prior, digest):
                raise ValueError('Changed USD100 retained claims')
        if set(os.listdir(self.root)) != expected or json_document(self.root / 'approval.json')[1] != self.approval:
            raise ValueError('Changed or concurrent approval inventory; no renewal')
        for index, claim in enumerate(self.claims):
            if json_document(self.root / ('effect-' + str(index) + '.json'))[1] != claim:
                raise ValueError('Changed claim; retain unknown reservation')

    def claim(self, kind):
        self.verify()
        if kind not in ('boot', 'chat'):
            raise ValueError('Unknown provider effect')
        if not self.has_capacity(int(kind == 'boot'), int(kind == 'chat')):
            raise ValueError('Approved cumulative reservation capacity exhausted')
        if kind == 'chat' and not any(claim['kind'] == 'boot' for claim in self.claims):
            raise ValueError('No reserved provider boot')
        # Every chat reserves a possible first-prompt title, even if manual/no title.
        parts = {'boot': 200} if kind == 'boot' else {'chat': 80, 'title': 1}
        reserve = sum(parts.values())
        if self.total + reserve > self.limits['maximumMilliUsd']:
            raise ValueError('Cumulative approved envelope exhausted')
        claim = self.record(len(self.claims), kind, self.binding)
        durable_claim(self.root / ('effect-' + str(len(self.claims)) + '.json'), claim)
        self.claims.append(claim)


class RetainedLineage:
    """One closed four-round recovery input, never a generic database selector."""
    def __init__(self, evidence, disposition_path, receipt_path):
        proof_path, proof, proof_hash = read_receipt(receipt_path)
        disposition_file, disposition, _, _ = json_document(disposition_path)
        run_id = proof.get('runId')
        if (proof_path.parent != evidence or disposition_file.parent != evidence
                or not disposition_file.name.startswith('resource-disposition-')
                or not isinstance(run_id, str) or str(uuid.UUID(run_id)) != run_id
                or proof.get('lastStage') != 'summary-round-5'
                or [entry.get('observedRound') for entry in proof.get('rounds', [])] != [1, 2, 3, 4]
                or disposition.get('invocationFailed') is not True or disposition.get('recoveryHold') is not True
                or disposition.get('evidenceRoot') != str(evidence)):
            raise ValueError('Exact settled four-round authored recovery required')
        root = private_directory(resources.runtime_path(evidence / ('ordinary-' + run_id)))
        self.database = root / 'trainer.sqlite'
        if (str(root) not in disposition.get('allocationRoots', [])
                or not any(item.get('path') == str(self.database) and item.get('status') == 'retained'
                           for item in disposition.get('artifacts', []))
                or private_file(root / 'owner', 64)[1].decode() != run_id):
            raise ValueError('Retained task-owned source identity mismatch')
        self.metadata = []
        documents = {}
        for name in ('artifact.json', 'provenance.json', 'shutdown-1.json', 'integrated-seed.json'):
            _, value, digest, _ = json_document(root / name)
            if json_document(evidence / ('ordinary-' + run_id) / name)[2] != digest:
                raise ValueError('Source metadata differs from retained evidence')
            self.metadata.append((root / name, digest))
            documents[name] = value
        if (documents['artifact.json'].get('sourceFingerprint') != proof['source']
                or documents['provenance.json'].get('source') != proof['source']
                or documents['shutdown-1.json'].get('nativeReaped') is not True
                or documents['shutdown-1.json'].get('endpointsAndLeaseSettled') is not True
                or documents['integrated-seed.json'].get('task') != 'T0272'
                or documents['integrated-seed.json'].get('completed') != SEED_COMPLETIONS):
            raise ValueError('Unknown source, seed or shutdown; never adopt')
        lease = Path(str(self.database) + '.trainer-writer')
        if lease.exists() or lease.is_symlink():
            raise ValueError('Recovery input has a writer; refuse before SQLite access')
        self.database, self.database_identity = database_state(self.database)
        observed = observe_summary(self)
        if (observed != proof.get('lastSummary') or observed['frontier'] != 80
                or len(observed['attempts']) != 4 or not meaning_passed(observed)
                or any(a['outcome'] != 'committed' or a['sourceCount'] != 20 for a in observed['attempts'])):
            raise ValueError('Retained lineage changed or has uncertain attempts')
        self.rounds = proof['rounds']
        self.snapshots = {}
        with contextlib.closing(readonly(self.database)) as db:
            for entry in self.rounds:
                if 'pin' not in entry:
                    continue
                matches = db.execute('select conversation_id from conversation_summary_pin where seal=?', (entry['pin']['seal'],)).fetchall()
                if len(matches) != 1 or pin(self, matches[0][0]) != entry['pin']:
                    raise ValueError('Retained consumed pin changed or ambiguous')
                self.snapshots[matches[0][0]] = entry['pin']
            if len(self.snapshots) != 1 or db.execute('select count(*) from conversation_completion').fetchone()[0] != 185:
                raise ValueError('Exact authored source frontier and first answer required')
            self.original = fingerprint(db)
        self.proof = {'receipt': proof_path.name, 'sha256': proof_hash, 'runId': run_id,
                      'frontier': 80, 'summarySeal': observed['checksum'], 'reseeded': False}
        self.verify_current()
        resources.guard(self.verify_current)  # Borrowed recovery input is never enrolled for deletion.

    def verify_current(self):
        if Path(str(self.database) + '.trainer-writer').exists() or Path(str(self.database) + '.trainer-writer').is_symlink():
            raise ValueError('Recovery input has a writer lease; never stop or adopt it')
        if database_state(self.database)[1] != self.database_identity:
            raise ValueError('Recovery input file/WAL identity changed')
        for path, digest in self.metadata:
            json_document(path, digest)
        with contextlib.closing(readonly(self.database)) as db:
            if fingerprint(db) != self.original:
                raise ValueError('Recovery input changed; never copy back')


def configure(run, *, seed=True, scenario='lineage'):
    recipes = {'lineage': ('integrated', SEED_COMPLETIONS, 'integrated-summary'),
               'controls': ('controls', 4, 'integrated-controls'),
               'correction': ('correction', 4, 'integrated-correction'),
               'compaction': ('compaction', 68, 'integrated-compaction')}
    if scenario not in recipes:
        raise ValueError('Unknown finite integrated scenario')
    mode, completed, variant = recipes[scenario]
    (run.root / 'tokens').mkdir(mode=0o700)
    private_json(run.root / 'config/settings-v3.json', {
        'version': 3, 'keys': {}, 'fields': {
            'DATABASE_PATH': str(run.database), 'GARMIN_MCP_TOKEN_DIR': str(run.root / 'tokens'),
            'AI_PROVIDER': 'openai', 'AI_MODEL': 'gpt-6-luna', 'MEMORY_ENABLED': 'true',
            'SUMMARY_ENABLED': 'true', 'SUMMARY_MODEL': 'gpt-6-luna', 'SUMMARY_CHAR_LIMIT': '6000',
            'SUMMARY_CONTRACT_VERSION': '2', 'MEMORY_EMBEDDING_PROVIDER': 'ollama',
            'MEMORY_EMBEDDING_MODEL': 'nomic-embed-text', 'MEMORY_EMBEDDING_BASE_URL': 'http://127.0.0.1:1',
            'MEMORY_EMBEDDING_DIMS': '768'},
        'chatCatalog': {'version': 1, 'defaultEntryId': None, 'entries': [
            {'id': CATALOG_ID, 'provider': 'openai', 'modelId': 'gpt-6-luna'}]}})
    if not seed:
        return
    result = subprocess.run(['npm', 'run', '--silent', 'smoke:summary:seed', '--', str(run.root), mode],
                            cwd=Path(__file__).resolve().parents[2], capture_output=True, timeout=30, check=True)
    if len(result.stdout) > 2048:
        raise ValueError('Seed output bound exceeded')
    value = json.loads(result.stdout)
    if any(value.get(key) != expected for key, expected in {
            'task': 'T0272', 'runId': run.id, 'completed': completed,
            'providerCalls': 0, 'variant': variant}.items()):
        raise ValueError('Exact authored integrated source required')
    private_json(run.root / 'integrated-seed.json', value)


@contextlib.contextmanager
def request_deadline(seconds):
    # Socket timeouts alone allow a slow trickle to run forever. This runner is
    # single-threaded; a wall-clock alarm bounds the entire admitted response.
    previous = signal.getsignal(signal.SIGALRM)
    if signal.getitimer(signal.ITIMER_REAL) != (0.0, 0.0):
        raise ValueError('Existing process alarm; refuse competing timer owner')
    def expired(*_):
        raise TimeoutError('Admitted request deadline; retain unknown spend')
    signal.signal(signal.SIGALRM, expired)
    signal.setitimer(signal.ITIMER_REAL, seconds)
    try:
        yield
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, previous)


def api(run, method, path, body=None, envelope=None):
    if time.monotonic() >= run.activity_deadline:
        raise TimeoutError('Provider activity deadline; no new effects')
    allowed = {('GET', '/api/cross-chat-summary'), ('GET', '/api/cross-chat-summary?view=content'), ('POST', '/api/conversations'),
               ('POST', '/api/cross-chat-summary'), ('PATCH', '/api/model-settings'), ('POST', '/api/chat'),
               ('GET', '/api/profile'), ('POST', '/api/profile')}
    if (method, path) not in allowed:
        raise ValueError('Unsupported finite integrated route')
    identity = run.http('/identity')
    if (not run.accept_identity(identity) or identity.get('providerSourceUnchanged') is not True
            or run.descriptor.get('providerSmoke') != PRESET):
        raise ValueError('Exact native scope/source preservation required')
    if time.monotonic() >= run.activity_deadline:
        raise TimeoutError('Activity ended during identity check; no new effects')
    if path == '/api/chat':
        if envelope is None or method != 'POST':
            raise ValueError('Unreserved chat refused')
        envelope.claim('chat')  # Both chat and possible title, before opening socket.
    connection = http.client.HTTPConnection('127.0.0.1', int(run.origin.rsplit(':', 1)[1]), timeout=60 if path == '/api/chat' else 5)
    try:
        with request_deadline(60 if path == '/api/chat' else 5):
            connection.request(method, path, json.dumps(body) if body is not None else None,
                               {'Content-Type': 'application/json', **({'x-trainer-turn-budget': 'finite-live-smoke'} if path == '/api/chat' else {})})
            response = connection.getresponse()
            raw = response.read(512 * 1024 + 1)
            if len(raw) > 512 * 1024:
                raise ValueError('Bounded API result exceeded')
            return response.status, json.loads(raw)
    finally:
        connection.close()


def pin(run, conversation):
    with contextlib.closing(readonly(run.database)) as db:
        row = db.execute('select payload,seal from conversation_summary_pin where conversation_id=?', (conversation,)).fetchone()
        if not row or hashlib.sha256(row[0].encode()).hexdigest() != row[1]:
            raise ValueError('Missing or unsealed pin')
        value = json.loads(row[0])
        return {'seal': row[1], 'revision': value['stamp']['revision'] if value else None,
                'tokens': value['tokens'] if value else None, 'omitted': value['omitted'] if value else None}


def wait_summary(run, frontier):
    started = time.monotonic()
    while time.monotonic() < run.activity_deadline:
        status, meta = api(run, 'GET', '/api/cross-chat-summary')
        if status != 200:
            raise ValueError('Summary metadata unavailable')
        observed = observe_summary(run)
        if observed['frontier'] >= frontier:
            return {**observed, 'observedWaitSeconds': round(time.monotonic() - started, 3)}
        if meta.get('reason') not in (None, 'summary_invalidated', 'summary_correction_pending'):
            raise ValueError('Summary generation unavailable: ' + str(meta['reason']))
        time.sleep(.25)  # Bounded observation only, no provider/mutation retry.
    raise TimeoutError('Summary publication deadline')


def answer_observation(status, body, seconds):
    assistant = body.get('assistant', {})
    text = assistant.get('content', '')
    trace = (assistant.get('grounding') or {}).get('debugTrace') or {}
    lower = text.lower().replace('\u2019', "'")
    # One reviewed authored approach is a long hyphenated English phrase, not
    # an opaque identifier. Normalize only that exact phrase before screening;
    # unknown long tokens, keys, URLs, emails and private paths still withhold.
    excerpt = text[:1000].replace('short-weekday-walks-and-weekend-hiking', 'short weekday walks and weekend hiking')
    if re.search(r'(sk-|https?://|/Users/|@|[A-Za-z0-9_-]{32,})', excerpt):
        excerpt = '[noncanonical synthetic excerpt withheld]'
    return {'httpStatus': status, 'characters': len(text), 'excerpt': excerpt,
            'secondsToJson': round(seconds, 3), 'context': body.get('conversationContext'),
            'diagnosticsRevoked': ((assistant.get('grounding') or {}).get('conversationContext') or {}).get('summaryRevoked') is True,
            'providerCalls': [{'purpose': call.get('purpose'), 'tokenUsage': call.get('tokenUsage')}
                              for call in trace.get('providerCalls', [])],
            'tools': [{'tool': step.get('tool'), 'status': step.get('status')}
                      for step in (assistant.get('grounding') or {}).get('toolSteps', [])],
            'meaning': {'shortWeekdays': 'short' in lower and 'week' in lower,
                        'weekendHike': 'weekend' in lower and 'hik' in lower,
                        'timeRationale': any(word in lower for word in ['time', 'bicycle', '18:00', 'availab']),
                        'rejectedLongWeekdays': 'long' in lower and any(word in lower for word in ['reject', 'stopped', 'did not fit', "didn't fit", 'could not fit', "couldn't fit"]),
                        'threeHourGoal': bool(re.search(r'(?:three|3)[ -]?(?:hours?|h\b)', lower)),
                        'unchosenEquipment': 'pole' in lower and 'bag' in lower and any(word in lower for word in ['undecided', 'not chosen', 'unresolved', 'not decided', 'unchosen', "haven't chosen", "haven't decided"])}}


def assert_answer(answer, projected):
    context = answer['context'] or {}
    if (answer['httpStatus'] != 200 or not all(answer['meaning'].values())
            or context.get('summaryRevision') != projected['revision']
            or type(projected['tokens']) is not int or not 0 <= projected['tokens'] <= 2048
            or not answer['providerCalls']):
        raise ValueError('Actual consumed-pin/answer meaning or usage proof failed')


OFF_TITLE_QUESTION = ('Explain in English, in at most 60 words, why a fictional beginner might prefer short walks. '
                      'This is a general question, not a personal preference or measurement. No tools, saves or Garmin connection.')


def summary_command(run, action, **fields):
    status, meta = api(run, 'GET', '/api/cross-chat-summary')
    if status != 200:
        raise ValueError('Summary authority unavailable')
    status, result = api(run, 'POST', '/api/cross-chat-summary',
                         {'version': 1, 'expected': meta['expected'], 'action': action, **fields})
    if status != 200:
        raise ValueError('Summary mutation refused; never replay: ' + action)
    return result


def title_observation(run, conversation):
    with contextlib.closing(readonly(run.database)) as db:
        title = db.execute('''select c.title,c.manual_title,a.claimed,a.pending from conversation c
            join conversation_title_attempt a on a.conversation_id=c.id where c.id=?''', (conversation,)).fetchone()
        attempts = db.execute('select reserved_usd,usage_json from conversation_title_spend').fetchall()
        enabled = db.execute('select enabled from summary_control where id=1').fetchone()[0]
        summaries = db.execute('select count(*) from summary_attempt').fetchone()[0]
    fallback = OFF_TITLE_QUESTION[:47] + '…'
    return {'effectiveOff': enabled == 0, 'summaryAttempts': summaries,
            'titleSettled': bool(title and title[2] == 1 and title[3] == 0),
            'generatedNonExcerpt': bool(title and title[1] == 0 and title[0] != fallback and 0 < len(title[0]) <= 48),
            'attempts': len(attempts), 'reservedUsd': sum(row[0] for row in attempts),
            'usage': json.loads(attempts[0][1]) if len(attempts) == 1 and attempts[0][1] else None}


def assert_off_title(observed):
    if (observed.get('effectiveOff') is not True or observed.get('summaryAttempts') != 0
            or observed.get('titleSettled') is not True or observed.get('generatedNonExcerpt') is not True
            or observed.get('attempts') != 1 or observed.get('reservedUsd') != .001
            or not isinstance(observed.get('usage'), dict)
            or not all(type(observed['usage'].get(key)) is int and observed['usage'][key] > 0 for key in ('input', 'output'))):
        raise ValueError('Real Off-independent title and usage not proved; no retry')


def original_controls_messages(run):
    # Fixed authored seed conversations only, never a private/history scan.
    with contextlib.closing(readonly(run.database)) as db:
        rows = db.execute('select id,role,content from message where conversation_id in (?,?) order by id',
                          ('T0272-' + run.id + '-A', 'T0272-' + run.id + '-B')).fetchall()
    if len(rows) != 8:
        raise ValueError('Exact four-source original inventory required')
    return hashlib.sha256(json.dumps(rows).encode()).hexdigest()


def import_observation(run, manifest):
    with contextlib.closing(readonly(run.database)) as db:
        row = db.execute('select state,position,selection_json from summary_import where id=?', (manifest,)).fetchone()
        attempts = db.execute('select outcome,source_ids_json,usage_json from summary_attempt where import_id=?', (manifest,)).fetchall()
        state = db.execute('select frontier,payload from summary_state where id=1').fetchone()
        dispositions = db.execute('select source_id from summary_import_disposition where manifest_id=?', (manifest,)).fetchall()
    return {'state': row[0], 'position': row[1], 'selected': json.loads(row[2]), 'frontier': state[0],
            'publishedSources': sorted({source for item in json.loads(state[1])['items'] for source in item['sourceIds']}),
            'disposedSources': sorted(r[0] for r in dispositions),
            'attempts': [{'outcome': r[0], 'sources': json.loads(r[1]), 'usage': json.loads(r[2]) if r[2] else None} for r in attempts]}


def assert_import(observed, selected, frontier):
    attempts = observed['attempts']
    if (observed['state'] != 'complete' or observed['position'] != 4 or observed['frontier'] != frontier
            or sorted(observed['selected']) != sorted(selected) or observed['disposedSources'] != sorted(selected)
            or not observed['publishedSources'] or not set(observed['publishedSources']).issubset(selected)
            or len(attempts) != 1 or attempts[0]['outcome'] != 'committed'
            or sorted(attempts[0]['sources']) != sorted(selected)
            or not isinstance(attempts[0]['usage'], dict)
            or not all(type(attempts[0]['usage'].get(key)) is int and attempts[0]['usage'][key] > 0 for key in ('input', 'output'))):
        raise ValueError('Selected import coverage/provenance/usage/frontier proof failed')


def restart_owned(run, envelope, receipt):
    identity = run.http('/identity')
    receipt['credentialSourceUnchanged'] = run.accept_identity(identity) and identity.get('providerSourceUnchanged') is True
    if not receipt['credentialSourceUnchanged']:
        raise ValueError('Credential source changed before restart')
    run.stop()
    run.verify_settled()
    envelope.claim('boot')
    run.activity_deadline = time.monotonic() + 300
    run.start(run.binary, timeout=100)


def run_controls(run, envelope, receipt):
    evidence = receipt['controls'] = {'stage': 'activation'}
    original = original_controls_messages(run)
    envelope.claim('boot')
    run.activity_deadline = time.monotonic() + 300
    run.start(run.binary, timeout=100)
    status, meta = api(run, 'GET', '/api/cross-chat-summary')
    if status != 200 or meta.get('enabled') is not False or observe_summary(run)['attempts']:
        raise ValueError('Authored effective-Off baseline required')
    status, _ = api(run, 'PATCH', '/api/model-settings', {'modelId': CATALOG_ID})
    if status != 200:
        raise ValueError('Exact Luna selection refused')
    conversation = 'T0272-' + str(uuid.uuid4())
    status, created = api(run, 'POST', '/api/conversations', {'id': conversation})
    if status != 200 or created.get('conversation', {}).get('id') != conversation:
        raise ValueError('New automatic-title conversation refused')
    evidence['stage'] = 'off-answer-title'
    started = time.monotonic()
    status, body = api(run, 'POST', '/api/chat', {'conversationId': conversation, 'message': OFF_TITLE_QUESTION, 'stream': False}, envelope)
    answer = evidence['offAnswer'] = answer_observation(status, body, time.monotonic() - started)
    if (status != 200 or not answer['characters'] or not answer['providerCalls'] or answer['tools']
            or (answer['context'] or {}).get('summaryRevision') is not None):
        raise ValueError('Off chat without tools/pin not proved')
    title_deadline = min(run.activity_deadline, time.monotonic() + 10)
    while True:
        evidence['offTitle'] = title_observation(run, conversation)
        if evidence['offTitle']['titleSettled'] or time.monotonic() >= title_deadline:
            break
        time.sleep(.1)  # Observation only; title has its own unchanged3s bound.
    assert_off_title(evidence['offTitle'])
    evidence['stage'] = 'enable-drain-ineligible'
    summary_command(run, 'enable')
    # Off completions are dispositioned, never silently imported. Finish that
    # routine bookkeeping before measuring the independent import frontier.
    routine = wait_summary(run, 5)
    if routine['itemCount'] != 0:
        raise ValueError('Off history was silently summarized')
    status, content = api(run, 'GET', '/api/cross-chat-summary?view=content')
    if status != 200:
        raise ValueError('Import selection unavailable')
    selected = [c['id'] for c in content['historical']['candidates']
                if c['conversationId'] in ('T0272-' + run.id + '-A', 'T0272-' + run.id + '-B')]
    if len(selected) != 4:
        raise ValueError('Exact authored four-source selection required')
    evidence['stage'] = 'selected-import-pause-resume'
    summary_command(run, 'import-create', sourceIds=selected)
    status, content = api(run, 'GET', '/api/cross-chat-summary?view=content')
    manifests = content.get('historical', {}).get('manifests', [])
    if status != 200 or len(manifests) != 1:
        raise ValueError('Exact new import manifest unavailable')
    manifest = manifests[0]['id']
    summary_command(run, 'import-pause', id=manifest)
    paused = import_observation(run, manifest)
    if paused['state'] != 'paused' or paused['position'] != 0 or paused['attempts']:
        raise ValueError('Pause raced an admitted request; retain unknown and do not resume automatically')
    restart_owned(run, envelope, receipt)
    if import_observation(run, manifest) != paused:
        raise ValueError('Paused import changed across restart')
    evidence['pausedImportSurvivesRestart'] = True
    summary_command(run, 'import-resume', id=manifest)
    evidence['pauseResumeBeforeInference'] = True
    while time.monotonic() < run.activity_deadline:
        evidence['import'] = import_observation(run, manifest)
        if evidence['import']['state'] == 'complete':
            break
        if evidence['import']['state'] != 'active' or any(a['outcome'] not in ('admitted', 'committed') for a in evidence['import']['attempts']):
            raise ValueError('Import failed/interrupted; no retry')
        time.sleep(.25)
    assert_import(evidence['import'], selected, routine['frontier'])
    evidence['summary'] = observe_summary(run)
    if not meaning_passed(evidence['summary']):
        raise ValueError('Imported summary lost required meaning')
    evidence['stage'] = 'post-import-consumption'
    imported_chat = new_authored_chat(run, 'Authored selected-import consumption')
    evidence['postImportAnswer'] = timing_answer(run, envelope, imported_chat, QUESTION)
    evidence['postImportPin'] = pin(run, imported_chat)
    assert_answer(evidence['postImportAnswer'], evidence['postImportPin'])
    completed = import_observation(run, manifest)
    restart_owned(run, envelope, receipt)
    if import_observation(run, manifest) != completed or pin(run, imported_chat) != evidence['postImportPin']:
        raise ValueError('Completed import or consumed pin changed across restart')
    evidence['completedImportAndPinSurviveRestart'] = True
    evidence['originalMessagesUnchanged'] = original_controls_messages(run) == original
    if not evidence['originalMessagesUnchanged']:
        raise ValueError('Import changed original authored messages')
    identity = run.http('/identity')
    receipt['credentialSourceUnchanged'] = run.accept_identity(identity) and identity.get('providerSourceUnchanged') is True
    run.stop()
    run.verify_settled()
    evidence['stage'] = 'complete'
    receipt['notProved'] = ['M28 baseline comparison', 'live correction/outage/in-flight interruption',
                            'native compaction', 'primary activation']


TIMING_QUESTION = ('Using only our remembered fictional discussion, when do sessions suit me? '
                   'Distinguish current preference from old information; do not infer measurements. '
                   'Reply in English in at most 80 words. No tools, saves or Garmin connection.')
MORNING_CORRECTION = ('Actually mornings suit me now; evenings were only last month. '
                      'Acknowledge this correction to our fictional training discussion in English in at most 60 words. '
                      'No tools, saves or Garmin connection.')
PROFILE_TIMING_QUESTION = ('Use my current Profile; what is the weekday timing constraint? '
                          'Explain why it takes precedence over our older timing discussion. '
                          'Reply in English in at most 80 words. No tools, saves or Garmin connection.')


def new_authored_chat(run, title):
    conversation = 'T0272-' + str(uuid.uuid4())
    status, created = api(run, 'POST', '/api/conversations', {'id': conversation, 'title': title})
    if status != 200 or created.get('conversation', {}).get('id') != conversation:
        raise ValueError('Exact authored conversation creation failed')
    return conversation


def timing_answer(run, envelope, conversation, question):
    started = time.monotonic()
    status, body = api(run, 'POST', '/api/chat', {'conversationId': conversation, 'message': question, 'stream': False}, envelope)
    return answer_observation(status, body, time.monotonic() - started)


def assert_timing_answer(answer, timing, revision=None, *, allow_revoked_diagnostics=False):
    text = answer['excerpt'].lower()
    patterns = {'evening': r'\bevenings?\b', 'morning': r'\bmornings?\b',
                'profile': r'\b(?:lunchtime|lunch time|midday|noon)\b'}
    usage_available = bool(answer['providerCalls'])
    expected_revocation = allow_revoked_diagnostics and answer.get('diagnosticsRevoked') is True
    if (answer['httpStatus'] != 200 or (not usage_available and not expected_revocation) or answer['tools']
            or not re.search(patterns[timing], text)
            or (revision is not None and (answer['context'] or {}).get('summaryRevision') != revision)):
        raise ValueError('Required real timing/authority answer not proved')


def revoked_pin(run, conversation):
    with contextlib.closing(readonly(run.database)) as db:
        row = db.execute('select payload,reason from conversation_summary_pin where conversation_id=?', (conversation,)).fetchone()
    return bool(row and row[0] == 'null' and row[1] == 'invalidated')


def current_summary_text(run):
    with contextlib.closing(readonly(run.database)) as db:
        value = json.loads(db.execute('select payload from summary_state where id=1').fetchone()[0])
    text = value['text']
    if len(text) > 1000 or re.search(r'(sk-|https?://|/Users/|@|[A-Za-z0-9_-]{32,})', text):
        raise ValueError('Noncanonical synthetic summary; retain only bounded diagnostics')
    return text


def run_correction(run, envelope, receipt):
    evidence = receipt['correction'] = {'stage': 'activation'}
    original = original_controls_messages(run)
    envelope.claim('boot')
    run.activity_deadline = time.monotonic() + 300
    run.start(run.binary, timeout=100)
    status, _ = api(run, 'PATCH', '/api/model-settings', {'modelId': CATALOG_ID})
    if status != 200:
        raise ValueError('Exact Luna selection refused')
    evidence['stage'] = 'initial-summary-and-pin'
    initial = evidence['initialSummary'] = wait_summary(run, 4)
    evidence['initialSummaryText'] = current_summary_text(run)
    if not re.search(r'\bevenings?\b', evidence['initialSummaryText'], re.I):
        raise ValueError('Initial evening preference not published')
    a = new_authored_chat(run, 'Authored stale evening pin')
    evidence['initialAnswer'] = timing_answer(run, envelope, a, TIMING_QUESTION)
    evidence['initialPin'] = pin(run, a)
    assert_timing_answer(evidence['initialAnswer'], 'evening', initial['revision'])
    if type(evidence['initialPin']['tokens']) is not int or not 0 <= evidence['initialPin']['tokens'] <= 2048:
        raise ValueError('Initial consumed pin token proof missing')
    b = new_authored_chat(run, 'Authored morning correction')
    evidence['stage'] = 'explicit-correction'
    evidence['correctionAnswer'] = timing_answer(run, envelope, b, MORNING_CORRECTION)
    assert_timing_answer(evidence['correctionAnswer'], 'morning', allow_revoked_diagnostics=True)
    evidence['correctionUsageUnavailableDueToRevocation'] = not evidence['correctionAnswer']['providerCalls']
    evidence['oldPinRevokedAtCorrection'] = revoked_pin(run, a)
    if not evidence['oldPinRevokedAtCorrection']:
        raise ValueError('Correction failed to revoke older consumed pin')
    # Two real completions follow the four authored sources; normal scheduling
    # and low-volume debounce remain unchanged, no artificial tick or clock.
    evidence['stage'] = 'corrected-publication'
    corrected = evidence['correctedSummary'] = wait_summary(run, 6)
    evidence['correctedSummaryText'] = current_summary_text(run)
    if corrected['revision'] <= initial['revision'] or not re.search(r'\bmornings?\b', evidence['correctedSummaryText'], re.I):
        raise ValueError('Corrected preference was not published')
    c = new_authored_chat(run, 'Authored current morning pin')
    evidence['currentAnswer'] = timing_answer(run, envelope, c, TIMING_QUESTION)
    evidence['currentPin'] = pin(run, c)
    assert_timing_answer(evidence['currentAnswer'], 'morning', corrected['revision'])
    evidence['stage'] = 'explicit-profile-precedence'
    status, profile = api(run, 'GET', '/api/profile')
    if status != 200 or not isinstance(profile.get('constraints'), list):
        raise ValueError('Synthetic Profile unavailable')
    status, saved = api(run, 'POST', '/api/profile', {
        'constraints': [*profile['constraints'], 'Weekday lunchtime is my explicit current training-time constraint.']})
    if status != 200 or saved.get('ok') is not True:
        raise ValueError('Explicit synthetic Profile save failed; no retry')
    evidence['currentPinRevokedAtProfile'] = revoked_pin(run, c)
    if not evidence['currentPinRevokedAtProfile']:
        raise ValueError('Profile save failed to revoke current pin')
    evidence['profileAnswer'] = timing_answer(run, envelope, a, PROFILE_TIMING_QUESTION)
    assert_timing_answer(evidence['profileAnswer'], 'profile')
    if (evidence['profileAnswer']['context'] or {}).get('summaryRevision') is not None:
        raise ValueError('Revoked summary still consumed after Profile change')
    evidence['originalMessagesUnchanged'] = original_controls_messages(run) == original
    if not evidence['originalMessagesUnchanged']:
        raise ValueError('Correction/Profile changed original seed messages')
    identity = run.http('/identity')
    receipt['credentialSourceUnchanged'] = run.accept_identity(identity) and identity.get('providerSourceUnchanged') is True
    run.stop()
    run.verify_settled()
    evidence['stage'] = 'complete'
    receipt['notProved'] = ['M28 baseline comparison', 'live outage/in-flight interruption',
                            'native compaction', 'post-import answer/restart', 'primary activation']


def compaction_observation(run, conversation):
    with contextlib.closing(readonly(run.database)) as db:
        segment = db.execute('select revision,covered_through,compact_sha256,compact_characters,compact from conversation_segment where conversation_id=?', (conversation,)).fetchone()
        rows = db.execute('select id,role,content from message where conversation_id=? order by rowid limit 128', (conversation,)).fetchall()
        spent = db.execute('select coalesce(sum(attempts),0),coalesce(sum(reserved_usd),0) from conversation_compaction_spend').fetchone()
    if not segment or len(rows) != 128:
        raise ValueError('Exact authored long-history inventory required')
    compact = segment[4]
    if len(compact) > 6000 or re.search(r'(sk-|https?://|/Users/|@)', compact):
        compact = '[screened authored compact withheld]'
    return {'revision': segment[0], 'coveredThrough': segment[1], 'compactHash': segment[2],
            'characters': segment[3], 'compactText': compact, 'originalMessagesSha256': hashlib.sha256(json.dumps(rows).encode()).hexdigest(),
            'attempts': spent[0], 'reservedUsd': spent[1]}


def second_option_preserved(answer):
    text = re.sub(r'["“”]', '', answer['excerpt'].lower()).replace('-', ' ')
    label = r'(?:second option|option two|option 2)'
    return bool(re.search(r'\b' + label + r'\b\s*(?:(?:was|is|means|meant|refers to|referred to)\s+)?[:—–,-]*\s*(?:the\s+)?(?:approach of\s+)?short weekday', text)
                or re.search(r'\bshort weekday (?:walks|sessions)[^.!?]{0,70}\b(?:was|were|is|are) (?:the |our )?(?:early |original )?' + label + r'\b', text))


def assert_compaction(before, after, answer, projected):
    assert_answer(answer, projected)
    if not second_option_preserved(answer):
        raise ValueError('Early second option mapping lost or inverted')
    if (before['coveredThrough'] != 0 or after['coveredThrough'] <= 0
            or after['revision'] <= before['revision'] or not re.fullmatch('[a-f0-9]{64}', after['compactHash'])
            or not 0 < after['characters'] <= 6000 or after['attempts'] != before['attempts'] + 1
            or abs(after['reservedUsd'] - before['reservedUsd'] - .01) > 1e-9
            or after['originalMessagesSha256'] != before['originalMessagesSha256']):
        raise ValueError('Actual compaction/adoption/preservation proof failed')


def run_compaction(run, envelope, receipt):
    evidence = receipt['compaction'] = {'stage': 'activation'}
    original = original_controls_messages(run)
    conversation = 'T0272-' + run.id + '-long'
    evidence['before'] = compaction_observation(run, conversation)
    if not revoked_pin(run, conversation):
        raise ValueError('Long-history case must start with no usable global pin')
    envelope.claim('boot')
    run.activity_deadline = time.monotonic() + 300
    run.start(run.binary, timeout=100)
    status, _ = api(run, 'PATCH', '/api/model-settings', {'modelId': CATALOG_ID})
    if status != 200:
        raise ValueError('Exact Luna selection refused')
    evidence['stage'] = 'publish-independent-global-summary'
    evidence['initialSummary'] = wait_summary(run, 20)
    evidence['initialSummaryText'] = current_summary_text(run)
    if not meaning_passed(evidence['initialSummary']) or not revoked_pin(run, conversation):
        raise ValueError('Ordinary publication must not replace the old null pin')
    evidence['stage'] = 'real-local-compaction-and-answer'
    evidence['answer'] = timing_answer(run, envelope, conversation, QUESTION + ' Also explain our early second option.')
    evidence['after'] = compaction_observation(run, conversation)
    evidence['pin'] = pin(run, conversation)
    evidence['earlySecondOptionCorrect'] = second_option_preserved(evidence['answer'])
    assert_compaction(evidence['before'], evidence['after'], evidence['answer'], evidence['pin'])
    restart_owned(run, envelope, receipt)
    if compaction_observation(run, conversation) != evidence['after'] or pin(run, conversation) != evidence['pin']:
        raise ValueError('Compacted segment or pin changed across restart')
    evidence['compactedSegmentAndPinSurviveRestart'] = True
    evidence['latestSummary'] = observe_summary(run)
    if not evidence['initialSummary']['revision'] <= evidence['pin']['revision'] <= evidence['latestSummary']['revision']:
        raise ValueError('Compaction adopted an unrelated summary revision')
    evidence['originalMessagesUnchanged'] = original_controls_messages(run) == original
    if not evidence['originalMessagesUnchanged']:
        raise ValueError('Compaction changed original global sources')
    identity = run.http('/identity')
    receipt['credentialSourceUnchanged'] = run.accept_identity(identity) and identity.get('providerSourceUnchanged') is True
    run.stop()
    run.verify_settled()
    evidence['stage'] = 'complete'
    receipt['notProved'] = ['M28 baseline comparison', 'live outage/in-flight interruption',
                            'primary activation']


@resources.invocation
def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--scratch', required=True)
    parser.add_argument('--bundle', required=True)
    parser.add_argument('--approved-integrated-memory-tests-usd200', action='store_true', required=True)
    parser.add_argument('--continue-receipt', help='Exact settled receipt; every original reservation remains consumed')
    parser.add_argument('--case', choices=('lineage', 'controls', 'correction', 'compaction'), default='lineage')
    parser.add_argument('--continue-settled-success', action='store_true', help='Explicit ledger-only continuation after success; never reconstruct/reseed that lineage')
    parser.add_argument('--approved-reallocation-usd500', action='store_true', help='Historical seven/seven additive allocation; USD5 total, not additional')
    parser.add_argument('--approved-budget-only-usd500', action='store_true', help='Operator removed count caps; USD5 cumulative total including every prior reservation')
    parser.add_argument('--approved-budget-usd100', action='store_true', help='Explicit USD100 cumulative Luna approval; retains all prior reservations and no count caps')
    parser.add_argument('--resume-lineage-disposition', help='Exact retained resource disposition for the settled four-round authored copy')
    args = parser.parse_args()
    args.approved_budget_only_usd500 |= args.approved_budget_usd100
    if args.case != 'lineage' and args.resume_lineage_disposition:
        raise ValueError('Controls require fresh authored input, not lineage recovery')
    if args.continue_settled_success and args.case == 'lineage':
        raise ValueError('Successful continuation is ledger-only for a distinct finite case')
    if args.resume_lineage_disposition and (not args.continue_receipt or not (args.approved_reallocation_usd500 or args.approved_budget_only_usd500)):
        raise ValueError('Lineage continuation requires approved additive scope and exact prior receipt')
    os.umask(0o077)
    evidence = private_directory(resources.configure(canonical(args.scratch)))
    bundle = canonical(args.bundle)
    inventory, source = audit(bundle), source_identity()
    if json.loads((bundle / 'Contents/Resources/resources/provenance.json').read_text()).get('sourceFingerprint') != source:
        raise ValueError('Current exact-source ordinary artifact required')
    artifact = hashlib.sha256(json.dumps(inventory, sort_keys=True).encode()).hexdigest()
    envelope = Envelope(evidence, {'source': source, 'artifact': artifact}, args.continue_receipt,
                        args.approved_reallocation_usd500 or args.approved_budget_only_usd500,
                        allow_settled_success=args.continue_settled_success, budget_only=args.approved_budget_only_usd500,
                        approved_usd100=args.approved_budget_usd100)
    resuming = args.resume_lineage_disposition is not None
    controls = args.case == 'controls'
    correction = args.case == 'correction'
    compaction = args.case == 'compaction'
    batches = ([(5, 9), (9, 11)] if resuming else [(1, 5), (5, 9), (9, 11)]) if args.case == 'lineage' else []
    required_chats = {'controls': 2, 'correction': 4, 'compaction': 1, 'lineage': 2 if resuming else 3}[args.case]
    required_boots = len(batches) if args.case == 'lineage' else {'controls': 3, 'compaction': 2, 'correction': 1}[args.case]
    if not envelope.has_capacity(required_boots, required_chats):
        raise ValueError('Insufficient remaining bounded effects; no partial relaunch')
    prepared = (RetainedLineage(evidence, args.resume_lineage_disposition, args.continue_receipt) if resuming else
                prepare(evidence, argparse.Namespace(task_id='T0272', input_file=None, grant_file=None, provenance_file=None, anchor=None), 'ordinary'))
    run, observer = None, None
    receipt = {'purpose': PRESET, 'source': source, 'artifact': artifact, 'scenarioPassed': False,
               'syntheticOnly': True, 'credentialReadback': False, 'case': args.case, 'rounds': [], 'captures': [],
               'credentialSourceUnchanged': 'unavailable-before-activation', 'allOwnedProcessesSettled': False,
               'pricing': {'standardInputPerMillionUsd': .10, 'outputPerMillionUsd': .50,
                           'worstCacheWritePerMillionUsd': .25, 'reviewed': '2026-11-04'},
               'notProved': ['M28 baseline comparison', 'live correction/outage/import', 'title while Off', 'primary activation']}
    if resuming:
        receipt['continuedLineage'] = prepared.proof
        receipt['rounds'] = list(prepared.rounds)
    stage = 'preparation'
    try:
        run = OrdinaryRun(evidence, prepared.database, source, bundle, inventory)
        receipt['runId'] = run.id
        run.before_start = prepared.verify_current
        configure(run, seed=not resuming, scenario=args.case)
        if resuming and run.original != prepared.original:
            raise ValueError('Continuation copy differs from retained logical snapshot')
        run.descriptor['providerSmoke'] = PRESET
        observer = Observer(evidence)
        run.observer = observer
        snapshots = dict(prepared.snapshots) if resuming else {}
        first_conversation = next(iter(snapshots), None)
        if controls:
            stage = 'off-title-selected-import'
            run_controls(run, envelope, receipt)
        if correction:
            stage = 'correction-profile-precedence'
            run_correction(run, envelope, receipt)
        if compaction:
            stage = 'local-compaction-adopts-summary'
            run_compaction(run, envelope, receipt)
        for start, end in batches:
            envelope.claim('boot')
            run.activity_deadline = time.monotonic() + 300
            stage = 'native-activation-' + str(start)
            run.start(run.binary, timeout=100)
            if any(pin(run, conversation) != saved for conversation, saved in snapshots.items()):
                raise ValueError('Sealed consumed pins changed across owned restart')
            if snapshots:
                receipt['restartRetainsExactPins'] = True
            status, _ = api(run, 'PATCH', '/api/model-settings', {'modelId': CATALOG_ID})
            if status != 200:
                raise ValueError('Exact Luna chat selection refused')
            for number in range(start, end):
                stage = 'summary-round-' + str(number)
                frontier = number * 20 if number < 10 else SEED_COMPLETIONS + 2
                observed = wait_summary(run, frontier)
                entry = {'round': number, 'summary': observed}
                receipt['rounds'].append(entry)
                if not meaning_passed(observed):
                    raise ValueError('Summary lost required source meaning')
                committed = [attempt for attempt in observed['attempts'] if attempt['outcome'] == 'committed']
                entry['observedRound'] = len(committed)
                expected_counts = [20] * min(len(committed), 9) + ([6] if len(committed) == 10 else [])
                if (not number <= len(committed) <= 10
                        or [attempt['sourceCount'] for attempt in committed] != expected_counts
                        or (number in ANSWER_ROUNDS and len(committed) != number)):
                    raise ValueError('Incremental source coverage/required oracle round mismatch')
                if any(pin(run, conversation) != saved for conversation, saved in snapshots.items()):
                    raise ValueError('Ordinary publication replaced a consumed pin')
                if number not in ANSWER_ROUNDS:
                    continue
                conversation = 'T0272-' + str(uuid.uuid4())
                status, created = api(run, 'POST', '/api/conversations', {'id': conversation, 'title': 'Authored lineage round ' + str(number)})
                if status != 200 or created.get('conversation', {}).get('id') != conversation or pin(run, conversation)['revision'] != observed['revision']:
                    raise ValueError('Explicit new-chat freeze failed')
                if first_conversation is None:
                    first_conversation = conversation
                stage = 'answer-round-' + str(number)
                started = time.monotonic()
                status, body = api(run, 'POST', '/api/chat', {'conversationId': conversation, 'message': QUESTION, 'stream': False}, envelope)
                entry['answer'] = answer_observation(status, body, time.monotonic() - started)
                entry['pin'] = pin(run, conversation)
                assert_answer(entry['answer'], entry['pin'])
                snapshots[conversation] = entry['pin']
            identity = run.http('/identity')
            receipt['credentialSourceUnchanged'] = run.accept_identity(identity) and identity.get('providerSourceUnchanged') is True
            if not receipt['credentialSourceUnchanged']:
                raise ValueError('Credential source changed')
            if end == 11:
                stage = 'explicit-refresh'
                status, meta = api(run, 'GET', '/api/cross-chat-summary')
                with contextlib.closing(readonly(run.database)) as db:
                    revision = db.execute('select revision from conversation_segment where conversation_id=?', (first_conversation,)).fetchone()[0]
                if status != 200:
                    raise ValueError('Refresh authority unavailable')
                status, _ = api(run, 'POST', '/api/cross-chat-summary', {'version': 1, 'expected': meta['expected'], 'action': 'refresh',
                                  'conversationId': first_conversation, 'segmentRevision': revision})
                refreshed = pin(run, first_conversation)
                if status != 200 or refreshed['revision'] != meta['revision'] or refreshed['seal'] == snapshots[first_conversation]['seal']:
                    raise ValueError('Explicit Refresh failed to adopt latest')
                receipt['explicitRefreshAdoptsLatest'] = True
            run.stop()
            run.verify_settled()
        if source_identity() != source or audit(bundle) != inventory:
            raise ValueError('Source/artifact changed during scenario')
        receipt['scenarioPassed'] = True
    finally:
        with resources.preserve_failure():
            receipt['lastStage'] = stage
            receipt['claims'] = envelope.claims
            receipt['reservedMilliUsd'] = envelope.total
            if run and run.child is not None:
                try:
                    identity = run.http('/identity')
                    receipt['credentialSourceUnchanged'] = run.accept_identity(identity) and identity.get('providerSourceUnchanged') is True
                except Exception:
                    receipt['credentialSourceUnchanged'] = 'unavailable-before-owned-shutdown'
            errors = []
            if run:
                try:
                    run.stop()
                    run.verify_settled()
                except Exception as error:
                    errors.append(type(error).__name__)
            if run:
                try:
                    receipt['lastSummary'] = observe_summary(run)
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
            private_json(evidence / ('integrated-memory-live-' + str(uuid.uuid4()) + '.json'), receipt)
            if errors:
                raise RuntimeError('Owned settlement failed; preserve diagnostics')
    print(json.dumps({'scenarioPassed': receipt['scenarioPassed'], 'reservedMilliUsd': envelope.total, 'credentialReadback': False}))
    if not receipt['scenarioPassed']:
        raise RuntimeError('Integrated lineage or preservation gate failed')


if __name__ == '__main__':
    signal.signal(signal.SIGTERM, lambda *_: (_ for _ in ()).throw(KeyboardInterrupt('Owned integrated test interrupted')))
    try:
        main()
    except Exception as error:
        print('Finite integrated scenario failed: ' + type(error).__name__ + '; retain receipt and claims, never blindly replay.')
        raise SystemExit(1) from None
