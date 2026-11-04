#!/usr/bin/env python3
"""T0270 authored native Luna summary test; native owns the opaque OpenAI slot."""
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
from smoke_input import prepare, json_document
import smoke_resources as resources

PRESET = 't0270-summary-luna-100'
RESERVES = {'summary-case': 20, 'chat': 8}
APPROVAL = {'purpose': PRESET, 'maximumCents': 100, 'reserveCents': RESERVES,
            'source': 'T0270 operator approved USD1 tests and exact native-owner opaque OpenAI routing in plan/trace',
            'unknownsRemainReserved': True, 'credentialReadback': False}


class Envelope:
    def __init__(self, evidence, continuation=None):
        self.root = evidence / 't0270-summary-approved-usd100'
        self.claims = []
        if continuation is None:
            self.root.mkdir(mode=0o700)  # Existing/unknown scope never renews by replay.
            private_json(self.root / 'approval.json', APPROVAL)
        else:
            private_directory(self.root)
            if json_document(self.root / 'approval.json')[1] != APPROVAL:
                raise ValueError('Approval changed; no renewal')
            names = set(os.listdir(self.root))
            count = len(names) - 1
            if count < 0 or names != {'approval.json', *('effect-' + str(i) + '.json' for i in range(count))}:
                raise ValueError('Unknown claim inventory')
            for index in range(count):
                claim = json_document(self.root / ('effect-' + str(index) + '.json'))[1]
                kind = claim.get('kind')
                if kind not in RESERVES or claim != self.record(index, kind):
                    raise ValueError('Modified effect claim')
                self.claims.append(claim)
            path, receipt, _, _ = json_document(continuation)
            if path.parent != evidence or not path.name.startswith('summary-live-') or any(receipt.get(key) != value for key, value in {
                    'purpose': PRESET, 'scenarioPassed': False, 'syntheticOnly': True, 'credentialReadback': False,
                    'claims': self.claims, 'reservedCents': self.total, 'inputUnchanged': True,
                    'allOwnedProcessesSettled': True}.items()) or receipt.get('credentialSourceUnchanged') not in [True, 'unavailable-before-activation']:
                raise ValueError('Exact settled failure receipt required; never reset unknowns')
            private_json(evidence / ('summary-reconciliation-' + str(uuid.uuid4()) + '.json'),
                         {'priorReceipt': path.name, 'claimCount': len(self.claims), 'reservedCents': self.total, 'approvalRenewed': False})
        if self.total > 100:
            raise ValueError('Approval envelope exceeded')

    @staticmethod
    def record(index, kind):
        return {'effect': index, 'kind': kind, 'reservedCents': RESERVES[kind],
                'outcome': 'submitted-or-unknown; no automatic refund'}

    @property
    def total(self):
        return sum(claim['reservedCents'] for claim in self.claims)

    def claim(self, kind):
        if kind not in RESERVES or self.total + RESERVES[kind] > 100:
            raise ValueError('Cumulative approved USD1 envelope exhausted')
        claim = self.record(len(self.claims), kind)
        private_json(self.root / ('effect-' + str(len(self.claims)) + '.json'), claim)
        self.claims.append(claim)


def configure_document(run):
    (run.root / 'tokens').mkdir(mode=0o700)
    private_json(run.root / 'config/settings-v3.json', {'version': 3, 'keys': {},
                 'fields': {'DATABASE_PATH': str(run.database), 'AI_PROVIDER': 'openai', 'AI_MODEL': 'gpt-6-luna',
                            'MEMORY_ENABLED': 'false', 'GARMIN_MCP_TOKEN_DIR': str(run.root / 'tokens'),
                            'SUMMARY_ENABLED': 'true', 'SUMMARY_MODEL': 'gpt-6-luna', 'SUMMARY_CHAR_LIMIT': '6000'},
                 'chatCatalog': {'version': 1, 'defaultEntryId': None, 'entries': [
                     {'id': 'entry_t0270_chat_luna', 'provider': 'openai', 'modelId': 'gpt-6-luna'}]}})


def configure(run):
    configure_document(run)
    result = subprocess.run(['npm', 'run', '--silent', 'smoke:summary:seed', '--', str(run.root), 'live'],
                            cwd=Path(__file__).resolve().parents[2], capture_output=True, timeout=30, check=True)
    if len(result.stdout) > 2048:
        raise ValueError('Seed output bound exceeded')
    value = json.loads(result.stdout)
    if value.get('runId') != run.id or value.get('completed') != 4 or value.get('providerCalls') != 0 or value.get('variant') != 'live-summary':
        raise ValueError('Exact authored live-summary source required')
    private_json(run.root / 'summary-live-seed.json', value)
    return value['conversationId']


