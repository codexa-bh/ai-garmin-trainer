"""Versioned multi-platform release set: one source, version, notes and an
explicit nonempty platform list, each with its exact record and assets.

Trust boundary: each per-platform record is produced and original-producer
verified only on its own native host (`release.py package/verify`). Assembling
a set elsewhere checks portable digests only: it binds the exact bytes of
those records and assets and refuses any mixing, but it does not re-admit a
foreign host's producer and is labelled accordingly. A caller-supplied record
grants no producer authority by itself; omitted platforms are not present.
"""

import hashlib
import json
from pathlib import Path
import re

import platform_target
from release_metadata import REPOSITORY, version_value

SCHEMA = 1
NAME = 'release-set.json'
VERIFICATION = 'portable-digests; per-platform original-producer verification on each native host'
LEGACY_RECORD = 'release.json'  # Published 0.1.x macOS records keep their name and schema.
# Readers accept immutable former-name assets; producers emit only the current name.
ASSET_PREFIX = r'(?:AI-Trainer-for-Garmin-Connect|Garmin-Trainer)-'
ARTIFACT = {
    platform_target.MACOS: re.compile('^' + ASSET_PREFIX + r'(?P<v>[^/\\\\]+)-macos-arm64\.dmg$'),
    platform_target.WINDOWS: re.compile(
        '^' + ASSET_PREFIX + r'(?P<v>[^/\\\\]+)-windows-x64-setup\.exe$'
    ),
}
TARGET = {
    platform_target.MACOS: 'aarch64-apple-darwin',
    platform_target.WINDOWS: 'x86_64-pc-windows-msvc',
}
RECORD_NAME = {
    platform_target.MACOS: LEGACY_RECORD,
    platform_target.WINDOWS: 'release-windows-x64.json',
}
HEX = re.compile(r'^[0-9a-f]{64}$')


