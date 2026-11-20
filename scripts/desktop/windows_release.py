"""Windows x64 package/verify for a legitimate ordinary producer.

Packaging copies (never rebuilds) the producer's stamped unsigned per-user NSIS
installer, verifies its non-installing payload against the producer and writes
a per-platform record plus checksum. Verification re-derives everything from
the current bytes. Nothing here executes the installer or contacts a service.
"""

import contextlib
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import uuid

from ordinary_identity import document, provenance, resources_of, verify_ordinary
import platform_files
import platform_target
from release_metadata import REPOSITORY, check, git
from release_timing import stage
import smoke_resources as resources
import windows_package

PLATFORM = platform_target.WINDOWS
TARGET = 'x86_64-pc-windows-msvc'
SIGNING = 'unsigned; no Authenticode signature or verified publisher (SmartScreen may warn)'
RECORD = 'release-windows-x64.json'
X64 = 0x8664
REQUIRED = [
    'NODE-LICENSE.txt',
    'THIRD-PARTY-NOTICES.txt',
    'REDISTRIBUTION-REVIEW.txt',
    'redistribution/index.json',
    'redistribution/NOTICES.txt',
    'redistribution/sources/native-crates.tar.gz',
    'runtime/runtime.cjs',
    'runtime/scripts/chatgpt-oauth.mjs',
]
EXCLUDED_RUNTIME = (
    'node_modules/sharp',
    'node_modules/@img',
    'node_modules/next/dist/compiled/@vercel/og',
)
PRIVATE = re.compile(
    r'^(?:\.env(?:\..*)?|\.garmin.*|\.cache|__pycache__|data|logs|backups|'
    r'settings-v[0-9]+\.json|tokens?\.json)$|\.(?:sqlite|db)(?:-.*)?$',
    re.I,
)


def asset_name(version):
    return 'Garmin-Trainer-' + version + '-windows-x64-setup.exe'


def regular(path):
    info = path.lstat()
    if platform_files.is_link(info) or not path.is_file() or info.st_nlink != 1:
        raise ValueError('Canonical single-link regular artifact required')
    return info


def payload_checks(payload, release_dir, version):
    """Required binary architecture, resources, notices and exclusions."""
    root = resources_of(release_dir)
    for relative in payload:
        if any(PRIVATE.search(part) for part in relative.split('/')):
            raise ValueError('Private/cache payload name refused: ' + relative)
        if any(
            relative.startswith('resources/runtime/' + path + '/')
            or relative == 'resources/runtime/' + path
            for path in EXCLUDED_RUNTIME
        ):
            raise ValueError('Excluded runtime content present in payload')
    value = provenance(release_dir)
    if value.get('platform') != PLATFORM:
        raise ValueError('Producer resources are not Windows x64 resources')
    for entry in value['files']:
        if payload.get('resources/' + entry['path']) != entry['sha256']:
            raise ValueError('Resource provenance mismatch')
    for name in REQUIRED:
        if regular(root / name).st_size == 0 or 'resources/' + name not in payload:
            raise ValueError('Required payload resource/notice missing')
    sqlite = 'resources/runtime/node_modules/better-sqlite3/build/Release/better_sqlite3.node'
    for name, path in [
        (windows_package.BINARY, release_dir / windows_package.BINARY),
        ('resources/node.exe', root / 'node.exe'),
        (sqlite, root / sqlite[len('resources/') :]),
    ]:
        if name not in payload or windows_package.pe_machine(path) != X64:
            raise ValueError('Payload must contain Windows x64 native binaries: ' + name)
    if 'resources/runtime/node_modules/@resvg/resvg-wasm/index_bg.wasm' not in payload:
        raise ValueError('Required activity image rasterizer missing')
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()


