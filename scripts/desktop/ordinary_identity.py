"""Conservative ordinary build compatibility, separate from current scenario evidence.

Only the full locked build producer publishes a stamp. Consumers never rewrite a bundle.
Debug/probe callers retain unrestricted source identity and their own stamps.
"""

import contextlib
import hashlib
import json
import os
from pathlib import Path
import stat
import subprocess
import time
import uuid

import platform_files
import platform_target
from release_timing import stage
from smoke_build import build_inputs, preparation_lock

VERSION = 2
MODE = 'ordinary-release/v2'
# Proven external to Next/assembly/native includes. Unknown and untracked paths stay in.
EXTERNAL = frozenset(
    [
        'scripts/desktop/ordinary_smoke.py',
        'scripts/desktop/ordinary_smoke_test.py',
        'docs/dev-bridge.md',
    ]
)
CLASSIFIER = {'version': 1, 'externalTrackedPaths': sorted(EXTERNAL)}
STAMP = 'ordinary-build-v2.json'


# Content identity of an open source file; access time is excluded (Windows may
# update it on read).
STABLE = ('st_dev', 'st_ino', 'st_size', 'st_mtime_ns', 'st_ctime_ns')


def stable(info):
    return tuple(getattr(info, field) for field in STABLE)


def current_stat(path):
    """The object `path` names now. Windows path and handle stat APIs can report
    different fields, so compare handle stats of a fresh no-follow open."""
    if not platform_files.WINDOWS:
        return path.stat()
    fd = platform_files.open_nofollow(path, os.O_RDONLY)
    try:
        return os.fstat(fd)
    finally:
        os.close(fd)


@stage('source-snapshot')
def source_snapshot(repo):
    repo = Path(repo)
    if repo.resolve(strict=True) != repo:
        raise ValueError('Canonical source worktree required')
    tracked = set(
        subprocess.check_output(['git', 'ls-files', '-z', '--cached'], cwd=repo).split(b'\0')
    ) - {b''}
    names = set(
        subprocess.check_output(
            ['git', 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], cwd=repo
        ).split(b'\0')
    ) - {b''}
    full = hashlib.sha256()
    build = hashlib.sha256(json.dumps(CLASSIFIER, sort_keys=True).encode() + b'\0')
    driver = hashlib.sha256()
    for name in sorted(names):
        path = repo / os.fsdecode(name)
        if path.is_symlink() or path.resolve() != path:
            raise ValueError('Source aliases not supported')
        try:
            fd = platform_files.open_nofollow(path, os.O_RDONLY)
        except FileNotFoundError:
            data, mode = b'<deleted>', None
        else:
            with os.fdopen(fd, 'rb') as stream:
                before = os.fstat(stream.fileno())
                if not stat.S_ISREG(before.st_mode):
                    raise ValueError('Unexpected source object')
                data = stream.read()
                mode = stat.S_IMODE(before.st_mode)
                after = os.fstat(stream.fileno())
                current = current_stat(path)
                if (
                    stable(before) != stable(after)
                    or stable(current) != stable(after)
                    or current.st_mode != after.st_mode
                ):
                    changed = [
                        field
                        for field in STABLE
                        if getattr(current, field) != getattr(after, field)
                        or getattr(before, field) != getattr(after, field)
                    ]
                    raise ValueError(
                        'Source changed while hashing: '
                        + os.fsdecode(name)
                        + ' '
                        + ','.join(changed)
                    )
        full.update(name + b'\0' + data)
        external = name in tracked and os.fsdecode(name) in EXTERNAL
        # Preserve the unrestricted legacy byte hash above, but domain-separate
        # real files from deletion markers and bind executable/config mode changes.
        record = b'deleted\0' if mode is None else b'file\0' + str(mode).encode() + b'\0' + data
        (driver if external else build).update(name + b'\0' + record)
    return {
        'source': full.hexdigest(),
        'buildSource': build.hexdigest(),
        'driver': driver.hexdigest(),
    }


