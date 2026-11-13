"""Local DMG transport of a legitimate ordinary producer, never an installer/builder."""
import contextlib
import hashlib
import json
import os
from pathlib import Path
import platform
import plistlib
import re
import stat
import subprocess
import uuid

from ordinary_identity import document, inventory_hash, provenance, verify_ordinary
from release_metadata import REPOSITORY, check, git
from release_smoke import audit
import smoke_resources as resources

APP_NAME = 'Garmin Trainer.app'
SIGNING = 'unsigned-or-linker-adhoc; not notarized; no verified publisher'


def run(args, *, timeout=120, check=True):
    result = subprocess.run([str(arg) for arg in args], capture_output=True, timeout=timeout)
    if check and result.returncode:
        # Vendor output may contain paths; bounded generic diagnostic, retain owned stage.
        raise RuntimeError(str(args[0]) + ' failed with exit ' + str(result.returncode) + '; owned outputs retained')
    return result


def regular(path):
    info = path.lstat()
    if path.resolve(strict=True) != path or not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
        raise ValueError('Canonical single-link regular artifact required')
    return info


def stable_file(info):
    # Reading may update atime (not content identity), notably on freshly created DMGs.
    return (info.st_dev, info.st_ino, info.st_size, info.st_mode, info.st_nlink,
            info.st_uid, info.st_mtime_ns, info.st_ctime_ns)


def digest(path):
    before = stable_file(regular(path))
    value = hashlib.sha256()
    with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW), 'rb') as stream:
        if stable_file(os.fstat(stream.fileno())) != before:
            raise ValueError('Artifact replaced before hashing')
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            value.update(block)
        if stable_file(os.fstat(stream.fileno())) != before or stable_file(path.lstat()) != before:
            raise ValueError('Artifact changed during hashing')
    return value.hexdigest()


def xattrs(path):
    if hasattr(os, 'listxattr'):
        return {name: hashlib.sha256(os.getxattr(path, name, follow_symlinks=False)).hexdigest()
                for name in sorted(os.listxattr(path, follow_symlinks=False))}
    # CPython exposes xattr helpers only on Linux. Use Darwin's no-follow API,
    # not one subprocess per packaged file and not a new dependency.
    import ctypes
    libc = ctypes.CDLL(None, use_errno=True)
    libc.listxattr.restype = libc.getxattr.restype = ctypes.c_ssize_t
    encoded = os.fsencode(path)
    size = libc.listxattr(encoded, None, 0, 1)  # XATTR_NOFOLLOW
    if size < 0 or size > 65536:
        raise OSError(ctypes.get_errno(), 'Cannot inspect bounded payload xattrs')
    names = ctypes.create_string_buffer(size)
    if libc.listxattr(encoded, names, size, 1) != size:
        raise ValueError('Payload xattr names changed')
    result = {}
    for name in sorted(names.raw.rstrip(b'\0').split(b'\0')) if size else []:
        length = libc.getxattr(encoded, name, None, 0, 0, 1)
        if length < 0 or length > 16 * 1024 * 1024:
            raise OSError(ctypes.get_errno(), 'Cannot inspect bounded payload xattr')
        data = ctypes.create_string_buffer(length)
        if libc.getxattr(encoded, name, data, length, 0, 1) != length:
            raise ValueError('Payload xattr value changed')
        result[os.fsdecode(name)] = hashlib.sha256(data.raw).hexdigest()
    return result


def tree_identity(app):
    """Byte, directory, mode and xattr equality, not an inode-rebound producer stamp."""
    inventory = audit(app)
    result = {}
    for path in [app, *sorted(app.rglob('*'))]:
        info = path.lstat()
        if path.is_symlink() or (not path.is_dir() and not path.is_file()):
            raise ValueError('Unexpected payload object')
        if path.is_file() and info.st_nlink != 1:
            raise ValueError('Hardlinked payload refused')
        relative = str(path.relative_to(app))
        if any(c in relative for c in '\x00\r\n'):
            raise ValueError('Unrepresentable payload name')
        if any(re.search(r'^(?:\.env(?:\..*)?|\.garmin.*|\.cache|\.DS_Store|__pycache__|data|logs|backups|settings-v[0-9]+\.json|tokens?\.json)$|\.(?:sqlite|db)(?:-.*)?$', part, re.I)
               for part in path.relative_to(app).parts):
            raise ValueError('Private/cache payload name refused: ' + relative)
        attrs = xattrs(path)
        result[relative] = {'kind': 'directory' if path.is_dir() else 'file',
                            'mode': stat.S_IMODE(info.st_mode), 'xattrs': attrs,
                            'sha256': inventory.get(relative)}
    return result


