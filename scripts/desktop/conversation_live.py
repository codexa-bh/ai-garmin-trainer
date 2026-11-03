#!/usr/bin/env python3
"""Explicit T0269 synthetic live-Luna test. Native owns credentials; never a secret reader."""
import argparse
import contextlib
import http.client
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import uuid

from native_smoke import Observer, canonical, fingerprint, private_json, readonly, source_identity
from ordinary_smoke import OrdinaryRun, audit, private_directory
from smoke_input import prepare, json_document
import smoke_resources as resources

PRESET = 't0269-openai-luna-025'
DOLLAR_PRESET = 't0269-openai-luna-100'
HEADER = {'x-trainer-turn-budget': 'finite-live-smoke'}
MAX_EFFECTS = 3
RESERVE_USD = 0.08


def original_approval():
    return {'purpose': PRESET, 'maximumUsd': 0.25,
            'maximumEffects': MAX_EFFECTS, 'reservePerEffectUsd': RESERVE_USD,
            'source': 'operator approval retained in T0269 plan/trace; not authority invented by this file',
            'unknownOutcomesRemainReserved': True, 'credentialReadback': False}


class PaidEnvelope:
    maximum_effects = MAX_EFFECTS

    def __init__(self, evidence, zero_effect_receipt=None, reserved_effect_receipt=None):
        if zero_effect_receipt and reserved_effect_receipt:
            raise ValueError('Choose one exact reconciliation mode')
        self.root = evidence / 't0269-luna-approved-025'
        prior_effects = 0
        expected = original_approval()
        if zero_effect_receipt is None and reserved_effect_receipt is None:
            # Refuse any pre-existing/unknown claim; never renew approval by rerunning.
            self.root.mkdir(mode=0o700)
            private_json(self.root / 'approval.json', expected)
        else:
            private_directory(self.root)
            proof_path, proof, _, _ = json_document(zero_effect_receipt or reserved_effect_receipt)
            entries = set(os.listdir(self.root))
            prior_effects = len(entries) - 1
            if not 0 <= prior_effects < MAX_EFFECTS or proof_path.parent != evidence or not proof_path.name.startswith('conversation-live-') or entries != {'approval.json', *('effect-' + str(i) + '.json' for i in range(prior_effects))}:
                raise ValueError('Exact retained envelope/receipt required')
            if (zero_effect_receipt is not None and prior_effects != 0) or (reserved_effect_receipt is not None and not 1 <= prior_effects < MAX_EFFECTS):
                raise ValueError('Reconciliation mode/remaining budget mismatch')
            for index in range(prior_effects):
                if json_document(self.root / ('effect-' + str(index) + '.json'))[1] != {
                        'effect': index, 'reservedUsd': RESERVE_USD, 'outcome': 'submitted-or-unknown; never refunded automatically'}:
                    raise ValueError('Unknown or modified claim; no refund/reset')
            if json_document(self.root / 'approval.json')[1] != expected or any(proof.get(key) != value for key, value in {
                    'purpose': PRESET, 'claimedEffects': prior_effects, 'reservedUsd': round(prior_effects * RESERVE_USD, 2), 'scenarioPassed': False,
                    'syntheticOnly': True, 'credentialValueReadback': False, 'inputUnchanged': True}.items()):
                raise ValueError('Mismatched prior receipt; no authority renewal')
            private_json(evidence / ('effect-reconciliation-' + str(uuid.uuid4()) + '.json'),
                         {'priorReceipt': proof_path.name, 'approvalRenewed': False, 'priorEffects': prior_effects,
                          'priorReservedUsd': round(prior_effects * RESERVE_USD, 2), 'unknownsStillReserved': True, 'maximumUsd': 0.25})
        self.effects = prior_effects

    def claim(self):
        if self.effects >= self.maximum_effects:
            raise ValueError('Approved total provider-test envelope exhausted')
        index = self.effects
        private_json(self.root / ('effect-' + str(index) + '.json'),
                     {'effect': index, 'reservedUsd': RESERVE_USD, 'outcome': 'submitted-or-unknown; never refunded automatically'})
        self.effects += 1
        return index


