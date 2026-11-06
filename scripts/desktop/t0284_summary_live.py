#!/usr/bin/env python3
"""T0284 ONLY: one actual-derived whole rebuild plus one private Luna quality assessment.

Not a generic fixture/grant/budget service. No default paid effects, seed, title/chat,
primary activation, raw-content output, credential readback, blind replay or cleanup.
Changed-hypothesis runs require new immutable owned-run claims; verified returned usage
can settle a prospective reservation, never refund charges or zero unknown effects.
"""
import argparse
import contextlib
import fcntl
import hashlib
import http.client
import json
import math
import os
from pathlib import Path
import subprocess
import time
import uuid

from native_smoke import REPO, Observer, canonical, fingerprint, private_json, readonly, source_identity
from ordinary_smoke import OrdinaryRun
from ordinary_identity import ordinary_preparation, inventory_hash, verify_ordinary
from release_smoke import audit
from integrated_memory_live import configure, request_deadline, PRESET
from smoke_input import private_directory, private_file
import smoke_resources as resources

TASK = 'T0284-replace-memory-ledger-with-one-summary'
CEILING_CENTS = 5000  # Genuine D3 approval; includes every previous task effect/claim.
CALL_CENTS = 137  # Official full model maxima + long/cache/Fast/regional premiums, rounded UP.
MAX_SECONDS = 760
KINDS = {'main': 'main-claim.json', 'quality': 'quality-claim.json'}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def document(path):
    def unique(pairs):
        value = {}
        for key, item in pairs:
            if key in value:
                raise ValueError('Duplicate private record key refused')
            value[key] = item
        return value
    result = json.loads(private_file(path, 128 * 1024)[1], object_pairs_hook=unique)
    if not isinstance(result, dict):
        raise ValueError('Bounded private object required')
    return result


def authority(task):
    task = canonical(task)
    if task.name != TASK or task.parent.name != 'E0007-ai-garmin-connect-trainer':
        raise ValueError('Exact T0284 task required')
    plan = (task / 'plan.md').read_bytes()
    if len(plan) > 128 * 1024 or any(text not in plan.decode() for text in (
            'actual Garmin Trainer SQLite database', 'direct OpenAI `gpt-6-luna` ONLY',
            'USD50 TOTAL', 'approved.. $50', 'whole batch of messages must succeed')):
        raise ValueError('Current genuine task input/export/spend contract unavailable')
    controls = json.loads((task / 'kanban.json').read_text())
    scheduler = controls.get('scheduler') or {}
    if scheduler.get('stopRequested') or scheduler.get('pauseRequested') or scheduler.get('runState') != 'running':
        raise ValueError('Current worker controls refuse effects')
    if controls.get('modeType') != 'Dispatcher-managed' or controls.get('autonomyLevel') != 'A3' or any(controls.get(key) for key in ('forbiddenActions', 'stopConditions', 'guardrails')) or controls.get('timeBudget') is not None:
        raise ValueError('Changed task controls require worker reconciliation')
    if controls.get('hitlGates') != {'deployRelease': False, 'qaManualSmoke': False, 'reviewPr': False}:
        raise ValueError('Changed task gates require worker reconciliation')
    if not isinstance(scheduler.get('runId'), str) or not scheduler['runId']:
        raise ValueError('Exact running worker identity required')
    return {'task': TASK, 'planSha256': digest(plan), 'runId': scheduler.get('runId'), 'ownerSession': controls.get('ownerSession'),
            'provider': 'openai', 'model': 'gpt-6-luna', 'ceilingCents': CEILING_CENTS}


def safe_database(path, *, live_original=False):
    private_file(path, 512 * 1024 * 1024)
    for suffix in ('-wal', '-shm', '-journal'):
        sidecar = Path(str(path) + suffix)
        if sidecar.exists() or sidecar.is_symlink():
            private_file(sidecar, 512 * 1024 * 1024, allow_empty=True)
            if suffix == '-journal':
                raise ValueError('Rollback journal refuses read/recovery')
    if not live_original and Path(str(path) + '.trainer-writer').exists():
        raise ValueError('Borrowed input still has a writer; no owner override')