def inventory_hash(inventory):
    digest = hashlib.sha256()
    for path, content in sorted(inventory.items()):
        if any(char in path for char in '\x00\r\n'):
            raise ValueError('Unrepresentable inventory path')
        digest.update((path + '\x00' + content + '\n').encode())
    return digest.hexdigest()


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('Duplicate provenance key refused')
        result[key] = value
    return result


def document(path):
    if (
        path.is_symlink()
        or not path.is_file()
        or path.stat().st_nlink != 1
        or path.stat().st_size > 16 * 1024 * 1024
    ):
        raise ValueError('Missing/aliased ordinary provenance; full rebuild required')
    return json.loads(path.read_text(), object_pairs_hook=unique_object)


def resources_of(bundle):
    """Packaged resources of a producer: macOS .app bundle or Windows release dir."""
    if bundle.suffix == '.app':
        return bundle / 'Contents/Resources/resources'
    return bundle / 'resources'


def provenance(bundle):
    value = document(resources_of(bundle) / 'provenance.json')
    if (
        not isinstance(value, dict)
        or type(value.get('version')) is not int
        or value['version'] != VERSION
    ):
        raise ValueError(
            'Unsupported ordinary provenance; full rebuild required, never relabel a bundle'
        )
    for field in ['sourceFingerprint', 'buildSourceFingerprint', 'buildContext']:
        if (
            not isinstance(value.get(field), str)
            or len(value[field]) != 64
            or any(c not in '0123456789abcdef' for c in value[field])
        ):
            raise ValueError('Malformed ordinary identity; full rebuild required')
    return value


@stage('build-context')
def context_identity(repo, snapshot):
    # Also bind the exact lock inode: replacing it cannot manufacture a second owner
    # for an old stamp. Standalone assembly may allocate it, but publishes no stamp.
    lock = preparation_directory(repo) / 'native-smoke.lock'
    fd = platform_files.open_nofollow(lock, os.O_RDWR | os.O_CREAT, 0o600)
    try:
        info = os.fstat(fd)
        current = lock.stat()
        if (
            not stat.S_ISREG(info.st_mode)
            or info.st_nlink != 1
            or not platform_files.owned(fd)
            or (current.st_dev, current.st_ino) != (info.st_dev, info.st_ino)
        ):
            raise ValueError('Foreign/replaced preparation lock refused')
        inputs = build_inputs(repo, snapshot['buildSource'], MODE)
        key = hashlib.sha256(json.dumps(inputs, sort_keys=True).encode()).hexdigest()
        components = {
            name: hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()
            for name, value in inputs.items()
            if name != 'environment'
        }
        components['environment'] = {
            name: hashlib.sha256(value.encode()).hexdigest()
            for name, value in inputs['environment'].items()
        }
        return {
            'key': hashlib.sha256(json.dumps([key, info.st_dev, info.st_ino]).encode()).hexdigest(),
            'components': components,
        }
    finally:
        os.close(fd)


def context_key(repo, snapshot):
    return context_identity(repo, snapshot)['key']


def preparation_directory(repo):
    dist = repo / 'dist'
    dist.mkdir(exist_ok=True)
    if dist.is_symlink() or dist.resolve(strict=True) != dist:
        raise ValueError('Canonical worktree preparation directory required')
    return dist


def producer_platform(bundle):
    return platform_target.MACOS if bundle.suffix == '.app' else platform_target.WINDOWS


@stage('producer-inventory')
def producer_inventory(repo, bundle, workspace):
    from release_smoke import audit

    if producer_platform(bundle) == platform_target.WINDOWS:
        platform_target.require_host(platform_target.WINDOWS)
        return windows_producer_inventory(repo, bundle, workspace)
    return audit(bundle)


