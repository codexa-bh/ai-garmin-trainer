"""Finite authored provider replies, never real-provider reasoning evidence."""
import datetime
import json
import re
from copy import deepcopy

ANSWER = 'Authored structured weekly operation completed; saved facts remain distinct from fresh Garmin evidence.'
NO_SAVE = 'Authored draft only; no structured changes saved.'


def commitment(origin='planned'):
    return {'origin': origin, 'items': [{
        'id': 'sessions', 'conceptId': 'authored-sessions', 'label': 'T0319 authored sessions',
        'tracks': [{'key': 'count', 'kind': 'numeric', 'unit': 'sessions', 'meaning': 'Selected session count', 'target': {'comparator': 'at-least', 'value': 3 if origin == 'planned' else 5},
                    'availablePoints': 60 if origin == 'planned' else 50},
                   {'key': 'duration', 'kind': 'numeric', 'unit': 'minutes', 'meaning': 'Selected session duration', 'target': {'comparator': 'at-least', 'value': 90},
                    'availablePoints': 40 if origin == 'planned' else 30}]}]}


def canonical_kpis(messages):
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
        identity = value.get('latestPlanSetId')
        if value.get('complete') is True and isinstance(identity, str) and re.fullmatch(r'[A-Za-z0-9_-]+', identity):
            return value
    raise ValueError('Complete current canonical tool result required')


def latest_id(messages):
    return canonical_kpis(messages)['latestPlanSetId']


def reused_adaptation(messages):
    read = canonical_kpis(messages)
    selected = next((value for value in read.get('sets', []) if value['id'] == read['latestPlanSetId']), None)
    if not selected or len(selected.get('items', [])) != 1 or selected['items'][0]['conceptId'] != 'authored-sessions':
        raise ValueError('Actual authored canonical commitment required for reuse')
    result = commitment('adaptation')
    result['items'] = deepcopy(selected['items'])
    result['items'][0]['tracks'][0]['availablePoints'] = 50
    result['items'][0]['tracks'][1]['availablePoints'] = 30
    result['items'][0]['tracks'][0]['target']['value'] = 5
    return result


def assessment(set_id, correction=False):
    evidence = {'origin': 'user-report', 'references': ['T0319 synthetic report']}
    return {'setId': set_id, 'asOf': datetime.datetime.now(datetime.timezone.utc).isoformat().replace('+00:00', 'Z'), 'status': 'provisional',
            'totalPoints': 25 if correction else 112.5,
            'items': [{'itemId': 'sessions', 'actuals': [{'trackKey': 'count', 'value': 0 if correction else 4, 'awardedPoints': 12.5 if correction else 50},
                                                         {'trackKey': 'duration', 'value': None, 'awardedPoints': 0 if correction else 50}],
                       'status': 'provisional', 'evidence': evidence}],
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
        name, args = 'saveWeeklyKpis', {'weekStart': week, 'commitment': commitment() if index == 1 else reused_adaptation(body['messages'])}
    elif index in (7, 11):
        name, args = 'saveWeeklyKpis', {'weekStart': week, 'assessments': [assessment(latest_id(body['messages']), index == 11)]}
    else:
        raise ValueError('Unexpected authored KPI provider call')
    if index in (4, 11):
        name, args = 'saveWeeklyDocuments', {'changes': [], 'kpiChanges': [args]}
    if name not in [tool.get('function', {}).get('name') for tool in body.get('tools', [])]:
        raise ValueError('Actual structured weekly tool schema missing')
    return {'role': 'assistant', 'content': None, 'tool_calls': [{'id': 'kpi-' + str(index), 'type': 'function', 'function': {'name': name, 'arguments': json.dumps(args)}}]}
