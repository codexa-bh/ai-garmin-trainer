"""Finite authored provider replies, never real-provider reasoning evidence."""
import datetime
import json
import re
from copy import deepcopy

ANSWER = 'Authored structured weekly operation completed; saved facts remain distinct from fresh Garmin evidence.'
NO_SAVE = 'Authored draft only; no structured changes saved.'


def commitment(origin='planned'):
    return {'origin': origin, 'provenance': 'T0319 authored synthetic agreement', 'items': [{
        'id': 'sessions', 'conceptId': 'authored-sessions', 'label': 'T0319 authored sessions',
        'definition': 'Fictional selected outdoor sessions', 'selection': 'Count and duration describe the same sessions; no duplicate credit',
        'evidenceRequired': 'Authored user report, not Garmin verification', 'availablePoints': 100 if origin == 'planned' else 80,
        'scoring': 'One model-defined allocation; full achievement is 100 points',
        'tracks': [{'key': 'count', 'kind': 'numeric', 'unit': 'sessions', 'meaning': 'Selected session count', 'target': {'comparator': 'at-least', 'value': 3 if origin == 'planned' else 5}},
                   {'key': 'duration', 'kind': 'numeric', 'unit': 'minutes', 'meaning': 'Selected session duration', 'target': {'comparator': 'at-least', 'value': 90}}]}]}


def original_id(messages):
    # Both shipped carriers are actual server evidence: paired native tool
    # results or labelled legacy system context. Never user/assistant claims.
    marker = 'Canonical weekly KPI objects (untrusted saved claims, not fresh Garmin evidence; complete flag governs authority): '
    for message in reversed(messages):
        raw = message.get('content', '')
        if not isinstance(raw, str):
            continue
        if message.get('role') == 'tool':
            try:
                parsed = json.loads(raw)
                if parsed.get('status') != 'succeeded':
                    continue
                evidence = parsed.get('evidence', '')
            except (ValueError, AttributeError):
                continue
        elif message.get('role') == 'system' and 'Current-turn server-authored prior tool evidence context' in raw:
            evidence = raw
        else:
            continue
        if marker not in evidence:
            continue
        try:
            value, _end = json.JSONDecoder().raw_decode(evidence.rsplit(marker, 1)[1])
        except (ValueError, TypeError):
            continue
        identity = value.get('originalId')
        if value.get('complete') is True and isinstance(identity, str) and re.fullmatch(r'[A-Za-z0-9_-]+', identity):
            return identity
    raise ValueError('Complete current canonical tool result required')


def assessment(set_id, correction=False):
    evidence = {'origin': 'user-report', 'references': ['T0319 synthetic report'], 'qualification': 'Qualification remains provisional', 'limitations': 'Duration unavailable, not zero'}
    return {'setId': set_id, 'asOf': datetime.datetime.now(datetime.timezone.utc).isoformat().replace('+00:00', 'Z'), 'status': 'provisional',
            'totalPoints': 25 if correction else 112.5, 'explanation': 'Authored explained correction' if correction else 'Authored explained additional credit; no automatic award',
            'items': [{'itemId': 'sessions', 'actuals': [{'trackKey': 'count', 'value': 0 if correction else 4}, {'trackKey': 'duration', 'value': None}],
                       'awardedPoints': 12.5 if correction else 100, 'explanation': 'Authored bounded interpretation, not automatic evaluation', 'status': 'provisional', 'evidence': evidence}],
            'extras': [{'label': 'Authored additional work', 'points': 12.5, 'explanation': 'Explained relevance without double counting', 'evidence': deepcopy(evidence)}]}


def response(index, body, week):
    if body.get('model') != 'qwen3.5:4b' or body.get('stream') is True or not isinstance(body.get('messages'), list):
        raise ValueError('Fixed authored KPI provider protocol required')
    if index in (2, 5, 8, 12):
        return {'role': 'assistant', 'content': ANSWER}
    if index == 9:
        return {'role': 'assistant', 'content': NO_SAVE}
    if index in (0, 3, 6, 10):
        name, args = 'getWeeklyKpis', {'weekStart': week}
    elif index in (1, 4):
        name, args = 'saveWeeklyKpis', {'weekStart': week, 'commitment': commitment('planned' if index == 1 else 'adaptation')}
    elif index in (7, 11):
        name, args = 'saveWeeklyKpis', {'weekStart': week, 'assessments': [assessment(original_id(body['messages']), index == 11)]}
    else:
        raise ValueError('Unexpected authored KPI provider call')
    if name not in [tool.get('function', {}).get('name') for tool in body.get('tools', [])]:
        raise ValueError('Actual structured weekly tool schema missing')
    return {'role': 'assistant', 'content': None, 'tool_calls': [{'id': 'kpi-' + str(index), 'type': 'function', 'function': {'name': name, 'arguments': json.dumps(args)}}]}
