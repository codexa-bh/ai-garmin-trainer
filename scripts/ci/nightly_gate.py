"""Bounded main-only metadata gate. A skip is not a successful native validation."""
import json
import os
import re
import sys
from urllib.request import Request, urlopen

WORKFLOW = 'nightly-macos.yml'
GATE_JOB = 'Linux change gate'
NATIVE_JOB = 'macOS native validation'
LIMIT = 20
SHA = re.compile(r'[0-9a-f]{40}')
RESULTS = {'success', 'failure', 'cancelled', 'timed_out', 'action_required', 'startup_failure', 'neutral'}


def decide(runs, load_jobs, sha, current_id, truncated=False):
    if not isinstance(sha, str) or not SHA.fullmatch(sha) or type(current_id) is not int or current_id <= 0:
        raise ValueError('Invalid source/run identity')
    if not isinstance(runs, list) or len(runs) > LIMIT:
        raise ValueError('Invalid bounded history')
    ids = set()
    for run in runs:
        if not isinstance(run, dict) or type(run.get('id')) is not int or run['id'] in ids:
            raise ValueError('Malformed/duplicate workflow run')
        ids.add(run['id'])
    for run in sorted(runs, key=lambda item: item['id'], reverse=True):
        if run['id'] == current_id or run.get('status') != 'completed':
            continue
        if run.get('head_branch') != 'main' or run.get('event') not in ('schedule', 'workflow_dispatch'):
            raise ValueError('Unexpected nightly branch/event')
        previous = run.get('head_sha')
        if not isinstance(previous, str) or not SHA.fullmatch(previous):
            raise ValueError('Malformed prior source')
        jobs = load_jobs(run['id'])
        if not isinstance(jobs, list) or len(jobs) > LIMIT or not all(isinstance(job, dict) for job in jobs):
            raise ValueError('Malformed bounded job history')
        gates = [job for job in jobs if job.get('name') == GATE_JOB]
        natives = [job for job in jobs if job.get('name') == NATIVE_JOB]
        if len(gates) != 1 or len(natives) > 1 or any(job.get('name') not in (GATE_JOB, NATIVE_JOB) for job in jobs):
            raise ValueError('Expected exact nightly job identities')
        gate = gates[0]
        if gate.get('status') != 'completed':
            raise ValueError('Incomplete prior gate')
        if not natives:
            if gate.get('conclusion') in ('failure', 'cancelled', 'timed_out'):
                continue  # Preflight failure never establishes a native baseline.
            raise ValueError('Missing native decision')
        native = natives[0]
        if native.get('status') != 'completed':
            raise ValueError('Incomplete prior native job')
        result = native.get('conclusion')
        if result == 'skipped':
            if gate.get('conclusion') != 'success':
                continue
            baseline = 'carried unchanged skip (not a new pass)'
        elif result in RESULTS:
            runner = native.get('runner_id')
            if type(runner) is not int or runner < 0:
                raise ValueError('Unknown native allocation')
            if runner == 0:
                if result in ('cancelled', 'startup_failure'):
                    continue  # No native runner allocated.
                raise ValueError('Native outcome without allocation')
            if gate.get('conclusion') != 'success' or not native.get('started_at'):
                raise ValueError('Ambiguous native attempt')
            baseline = result
        else:
            raise ValueError('Unknown native outcome')
        if previous == sha:
            return False, f'Unchanged main {sha}; prior run {run["id"]}: {baseline}. Retain prior outcomes; no retry or green relabeling.'
        return True, f'Main changed since run {run["id"]}: {previous} -> {sha}; prior {baseline}.'
    if truncated:
        raise ValueError('No reliable baseline within bounded history')
    return True, 'Initial source: no prior allocated native attempt or carried decision.'


def api(path):
    repository = os.environ['GITHUB_REPOSITORY']
    if not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', repository):
        raise ValueError('Invalid repository')
    request = Request(f'https://api.github.com/repos/{repository}/actions/{path}', headers={
        'Authorization': 'Bearer ' + os.environ['GH_TOKEN'],
        'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28',
    })
    with urlopen(request, timeout=10) as response:
        raw = response.read(1024 * 1024 + 1)
    if len(raw) > 1024 * 1024:
        raise ValueError('Oversized metadata')
    return json.loads(raw)


def collection(value, key):
    if not isinstance(value, dict) or not isinstance(value.get(key), list) or type(value.get('total_count')) is not int:
        raise ValueError('Malformed Actions collection')
    rows = value[key]
    if value['total_count'] < len(rows) or len(rows) > LIMIT:
        raise ValueError('Inconsistent Actions collection')
    return rows, value['total_count'] > len(rows)


def main():
    try:
        if os.environ['GITHUB_REF'] != 'refs/heads/main' or os.environ['GITHUB_EVENT_NAME'] not in ('schedule', 'workflow_dispatch'):
            raise ValueError('Main scheduled/manual only')
        sha = os.environ['GITHUB_SHA']
        runs, truncated = collection(api(f'workflows/{WORKFLOW}/runs?branch=main&per_page={LIMIT}'), 'workflow_runs')

        def jobs(run_id):
            rows, more = collection(api(f'runs/{run_id}/jobs?filter=latest&per_page={LIMIT}'), 'jobs')
            if more:
                raise ValueError('Truncated jobs')
            return rows

        should_run, reason = decide(runs, jobs, sha, int(os.environ['GITHUB_RUN_ID']), truncated)
        with open(os.environ['GITHUB_OUTPUT'], 'a', encoding='utf-8') as output:
            output.write(f'should_run={str(should_run).lower()}\nsource_sha={sha}\n')
        summary = f'### Nightly: {"run" if should_run else "skip macOS allocation"}\n\nSource: `{sha}`\n\n{reason}\n'
        with open(os.environ['GITHUB_STEP_SUMMARY'], 'a', encoding='utf-8') as output:
            output.write(summary)
        print(reason)
        return 0
    except (OSError, ValueError, KeyError, TypeError):
        message = 'Nightly metadata gate failed; no macOS allocation. Inspect bounded Actions history/access. No source was certified.'
        print(message, file=sys.stderr)
        if os.environ.get('GITHUB_STEP_SUMMARY'):
            with open(os.environ['GITHUB_STEP_SUMMARY'], 'a', encoding='utf-8') as output:
                output.write(message + '\n')
        return 1


if __name__ == '__main__':
    sys.exit(main())
