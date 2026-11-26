"""Finite authored provider replies, never real-provider reasoning evidence."""

import datetime
import json
import re
from copy import deepcopy

ANSWER = 'Authored structured weekly operation completed; saved facts remain distinct from fresh Garmin evidence.'
NO_SAVE = 'Authored draft only; no structured changes saved.'
RECOVERED = 'Saved canonical targets are 5 sessions and 90 minutes; reviewed points are 12.5. The requested version is unavailable; no data changed.'
MISSING = (
    'No KPIs are saved for that week. The requested saved version is unavailable; no data changed.'
)
EXACT_MISSING = 'The requested saved version is unavailable. Canonical targets are separate evidence, not that version; no data changed.'
RECOVERY_MARKER = 'Independent canonical week recovery: '
CONFLICT_ORIGINAL = 'Authored conflict original.'
CONFLICT_EXTERNAL = 'Authored concurrent edit.'
CONFLICT_PROPOSED = 'Authored stale proposal.'


def commitment(origin='planned'):
    return {
        'origin': origin,
        'items': [
            {
                'id': 'sessions',
                'conceptId': 'authored-sessions',
                'label': 'T0319 authored sessions',
                'tracks': [
                    {
                        'key': 'count',
                        'kind': 'numeric',
                        'unit': 'sessions',
                        'meaning': 'Selected session count',
                        'target': {
                            'comparator': 'at-least',
                            'value': 3 if origin == 'planned' else 5,
                        },
                        'availablePoints': 60 if origin == 'planned' else 50,
                        'pointsRule': {'kind': 'proportional'},
                    },
                    {
                        'key': 'duration',
                        'kind': 'numeric',
                        'unit': 'minutes',
                        'meaning': 'Selected session duration',
                        'target': {'comparator': 'at-least', 'value': 90},
                        'availablePoints': 40 if origin == 'planned' else 30,
                        'pointsRule': {'kind': 'proportional'},
                    },
                ],
            }
        ],
    }


def planning_preload(messages):
    marker = 'Foreground planning preload (not tool execution).'
    for message in messages:
        raw = message.get('content', '')
        if message.get('role') != 'system' or not isinstance(raw, str) or marker not in raw:
            continue
        try:
            value, _end = json.JSONDecoder().raw_decode(raw.split(marker, 1)[1].split('\n', 1)[1])
            if value.get('source') != 'foreground_preload':
                continue
            return value
        except (ValueError, TypeError, KeyError, IndexError):
            continue
    raise ValueError('Complete current foreground preload required')


def preloaded_kpis(messages, week=None):
    for entry in planning_preload(messages).get('weeks', []):
        evidence = entry['kpis']
        if (week is None or entry['weekStart'] == week) and evidence['status'] == 'complete':
            read = evidence['value']
            if read['complete'] is True and read['weekStart'] == entry['weekStart']:
                return read
    raise ValueError('Complete current foreground preload required')


def kpi_evidence(messages, recovery_only=False):
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
                if parsed.get('status') not in ('succeeded', 'rejected'):
                    continue
                evidence = parsed.get('evidence', '')
            except (ValueError, AttributeError):
                continue
        elif (
            message.get('role') == 'system'
            and 'Current-turn server-authored prior tool evidence context' in raw
        ):
            evidence = raw
        else:
            continue
        selected = RECOVERY_MARKER if RECOVERY_MARKER in evidence else marker
        if selected not in evidence or (recovery_only and selected != RECOVERY_MARKER):
            continue
        if message.get('role') == 'tool' and parsed['status'] != (
            'rejected' if selected == RECOVERY_MARKER else 'succeeded'
        ):
            continue
        try:
            value, _end = json.JSONDecoder().raw_decode(evidence.rsplit(selected, 1)[1])
            if selected == RECOVERY_MARKER:
                value = value['canonical']
        except (ValueError, TypeError, KeyError):
            continue
        if value.get('complete') is True:
            return value
    if not recovery_only:
        return preloaded_kpis(messages)
    raise ValueError('Complete current canonical tool result required')


def canonical_kpis(messages, recovery_only=False):
    value = kpi_evidence(messages, recovery_only)
    identity = value.get('latestPlanSetId')
    if not isinstance(identity, str) or not re.fullmatch(r'[A-Za-z0-9_-]+', identity):
        raise ValueError('Actual canonical identity required')
    return value


def latest_id(messages):
    return canonical_kpis(messages)['latestPlanSetId']


def reused_adaptation(messages):
    read = canonical_kpis(messages, recovery_only=True)
    selected = next(
        (value for value in read.get('sets', []) if value['id'] == read['latestPlanSetId']), None
    )
    if (
        not selected
        or len(selected.get('items', [])) != 1
        or selected['items'][0]['conceptId'] != 'authored-sessions'
    ):
        raise ValueError('Actual authored canonical commitment required for reuse')
    result = commitment('adaptation')
    result['items'] = deepcopy(selected['items'])
    result['items'][0]['tracks'][0]['availablePoints'] = 50
    result['items'][0]['tracks'][1]['availablePoints'] = 30
    result['items'][0]['tracks'][0]['target']['value'] = 5
    return result