class DollarEnvelope(PaidEnvelope):
    """Additive explicit USD1 approval; original exhausted ledger remains immutable."""
    maximum_effects = 12  # 12 * 0.08 = 0.96 total, INCLUDING the prior three claims.

    def __init__(self, evidence, prior_receipt, continuation=None):
        old = private_directory(evidence / 't0269-luna-approved-025')
        if set(os.listdir(old)) != {'approval.json', 'effect-0.json', 'effect-1.json', 'effect-2.json'}:
            raise ValueError('Exact original exhausted ledger required')
        _, approval, approval_hash, _ = json_document(old / 'approval.json')
        if approval != original_approval():
            raise ValueError('Original authority changed; never rewrite it')
        hashes = []
        for index in range(3):
            _, claim, digest, _ = json_document(old / ('effect-' + str(index) + '.json'))
            if claim != {'effect': index, 'reservedUsd': RESERVE_USD, 'outcome': 'submitted-or-unknown; never refunded automatically'}:
                raise ValueError('Original claim modified; no refund/reset')
            hashes.append(digest)
        path, proof, proof_hash, _ = json_document(prior_receipt)
        required = {'purpose': PRESET, 'claimedEffects': 3, 'reservedUsd': 0.24, 'scenarioPassed': False,
                    'syntheticOnly': True, 'credentialValueReadback': False, 'inputUnchanged': True,
                    'productionCredentialSourceUnchanged': True}
        if path.parent != evidence or not path.name.startswith('conversation-live-') or any(proof.get(key) != value for key, value in required.items()):
            raise ValueError('Exact retained prior failure/authority required')
        expected = {'purpose': DOLLAR_PRESET, 'maximumUsd': 1.0, 'maximumEffectsIncludingPrior': 12,
                    'priorEffects': 3, 'priorReservedUsd': 0.24, 'reservePerEffectUsd': RESERVE_USD,
                    'priorApprovalSha256': approval_hash, 'priorClaimSha256': hashes, 'priorReceiptSha256': proof_hash,
                    'source': 'explicit operator USD1 approval retained in T0269 plan/trace',
                    'unknownOutcomesRemainReserved': True, 'credentialReadback': False}
        self.root = evidence / 't0269-luna-approved-100'
        self.effects = 3
        if continuation is None:
            self.root.mkdir(mode=0o700)  # Existing/unknown scope never renews by replay.
            private_json(self.root / 'approval.json', expected)
        else:
            private_directory(self.root)
            entries = set(os.listdir(self.root))
            self.effects = 3 + len(entries) - 1
            if not 3 <= self.effects < self.maximum_effects or entries != {'approval.json', *('effect-' + str(i) + '.json' for i in range(3, self.effects))}:
                raise ValueError('Unknown/exhausted incremental claims')
            if json_document(self.root / 'approval.json')[1] != expected:
                raise ValueError('Incremental authority chain changed')
            for index in range(3, self.effects):
                if json_document(self.root / ('effect-' + str(index) + '.json'))[1] != {
                        'effect': index, 'reservedUsd': RESERVE_USD, 'outcome': 'submitted-or-unknown; never refunded automatically'}:
                    raise ValueError('Modified incremental claim')
            continued_path, continued, _, _ = json_document(continuation)
            if continued_path.parent != evidence or not continued_path.name.startswith('conversation-live-') or any(continued.get(key) != value for key, value in {
                    **required, 'purpose': DOLLAR_PRESET, 'claimedEffects': self.effects,
                    'reservedUsd': round(self.effects * RESERVE_USD, 2)}.items()):
                raise ValueError('Exact incremental failure receipt required')
            private_json(evidence / ('dollar-reconciliation-' + str(uuid.uuid4()) + '.json'),
                         {'priorReceipt': continued_path.name, 'effectsStillReserved': self.effects,
                          'totalReservedUsd': round(self.effects * RESERVE_USD, 2), 'approvalRenewed': False})


