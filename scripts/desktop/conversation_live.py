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
from smoke_input import prepare
import smoke_resources as resources

PRESET = 't0269-openai-luna-025'
HEADER = {'x-trainer-turn-budget': 'finite-live-smoke'}
MAX_EFFECTS = 3
RESERVE_USD = 0.08


class PaidEnvelope:
    def __init__(self, evidence):
        self.root = evidence / 't0269-luna-approved-025'
        # Refuse any pre-existing/unknown claimed envelope; never renew approval by rerunning.
        self.root.mkdir(mode=0o700)
        private_json(self.root / 'approval.json', {'purpose': PRESET, 'maximumUsd': 0.25,
                     'maximumEffects': MAX_EFFECTS, 'reservePerEffectUsd': RESERVE_USD,
                     'source': 'operator approval retained in T0269 plan/trace; not authority invented by this file',
                     'unknownOutcomesRemainReserved': True, 'credentialReadback': False})
        self.effects = 0

    def claim(self):
        if self.effects >= MAX_EFFECTS:
            raise ValueError('Approved total provider-test envelope exhausted')
        index = self.effects
        private_json(self.root / ('effect-' + str(index) + '.json'),
                     {'effect': index, 'reservedUsd': RESERVE_USD, 'outcome': 'submitted-or-unknown; never refunded automatically'})
        self.effects += 1
        return index


def api(run, method, path, body=None, *, paid=None):
    identity = run.http('/identity')
    if identity.get('providerSourceUnchanged') is not True or not run.accept_identity(identity):
        raise ValueError('Exact native source/credential preservation admission required')
    if paid:
        paid.claim()  # Durable reserve before opening the request socket.
    connection = http.client.HTTPConnection('127.0.0.1', int(run.origin.rsplit(':', 1)[1]), timeout=240)
    try:
        connection.request(method, path, json.dumps(body) if body is not None else None,
                           {'Content-Type': 'application/json', **(HEADER if paid else {})})
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
    parser.add_argument('--approved-luna-test-usd025', action='store_true')
    args = parser.parse_args()
    if not args.approved_luna_test_usd025:
        raise ValueError('Explicit actual operator approval required; no automatic credential access')
    os.umask(0o077)
    evidence = private_directory(resources.configure(canonical(args.scratch)))
    bundle = canonical(args.bundle)
    inventory = audit(bundle)
    source = source_identity()
    if json.loads((bundle / 'Contents/Resources/resources/provenance.json').read_text()).get('sourceFingerprint') != source:
        raise ValueError('Current exact-source ordinary artifact required')
    envelope = PaidEnvelope(evidence)
    selection = argparse.Namespace(task_id='T0269', input_file=None, grant_file=None, provenance_file=None, anchor=None)
    prepared = prepare(evidence, selection, 'ordinary', synthetic_empty_chat=True)
    run = None
    observer = None
    receipt = {'source': source, 'purpose': PRESET, 'syntheticOnly': True, 'credentialValueReadback': False,
               'maximumReservedUsd': 0.25, 'scenarioPassed': False, 'provider': 'real direct OpenAI gpt-6-luna',
               'realGarmin': 'not authorized/exercised; empty run-local token directory', 'captures': []}
    try:
        run = OrdinaryRun(evidence, prepared.database, source, bundle, inventory)
        run.before_start = prepared.verify_current
        private_json(run.root / 'config/settings-v3.json', {'version': 3, 'keys': {},
                     'fields': {'DATABASE_PATH': str(run.database), 'AI_PROVIDER': 'openai', 'AI_MODEL': 'gpt-6-luna',
                                'MEMORY_ENABLED': 'false', 'GARMIN_MCP_TOKEN_DIR': str(run.root / 'tokens')},
                     'chatCatalog': {'version': 1, 'defaultEntryId': None, 'entries': [
                         {'id': 'entry_t0269_luna', 'provider': 'openai', 'modelId': 'gpt-6-luna'}]}})
        run.descriptor['providerSmoke'] = PRESET
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
        if status != 200 or not first['segment'] or first['segment'][1] <= 0 or not receipt['firstAnswer']['retainsShortWeekdays'] or not receipt['firstAnswer']['retainsTimeRationale']:
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
        # Authored Unicode storage overflow rejects before any inference, not a fake provider result.
        status, _ = api(run, 'POST', '/api/chat', {'conversationId': conversation, 'message': '界' * 12001}, paid=envelope)
        receipt['overflowHttpStatus'] = status
        if status != 400:
            raise ValueError('Visible-input overflow did not reject honestly')
        status, _ = api(run, 'DELETE', '/api/chat?conversationId=' + conversation)
        receipt['clearHttpStatus'] = status
        after = state(run, conversation)
        receipt['afterClear'] = after
        if status != 200 or (after['segment'] and (after['segment'][1] != 0 or after['segment'][3] != 0)):
            raise ValueError('Native clear did not invalidate compact content')
        receipt['productionCredentialSourceUnchanged'] = run.http('/identity').get('providerSourceUnchanged') is True
        if not receipt['productionCredentialSourceUnchanged'] or source_identity() != source or audit(bundle) != inventory:
            raise ValueError('Final source/artifact/credential original preservation failed')
        receipt['scenarioPassed'] = True
    finally:
        with resources.preserve_failure():
            receipt['claimedEffects'] = envelope.effects
            receipt['reservedUsd'] = round(envelope.effects * RESERVE_USD, 2)
            if run:
                run.stop()
            if observer:
                receipt['noninterference'] = observer.stop(run.pids if run else [])
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