def api(run, method, path, body=None, envelope=None):
    identity = run.http('/identity')
    if not run.accept_identity(identity):
        raise ValueError('Exact native run/source required')
    if getattr(run, 'keyless_lifecycle', False):
        if run.descriptor.get('providerSmoke') is not None or identity.get('providerSourceUnchanged') is True or (method, path) not in [('GET', '/api/model-settings'), ('GET', '/api/cross-chat-summary'), ('POST', '/api/cross-chat-summary')] or (method == 'POST' and body not in [{'action':'clear'}, {'action':'disable'}]):
            raise ValueError('Exact credential-free lifecycle scope required')
    elif run.descriptor.get('providerSmoke') != PRESET or identity.get('providerSourceUnchanged') is not True:
        raise ValueError('Exact native source/purpose preservation required')
    if method == 'POST' and path == '/api/chat':
        if envelope is None:
            raise ValueError('Unreserved paid chat refused')
        envelope.claim('chat')  # Before opening the effect socket, including unknowns.
    connection = http.client.HTTPConnection('127.0.0.1', int(run.origin.rsplit(':', 1)[1]), timeout=60 if path == '/api/chat' else 5)
    try:
        connection.request(method, path, json.dumps(body) if body is not None else None,
                           {'Content-Type': 'application/json', **({'x-trainer-turn-budget': 'finite-live-smoke'} if path == '/api/chat' else {})})
        response = connection.getresponse()
        raw = response.read(512 * 1024 + 1)
        if len(raw) > 512 * 1024:
            raise ValueError('Bounded API result exceeded')
        return response.status, json.loads(raw)
    finally:
        connection.close()


def unendorsed_question(item):
    # A user-stated QUESTION with explicit non-choice is not an endorsed preference.
    # Require its unresolved meaning as well as category/stance; neither enum alone proves it.
    return (item['category'] in ['question', 'discussion'] and item['stance'] in ['user-stated', 'discussed-not-endorsed']
            and re.search(r'\b(?:poles?|bag)\b', item['text'], re.I) is not None
            and re.search(r'\b(?:not chosen|not decided|undecided|unresolved|unsure|open question)\b', item['text'], re.I) is not None)


def rejected_alternative(item):
    text = item['text'].lower()
    explicit = ('long' in text and 'week' in text and
                (item['category'] == 'rejected' or any(word in text for word in ['reject', 'tried', 'stopped'])))
    # The real imported summary groups choice/rejection/rationale in one goal
    # item. Its explicit failed-fit clause preserves rejection without requiring
    # a separate category or exact verb. Do not accept hypothetical fit questions.
    failed_fit = (item['stance'] == 'user-stated' and item['category'] not in ('question', 'discussion')
                  and not re.search(r'\b(?:if|whether|might)\b', text)
                  and re.search(r"\blong(?:er)? weekday (?:sessions|plan|approach) (?:did not|didn't|could not|couldn't) fit\b", text) is not None)
    return explicit or bool(failed_fit)


def observe_summary(run):
    with contextlib.closing(readonly(run.database)) as db:
        state = db.execute('select revision,frontier,payload,checksum from summary_state where id=1').fetchone()
        value = json.loads(state[2])
        items = value['items']
        text = value['text'].lower()
        attempts = [{'outcome': row[0], 'sourceCount': len(json.loads(row[1])), 'upper': row[2],
                     'usage': json.loads(row[3]) if row[3] else None}
                    for row in db.execute('select outcome,source_ids_json,upper_event,usage_json from summary_attempt order by started_at,job_id')]
        return {'revision': state[0], 'frontier': state[1], 'characters': len(value['text']), 'checksum': state[3],
                'payloadSha256': hashlib.sha256(state[2].encode()).hexdigest(), 'itemCount': len(items),
                'retainsShortWeekdays': 'short' in text and 'week' in text,
                'retainsTimeRationale': any(word in text for word in ['time', 'bicycle', '18:00', 'availab']),
                'retainsHikingGoal': bool(re.search(r'(?:three|3)[ -]?(?:hours?|h\b)', text)) and 'hik' in text,
                'retainsRejectedAlternative': any(rejected_alternative(item) for item in items),
                'retainsUnendorsedQuestion': any(unendorsed_question(item) for item in items),
                'attempts': attempts, 'messages': db.execute('select count(*) from message').fetchone()[0]}


