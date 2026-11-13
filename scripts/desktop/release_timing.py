"""Observational release-stage timing for one CLI invocation.

A record states what this process measured, never that a candidate is approved,
current, verified or published. It holds stage names, UTC correlation stamps,
monotonic durations, outcomes and error class names only: no messages, paths,
environment or provider payloads. Writing it must never replace an owner failure.
"""
import contextlib
import contextvars
from datetime import datetime, timezone
import json
import os
import sys
import time
import uuid

_CURRENT = contextvars.ContextVar('release_timing', default=None)
NOTE = 'Observation only; not approval, eligibility or proof of settlement. Unobserved spans are unavailable, not zero.'


def utc():
    return datetime.now(timezone.utc).isoformat(timespec='milliseconds')


class Recorder:
    def __init__(self, action, correlation):
        self.path = None
        self.open = []
        self.started = time.monotonic()
        # A hard kill leaves this start state on disk: unknown, not success or zero time.
        self.value = {'schemaVersion': 1, 'kind': 'release-timing', 'note': NOTE, 'action': action,
                      'startedAt': utc(), 'endedAt': None, 'elapsedSeconds': None, 'outcome': 'incomplete',
                      'correlation': {key: value for key, value in correlation.items() if value is not None},
                      'references': [], 'stages': []}

    def save(self):
        if self.path is None:
            return
        try:
            temporary = self.path.with_suffix('.partial')
            with open(temporary, 'w', opener=lambda p, flags: os.open(p, flags | os.O_NOFOLLOW, 0o600)) as output:
                json.dump(self.value, output, indent=2)
                output.write('\n')
            os.replace(temporary, self.path)
        except OSError as error:
            self.path = None  # One bounded warning; the owner operation continues unchanged.
            print('Release timing evidence unavailable: ' + type(error).__name__, file=sys.stderr)


@contextlib.contextmanager
def recording(action, **correlation):
    recorder = Recorder(action, correlation)
    token = _CURRENT.set(recorder)
    try:
        yield recorder
        recorder.value['outcome'] = 'completed'
    except BaseException as error:
        recorder.value.update({'outcome': 'failed or interrupted', 'error': type(error).__name__})
        raise
    finally:
        _CURRENT.reset(token)
        recorder.value.update({'endedAt': utc(), 'elapsedSeconds': round(time.monotonic() - recorder.started, 3)})
        recorder.save()
        if recorder.path is not None:
            print(json.dumps({'timing': str(recorder.path), 'elapsedSeconds': recorder.value['elapsedSeconds'],
                              'outcome': recorder.value['outcome']}), flush=True)


def attach(directory):
    """Start persisting to an existing private evidence directory; exclusive, never overwritten."""
    recorder = _CURRENT.get()
    if recorder is None or recorder.path is not None:
        return
    path = directory / ('release-timing-' + recorder.value['action'] + '-' + str(uuid.uuid4()) + '.json')
    try:
        os.close(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600))
    except OSError as error:
        print('Release timing evidence unavailable: ' + type(error).__name__, file=sys.stderr)
        return
    recorder.path = path
    recorder.save()


def correlate(**values):
    recorder = _CURRENT.get()
    if recorder is not None:
        recorder.value['correlation'].update(values)
        recorder.save()


def reference(kind, name):
    """Name (not path) of an owner journal/receipt beside this record."""
    recorder = _CURRENT.get()
    if recorder is not None:
        recorder.value['references'].append({'kind': kind, 'name': name})
        recorder.save()


@contextlib.contextmanager
def stage(name):
    """Measure one owned span. Outside a recorded release invocation this is a no-op."""
    recorder = _CURRENT.get()
    if recorder is None:
        yield
        return
    entry = {'name': name, 'parent': recorder.open[-1] if recorder.open else None, 'startedAt': utc(),
             'endedAt': None, 'elapsedSeconds': None, 'outcome': 'incomplete'}
    recorder.value['stages'].append(entry)
    recorder.open.append(name)
    started = time.monotonic()
    recorder.save()
    try:
        yield
        entry['outcome'] = 'completed'
    except BaseException as error:
        entry.update({'outcome': 'failed or interrupted', 'error': type(error).__name__})
        raise
    finally:
        recorder.open.pop()
        entry.update({'endedAt': utc(), 'elapsedSeconds': round(time.monotonic() - started, 3)})
        recorder.save()