def api(run, method, path, body=None, *, paid=None):
    identity = run.http('/identity')
    if (paid is not None and identity.get('providerSourceUnchanged') is not True) or not run.accept_identity(identity):
        raise ValueError('Exact native source/credential preservation admission required')
    if method == 'POST' and path.split('?', 1)[0] == '/api/chat' and paid is None:
        if not getattr(run, 'keyless_lifecycle', False) or run.descriptor.get('providerSmoke') is not None or identity.get('providerSourceUnchanged') is True:
            raise ValueError('Unreserved chat requires verified credential-free lifecycle scope')
    if paid is not None:
        paid.claim()  # Durable reserve before opening the request socket.
    connection = http.client.HTTPConnection('127.0.0.1', int(run.origin.rsplit(':', 1)[1]), timeout=240)
    try:
        connection.request(method, path, json.dumps(body) if body is not None else None,
                           {'Content-Type': 'application/json', **(HEADER if paid is not None else {})})
        response = connection.getresponse()
        raw = response.read(512 * 1024 + 1)
        if len(raw) > 512 * 1024:
            raise ValueError('Bounded native API result exceeded')
        try:
            result = json.loads(raw)
        except (ValueError, TypeError):
            raise ValueError('Native API result unavailable; do not replay unknown effect') from None
        return response.status, result
    finally:
        connection.close()


def prepare_luna_config(run):
    # Both scopes persist no credentials. Only the separate closed descriptor may borrow one.
    (run.root / 'tokens').mkdir(mode=0o700)
    private_json(run.root / 'config/settings-v3.json', {'version': 3, 'keys': {},
                 'fields': {'DATABASE_PATH': str(run.database), 'AI_PROVIDER': 'openai', 'AI_MODEL': 'gpt-6-luna',
                            'MEMORY_ENABLED': 'false', 'GARMIN_MCP_TOKEN_DIR': str(run.root / 'tokens')},
                 'chatCatalog': {'version': 1, 'defaultEntryId': None, 'entries': [
                     {'id': 'entry_t0269_luna', 'provider': 'openai', 'modelId': 'gpt-6-luna'}]}})


def seed(run, action):
    result = subprocess.run([str(Path(__file__).resolve().parents[2] / 'node_modules/.bin/tsx'),
                             str(Path(__file__).with_name('conversation_seed.ts').resolve()), action, str(run.root)],
                            cwd=Path(__file__).resolve().parents[2], capture_output=True, timeout=30,
                            env={key: value for key, value in {'PATH': os.environ.get('PATH', '/usr/bin:/bin'), 'HOME': os.environ.get('HOME'), 'TMPDIR': str(run.root / 'tmp')}.items() if value is not None})
    if result.returncode:
        raise ValueError('Finite authored journal preparation refused; no source details retained')
    return json.loads(result.stdout)


def state(run, conversation):
    with contextlib.closing(readonly(run.database)) as db:
        row = db.execute('select revision,covered_through,compact_sha256,compact_characters from conversation_segment where conversation_id=?', (conversation,)).fetchone()
        return {'segment': list(row) if row else None,
                'completed': db.execute("select count(*) from conversation_turn where conversation_id=? and status='completed'", (conversation,)).fetchone()[0],
                'manualTitle': db.execute('select manual_title from conversation where id=?', (conversation,)).fetchone()[0] == 1}


def observe_answer(status, body):
    assistant = body.get('assistant', {}) if isinstance(body, dict) else {}
    text = assistant.get('content', '')
    grounding = assistant.get('grounding') or {}
    trace = grounding.get('debugTrace') or {}
    excerpt = text[:480]
    if re.search(r'(sk-|https?://|/Users/|@|[A-Za-z0-9_-]{32,})', excerpt):
        excerpt = '[noncanonical synthetic answer excerpt withheld]'
    return {'httpStatus': status, 'answerCharacters': len(text), 'syntheticAnswerExcerpt': excerpt,
            'retainsShortWeekdays': 'short' in text.lower() and 'week' in text.lower(),
            'retainsTimeRationale': any(word in text.lower() for word in ['time', 'availab']),
            'retainsRejectedAlternative': 'evening' in text.lower(),
            'context': body.get('conversationContext'),
            'providerCalls': [{'purpose': call.get('purpose'), 'tokenUsage': call.get('tokenUsage')} for call in trace.get('providerCalls', [])],
            'tools': [{'tool': step.get('tool'), 'status': step.get('status')} for step in grounding.get('toolSteps', [])]}