@stage('verify-ordinary')
def verify_ordinary(repo, bundle, source, inventory, workspace=None):
    """Caller owns the preparation lock. A stamp is not a substitute for rehashing."""
    if workspace is None:
        workspace = preparation_directory(repo)
    if (
        bundle.resolve(strict=True) != bundle
        or producer_inventory(repo, bundle, workspace) != inventory
    ):
        raise ValueError('Ordinary inventory/alias changed')
    current = source_snapshot(repo)
    if current['source'] != source:
        raise ValueError('Current driver/source changed before ordinary verification')
    value = provenance(bundle)
    context = context_key(repo, current)
    if (
        value['buildSourceFingerprint'] != current['buildSource']
        or value['buildContext'] != context
    ):
        raise ValueError('Ordinary build inputs/context mismatch; full desktop:build required')
    info = bundle.stat()
    expected = {
        'version': VERSION,
        'mode': MODE,
        'bundle': str(bundle),
        'bundleIdentity': [info.st_dev, info.st_ino],
        'source': value['sourceFingerprint'],
        'buildSource': current['buildSource'],
        'context': context,
        'inventory': inventory_hash(inventory),
    }
    if producer_platform(bundle) != platform_target.MACOS:
        expected['platform'] = producer_platform(bundle)
    if document(repo / 'dist' / STAMP) != expected:
        raise ValueError(
            'Missing/stale ordinary build stamp or changed inventory; full rebuild required'
        )
    if source_snapshot(repo) != current or context_key(repo, current) != context:
        raise ValueError('Inputs changed during ordinary verification')
    return {
        'provenance': value,
        'current': current,
        'context': context,
        'inventory': expected['inventory'],
    }


@contextlib.contextmanager
def ordinary_preparation(repo, bundle, source, scratch):
    """Serialize the original artifact through final preservation, never share writable runs."""
    from native_smoke import private_json

    decision = {
        'mode': MODE,
        'decision': 'refused',
        'reason': 'verification incomplete',
        'stageRequests': {'nextBuild': 0, 'resourceAssembly': 0, 'nativeBuild': 0},
    }
    started = time.monotonic()
    with preparation_lock(preparation_directory(repo)):
        try:
            with stage('producer-verification'):
                inventory = producer_inventory(repo, bundle, scratch)
                verified = verify_ordinary(repo, bundle, source, inventory)
            decision.update(
                {
                    'decision': 'hit',
                    'reason': 'verified build inputs, context and complete inventories',
                    'artifactBuildSource': verified['current']['buildSource'],
                    'currentSource': source,
                    'artifactOriginalSource': verified['provenance']['sourceFingerprint'],
                    'buildContext': verified['context'],
                    'artifactInventoryHash': verified['inventory'],
                }
            )
            decision['freshScenarioOutcome'] = 'incomplete'
            yield verified, inventory
            # A scenario pass never bypasses current-context/original-artifact preservation.
            with stage('producer-preservation'):
                verify_ordinary(repo, bundle, source, inventory, scratch)
            decision['freshScenarioOutcome'] = 'completed; consult scenario receipt for assertions'
        except BaseException as error:
            # A fresh failed oracle on a verified hit is not a cache miss or an old pass.
            decision['freshScenarioOutcome'] = 'failed or incomplete'
            decision['failure'] = (
                type(error).__name__ + ': inspect retained verification/scenario evidence'
            )
            if decision['decision'] == 'refused' and isinstance(error, ValueError):
                decision['reason'] = str(error)[:240]
            raise
        finally:
            decision['elapsedSeconds'] = time.monotonic() - started
            private_json(scratch / ('ordinary-reuse-' + str(uuid.uuid4()) + '.json'), decision)


def run_build(command, *, cwd):
    subprocess.run(command, cwd=cwd, check=True)


def producer(repo, platform_id):
    """The legitimate full-build output for a target (Windows: release dir)."""
    if platform_id == platform_target.WINDOWS:
        return repo / 'src-tauri/target/x86_64-pc-windows-msvc/release'
    bundles = repo / 'src-tauri/target/aarch64-apple-darwin/release/bundle/macos'
    return bundles / 'AI Trainer for Garmin Connect.app'