def original_history(database):
    rows = [database.execute('select * from conversation order by id').fetchall(),
            database.execute('select id,conversation_id,role,content,created_at from message order by id').fetchall()]
    return digest(json.dumps(rows, separators=(',', ':'), ensure_ascii=False).encode())


def primary_preserved(evidence, expected_history):
    selected = document(evidence / 'native-selection.json')
    previous = document(evidence / 'compatibility-inventory.json')
    path = canonical(selected['database'])
    # Only the legitimate native-selected original, never discovery or a writable constructor.
    safe_database(path, live_original=True)
    with contextlib.closing(readonly(path)) as database:
        if fingerprint(database) != previous['original'] or original_history(database) != expected_history:
            raise ValueError('Primary input/copy changed; fresh whole-history inventory required')


def qualify(counts, routine, configured_model='gpt-6-luna'):
    if type(counts) is not int or not 1 <= counts <= 10000 or type(routine) is not int or routine != 0 or configured_model != 'gpt-6-luna':
        raise ValueError('Finite count/zero-backlog/direct-Luna admission refused')
    calls = 2 * math.ceil(counts / 40)  # First draft + at most one known-oversize condensation.
    if (calls + 1) * CALL_CENTS > CEILING_CENTS:
        raise ValueError('Whole proof plus private assessment exceeds cumulative authority')
    return calls