def wait_summary(run, frontier, deadline):
    observed = None
    while time.monotonic() < deadline:
        status, meta = api(run, 'GET', '/api/cross-chat-summary')
        if status != 200:
            raise ValueError('Summary metadata unavailable')
        observed = observe_summary(run)
        if observed['frontier'] >= frontier:
            return observed
        if meta['reason'] and meta['reason'] not in ['summary_correction_pending', 'summary_invalidated']:
            raise ValueError('Summary generation failed: ' + str(meta['reason']))
        time.sleep(.25)  # Read-only local foreground observation, never effect replay.
    raise TimeoutError('Foreground summary publication deadline')


def meaning_passed(observed):
    return all(observed[key] for key in ['retainsShortWeekdays', 'retainsTimeRationale', 'retainsHikingGoal',
                                        'retainsRejectedAlternative', 'retainsUnendorsedQuestion'])


@resources.invocation
def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--scratch', required=True)
    parser.add_argument('--bundle', required=True)
    parser.add_argument('--approved-summary-tests-usd100', action='store_true', required=True)
    parser.add_argument('--continue-receipt', help='Exact settled diagnosed failure receipt; retains every original claim')
    args = parser.parse_args()
    os.umask(0o077)
    evidence = private_directory(resources.configure(canonical(args.scratch)))
    bundle = canonical(args.bundle)
    inventory, source = audit(bundle), source_identity()
    if json.loads((bundle / 'Contents/Resources/resources/provenance.json').read_text()).get('sourceFingerprint') != source:
        raise ValueError('Current exact-source ordinary artifact required')
    envelope = Envelope(evidence, args.continue_receipt)
    selection = argparse.Namespace(task_id='T0270', input_file=None, grant_file=None, provenance_file=None, anchor=None)
    prepared = prepare(evidence, selection, 'ordinary')
    run, observer, provider_run = None, None, None
    runs = []
    provider_stopped = False
    receipt = {'purpose': PRESET, 'source': source, 'syntheticOnly': True, 'credentialReadback': False,
               'scenarioPassed': False, 'captures': [], 'realGarmin': 'not authorized/exercised',
               'credentialSourceUnchanged': 'unavailable-before-activation', 'allOwnedProcessesSettled': False}
    stage = 'preparation'
    try:
        run = OrdinaryRun(evidence, prepared.database, source, bundle, inventory)
        runs.append(run)
        provider_run = run
        run.before_start = prepared.verify_current
        conversation = configure(run)
        run.descriptor['providerSmoke'] = PRESET
        observer = Observer(evidence)
        run.observer = observer
        envelope.claim('summary-case')
        deadline = time.monotonic() + 300
        stage = 'native-activation'
        run.start(run.binary, timeout=100)
        status, _ = api(run, 'PATCH', '/api/model-settings', {'modelId': 'entry_t0270_chat_luna'})
        if status != 200:
            raise ValueError('Explicit chat selection failed')
        stage = 'first-summary'
        first = wait_summary(run, 4, deadline)
        receipt['firstSummary'] = first
        if not meaning_passed(first) or first['attempts'][-1]['sourceCount'] != 4:
            raise ValueError('First native summary meaning/coverage failed')
        stage = 'chat-completion'
        message = ('Preserve our fictional choice of short weekday walks plus weekend hiking because of available time, and the rejected long-weekday approach. '
                   'Give one short English sentence acknowledging that choice. No tools, measurements, saves or Garmin connection. '
                   + 'Authored neutral pacing discussion; this adds no new preference or fact. ' * 30)
        status, body = api(run, 'POST', '/api/chat', {'conversationId': conversation, 'message': message, 'stream': False}, envelope)
        text = body.get('assistant', {}).get('content', '')
        excerpt = text[:240]
        if re.search(r'(sk-|https?://|/Users/|@|[A-Za-z0-9_-]{32,})', excerpt):
            excerpt = '[noncanonical synthetic excerpt withheld]'
        receipt['chat'] = {'httpStatus': status, 'characters': len(text), 'excerpt': excerpt,
                           'doneBeforeNextSummary': observe_summary(run)['frontier'] == 4}
        if status != 200 or not text:
            raise ValueError('Native answer completion failed')
        stage = 'incremental-summary'
        second = wait_summary(run, 5, deadline)
        receipt['secondSummary'] = second
        committed = [row for row in second['attempts'] if row['outcome'] == 'committed']
        if not meaning_passed(second) or [row['sourceCount'] for row in committed] != [4, 1] or not all(row['usage'] and row['usage']['input'] is not None and row['usage']['output'] is not None for row in committed):
            raise ValueError('Incremental meaning/usage/new-source-only coverage failed')
        for preset in ['wide', 'narrow']:
            if time.monotonic() >= deadline:
                raise TimeoutError('Native case deadline')
            run.command({'type': 'setViewport', 'preset': preset})
            receipt['captures'].append({'preset': preset, **run.command({'type': 'captureView', 'view': 'trainer', 'preset': preset})})
        stage = 'restart'
        identity = run.http('/identity')
        receipt['credentialSourceUnchanged'] = run.accept_identity(identity) and identity.get('providerSourceUnchanged') is True
        if not receipt['credentialSourceUnchanged']:
            raise ValueError('Credential source changed before provider shutdown')
        run.stop()
        provider_stopped = True
        # No second private lookup: online-clone the stopped actual published state
        # into an ordinary credential-free run before restart/clear/privacy work.
        run = OrdinaryRun(evidence, provider_run.database, source, bundle, inventory)
        runs.append(run)
        run.before_start = prepared.verify_current
        run.observer = observer
        configure_document(run)
        run.keyless_lifecycle = True
        run.start(run.binary, timeout=100)
        status, models = api(run, 'GET', '/api/model-settings')
        if status != 200 or models.get('available') is not False or any(option['available'] for option in models.get('options', [])):
            raise ValueError('Credential-free lifecycle clone required')
        restarted = observe_summary(run)
        if restarted != second:
            raise ValueError('Native restart changed coherent summary/checkpoint or replayed source')
        receipt['restartRetainsExactSummary'] = True
        stage = 'privacy'
        status, cleared = api(run, 'POST', '/api/cross-chat-summary', {'action': 'clear'})
        if status != 200 or cleared['items'] != 0 or cleared['characters'] != 0:
            raise ValueError('Native summary clear failed')
        status, disabled = api(run, 'POST', '/api/cross-chat-summary', {'action': 'disable'})
        with contextlib.closing(readonly(run.database)) as db:
            cutoff = db.execute('select cutoff from summary_control where id=1').fetchone()[0]
        after = observe_summary(run)
        if status != 200 or disabled['enabled'] or after['itemCount'] != 0 or after['messages'] != second['messages'] or cutoff != 6:
            raise ValueError('Privacy cutoff/Off/original preservation failed')
        receipt['privacy'] = {'clear': True, 'disabled': True, 'cutoffIncludesIncomplete': True, 'originalMessagesPreserved': True, 'credentialFreeClone': True}
        with contextlib.closing(readonly(provider_run.database)) as db:
            receipt['providerCopyUnchangedByLifecycle'] = fingerprint(db) == run.original
        if not receipt['providerCopyUnchangedByLifecycle']:
            raise ValueError('Lifecycle clone changed the stopped provider original')
        if source_identity() != source or audit(bundle) != inventory:
            raise ValueError('Source/artifact changed during scenario')
        receipt['scenarioPassed'] = True
    finally:
        with resources.preserve_failure():
            receipt['lastStage'] = stage
            receipt['claims'] = envelope.claims
            receipt['reservedCents'] = envelope.total
            if provider_run and provider_run.origin and not provider_stopped:
                try:
                    identity = provider_run.http('/identity')
                    receipt['credentialSourceUnchanged'] = provider_run.accept_identity(identity) and identity.get('providerSourceUnchanged') is True
                except Exception:
                    receipt['credentialSourceUnchanged'] = 'unavailable-before-owned-shutdown'
            if run and run.origin:
                try:
                    receipt['lastSummary'] = observe_summary(run)
                except Exception:
                    receipt['lastSummaryUnavailable'] = True
            errors = []
            for owned in reversed(runs):
                try:
                    owned.stop()
                    owned.verify_settled()
                except Exception as error:
                    errors.append(type(error).__name__)
            if observer:
                receipt['noninterference'] = observer.stop([pid for owned in runs for pid in owned.pids])
            prepared.verify_current()
            with contextlib.closing(readonly(prepared.database)) as db:
                receipt['inputUnchanged'] = fingerprint(db) == prepared.original
            receipt['allOwnedProcessesSettled'] = not errors
            if errors or not receipt['inputUnchanged'] or receipt['credentialSourceUnchanged'] is not True:
                receipt['scenarioPassed'] = False
            private_json(evidence / ('summary-live-' + str(uuid.uuid4()) + '.json'), receipt)
            if errors:
                raise RuntimeError('Owned settlement failed; preserve diagnostics')
    print(json.dumps({'scenarioPassed': receipt['scenarioPassed'], 'reservedCents': envelope.total, 'credentialReadback': False}))
    if not receipt['scenarioPassed']:
        raise RuntimeError('Preservation or scenario gate failed')


if __name__ == '__main__':
    signal.signal(signal.SIGTERM, lambda *_: (_ for _ in ()).throw(KeyboardInterrupt('Owned live summary test interrupted')))
    try:
        main()
    except Exception as error:
        print('Finite live summary scenario failed: ' + type(error).__name__ + '; inspect retained bounded receipt, never blindly replay.')
        raise SystemExit(1) from None