def record_for(repo, installer, version, notes, verified, payload_identity):
    head = git(repo, 'rev-parse', 'HEAD')
    return {
        'schemaVersion': 2,
        'platform': PLATFORM,
        'repository': REPOSITORY,
        'commit': head,
        'sourceDirty': bool(git(repo, 'status', '--porcelain', '--untracked-files=all'))
        or verified['provenance']['sourceDirty']
        or verified['provenance']['source'] != head,
        'version': version,
        'tag': 'v' + version,
        'target': TARGET,
        'originalSource': verified['provenance']['sourceFingerprint'],
        'buildSource': verified['provenance']['buildSourceFingerprint'],
        'buildContext': verified['context'],
        'inventory': verified['inventory'],
        'payloadIdentity': payload_identity,
        'signing': SIGNING,
        'notesSha256': hashlib.sha256(notes.encode()).hexdigest(),
        'artifact': {
            'name': installer.name,
            'size': regular(installer).st_size,
            'sha256': windows_package.digest(installer),
        },
    }


@contextlib.contextmanager
def verified_installer(
    repo, release_dir, source, verified, inventory, installer, workspace, record=None
):
    verify_ordinary(repo, release_dir, source, inventory, workspace)
    version, notes = check(repo)
    before = windows_package.digest(installer)
    try:
        with stage('installer-payload-verify'):
            seven_zip = windows_package.extractor()
            _, payload = windows_package.payload(seven_zip, installer, workspace)
            windows_package.check_payload(payload, release_dir, resources_of(release_dir))
            identity = payload_checks(payload, release_dir, version)
        observed = record_for(repo, installer, version, notes, verified, identity)
        if record is not None and record != observed:
            raise ValueError('Release record is stale, malformed or contradictory')
        yield observed
    finally:
        with resources.preserve_failure(), stage('installer-settlement'):
            if windows_package.digest(installer) != before:
                raise ValueError('Final installer changed during verification')
            verify_ordinary(repo, release_dir, source, inventory, workspace)


def package(repo, release_dir, source, verified, inventory, scratch):
    platform_target.require_host(PLATFORM)
    version, _ = check(repo)
    workspace = resources.run_directory(scratch / ('release-' + str(uuid.uuid4())))
    resources.retain(
        'Local release artifact retained for inspection; no installation or immediate disposal'
    )
    produced = windows_package.installer_path(repo, version)
    output = workspace / asset_name(version)
    if os.path.lexists(output):
        raise ValueError('Artifact output exists; never overwrite')
    with stage('package-copy'):
        # A byte copy of the stamped producer output, never a rebuild or relabel.
        verify_ordinary(repo, release_dir, source, inventory, workspace)
        with produced.open('rb') as source_stream, output.open('xb') as stream:
            shutil.copyfileobj(source_stream, stream)
        if windows_package.digest(output) != windows_package.digest(produced):
            raise ValueError('Packaged installer differs from the stamped producer output')
    with verified_installer(
        repo, release_dir, source, verified, inventory, output, workspace
    ) as record:
        pass
    path = workspace / RECORD
    with path.open('x') as stream:
        json.dump(record, stream, indent=2)
        stream.write('\n')
    with (workspace / (output.name + '.sha256')).open('x', newline='\n') as stream:
        stream.write(record['artifact']['sha256'] + '  ' + output.name + '\n')
    return path


@contextlib.contextmanager
def transported(repo, release_dir, source, verified, inventory, record_path, scratch):
    platform_target.require_host(PLATFORM)
    record = document(record_path)
    name = record.get('artifact', {}).get('name')
    if (
        record.get('platform') != PLATFORM
        or not isinstance(name, str)
        or Path(name).name != name
        or not name.endswith('-windows-x64-setup.exe')
    ):
        raise ValueError('Unsafe or non-Windows artifact record')
    installer = record_path.parent / name
    workspace = resources.run_directory(scratch / ('release-verify-' + str(uuid.uuid4())))
    with verified_installer(
        repo, release_dir, source, verified, inventory, installer, workspace, record
    ) as observed:

        def verify_current():
            with stage('transport-recheck'):
                verify_ordinary(repo, release_dir, source, inventory, workspace)
                if (
                    document(record_path) != record
                    or windows_package.digest(installer) != record['artifact']['sha256']
                ):
                    raise ValueError('Transport record/installer changed')

        verify_current()
        try:
            yield installer, verify_current, observed
        finally:
            with resources.preserve_failure():
                verify_current()