def exclusive(path, value):
    # A partial/unknown record remains a refusal, never overwritten or refunded.
    private_json(path, value)
    with path.open('rb') as stream:
        os.fsync(stream.fileno())
    descriptor = os.open(path.parent, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def claim(root, binding, kind, calls, *, directory=None, prior_cents=0):
    if kind not in KINDS or type(calls) is not int or calls < 1:
        raise ValueError('Unknown task effect refused')
    if type(prior_cents) is not int or not 0 <= prior_cents <= CEILING_CENTS:
        raise ValueError('Unknown prior task liability')
    directory = directory or root / 't0284-live-budget'
    if not directory.exists():
        directory.mkdir(mode=0o700)
    private_directory(directory)
    allowed = {'authority.json', *KINDS.values(), 'settlement.json', 'settled-main.json', 'quality.json', 'quality-failure.json', 't0284-quality-dispatch.json'}
    if any(path.name not in allowed for path in directory.iterdir()):
        raise ValueError('Unreconciled task cumulative record refused')
    admitted = directory / 'authority.json'
    if admitted.exists():
        if document(admitted) != binding:
            raise ValueError('Changed task authority/source/artifact refused; preserve old claims')
    else:
        if any(directory.iterdir()):
            raise ValueError('Missing cumulative authority refused')
        exclusive(admitted, binding)
    if calls != (binding['maxMainCalls'] if kind == 'main' else 1):
        raise ValueError('Changed fixed task effect scope refused')
    previous = []
    for expected_kind, name in KINDS.items():
        if not (directory / name).exists():
            continue
        entry = document(directory / name)
        expected_calls = binding['maxMainCalls'] if expected_kind == 'main' else 1
        if set(entry) != {'kind', 'calls', 'reservedCents', 'bindingSha256'} or entry['kind'] != expected_kind or type(entry['calls']) is not int or entry['calls'] != expected_calls or type(entry['reservedCents']) is not int or entry['reservedCents'] != entry['calls'] * CALL_CENTS or entry['bindingSha256'] != digest(json.dumps(binding, sort_keys=True).encode()):
            raise ValueError('Unknown/altered cumulative liability refused')
        previous.append(entry)
    if kind == 'quality' and not any(entry['kind'] == 'main' for entry in previous):
        raise ValueError('Private quality effect requires retained main claim')
    if (directory / KINDS[kind]).exists():
        raise ValueError('Effect already claimed; reconcile retained result, never repeat')
    if prior_cents + sum(entry['reservedCents'] for entry in previous) + calls * CALL_CENTS > CEILING_CENTS:
        raise ValueError('Task cumulative spending ceiling reached')
    value = {'kind': kind, 'calls': calls, 'reservedCents': calls * CALL_CENTS,
             'bindingSha256': digest(json.dumps(binding, sort_keys=True).encode())}
    exclusive(directory / KINDS[kind], value)
    return prior_cents + sum(entry['reservedCents'] for entry in previous) + value['reservedCents']


def known_main_settlement(evidence, binding, observation):
    """Only verified returned usage settles a reservation. No refund/unknown-zero."""
    run = canonical(observation['runRoot'])
    if run.parent != evidence.parent / 'disposable' or run.name != 'ordinary-' + str(uuid.UUID(run.name[9:])):
        raise ValueError('Exact owned closed run required')
    receipt = canonical(observation['receipt'])
    if receipt.parent != evidence or not receipt.name.startswith('t0284-real-history-'):
        raise ValueError('Exact retained run observation required')
    result = document(receipt)
    if result.get('source') != binding['source'] or result.get('artifact') != binding['artifact']:
        raise ValueError('Receipt/source binding changed')
    identity = document(run / 'native-identity-1.json')
    shutdown = document(run / 'shutdown-1.json')
    if (result.get('allOwnedProcessesSettled') is not True or result.get('primaryWrite') is not False
            or identity.get('runId') != run.name[9:] or identity.get('source') != binding['source']
            or identity.get('artifactInventoryHash') != binding['artifact'] or identity.get('providerSourceUnchanged') is not True
            or identity.get('database') != str(run / 'trainer.sqlite') or shutdown.get('nativeReaped') is not True
            or shutdown.get('endpointsAndLeaseSettled') is not True):
        raise ValueError('Native closure/source accounting is not proven')
    reference = canonical(document(evidence / 'actual-history-review.json')['copy'])
    if not reference.is_relative_to(evidence.parent / 'disposable'):
        raise ValueError('Foreign accounting reference')
    safe_database(reference); safe_database(run / 'trainer.sqlite')
    with contextlib.closing(readonly(reference)) as before, contextlib.closing(readonly(run / 'trainer.sqlite')) as after:
        if fingerprint(before)['logicalHash'] != binding['inputLogicalHash'] or original_history(after) != result['originalHistorySha256']:
            raise ValueError('Original/input accounting changed')
        if before.execute('select * from conversation_title_attempt order by rowid').fetchall() != after.execute('select * from conversation_title_attempt order by rowid').fetchall():
            raise ValueError('Unaccounted title effect; retain full reservation')
        previous = {row[0] for row in before.execute('select job_id from summary_attempt')}
        attempts = [row for row in after.execute('select job_id,outcome,usage_json from summary_attempt order by job_id') if row[0] not in previous]
        if not 0 < len(attempts) <= binding['maxMainCalls'] or after.execute("select 1 from summary_rebuild where state='active'").fetchone():
            raise ValueError('Unknown/in-flight dispatch scope')
        input_tokens = output_tokens = 0
        for _, outcome, raw in attempts:
            usage = json.loads(raw) if raw else {}
            if outcome not in ('staged', 'committed', 'summary_invalid_output') or any(type(usage.get(key)) is not int for key in ('input', 'output', 'cached')) or not (0 < usage['input'] <= 1050000 and 0 < usage['output'] <= 128000 and 0 <= usage['cached'] <= usage['input']):
                raise ValueError('Unknown returned usage; retain full reservation')
            input_tokens += usage['input']; output_tokens += usage['output']
    # All input at worst documented cache/long/Fast/regional rates; no cache discount.
    upper = (input_tokens * 110 + output_tokens * 165 + 999999) // 1000000
    return {**observation, 'attempts': len(attempts), 'attemptsSha256': digest(json.dumps(attempts).encode()),
            'inputTokens': input_tokens, 'outputTokens': output_tokens, 'upperCents': upper,
            'purpose': 'Known returned usage settlement, not invoice/refund; original claims remain immutable'}


def amended_prior_authority(evidence, directory, admitted, binding):
    """Only the recorded genuine D3 amendment links immutable USD20 history to USD50."""
    approval = document(evidence / 'd3-approved-grant.json')
    link = document(evidence / 'd3-current-plan.json')
    if (approval.get('operatorReply') != 'approved.. $50' or approval.get('resumeReply') != 'resume work'
            or approval.get('task') != TASK or approval.get('previousCeilingCents') != 2000
            or approval.get('ceilingCents') != CEILING_CENTS or admitted.get('ceilingCents') != 2000
            or binding.get('ceilingCents') != CEILING_CENTS
            or approval.get('previousPlanSha256') != admitted.get('planSha256')
            or link.get('planSha256') != binding.get('planSha256')
            or link.get('approvalSha256') != digest((evidence / 'd3-approved-grant.json').read_bytes())
            or digest((directory / 'authority.json').read_bytes()) not in approval.get('priorAuthoritySha256', [])):
        raise ValueError('Changed authority is not the actual recorded D3 amendment')


def scoped_claim(evidence, binding, kind, calls, scope):
    """T0284 cumulative ledger only. One fixed main/judge pair per owned run."""
    if str(uuid.UUID(scope)) != scope:
        raise ValueError('Owned run UUID required')
    budget = evidence / 't0284-live-budget'
    budget.mkdir(mode=0o700, exist_ok=True); private_directory(budget)
    lock = budget / 'budget.lock'
    descriptor = os.open(lock, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        private_file(lock, 1, allow_empty=True)
        held, named = os.fstat(descriptor), lock.stat()
        if (held.st_dev, held.st_ino) != (named.st_dev, named.st_ino):
            raise ValueError('Budget lock changed')
        fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        directories = []
        root_files = {'authority.json', *KINDS.values(), 'settlement.json', 'budget.lock'}
        for path in budget.iterdir():
            if path.name in root_files:
                if path.is_dir() or path.is_symlink(): raise ValueError('Foreign budget record')
            elif path.is_dir() and not path.is_symlink() and str(uuid.UUID(path.name)) == path.name:
                private_directory(path)
                if path.name != scope: directories.append(path)
            else: raise ValueError('Unknown task cumulative record')
        if (budget / 'authority.json').exists(): directories.append(budget)
        elif any((budget / name).exists() for name in KINDS.values()): raise ValueError('Partial legacy claim')
        prior = 0
        for directory in directories:
            admitted = document(directory / 'authority.json')
            if (admitted.get('planSha256'), admitted.get('ceilingCents')) != (binding.get('planSha256'), binding.get('ceilingCents')):
                amended_prior_authority(evidence, directory, admitted, binding)
            for key in ('task', 'runId', 'ownerSession', 'provider', 'model', 'inputLogicalHash', 'retainedUsers', 'includedUsers', 'maxMainCalls', 'modelReferenceSha256', 'pricingReferenceSha256'):
                if admitted.get(key) != binding.get(key): raise ValueError('Different genuine grant/input/price reference')
            allowed = root_files if directory == budget else {'authority.json', *KINDS.values(), 'settlement.json', 'settled-main.json', 'quality.json', 'quality-failure.json', 't0284-quality-dispatch.json'}
            if any(p.name not in allowed and not (directory == budget and p.is_dir()) for p in directory.iterdir()): raise ValueError('Unknown scoped record')
            for purpose, name in KINDS.items():
                path = directory / name
                if not path.exists():
                    if purpose == 'main': raise ValueError('Partial scope without main claim')
                    continue
                item = document(path); expected = admitted['maxMainCalls'] if purpose == 'main' else 1
                if type(item.get('calls')) is not int or type(item.get('reservedCents')) is not int or item != {'kind': purpose, 'calls': expected, 'reservedCents': expected * CALL_CENTS, 'bindingSha256': digest(json.dumps(admitted, sort_keys=True).encode())}:
                    raise ValueError('Changed prior claim')
                liability = item['reservedCents']
                if purpose == 'main' and (directory / 'settlement.json').exists():
                    saved = document(directory / 'settlement.json')
                    observation = {key: saved[key] for key in ('runRoot', 'receipt')}
                    verified = known_main_settlement(evidence, admitted, observation)
                    if verified != saved or not 0 < saved['upperCents'] <= liability: raise ValueError('Unverified settlement; no liability reduction')
                    liability = saved['upperCents']
                prior += liability
        current = budget / scope
        if not current.exists():
            if kind != 'main' or prior + (calls + 1) * CALL_CENTS > CEILING_CENTS:
                raise ValueError('Whole next scope plus judge exceeds remaining authority')
        elif not (current / 'main-claim.json').exists():
            raise ValueError('Partial current scope; reconcile, never replay')
        return claim(evidence, binding, kind, calls, directory=current, prior_cents=prior)
    finally:
        os.close(descriptor)


def api(run, task, expected_authority, action=None, **fields):
    if authority(task) != expected_authority or time.monotonic() >= run.activity_deadline:
        raise ValueError('Current authority/deadline changed; no dispatch')
    allowed = {None: set(), 'enable': {'expected'}, 'rebuild-review': {'expected', 'selection'},
               'rebuild-start': {'expected', 'selection', 'id', 'snapshot'}}
    if action not in allowed or set(fields) != allowed[action]:
        raise ValueError('Finite summary-only action/fields refused; no chat/title or retry')
    if 'selection' in fields and fields['selection'] != {'version': 1, 'conversationIds': None, 'includeLegacy': True}:
        raise ValueError('Only the complete approved all-retained/legacy scope is admitted')
    identity = run.http('/identity')
    if not run.accept_identity(identity) or identity.get('providerSourceUnchanged') is not True or run.descriptor.get('providerSmoke') != PRESET:
        raise ValueError('Exact native run/boot/source/opaque route refused')
    connection = http.client.HTTPConnection('127.0.0.1', int(run.origin.rsplit(':', 1)[1]), timeout=8)
    try:
        body = None if action is None else {'version': 2, 'action': action, **fields}
        connection.request('GET' if body is None else 'POST', '/api/cross-chat-summary' + ('?view=content' if body is None else ''),
                           None if body is None else json.dumps(body), {'Content-Type': 'application/json'})
        response = connection.getresponse()
        raw = response.read(512 * 1024 + 1)
        if response.status != 200 or len(raw) > 512 * 1024:
            raise ValueError('Summary action/read refused; no mutation replay')
        return json.loads(raw)
    finally:
        connection.close()


@resources.invocation
def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--scratch', required=True)
    parser.add_argument('--bundle', required=True)
    parser.add_argument('--execute', action='store_true', help='Execute only under the current genuine T0284 contract; absence checks admission only')
    args = parser.parse_args()
    os.umask(0o077)
    task = canonical(os.environ.get('PIVAN_TASK_PATH', ''))
    approved = authority(task)
    root = canonical(args.scratch)
    expected = task.parents[2] / 'tmp' / 'E0007' / 'T0284'
    if root != expected:
        raise ValueError('Exact canonical T0284 scratch required')
    evidence = private_directory(resources.configure(root))
    review = document(evidence / 'actual-history-review.json')
    source_database = canonical(review['copy'])
    if not source_database.is_relative_to(root / 'disposable') or review['paidEffects'] != 0:
        raise ValueError('Exact rehearsed actual-derived copy required')
    safe_database(source_database)
    with contextlib.closing(readonly(source_database)) as db:
        original = fingerprint(db)
        input_history = original_history(db)
        if db.execute('select count(*) from summary_preference').fetchone() != (0,):
            raise ValueError('Actual manual inventory changed; refresh compatibility/authority first')
        users = db.execute("select count(*) from message where role='user'").fetchone()[0]
        routine = db.execute('select count(*) from conversation_completion where event_seq>(select frontier from summary_state)').fetchone()[0]
        if db.execute("select cap from summary_control where id=1").fetchone() != (6000,):
            raise ValueError('Existing finite native preset does not match actual configured character limit')
        if db.execute("select value from app_metadata where key='schema_version'").fetchone() != ('24',) or db.execute('pragma foreign_key_check').fetchone():
            raise ValueError('Current copy schema/integrity/FK admission refused')
    calls = qualify(users, routine)
    if users != review['counts']['userMessages'] or review['selectedCount'] != review['counts']['includedUserMessages']:
        raise ValueError('Changed full input inventory; new review required')
    # Metadata adapter rechecks the native selection without returning a path/key to stdout.
    adapter = evidence / 'native-selection'
    native = root / 'disposable/native-selection-target/debug/t0284-native-selection'
    for path in (native, adapter / 'assessment.ts'):
        if canonical(path) != path:
            raise ValueError('Task native quality owner unavailable')
    if not args.execute:
        print(json.dumps({'admissionOnly': True, 'retainedUsers': users, 'includedUsers': review['selectedCount'], 'maximumCalls': calls,
                          'mainReserveUsd': calls * CALL_CENTS / 100, 'qualityReserveUsd': CALL_CENTS / 100, 'paidEffects': 0}))
        return
    subprocess.run([str(native), '--verify'], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=10)
    primary_preserved(evidence, input_history)
    bundle = canonical(args.bundle)
    source = source_identity()
    inventory = audit(bundle)
    binding = {**approved, 'source': source, 'artifact': inventory_hash(inventory), 'inputLogicalHash': original['logicalHash'],
               'retainedUsers': users, 'includedUsers': review['selectedCount'], 'maxMainCalls': calls,
               'scenarioSha256': digest(Path(__file__).read_bytes()), 'nativeOwnerSha256': digest(native.read_bytes()),
               'assessmentSha256': digest((adapter / 'assessment.ts').read_bytes()),
               'modelReferenceSha256': digest((evidence / 'luna-model-reference.html').read_bytes()),
               'pricingReferenceSha256': digest((evidence / 'openai-developer-pricing.html').read_bytes())}
    receipt = {'task': 'T0284', 'scenarioPassed': False, 'allOwnedProcessesSettled': False, 'primaryWrite': False,
               'credentialReadback': False, 'source': source, 'artifact': binding['artifact'], 'spendCeilingCents': CEILING_CENTS}
    run = None
    observer = None
    path = evidence / ('t0284-real-history-' + str(uuid.uuid4()) + '.json')
    try:
        with ordinary_preparation(REPO, bundle, source, evidence) as (verified, inventory):
            def current():
                if authority(task) != approved:
                    raise ValueError('Current worker authority changed')
                with contextlib.closing(readonly(source_database)) as db:
                    if fingerprint(db) != original:
                        raise ValueError('Borrowed actual-derived input changed')
                verify_ordinary(REPO, bundle, source, inventory)
            run = OrdinaryRun(evidence, source_database, source, bundle, inventory, verified=verified)
            run.before_start = current
            configure(run, seed=False)
            run.descriptor['providerSmoke'] = PRESET
            observer = Observer(evidence, preparation_locked=True)
            run.observer = observer
            before_attempts = None
            with contextlib.closing(readonly(run.database)) as db:
                before_attempts = {row[0] for row in db.execute('select job_id from summary_attempt')}
                before_history = original_history(db)
                receipt['originalHistorySha256'] = before_history
            binding = {**binding, 'proofRunId': run.id}
            receipt.update({'runId':run.id,'runRoot':str(run.root),'database':str(run.database),'budgetScope':run.id})
            receipt['reservedCents'] = scoped_claim(evidence, binding, 'main', calls, run.id)
            run.activity_deadline = time.monotonic() + MAX_SECONDS
            with request_deadline(MAX_SECONDS):
                run.start(run.binary, timeout=80)
                before = api(run, task, approved)
                if before['pending'] != 0:
                    raise ValueError('Unexpected routine backlog; no rebuild dispatch')
                if not before['enabled']:
                    api(run, task, approved, 'enable', expected=before['expected'])
                    before = api(run, task, approved)
                selection = {'version': 1, 'conversationIds': None, 'includeLegacy': True}
                local = api(run, task, approved, 'rebuild-review', expected=before['expected'], selection=selection)['rebuild']
                if not local['ready'] or not local['complete'] or local['counts'] != review['counts'] or local['reasons'] != review['reasons']:
                    raise ValueError('Actual complete input/authority differs from reviewed copy')
                operation = 'T0284-' + str(uuid.uuid4())
                api(run, task, approved, 'rebuild-start', expected=before['expected'], id=operation, snapshot=local['snapshot'], selection=selection)
                progress = []
                while True:
                    value = api(run, task, approved)
                    op = value['rebuild']['operation']
                    if not op or op['id'] != operation:
                        raise ValueError('Operation identity changed; no retry')
                    if not progress or progress[-1] != op['processed']:
                        progress.append(op['processed'])
                    receipt.update({'operationId':operation,'progress':progress,'processed':op['processed'],'counts':local['counts'],'reasons':local['reasons']})
                    if op['state'] != 'active':
                        break
                    if value['stored'] != before['stored'] or value['revision'] != before['revision']:
                        raise ValueError('Partial generated publication refused')
                    time.sleep(.5)  # Local read-only operation observation, no effect replay.
                if op['state'] != 'complete' or op['processed'] != review['selectedCount'] or op['dispositions'] != {'processed': review['selectedCount']} or not value['stored']['text'].strip() or value['revision'] != before['revision'] + 1 or value['preferences'] != before['preferences']:
                    raise ValueError('Whole meaningful bounded publication remains unfinished')
                if value['stored']['version'] != 2 or len(value['stored']['text']) > value['cap']:
                    raise ValueError('Complete text shape/size refused')
                final_identity = run.http('/identity')
                if final_identity.get('providerSourceUnchanged') is not True:
                    raise ValueError('Native credential source changed')
                receipt.update({'runId': run.id, 'runRoot': str(run.root), 'database': str(run.database), 'operationId': operation,
                                'counts': local['counts'], 'reasons': local['reasons'], 'progress': progress, 'processed': op['processed'],
                                'revision': value['revision'], 'characters': len(value['stored']['text']),
                                'summarySha256': digest(json.dumps(value['stored'], separators=(',', ':'), ensure_ascii=False).encode()),
                                'credentialSourceUnchanged': True})
                private_json(evidence / ('t0284-private-final-summary-' + run.id + '.json'), {'purpose': 'Private final result/semantic assessment; never export to coding model or public evidence', 'stored': value['stored']})
            run.stop(); run.verify_settled()
            receipt['allOwnedProcessesSettled'] = True
            with contextlib.closing(readonly(run.database)) as db:
                if original_history(db) != before_history:
                    raise ValueError('Original history changed')
                receipt['originalHistoryPreserved'] = True
                attempts = db.execute('select job_id,outcome,usage_json from summary_attempt').fetchall()
                actual = [row for row in attempts if row[0] not in before_attempts]
                if not math.ceil(review['selectedCount'] / 40) <= len(actual) <= calls or sum(row[1] == 'committed' and not row[0].endswith(':condense') for row in actual) != 1 or any(row[1] not in ('staged', 'committed') for row in actual):
                    raise ValueError('Unexpected or unfinished provider accounting')
                receipt['newAttempts'] = len(actual)
                receipt['usage'] = [json.loads(row[2]) if row[2] else None for row in actual]
            current()
            # Reopen/grade input is an exact settled result, not continuation authority.
            private_json(evidence / 't0284-live-budget' / run.id / 'settled-main.json', receipt)
            receipt['reservedCents'] = scoped_claim(evidence, binding, 'quality', 1, run.id)
            subprocess.run([str(native), '--assess', str(run.root)], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=100)
            quality = document(evidence / 't0284-live-budget' / run.id / 'quality.json')
            receipt['quality'] = quality
            if quality.get('overall') != 'pass':
                raise ValueError('Private quality assessment did not pass; retain actual result')
            current()
            primary_preserved(evidence, input_history)
            receipt['primaryInputUnchanged'] = True
            receipt['scenarioPassed'] = True
    except BaseException as error:
        receipt['failureCategory'] = type(error).__name__  # Never echo raw private input/provider errors.
        raise
    finally:
        try:
            if run is not None:
                run.stop(); run.verify_settled()
            if observer is not None:
                observer.stop(run.pids if run else [])
            receipt['allOwnedProcessesSettled'] = True
        finally:
            # Retain exact actual-derived result for independent local composition evidence.
            # No hold/retention extension or model-owned cleanup.
            resources.retain('Actual-derived result retained for local composition/inspection; configured retention unchanged, no primary copy-back')
            private_json(path, receipt)
            print(json.dumps({'receipt': str(path), 'scenarioPassed': receipt['scenarioPassed'], 'allOwnedProcessesSettled': receipt['allOwnedProcessesSettled'],
                              'reservedUsd': receipt.get('reservedCents', 0) / 100, 'privateContentsPrinted': False}))


if __name__ == '__main__':
    try:
        main()
    except BaseException as error:
        print('T0284 whole-history proof unfinished: ' + type(error).__name__ + '; retained private evidence, no blind retry.')
        raise SystemExit(1)