def identity_hash(identity):
    return hashlib.sha256(json.dumps(identity, sort_keys=True).encode()).hexdigest()


def payload_checks(app, version):
    identity = tree_identity(app)
    with (app / 'Contents/Info.plist').open('rb') as stream:
        info = plistlib.load(stream)
    if any(info.get(key) != value for key, value in {
            'CFBundleIdentifier': 'com.codexa.garmin-trainer.desktop',
            'CFBundleShortVersionString': version, 'CFBundleVersion': version,
            'CFBundleExecutable': 'garmin-trainer-desktop'}.items()):
        raise ValueError('Payload app identity/version mismatch')
    root = app / 'Contents/Resources/resources'
    value = provenance(app)
    for entry in value['files']:
        name = entry['path']
        path = root / name
        if not path.is_relative_to(root) or '..' in Path(name).parts or digest(path) != entry['sha256']:
            raise ValueError('Resource provenance mismatch')
    for name in ['NODE-LICENSE.txt', 'THIRD-PARTY-NOTICES.txt', 'REDISTRIBUTION-REVIEW.txt',
                 'redistribution/index.json', 'redistribution/NOTICES.txt', 'redistribution/sources/native-crates.tar.gz',
                 'runtime/runtime.cjs', 'runtime/scripts/garmin_auth.py', 'runtime/scripts/garmin_auth.py.lock']:
        if regular(root / name).st_size == 0:
            raise ValueError('Required payload resource/notice missing')
    sqlite = list(root.glob('runtime/node_modules/better-sqlite3/build/Release/better_sqlite3.node'))
    if len(sqlite) != 1:
        raise ValueError('Required native SQLite missing')
    binaries = [app / 'Contents/MacOS/garmin-trainer-desktop', root / 'node', sqlite[0],
                root / 'runtime/node_modules/@img/sharp-darwin-arm64/lib/sharp-darwin-arm64-0.35.5.node',
                root / 'runtime/node_modules/@img/sharp-libvips-darwin-arm64/lib/libvips-cpp.8.18.7.dylib']
    for binary in binaries:
        if run(['/usr/bin/lipo', '-archs', binary]).stdout.strip() != b'arm64':
            raise ValueError('Payload must contain ARM64-only native binaries')
    if any(not (binary.stat().st_mode & 0o111) for binary in binaries[:2]):
        raise ValueError('Payload executable mode missing')
    details = run(['/usr/bin/codesign', '-d', '--verbose=4', app], check=False)
    text = (details.stdout + details.stderr).decode(errors='replace')
    if not ((details.returncode == 0 and 'Signature=adhoc' in text and 'Authority=' not in text)
            or (details.returncode == 1 and 'code object is not signed at all' in text)):
        raise ValueError('Unexpected signing profile; no certificate/trust operations permitted')
    return identity


@contextlib.contextmanager
def mounted(dmg, workspace):
    """Own one absent mountpoint; no auto-open, Finder, force detach or global cleanup."""
    mount = workspace / ('mount-' + str(uuid.uuid4()))
    mount.mkdir(mode=0o700)
    attached = False
    failed = True
    receipt = workspace / (mount.name + '.json')
    observation = {'mount': str(mount), 'attach': 'requested; effect unknown', 'detach': 'not attempted'}
    def save():
        receipt.write_text(json.dumps(observation, indent=2) + '\n')
    save()
    try:
        # -plist retains an exact mount observation; an unknown attach outcome is not retried.
        result = run(['/usr/bin/hdiutil', 'attach', '-readonly', '-nobrowse', '-noautoopen',
                      '-mountpoint', mount, '-plist', dmg])
        attached = True
        observation['attach'] = 'observed'
        save()
        entities = plistlib.loads(result.stdout).get('system-entities', [])
        if len([entry for entry in entities if entry.get('mount-point') == str(mount)]) != 1:
            raise ValueError('Unexpected DMG mount identity; inspect owned mount before recovery')
        if {entry.name for entry in mount.iterdir()} != {APP_NAME}:
            raise ValueError('Unexpected image entries; only the app is supported')
        yield mount / APP_NAME
        failed = False
    finally:
        if attached:
            observation['detach'] = 'requested; effect unknown'
            save()
            try:
                run(['/usr/bin/hdiutil', 'detach', mount], timeout=60)
                observation['detach'] = 'observed'
                save()
            except BaseException:
                if not failed:
                    raise
                print('Owned DMG detach also failed; original failure preserved; inspect mount receipt before recovery', flush=True)
        # On attach timeout the OS may still own the mount: preserve it, never blind retry/delete.