def assessment(set_id, correction=False):
    evidence = {'origin': 'user-report', 'references': ['T0319 synthetic report']}
    return {
        'setId': set_id,
        'asOf': datetime.datetime.now(datetime.timezone.utc).isoformat().replace('+00:00', 'Z'),
        'status': 'provisional',
        'totalPoints': 12.5 if correction else 112.5,
        'items': [
            {
                'itemId': 'sessions',
                'actuals': [
                    {
                        'trackKey': 'count',
                        'value': 0 if correction else 4,
                        'awardedPoints': 0 if correction else 50,
                    },
                    {
                        'trackKey': 'duration',
                        'value': None,
                        'awardedPoints': 0 if correction else 50,
                    },
                ],
                'status': 'provisional',
                'evidence': evidence,
            }
        ],
        'extras': [
            {
                'label': 'Authored additional work',
                'points': 12.5,
                'explanation': 'Explained relevance without double counting',
                'evidence': deepcopy(evidence),
            }
        ],
    }


def response(index, body, week):
    if (
        body.get('model') != 'qwen3.5:4b'
        or body.get('stream') is True
        or not isinstance(body.get('messages'), list)
    ):
        raise ValueError('Fixed authored KPI provider protocol required')
    # Same eight authored requests as the baseline, with three redundant
    # discovery rounds removed. Keep explicit unavailable-version recovery.
    if index == 16:
        if 'saveTrainingPlan' not in [
            tool.get('function', {}).get('name') for tool in body.get('tools', [])
        ]:
            raise ValueError('Actual General Plan tool schema missing')
        plan = planning_preload(body['messages']).get('trainingPlan', {})
        document = plan.get('value', {}).get('plan')
        if (
            plan.get('status') != 'complete'
            or not isinstance(document, dict)
            or document.get('contentMarkdown') != CONFLICT_ORIGINAL
        ):
            raise ValueError('Actual complete General Plan preload required for conflict proof')
        return {
            'role': 'assistant',
            'content': None,
            'tool_calls': [
                {
                    'id': 'authored-conflict',
                    'type': 'function',
                    'function': {
                        'name': 'saveTrainingPlan',
                        'arguments': json.dumps(
                            {
                                'edits': [
                                    {'oldText': CONFLICT_ORIGINAL, 'newText': CONFLICT_PROPOSED}
                                ]
                            }
                        ),
                    },
                }
            ],
        }
    original_indices = (1, 2, 3, 4, 5, 7, 8, 9, 11, 12, 13, 14, 15, 16, 17, 18)
    if not 0 <= index < len(original_indices):
        raise ValueError('Unexpected authored KPI provider call')
    index = original_indices[index]
    if index in (1, 7, 11):
        read = preloaded_kpis(body['messages'], week)
        if index == 1 and (read.get('sets') or read.get('latestPlanSetId')):
            raise ValueError('Complete empty-week preload required before establishment')
    # Adaptation must consume actual independent prior-pass recovery objects.
    if index in (14, 16, 18):
        read = kpi_evidence(body['messages'], recovery_only=True)
        expected_week = (
            (datetime.date.fromisoformat(week) + datetime.timedelta(days=21)).isoformat()
            if index == 16
            else week
        )
        if read.get('weekStart') != expected_week:
            raise ValueError('Requested-week recovery required')
        if index == 16:
            if read.get('sets') or read.get('latestPlanSetId') is not None:
                raise ValueError('Genuine empty-week evidence required')
            answer = MISSING
        else:
            selected = next(
                value for value in read['sets'] if value['id'] == read['latestPlanSetId']
            )
            if [track['target']['value'] for track in selected['items'][0]['tracks']] != [
                5,
                90,
            ] or read['assessments'][0]['totalPoints'] != 12.5:
                raise ValueError('Actual saved canonical values required')
            answer = RECOVERED if index == 14 else EXACT_MISSING
        return {'role': 'assistant', 'content': answer}
    if index in (2, 5, 8, 12):
        return {'role': 'assistant', 'content': ANSWER}
    if index == 9:
        return {'role': 'assistant', 'content': NO_SAVE}
    if index == 3:
        name, args = 'getWeeklyKpis', {'weekStart': week}
    elif index in (1, 4):
        name, args = (
            'saveWeeklyKpis',
            {
                'weekStart': week,
                'commitment': commitment() if index == 1 else reused_adaptation(body['messages']),
            },
        )
    elif index in (7, 11):
        name, args = (
            'saveWeeklyKpis',
            {
                'weekStart': week,
                'assessments': [assessment(latest_id(body['messages']), index == 11)],
            },
        )
    elif index in (13, 15, 17):
        target = (
            (datetime.date.fromisoformat(week) + datetime.timedelta(days=21)).isoformat()
            if index == 15
            else week
        )
        name, args = (
            'getWeeklyKpis',
            {'weekStart': target, 'setId': 'unavailable-version' if index == 17 else 'latest'},
        )
    else:
        raise ValueError('Unexpected authored KPI provider call')
    if index == 3:
        args['setId'] = 'latest'
    if index in (4, 11):
        name, args = 'saveWeeklyDocuments', {'changes': [], 'kpiChanges': [args]}
    if name not in [tool.get('function', {}).get('name') for tool in body.get('tools', [])]:
        raise ValueError('Actual structured weekly tool schema missing')
    return {
        'role': 'assistant',
        'content': None,
        'tool_calls': [
            {
                'id': 'kpi-' + str(index),
                'type': 'function',
                'function': {'name': name, 'arguments': json.dumps(args)},
            }
        ],
    }
