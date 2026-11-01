#!/usr/bin/env python3
"""Finite local synthetic/default or explicitly authorized private smoke preparation. No launch capability."""
import argparse
import contextlib
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import stat
import subprocess
import time
import uuid
from native_smoke import REPO, canonical, fingerprint, private_json, readonly

CLASSES = ['numeric-activity-summaries', 'daily-health', 'synthetic-profile']
SCENARIOS = ['native', 'ordinary', 'health-comparison']


def private_directory(path):
    path = canonical(path)
    info = path.stat()
    if not path.is_dir() or info.st_uid != os.getuid() or info.st_mode & 0o777 != 0o700:
        raise ValueError('Canonical owner-private directory required; no chmod/adoption')
    return path


def identity(info):
    return (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns)


def private_file(path, limit, allow_empty=False):
    path = canonical(path)
    private_directory(path.parent)
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o777 != 0o600 or info.st_nlink != 1 or not (0 if allow_empty else 1) <= info.st_size <= limit:
            raise ValueError('Private bounded owner single-link regular file required')
        data = os.read(fd, limit + 1)
        if len(data) != info.st_size or identity(os.fstat(fd)) != identity(info) or identity(path.stat()) != identity(info):
            raise ValueError('Input changed during bounded read')
        return path, data, identity(info)
    finally:
        os.close(fd)


def database_state(path):
    # SQLite may consult sidecars implicitly: authorize their safety before opening it.
    database, data, info = private_file(path, 16 * 1024 * 1024)
    state = {'database': (info, hashlib.sha256(data).hexdigest())}
    for suffix in ['-wal', '-shm', '-journal']:
        sidecar = Path(str(database) + suffix)
        if sidecar.exists() or sidecar.is_symlink():
            _, content, sidecar_info = private_file(sidecar, 16 * 1024 * 1024, allow_empty=True)
            if suffix == '-journal':
                raise ValueError('Selected input has rollback journal; no recovery/adoption')
            # SHM lock/read marks are transient; validate ownership but do not claim immutable bytes.
            if suffix == '-wal':
                state[suffix] = (sidecar_info, hashlib.sha256(content).hexdigest())
    return database, state


def json_document(path, expected_hash=None):
    path, data, info = private_file(path, 8192)
    content_hash = hashlib.sha256(data).hexdigest()
    if expected_hash is not None and content_hash != expected_hash:
        raise ValueError('Exact authorized document identity mismatch')
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError('Duplicate input key refused')
            result[key] = value
        return result
    document = json.loads(data, object_pairs_hook=unique)
    if not isinstance(document, dict):
        raise ValueError('Input object required')
    return path, document, content_hash, info


def exact(document, keys):
    if not isinstance(document, dict) or set(document) != set(keys):
        raise ValueError('Unknown/missing input fields refused')


def digest(value):
    return isinstance(value, str) and re.fullmatch('[0-9a-f]{64}', value) is not None