def record_for(repo, bundle, dmg, version, notes, verified, identity):
    return {'schemaVersion': 1, 'repository': REPOSITORY, 'commit': git(repo, 'rev-parse', 'HEAD'),
            'sourceDirty': bool(git(repo, 'status', '--porcelain', '--untracked-files=all')) or verified['provenance']['sourceDirty'] or verified['provenance']['source'] != git(repo, 'rev-parse', 'HEAD'),
            'version': version, 'tag': 'v' + version, 'target': 'aarch64-apple-darwin',
            'originalSource': verified['provenance']['sourceFingerprint'],
            'buildSource': verified['provenance']['buildSourceFingerprint'],
            'buildContext': verified['context'], 'inventory': verified['inventory'],
            'payloadIdentity': identity_hash(identity), 'signing': SIGNING,
            'notesSha256': hashlib.sha256(notes.encode()).hexdigest(),
            'artifact': {'name': dmg.name, 'size': dmg.stat().st_size, 'sha256': digest(dmg)}}


def verify_image(repo, bundle, source, verified, inventory, dmg, workspace, record=None):
    verify_ordinary(repo, bundle, source, inventory)
    version, notes = check(repo)
    before = digest(dmg)
    run(['/usr/bin/hdiutil', 'verify', dmg])
    original = payload_checks(bundle, version)
    try:
        with mounted(dmg, workspace) as payload:
            if payload_checks(payload, version) != original:
                raise ValueError('Final DMG payload differs from original bytes/modes/xattrs')
            observed = record_for(repo, bundle, dmg, version, notes, verified, original)
            if record is not None and record != observed:
                raise ValueError('Release record is stale, malformed or contradictory')
            yield payload, observed
    finally:
        with resources.preserve_failure():
            if digest(dmg) != before:
                raise ValueError('Final DMG changed during verification')
            verify_ordinary(repo, bundle, source, inventory)


verified_image = contextlib.contextmanager(verify_image)


def package(repo, bundle, source, verified, inventory, scratch):
    if platform.system() != 'Darwin' or platform.machine() != 'arm64':
        raise ValueError('DMG packaging requires macOS ARM64')
    version, _ = check(repo)
    workspace = resources.run_directory(scratch / ('release-' + str(uuid.uuid4())))
    resources.retain('Local release artifact and staging retained for inspection; no installation or immediate disposal')
    stage = workspace / 'staging'
    stage.mkdir(mode=0o700)
    verify_ordinary(repo, bundle, source, inventory)
    identity = payload_checks(bundle, version)
    # ditto preserves macOS modes/xattrs without changing the legitimate producer.
    run(['/usr/bin/ditto', '--rsrc', '--extattr', bundle, stage / APP_NAME])
    if payload_checks(stage / APP_NAME, version) != identity:
        raise ValueError('Staging did not preserve payload metadata')
    dmg = workspace / ('Garmin-Trainer-' + version + '-macos-arm64.dmg')
    if os.path.lexists(dmg):
        raise ValueError('Artifact output exists; never overwrite')
    # No -ov; exclusive workspace pins output namespace, no privileged destination.
    run(['/usr/bin/hdiutil', 'create', '-format', 'UDZO', '-fs', 'HFS+', '-volname',
         'Garmin Trainer ' + version, '-srcfolder', stage, dmg], timeout=300)
    with verified_image(repo, bundle, source, verified, inventory, dmg, workspace) as (_, record):
        pass
    with (workspace / 'release.json').open('x') as stream:
        json.dump(record, stream, indent=2)
        stream.write('\n')
    with (workspace / (dmg.name + '.sha256')).open('x') as stream:
        stream.write(record['artifact']['sha256'] + '  ' + dmg.name + '\n')
    return workspace / 'release.json'


@contextlib.contextmanager
def transported(repo, bundle, source, verified, inventory, record_path, scratch):
    """Finite runner input: producer remains stamped; mounted bytes are never relabeled."""
    record = document(record_path)
    name = record.get('artifact', {}).get('name')
    if not isinstance(name, str) or Path(name).name != name or not name.endswith('.dmg'):
        raise ValueError('Unsafe artifact record name')
    dmg = record_path.parent / name
    workspace = resources.run_directory(scratch / ('release-verify-' + str(uuid.uuid4())))
    with verified_image(repo, bundle, source, verified, inventory, dmg, workspace, record) as (payload, observed):
        def verify_current():
            verify_ordinary(repo, bundle, source, inventory)
            if document(record_path) != record or digest(dmg) != record['artifact']['sha256']:
                raise ValueError('Transport record/image changed')
            if tree_identity(payload) != tree_identity(bundle):
                raise ValueError('Transported payload changed; never fall back to producer')
        verify_current()
        try:
            yield payload, verify_current, observed
        finally:
            with resources.preserve_failure():
                verify_current()