def unique(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('Duplicate release key refused')
        result[key] = value
    return result


def load(path, limit=1024 * 1024):
    path = Path(path)
    info = path.lstat()
    if path.is_symlink() or not path.is_file() or info.st_nlink != 1 or info.st_size > limit:
        raise ValueError('Canonical bounded single-link release document required')
    return json.loads(path.read_bytes(), object_pairs_hook=unique)


def digest(path):
    path = Path(path)
    info = path.lstat()
    if path.is_symlink() or not path.is_file() or info.st_nlink != 1:
        raise ValueError('Canonical single-link regular asset required')
    value = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            value.update(block)
    if path.lstat().st_size != info.st_size:
        raise ValueError('Asset changed while hashing')
    return value.hexdigest(), info.st_size


def platform_of(record):
    """Explicit platform; a legacy schemaVersion 1 record is macOS ARM64 only."""
    if record.get('schemaVersion') == 1 and 'platform' not in record:
        if record.get('target') != TARGET[platform_target.MACOS]:
            raise ValueError('Legacy record is not a macOS ARM64 record')
        return platform_target.MACOS
    if record.get('schemaVersion') != 2 or record.get('platform') not in platform_target.PLATFORMS:
        raise ValueError('Unsupported or ambiguous platform record')
    if record.get('target') != TARGET[record['platform']]:
        raise ValueError('Record platform/target mismatch')
    return record['platform']


def check_record(record, platform_id):
    artifact = record.get('artifact')
    if (
        not isinstance(artifact, dict)
        or not isinstance(artifact.get('name'), str)
        or not HEX.match(str(artifact.get('sha256')))
        or type(artifact.get('size')) is not int
        or artifact['size'] <= 0
    ):
        raise ValueError('Malformed artifact entry')
    match = ARTIFACT[platform_id].match(artifact['name'])
    if not match or match.group('v') != record.get('version'):
        raise ValueError('Artifact name does not match platform/version')
    for field in [
        'originalSource',
        'buildSource',
        'buildContext',
        'inventory',
        'payloadIdentity',
        'notesSha256',
    ]:
        if not HEX.match(str(record.get(field))):
            raise ValueError('Malformed record identity: ' + field)
    if record.get('repository') != REPOSITORY or record.get('sourceDirty') is not False:
        raise ValueError('Canonical clean exact-source record required')
    if not re.fullmatch(r'[0-9a-f]{40}', str(record.get('commit'))) or record.get(
        'tag'
    ) != 'v' + str(record.get('version')):
        raise ValueError('Exact commit and version tag required')
    version_value(record['version'])
    if not isinstance(record.get('signing'), str) or not record['signing']:
        raise ValueError('Declared signing profile required')
    if platform_id == platform_target.WINDOWS and 'notar' in record['signing'].lower():
        raise ValueError('Windows signing text must not claim notarization')


def entry(record_path):
    """One verified platform's exact record and asset identities."""
    record_path = Path(record_path)
    record = load(record_path)
    platform_id = platform_of(record)
    check_record(record, platform_id)
    if record_path.name != RECORD_NAME[platform_id]:
        raise ValueError('Unexpected record name for ' + platform_id)
    directory = record_path.parent
    installer = directory / record['artifact']['name']
    sha, size = digest(installer)
    if (sha, size) != (record['artifact']['sha256'], record['artifact']['size']):
        raise ValueError('Selected ' + platform_id + ' artifact changed')
    checksum = directory / (installer.name + '.sha256')
    if checksum.read_bytes() != (sha + '  ' + installer.name + '\n').encode():
        raise ValueError('Selected ' + platform_id + ' checksum differs')
    assets = []
    for path in (installer, checksum, record_path):
        asset_sha, asset_size = digest(path)
        assets.append({'name': path.name, 'size': asset_size, 'sha256': asset_sha})
    identity = {
        key: record[key]
        for key in [
            'originalSource',
            'buildSource',
            'buildContext',
            'inventory',
            'payloadIdentity',
            'signing',
            'target',
        ]
    }
    return (
        record,
        {'platform': platform_id, 'record': record_path.name, **identity, 'assets': assets},
        {asset['name']: directory / asset['name'] for asset in assets},
    )


def build(record_paths, notes):
    """Validate a set of per-platform records into one release-set value."""
    if not record_paths:
        raise ValueError('Explicit nonempty platform set required')
    records, entries, files = [], [], {}
    for path in record_paths:
        record, item, paths = entry(path)
        records.append(record)
        entries.append(item)
        for name, file in paths.items():
            if name in files:
                raise ValueError('Colliding release asset name: ' + name)
            files[name] = file
    platforms = [item['platform'] for item in entries]
    if len(set(platforms)) != len(platforms):
        raise ValueError('Duplicate platform entry')
    first = records[0]
    for record in records[1:]:
        for field in ['repository', 'commit', 'version', 'tag', 'notesSha256']:
            if record[field] != first[field]:
                raise ValueError('Mixed release ' + field + ' across platforms')
    if hashlib.sha256(notes.encode()).hexdigest() != first['notesSha256']:
        raise ValueError('Reviewed notes differ from platform records')
    entries.sort(key=lambda item: platform_target.PLATFORMS.index(item['platform']))
    value = {
        'schemaVersion': SCHEMA,
        'kind': 'garmin-trainer-release-set',
        'repository': first['repository'],
        'commit': first['commit'],
        'version': first['version'],
        'tag': first['tag'],
        'notesSha256': first['notesSha256'],
        'platforms': [item['platform'] for item in entries],
        'verification': VERIFICATION,
        'entries': entries,
    }
    return value, files


def validate(value):
    """Shape of a stored set (fake-provider/consumer side); bytes rechecked separately."""
    if (
        not isinstance(value, dict)
        or value.get('schemaVersion') != SCHEMA
        or value.get('kind') != 'garmin-trainer-release-set'
        or value.get('verification') != VERIFICATION
    ):
        raise ValueError('Unsupported release set')
    platforms = value.get('platforms')
    if (
        not isinstance(platforms, list)
        or not platforms
        or len(set(platforms)) != len(platforms)
        or any(p not in platform_target.PLATFORMS for p in platforms)
        or [item.get('platform') for item in value.get('entries', [])] != platforms
    ):
        raise ValueError('Release set platforms must be explicit, known and unique')
    names = [asset['name'] for item in value['entries'] for asset in item['assets']]
    if len(set(names)) != len(names) or NAME in names:
        raise ValueError('Colliding release asset names')
    return value


def assemble(record_paths, notes, scratch, *, version=None):
    value, _ = build(record_paths, notes)
    if version is not None and value['version'] != version:
        raise ValueError('Selected version differs from platform records')
    scratch = Path(scratch)
    if not scratch.is_absolute() or not scratch.is_dir():
        raise ValueError('Existing absolute scratch required')
    path = scratch / NAME
    with path.open('x', newline='\n') as stream:
        json.dump(value, stream, indent=2)
        stream.write('\n')
    return path


def assets(set_path, record_dirs):
    """Current exact asset paths for a stored set, rechecking every byte."""
    value = validate(load(set_path))
    if set(record_dirs) != set(value['platforms']):
        raise ValueError('Exactly one record directory per selected platform required')
    result, paths = {}, []
    for item in value['entries']:
        directory = Path(record_dirs[item['platform']])
        record_path = directory / RECORD_NAME[item['platform']]
        _, current, files = entry(record_path)
        paths.append(record_path)
        if current != item:
            raise ValueError('Platform ' + item['platform'] + ' changed since the release set')
        for asset in item['assets']:
            sha, size = digest(files[asset['name']])
            result[asset['name']] = {'path': files[asset['name']], 'size': size, 'sha256': sha}
    # Rebuild shared source/version/tag/notes as well as per-platform entries.
    # A stored set cannot relabel otherwise valid platform records.
    first = load(paths[0])
    for path in paths:
        current = load(path)
        if any(
            current[key] != first[key] or value.get(key) != current[key]
            for key in ('repository', 'commit', 'version', 'tag', 'notesSha256')
        ):
            raise ValueError('Stored release set shared identity differs from platform records')
    sha, size = digest(set_path)
    result[NAME] = {'path': Path(set_path), 'size': size, 'sha256': sha}
    return value, result