@resources.invocation
def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--scratch', required=True)
    parser.add_argument('--bundle', required=True)
    approval = parser.add_mutually_exclusive_group(required=True)
    approval.add_argument('--approved-luna-test-usd025', action='store_true')
    approval.add_argument('--approved-luna-test-usd100', action='store_true')
    parser.add_argument('--prior-envelope-receipt', help='Exact exhausted original0.25 receipt for explicit cumulative USD1 approval')
    parser.add_argument('--reconcile-zero-effect-receipt', help='Exact retained settled preflight receipt; refuses any prior paid claim, never resets budget')
    parser.add_argument('--continue-reserved-effects-receipt', help='Exact diagnosed failure receipt; carries every prior immutable claim, never refunds unknowns or renews approval')
    args = parser.parse_args()
    if args.approved_luna_test_usd100 and (not args.prior_envelope_receipt or args.reconcile_zero_effect_receipt):
        raise ValueError('USD1 approval must chain the exhausted original receipt; never reset it')
    if not args.approved_luna_test_usd100 and args.prior_envelope_receipt:
        raise ValueError('Original0.25 mode cannot consume extended approval')
    os.umask(0o077)
    evidence = private_directory(resources.configure(canonical(args.scratch)))
    bundle = canonical(args.bundle)
    inventory = audit(bundle)
    source = source_identity()
    if json.loads((bundle / 'Contents/Resources/resources/provenance.json').read_text()).get('sourceFingerprint') != source:
        raise ValueError('Current exact-source ordinary artifact required')
    envelope = (DollarEnvelope(evidence, args.prior_envelope_receipt, args.continue_reserved_effects_receipt)
                if args.approved_luna_test_usd100 else PaidEnvelope(evidence, args.reconcile_zero_effect_receipt, args.continue_reserved_effects_receipt))
    preset = DOLLAR_PRESET if args.approved_luna_test_usd100 else PRESET
    maximum_usd = 1.0 if args.approved_luna_test_usd100 else 0.25
    selection = argparse.Namespace(task_id='T0269', input_file=None, grant_file=None, provenance_file=None, anchor=None)
    prepared = prepare(evidence, selection, 'ordinary', synthetic_empty_chat=True)
    run = None
    runs = []
    provider_run = None
    provider_stopped = False
    observer = None
    receipt = {'source': source, 'purpose': preset, 'syntheticOnly': True, 'credentialValueReadback': False,
               'maximumReservedUsd': maximum_usd, 'scenarioPassed': False, 'provider': 'real direct OpenAI gpt-6-luna',
               'realGarmin': 'not authorized/exercised; empty run-local token directory', 'captures': []}
    try:
        run = OrdinaryRun(evidence, prepared.database, source, bundle, inventory)
        runs.append(run)
        provider_run = run
        run.before_start = prepared.verify_current
        prepare_luna_config(run)
        run.descriptor['providerSmoke'] = preset
        authored = seed(run, 'initial')
        conversation = authored['conversationId']
        receipt['authored'] = authored
        observer = Observer(evidence)
        run.observer = observer
        run.start(run.binary)
        status, _ = api(run, 'PATCH', '/api/model-settings', {'modelId': 'entry_t0269_luna'})
        if status != 200 or not state(run, conversation)['manualTitle']:
            raise ValueError('Exact eligible Luna/manual-title configuration required')
        status, body = api(run, 'POST', '/api/chat', {'conversationId': conversation,
                           'message': 'Use the second option from our early fictional discussion. Explain the time rationale and rejected evening alternative. Check only the fictional local Profile if useful; no saves and no Garmin connection. Respond in English.', 'stream': False}, paid=envelope)
        receipt['firstAnswer'] = observe_answer(status, body)
        first = state(run, conversation)
        receipt['afterFirst'] = first
        if status != 200 or not first['segment'] or first['segment'][1] <= 0 or not receipt['firstAnswer']['retainsShortWeekdays'] or not receipt['firstAnswer']['retainsTimeRationale'] or not receipt['firstAnswer']['retainsRejectedAlternative']:
            raise ValueError('Live native continuity/compaction assertion failed; inspect bounded receipt, no blind retry')
        for preset in ['wide', 'narrow']:
            run.command({'type': 'setViewport', 'preset': preset})
            receipt['captures'].append({'stage': 'after-live-compaction', 'preset': preset,
                                        **run.command({'type': 'captureView', 'view': 'trainer', 'preset': preset})})
        if run.http('/identity').get('providerSourceUnchanged') is not True:
            raise ValueError('Production credential source changed; stop affected work')
        run.stop()
        run.start(run.binary)
        if state(run, conversation) != first:
            raise ValueError('Compact boundary/revision changed across owned restart')
        receipt['restartRetainsExactSegment'] = True
        receipt['productionCredentialSourceUnchanged'] = run.http('/identity').get('providerSourceUnchanged') is True
        if not receipt['productionCredentialSourceUnchanged']:
            raise ValueError('Credential source changed before provider shutdown')
        run.stop()
        provider_stopped = True
        # Lifecycle needs no model authority: clone the stopped actual compact state into normal keyless scope.
        run = OrdinaryRun(evidence, provider_run.database, source, bundle, inventory)
        runs.append(run)
        run.before_start = prepared.verify_current
        run.observer = observer
        prepare_luna_config(run)  # No providerSmoke descriptor, keys, fallback model or source lookup.
        run.start(run.binary)
        status, models = api(run, 'GET', '/api/model-settings')
        options = models.get('options', [])
        if status != 200 or models.get('available') is not False or len(options) != 1 or options[0].get('available') is not False or options[0].get('id') != 'entry_t0269_luna' or state(run, conversation) != first:
            raise ValueError('Credential-free exact compact clone/no eligible model required')
        run.keyless_lifecycle = True
        receipt['keylessLifecycle'] = {'sourceRun': provider_run.id, 'run': run.id, 'sameCompactState': True, 'eligibleModels': 0, 'providerEffectClaims': 0}
        # Authored Unicode storage overflow rejects with no eligible provider, not a canned provider result.
        status, _ = api(run, 'POST', '/api/chat', {'conversationId': conversation, 'message': '界' * 12001})
        receipt['overflowHttpStatus'] = status
        if status != 400:
            raise ValueError('Visible-input overflow did not reject honestly')
        status, _ = api(run, 'DELETE', '/api/chat?conversationId=' + conversation)
        receipt['clearHttpStatus'] = status
        after = state(run, conversation)
        receipt['afterClear'] = after
        if status != 200 or (after['segment'] and (after['segment'][1] != 0 or after['segment'][3] != 0)):
            raise ValueError('Native clear did not invalidate compact content')
        with contextlib.closing(readonly(provider_run.database)) as db:
            receipt['providerCopyUnchangedByLifecycle'] = fingerprint(db) == run.original
        if not receipt['providerCopyUnchangedByLifecycle'] or source_identity() != source or audit(bundle) != inventory:
            raise ValueError('Final source/artifact/credential original preservation failed')
        receipt['scenarioPassed'] = True
    finally:
        with resources.preserve_failure():
            receipt['claimedEffects'] = envelope.effects
            receipt['reservedUsd'] = round(envelope.effects * RESERVE_USD, 2)
            if provider_run and not provider_stopped:
                try:
                    identity = provider_run.http('/identity')
                    receipt['productionCredentialSourceUnchanged'] = provider_run.accept_identity(identity) and identity.get('providerSourceUnchanged') is True
                except Exception:
                    receipt['productionCredentialSourceUnchanged'] = 'unavailable-before-owned-shutdown'
                if receipt['productionCredentialSourceUnchanged'] is not True:
                    receipt['scenarioPassed'] = False
            for owned in reversed(runs):
                owned.stop()
            if observer:
                receipt['noninterference'] = observer.stop([pid for owned in runs for pid in owned.pids])
            prepared.verify_current()
            with contextlib.closing(readonly(prepared.database)) as db:
                receipt['inputUnchanged'] = fingerprint(db) == prepared.original
            private_json(evidence / ('conversation-live-' + str(uuid.uuid4()) + '.json'), receipt)
    print(json.dumps({'scenarioPassed': receipt['scenarioPassed'], 'claimedEffects': envelope.effects,
                      'reservedUsd': receipt['reservedUsd'], 'credentialReadback': False}))


if __name__ == '__main__':
    signal.signal(signal.SIGTERM, lambda *_: (_ for _ in ()).throw(KeyboardInterrupt('Owned live test interrupted')))
    try:
        main()
    except Exception as error:
        # No traceback/vendor payload/private path or config/credential output.
        print('Finite live provider scenario failed: ' + type(error).__name__ + '; retain private task evidence, do not replay effects.')
        raise SystemExit(1) from None