def instant(value):
    if not isinstance(value, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z', value):
        raise ValueError('Explicit UTC validity/retention required')
    return datetime.strptime(value, '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=timezone.utc)


def authorize(path, task, scenario, now=None):
    if not path:
        raise ValueError('Explicit private input denied: applicable grant required; synthetic is independently available without --input-file')
    path, grant, revision_hash, _ = json_document(path)
    exact(grant, ['schemaVersion', 'grantId', 'revision', 'status', 'kind', 'consumerTask', 'approval', 'artifactId', 'artifactVersion', 'selectionSha256', 'provenanceSha256', 'logicalHash', 'epic', 'scenarios', 'dataClasses', 'validFrom', 'expiresAt', 'retentionUntil', 'originalReadOnly', 'primaryWrite', 'credentials', 'externalTransmission'])
    exact(grant['approval'], ['operator', 'evidence'])
    for key in ['grantId', 'artifactId', 'artifactVersion']:
        if not isinstance(grant[key], str) or not re.fullmatch('[A-Za-z0-9._-]{1,100}', grant[key]):
            raise ValueError('Exact grant/artifact identity required')
    if any(not isinstance(grant['approval'][key], str) or not 1 <= len(grant['approval'][key].strip()) <= 512 for key in ['operator', 'evidence']):
        raise ValueError('Attributable explicit operator evidence required; fixture provenance is not approval')
    if type(grant['schemaVersion']) is not int or grant['schemaVersion'] != 1 or type(grant['revision']) is not int or grant['revision'] < 1 or grant['status'] != 'active':
        raise ValueError('Unknown/revoked grant revision refused')
    if grant['kind'] not in ['standing', 'one-off'] or (grant['kind'] == 'standing' and grant['consumerTask'] is not None) or (grant['kind'] == 'one-off' and grant['consumerTask'] != task):
        raise ValueError('Grant consumer scope refused')
    if grant['epic'] != 'E0007' or grant['dataClasses'] != CLASSES or not isinstance(grant['scenarios'], list) or not grant['scenarios'] or any(item not in SCENARIOS for item in grant['scenarios']) or len(set(grant['scenarios'])) != len(grant['scenarios']) or scenario not in grant['scenarios']:
        raise ValueError('Grant epic/scenario/data scope refused')
    if grant['originalReadOnly'] is not True or any(grant[key] is not False for key in ['primaryWrite', 'credentials', 'externalTransmission']):
        raise ValueError('Grant excluded intent refused')
    if not all(digest(grant[key]) for key in ['selectionSha256', 'provenanceSha256', 'logicalHash']):
        raise ValueError('Immutable artifact/provenance binding required')
    now = now or datetime.now(timezone.utc)
    start, end, retention = (instant(grant[key]) for key in ['validFrom', 'expiresAt', 'retentionUntil'])
    if not start <= now < end <= retention:
        raise ValueError('Grant expired/not yet valid/retention uncertain')
    return path, grant, revision_hash


def recipe_command(arguments):
    # Closed argument list; subprocess output is private, bounded and never forwarded on refusal.
    result = subprocess.run([str(REPO / 'node_modules/.bin/tsx'), str(REPO / 'scripts/desktop/smoke_recipe.ts'), *arguments], cwd=REPO, capture_output=True, timeout=45)
    if result.returncode or len(result.stdout) > 8192 or len(result.stderr) > 8192:
        raise ValueError('Smoke recipe/compatibility/coverage refused; no native launch')
    return json.loads(result.stdout)


class PreparedInput:
    def __init__(self, database, root, original, recheck, provenance):
        self.database, self.root, self.original = database, root, original
        self._recheck, self.provenance = recheck, provenance
        private_json(root / 'preparation.json', provenance)

    def verify_current(self):
        self._recheck()
        private_file(self.database, 16 * 1024 * 1024)
        with contextlib.closing(readonly(self.database)) as db:
            if fingerprint(db) != self.original:
                raise ValueError('Prepared input changed; preserve and reconcile')


def arguments(parser):
    parser.add_argument('--input-file', help='Optional exact private database-only selection; requires explicit applicable --grant-file and --provenance-file')
    parser.add_argument('--grant-file', help='Current owner-private attributable authority record; rechecked before every use')
    parser.add_argument('--provenance-file', help='Exact owner-private artifact provenance bound by the grant')
    parser.add_argument('--task-id', default=Path(os.environ.get('PIVAN_TASK_PATH', 'local-smoke')).name.split('-')[0])
    parser.add_argument('--anchor', help='Synthetic UTC YYYY-MM-DD; default resolves once to current UTC date')


def prepare(scratch, args, scenario):
    scratch = private_directory(scratch)
    if not re.fullmatch(r'T\d{4,}|local', args.task_id):
        raise ValueError('Consuming task identity required')
    if scenario not in SCENARIOS:
        raise ValueError('Unknown smoke scenario')
    root = scratch / ('prepared-' + str(uuid.uuid4()))
    grant_check = None
    if args.input_file:
        # Authority is established before opening any selection values, provenance or DB.
        grant_path, grant, grant_hash = authorize(args.grant_file, args.task_id, scenario)
        if args.anchor or not args.provenance_file:
            raise ValueError('Private input needs exact provenance, not synthetic anchor')
        selection_path, selected, selection_hash, _ = json_document(args.input_file, grant['selectionSha256'])
        exact(selected, ['database'])
        if selection_hash != grant['selectionSha256'] or not isinstance(selected['database'], str):
            raise ValueError('Grant selection identity mismatch')
        provenance_path, provenance, provenance_hash, _ = json_document(args.provenance_file, grant['provenanceSha256'])
        exact(provenance, ['schemaVersion', 'artifactId', 'artifactVersion', 'logicalHash', 'dataClasses', 'originalPreserved'])
        if type(provenance['schemaVersion']) is not int or provenance['schemaVersion'] != 1 or provenance_hash != grant['provenanceSha256'] or provenance['originalPreserved'] is not True or any(provenance[key] != grant[key] for key in ['artifactId', 'artifactVersion', 'logicalHash', 'dataClasses']):
            raise ValueError('Grant provenance mismatch')
        database, db_identity = database_state(selected['database'])
        checks = recipe_command(['verify', str(database), 'private'])
        with contextlib.closing(readonly(database)) as db:
            original = fingerprint(db)
        if original['logicalHash'] != grant['logicalHash']:
            raise ValueError('Grant artifact content mismatch')
        def recheck_private():
            _, current, current_hash = authorize(grant_path, args.task_id, scenario)
            if current_hash != grant_hash or current != grant or json_document(selection_path)[2] != selection_hash or json_document(provenance_path)[2] != provenance_hash or database_state(database)[1] != db_identity:
                raise ValueError('Current grant/source identity changed; no stale authority')
            with contextlib.closing(readonly(database)) as db:
                if fingerprint(db) != original:
                    raise ValueError('Authorized original changed; no reuse')
        grant_check = recheck_private
        grant_check()
        root.mkdir(mode=0o700)
        prepared = root / 'input.sqlite'
        fd = os.open(prepared, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        os.close(fd)
        deadline = time.monotonic() + 10
        def progress(_status, _remaining, _total):
            if time.monotonic() > deadline:
                raise TimeoutError('Online smoke backup deadline; retain partial output')
        with contextlib.closing(readonly(database)) as db, contextlib.closing(sqlite3.connect(prepared)) as copy:
            db.backup(copy, pages=128, sleep=.01, progress=progress)
            if fingerprint(copy) != original:
                raise ValueError('Authorized online-copy mismatch')
        grant_check()
        checks = recipe_command(['verify', str(prepared), 'private'])
        details = {'route': 'private', 'grantId': grant['grantId'], 'grantRevision': grant['revision'], 'grantRevisionHash': grant_hash, 'artifactId': grant['artifactId'], 'artifactVersion': grant['artifactVersion'], 'originalPreserved': True}
    else:
        if args.grant_file or args.provenance_file:
            raise ValueError('Private options without explicit selection refused')
        anchor = args.anchor or datetime.now(timezone.utc).date().isoformat()
        result = recipe_command(['create', str(scratch), 'smoke-input-' + str(uuid.uuid4()), anchor])
        prepared = Path(result.pop('path'))
        root = prepared.parent
        checks = recipe_command(['verify', str(prepared), 'synthetic'])
        with contextlib.closing(readonly(prepared)) as db:
            original = fingerprint(db)
        details = {'route': 'authored-synthetic', 'recipeVersion': result['recipeVersion'], 'anchor': anchor, 'personalInputRead': False}
    private_json(root / 'selection.json', {'database': str(prepared)})
    provenance = {'schemaVersion': 1, 'task': args.task_id, 'preparationRun': root.name, 'scenario': scenario, **details, 'checks': checks, 'original': original, 'publication': 'exclusive 0700/0600', 'cleanup': 'task-attributed scratch-expiry deferral; no primary copy-back'}
    return PreparedInput(prepared, root, original, grant_check or (lambda: None), provenance)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--scratch', required=True)
    arguments(parser)
    args = parser.parse_args()
    os.umask(0o077)
    prepared = prepare(args.scratch, args, 'native')
    prepared.verify_current()
    print(json.dumps({'prepared': str(prepared.root), 'route': prepared.provenance['route'], 'checks': prepared.provenance['checks'], 'launches': 0}))


if __name__ == '__main__':
    main()
