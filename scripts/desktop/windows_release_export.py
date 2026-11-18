"""Explicit verified Windows release transport, independent of masked-image export.

A receipt is portable digest/scenario evidence, not native producer admission.
Consumers require live exact Actions provenance as well as current local bytes.
No effects on releases, retries, archive-name trust or foreign producer rebinding.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import zipfile

import platform_files
import platform_target
import release_set
from release_metadata import REPOSITORY
import windows_smoke_evidence as evidence
import windows_smoke_state as state

RECEIPT = 'windows-release-export.json'
IMPORTED = 'windows-release-import.json'
MAX_INSTALLER = 512 * 1024 * 1024
KEYS = {'schemaVersion', 'kind', 'sourceSha', 'githubRunId', 'githubAttempt', 'platform',
        'payloadIdentity', 'scenarioManifestSha256', 'outcomes', 'members'}


def identifier(value):
    if not isinstance(value, str) or not re.fullmatch(r'[1-9][0-9]{0,19}', value):
        raise ValueError('Explicit positive Actions identifier required')
    return value


def artifact_name(source, run, attempt):
    return f'windows-release-{identifier(run)}-{identifier(attempt)}-{source}'


def fresh_directory(path):
    state.canonical(path.parent)
    if platform_files.WINDOWS:
        return state.mkdir(path)
    path.mkdir(mode=0o700)  # Existing destination refuses; no adoption/overwrite.
    return state.canonical(path)


def members(record_path):
    record, entry, files = release_set.entry(record_path)
    if entry['platform'] != platform_target.WINDOWS or record['artifact']['size'] > MAX_INSTALLER:
        raise ValueError('Bounded clean Windows release record required')
    return record, entry['assets'], files


def export(record_path, images, destination):
    platform_target.require_host(platform_target.WINDOWS)
    state.canonical(record_path)
    record, selected, files = members(record_path)
    source, run, attempt = os.environ['GITHUB_SHA'], os.environ['GITHUB_RUN_ID'], os.environ['GITHUB_RUN_ATTEMPT']
    if (os.environ.get('GITHUB_EVENT_NAME') != 'workflow_dispatch' or os.environ.get('GITHUB_REPOSITORY') != REPOSITORY
            or record['commit'] != source):
        raise ValueError('Exact manual native Actions source required')
    manifest = evidence.validate(images, expected_source=source, expected_run=run, expected_attempt=attempt)
    if (manifest['installerSha256'] != record['artifact']['sha256']
            or manifest['payloadSha256'] != record['payloadIdentity']):
        raise ValueError('Installed scenario exercised a different installer/payload')
    receipt = {'schemaVersion': 1, 'kind': 'garmin-trainer-windows-release-export', 'sourceSha': source,
               'githubRunId': identifier(run), 'githubAttempt': identifier(attempt), 'platform': platform_target.WINDOWS,
               'payloadIdentity': record['payloadIdentity'],
               'scenarioManifestSha256': release_set.digest(images / 'manifest.json')[0],
               'outcomes': manifest['outcomes'], 'members': selected}
    fresh_directory(destination)
    for name, path in files.items():
        with path.open('rb') as src, (destination / name).open('xb') as dst:
            shutil.copyfileobj(src, dst)
    state.write_file(destination / RECEIPT, (json.dumps(receipt, indent=2) + '\n').encode())
    validate(destination, source=source, run=run, attempt=attempt)
    return receipt


def validate(directory, *, source, run, attempt, imported=False):
    state.canonical(directory)
    receipt = release_set.load(directory / RECEIPT, 32 * 1024)
    evidence.exact(receipt, KEYS)
    if (type(receipt['schemaVersion']) is not int or receipt['schemaVersion'] != 1
            or receipt['kind'] != 'garmin-trainer-windows-release-export'
            or receipt['platform'] != platform_target.WINDOWS
            or (receipt['sourceSha'], receipt['githubRunId'], receipt['githubAttempt']) != (source, run, attempt)):
        raise ValueError('Export source/run/attempt/schema differs')
    evidence.hex_digest(source, 40)
    identifier(run)
    identifier(attempt)
    evidence.hex_digest(receipt['scenarioManifestSha256'])
    record, selected, _ = members(directory / release_set.RECORD_NAME[platform_target.WINDOWS])
    if (receipt['members'] != selected or record['commit'] != source
            or record['payloadIdentity'] != receipt['payloadIdentity']
            or receipt['outcomes'] != {key: 'passed' for key in evidence.STAGES}):
        raise ValueError('Export bytes/shared identity/scenario evidence differs')
    expected = {item['name'] for item in selected} | {RECEIPT} | ({IMPORTED} if imported else set())
    if {p.name for p in directory.iterdir()} != expected:
        raise ValueError('Export directory differs from exact members')
    return receipt


def api(endpoint):
    result = subprocess.run(['gh', 'api', 'repos/' + REPOSITORY + endpoint], capture_output=True, check=True, timeout=60)
    if len(result.stdout) > 1024 * 1024:
        raise ValueError('Provider response bound')
    return json.loads(result.stdout, object_pairs_hook=release_set.unique)


def provider(source, run, attempt, artifact):
    """Live provider attribution, never accepting caller-authored provider JSON."""
    evidence.hex_digest(source, 40)
    for value in (run, attempt, artifact):
        identifier(value)
    workflow = api('/actions/workflows/windows.yml')
    observed = api('/actions/runs/' + run)
    if (observed.get('id') != int(run) or observed.get('run_attempt') != int(attempt)
            or observed.get('workflow_id') != workflow.get('id')
            or workflow.get('path') != '.github/workflows/windows.yml'
            or observed.get('path') != '.github/workflows/windows.yml'
            or observed.get('head_sha') != source or observed.get('event') != 'workflow_dispatch'
            or observed.get('status') != 'completed' or observed.get('conclusion') != 'success'
            or observed.get('repository', {}).get('full_name') != REPOSITORY):
        raise ValueError('Successful exact-source manual Windows workflow/run/attempt required')
    listing = api('/actions/runs/' + run + '/artifacts?per_page=100')
    items = listing.get('artifacts', [])
    matches = [a for a in items if a.get('id') == int(artifact)]
    if listing.get('total_count') != len(items) or len(items) >= 100 or len(matches) != 1:
        raise ValueError('Exact unambiguous complete artifact selection required')
    item = matches[0]
    if (item.get('name') != artifact_name(source, run, attempt) or item.get('expired') is not False
            or item.get('workflow_run', {}).get('id') != int(run)
            or item.get('workflow_run', {}).get('head_sha') != source
            or type(item.get('size_in_bytes')) is not int or not 0 < item['size_in_bytes'] <= MAX_INSTALLER + 2 * 1024 * 1024):
        raise ValueError('Artifact identity/expiry/bound differs')
    return item


def extract(archive, destination, *, source, run, attempt):
    """All membership/type/size checks precede exclusive extraction."""
    state.canonical(archive)
    if release_set.digest(archive)[1] > MAX_INSTALLER + 2 * 1024 * 1024:
        raise ValueError('Archive bound')
    with zipfile.ZipFile(archive) as bundle:
        entries = bundle.infolist()
        installer = f'Garmin-Trainer-'
        receipts = [e for e in entries if e.filename == RECEIPT]
        if len(entries) != 4 or len({e.filename for e in entries}) != 4 or len(receipts) != 1:
            raise ValueError('Exact four-member archive required')
        for item in entries:
            mode = item.external_attr >> 16
            if (item.is_dir() or stat.S_IFMT(mode) not in (0, stat.S_IFREG) or item.flag_bits & 1
                    or '/' in item.filename or '\\' in item.filename or ':' in item.filename
                    or item.extra or item.comment):
                raise ValueError('Archive path/type/metadata refused')
            limit = MAX_INSTALLER if item.filename.startswith(installer) and item.filename.endswith('-windows-x64-setup.exe') else 32 * 1024
            if not 0 < item.file_size <= limit:
                raise ValueError('Archive member bound')
        receipt = json.loads(bundle.read(RECEIPT), object_pairs_hook=release_set.unique)
        evidence.exact(receipt, KEYS)
        selected = receipt['members']
        if not isinstance(selected, list) or len(selected) != 3:
            raise ValueError('Closed release triple required')
        expected = {a['name']: (a['size'], a['sha256']) for a in selected}
        if set(expected) != {e.filename for e in entries} - {RECEIPT}:
            raise ValueError('Archive members differ from receipt')
        fresh_directory(destination)
        for item in entries:
            digest, count = hashlib.sha256(), 0
            with bundle.open(item) as src, (destination / item.filename).open('xb') as dst:
                while block := src.read(1024 * 1024):
                    count += len(block)
                    if count > item.file_size:
                        raise ValueError('Archive decompression bound')
                    dst.write(block)
                    digest.update(block)
            if count != item.file_size or (item.filename != RECEIPT and (count, digest.hexdigest()) != expected[item.filename]):
                raise ValueError('Archive content differs')
    return validate(destination, source=source, run=run, attempt=attempt)


def download(directory, *, source, run, attempt, artifact):
    item = provider(source, run, attempt, artifact)
    state.canonical(directory.parent)
    archive = directory.with_name(directory.name + '.zip')
    # Exact API asset, bounded disk output and timeout, no gh run download globs.
    with archive.open('xb') as stream:
        child = subprocess.Popen(['gh', 'api', 'repos/' + REPOSITORY + '/actions/artifacts/' + artifact + '/zip'],
                                 stdout=stream, stderr=subprocess.DEVNULL)
        import time
        deadline = time.monotonic() + 180
        try:
            while child.poll() is None:
                if time.monotonic() > deadline or stream.tell() > MAX_INSTALLER + 2 * 1024 * 1024:
                    raise TimeoutError('Bounded release archive download failed')
                time.sleep(.1)
            if child.returncode:
                raise ValueError('Artifact download refused; no automatic retry')
        finally:
            if child.poll() is None:
                child.kill()  # Only the live read-only owned download process.
                child.wait(timeout=10)
    sha, size = release_set.digest(archive)
    if size != item['size_in_bytes'] or item.get('digest') != 'sha256:' + sha:
        raise ValueError('Downloaded archive differs from provider digest/size')
    extract(archive, directory, source=source, run=run, attempt=attempt)
    state.write_file(directory / IMPORTED, (json.dumps({'source': source, 'run': run, 'attempt': attempt, 'artifact': artifact}) + '\n').encode())
    return verify_import(directory, expected_source=source)


def verify_import(directory, *, expected_source):
    identity = release_set.load(directory / IMPORTED, 4096)
    evidence.exact(identity, {'source', 'run', 'attempt', 'artifact'})
    if identity['source'] != expected_source:
        raise ValueError('Imported Windows source differs')
    receipt = validate(directory, source=identity['source'], run=identity['run'], attempt=identity['attempt'], imported=True)
    attributed = provider(identity['source'], identity['run'], identity['attempt'], identity['artifact'])
    # Keep downloaded provider-authenticated ZIP as the attribution anchor. Merely
    # recomputing a caller-editable receipt and record would permit forged bytes.
    archive = directory.with_name(directory.name + '.zip')
    sha, size = release_set.digest(archive)
    if attributed.get('digest') != 'sha256:' + sha or attributed['size_in_bytes'] != size:
        raise ValueError('Retained archive no longer matches live provider identity')
    with zipfile.ZipFile(archive) as bundle:
        expected = {item['name'] for item in receipt['members']} | {RECEIPT}
        entries = bundle.infolist()
        if len(entries) != 4 or {item.filename for item in entries} != expected:
            raise ValueError('Retained archive membership changed')
        for item in entries:
            value, count = hashlib.sha256(), 0
            with bundle.open(item) as stream:
                while block := stream.read(1024 * 1024):
                    count += len(block)
                    if count > MAX_INSTALLER:
                        raise ValueError('Retained archive member bound')
                    value.update(block)
            if release_set.digest(directory / item.filename) != (value.hexdigest(), count):
                raise ValueError('Imported bytes differ from attributed native archive')
    return receipt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=('export', 'download', 'verify'))
    parser.add_argument('--directory', type=Path, required=True)
    parser.add_argument('--record', type=Path)
    parser.add_argument('--images', type=Path)
    for key in ('source', 'run', 'attempt', 'artifact'):
        parser.add_argument('--' + key)
    args = parser.parse_args()
    os.umask(0o077)
    if args.action == 'export':
        if args.record is None or args.images is None:
            parser.error('export requires --record and --images')
        value = export(args.record, args.images, args.directory)
    elif args.action == 'download':
        value = download(args.directory, source=args.source, run=args.run, attempt=args.attempt, artifact=args.artifact)
    else:
        value = verify_import(args.directory, expected_source=args.source)
    print(json.dumps({'source': value['sourceSha'], 'run': value['githubRunId'], 'attempt': value['githubAttempt'],
                      'verification': 'portable digests and live native Actions attribution; not foreign producer admission'}))


if __name__ == '__main__':
    main()