@stage('windows-producer-inventory')
def windows_producer_inventory(repo, bundle, workspace):
    """Installer + non-installing payload identity of a Windows producer."""
    import release_metadata
    import windows_package
    from release_smoke import audit

    version = release_metadata.check(repo)[0]
    installer = windows_package.installer_path(repo, version)
    seven_zip = windows_package.extractor()
    extracted, payload = windows_package.payload(seven_zip, installer, workspace)
    windows_package.check_payload(payload, bundle, resources_of(bundle))
    # Audit the program files that actually ship: the extracted installer
    # payload (Cargo's build directory hard-links its uplifted binary).
    inventory = audit(extracted / windows_package.BINARY, extra=extracted / 'resources')
    inventory['installer:' + installer.name] = windows_package.digest(installer)
    return inventory


def build_ordinary(repo, platform_id=None):
    """Full desktop:build semantics, under the same worktree lock as ordinary reuse."""
    from release_smoke import audit

    platform_id = platform_target.require_host(platform_id or platform_target.host())
    target = platform_target.target(platform_id)
    with preparation_lock(preparation_directory(repo)):
        with stage('build-input-identity'):
            before = source_snapshot(repo)
            captured_context = context_identity(repo, before)
        context = captured_context['key']
        with stage('build-resources'):
            if platform_id == platform_target.WINDOWS:
                # npm/tauri are .cmd shims on Windows; named explicitly, no shell.
                run_build(['npm.cmd', 'run', 'desktop:resources'], cwd=repo)
            else:
                run_build(['npm', 'run', 'desktop:resources'], cwd=repo)
        with stage('build-native'):
            if platform_id == platform_target.WINDOWS:
                run_build(
                    [
                        str(repo / 'node_modules/.bin/tauri.cmd'),
                        'build',
                        '--target',
                        target['triple'],
                        '--bundles',
                        'nsis',
                        '--no-sign',
                        '--no-binary-patching',
                        '--ci',
                    ],
                    cwd=repo,
                )
            else:
                run_build(
                    [
                        str(repo / 'node_modules/.bin/tauri'),
                        'build',
                        '--target',
                        target['triple'],
                        '--bundles',
                        'app',
                        '--no-sign',
                        '--no-binary-patching',
                        '--ci',
                    ],
                    cwd=repo,
                )
        bundle = producer(repo, platform_id)
        with stage('build-output-identity'):
            value = provenance(bundle)
            if platform_id == platform_target.WINDOWS:
                workspace = preparation_directory(repo) / ('windows-identity-' + str(uuid.uuid4()))
                workspace.mkdir()
                inventory = windows_producer_inventory(repo, bundle, workspace)
            else:
                inventory = audit(bundle)
            unchanged = source_snapshot(repo) == before and context_key(repo, before) == context
        if (
            not unchanged
            or value['sourceFingerprint'] != before['source']
            or value['buildSourceFingerprint'] != before['buildSource']
            or value['buildContext'] != context
        ):
            # Component hashes aid bounded diagnosis without recording env values/keys.
            print(
                json.dumps(
                    {
                        'ordinaryBuildRefused': True,
                        'before': captured_context,
                        'after': context_identity(repo, source_snapshot(repo)),
                        'assembled': value.get('buildContextComponents'),
                    },
                    sort_keys=True,
                )
            )
            raise ValueError(
                'Inputs changed during full ordinary build; no reusable stamp published'
            )
        info = bundle.stat()
        saved = {
            'version': VERSION,
            'mode': MODE,
            'bundle': str(bundle),
            'bundleIdentity': [info.st_dev, info.st_ino],
            'source': before['source'],
            'buildSource': before['buildSource'],
            'context': context,
            'inventory': inventory_hash(inventory),
        }
        if platform_id != platform_target.MACOS:
            saved['platform'] = platform_id
        temporary = repo / 'dist' / ('ordinary-stamp-' + str(uuid.uuid4()))
        with temporary.open('x') as stream:
            json.dump(saved, stream)
        os.replace(temporary, repo / 'dist' / STAMP)
        print('Full ordinary build complete; stable v2 identity and complete inventory stamped.')


if __name__ == '__main__':
    from release_metadata import check

    root = Path(__file__).resolve().parents[2]
    check(root)
    from release_timing import recording

    with recording('ordinary-build', report=platform_target.host() == platform_target.WINDOWS):
        build_ordinary(root, platform_target.host())
