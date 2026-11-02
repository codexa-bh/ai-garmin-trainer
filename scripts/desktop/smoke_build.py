"""Worktree-local verified smoke preparation; never a cross-worktree mutable cache."""
import contextlib
import fcntl
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import stat
import subprocess
import uuid


@contextlib.contextmanager
def preparation_lock(dist):
    fd = os.open(dist / 'native-smoke.lock', os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_uid != os.getuid():
            raise ValueError('Foreign/linked preparation lock refused')
        fcntl.flock(fd, fcntl.LOCK_EX)
        yield
    finally:
        os.close(fd)


def digest_file(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def tree_digest(root, *, dependencies=False):
    digest = hashlib.sha256()
    for directory, dirs, files in os.walk(root, followlinks=False):
        for name in sorted(dirs + files):
            path = Path(directory) / name
            digest.update(path.relative_to(root).as_posix().encode() + b'\0')
            if path.is_symlink():
                if not dependencies or not path.resolve(strict=True).is_relative_to(root):
                    raise ValueError('Prepared input/output alias refused')
                digest.update(os.readlink(path).encode())
            elif path.is_file():
                digest.update(str(path.stat().st_mode & 0o777).encode() + digest_file(path).encode())
            elif not path.is_dir():
                raise ValueError('Unexpected prepared input/output object')
        dirs.sort()
    return digest.hexdigest()


def build_key(repo, source, mode):
    tools = [['node', '--version'], ['npm', '--version'], ['rustc', '-vV'], ['cargo', '--version'],
             ['xcrun', '--show-sdk-version']]
    versions = [subprocess.check_output(command, cwd=repo, timeout=20, stderr=subprocess.STDOUT).decode().strip() for command in tools]
    # Include installed bytes, not only lockfile/HEAD or npm's installed-lock claim.
    dependencies = repo / 'node_modules'
    if not (dependencies / '.package-lock.json').is_file():
        raise ValueError('Locked local npm installation required')
    environment = {key: value for key, value in os.environ.items() if re.match(
        r'^(PATH$|SDKROOT$|DEVELOPER_DIR$|TOOLCHAINS$|MACOSX_DEPLOYMENT_TARGET$|SOURCE_DATE_EPOCH$|ARCHFLAGS$|CC$|CXX$|CFLAGS$|CXXFLAGS$|CPPFLAGS$|LDFLAGS$|CCACHE|CMAKE|PKG_CONFIG|RUST|CARGO|NODE_|NEXT_|TAURI_|TRAINER_|npm_config_)', key)}
    identity = repo.stat()
    return hashlib.sha256(json.dumps({'version': 1, 'worktree': [str(repo), identity.st_dev, identity.st_ino],
        'source': source, 'mode': mode, 'platform': [platform.system(), platform.machine()],
        'tools': versions, 'environment': environment, 'dependencies': tree_digest(dependencies, dependencies=True)}, sort_keys=True).encode()).hexdigest()


def prepare(repo, scratch, source, source_identity, verify_resources, *, resources_ready=False, mode='debug'):
    if mode not in ('debug', 'release-probe'):
        raise ValueError('Unknown smoke build mode')
    repo = repo.resolve(strict=True)
    dist = repo / 'dist'
    dist.mkdir(exist_ok=True)
    if dist.is_symlink() or dist.resolve(strict=True) != dist:
        raise ValueError('Canonical worktree preparation directory required')
    from smoke_resources import copy_file
    with preparation_lock(dist):
        if source_identity() != source:
            raise ValueError('Source changed before preparation')
        if resources_ready:
            verify_resources(source)  # Explicit mismatch always refuses, even with an old stamp.
        key = build_key(repo, source, mode)
        stamp = dist / ('smoke-build-' + mode + '.json')
        binary = repo / ('src-tauri/target/debug/garmin-trainer-desktop' if mode == 'debug' else
                         'src-tauri/target/aarch64-apple-darwin/release/garmin-trainer-desktop')
        reason = 'no verified preparation'
        hit = False
        if stamp.is_symlink() or binary.is_symlink():
            raise ValueError('Prepared output alias refused')
        try:
            saved = json.loads(stamp.read_text())
            verify_resources(source)
            resource_hash = tree_digest(repo / 'src-tauri/resources')
            hit = saved == {'key': key, 'binary': digest_file(binary), 'resources': resource_hash}
            reason = 'verified compatible preparation' if hit else 'input/mode/toolchain/output changed'
        except (OSError, ValueError, KeyError, TypeError):
            reason = 'missing, stale or corrupt preparation'
        if not hit:
            steps = [] if resources_ready else [('resources', ['npm', 'run', 'desktop:resources'])]
            command = ['cargo', 'build', '--locked', '--manifest-path', 'src-tauri/Cargo.toml']
            if mode == 'release-probe':
                command += ['--release', '--target', 'aarch64-apple-darwin', '--features', 'release-probe']
            steps.append((mode, command))
            for label, command in steps:
                with (scratch / (label + '-' + str(uuid.uuid4()) + '.log')).open('xb') as log:
                    subprocess.run(command, cwd=repo, env={**os.environ, 'TRAINER_BUILD_SOURCE': source},
                                   stdout=log, stderr=subprocess.STDOUT, check=True)
            verify_resources(source)
            if source_identity() != source or build_key(repo, source, mode) != key:
                raise ValueError('Inputs changed during preparation; no stamp published')
            resource_hash = tree_digest(repo / 'src-tauri/resources')
            saved = {'key': key, 'binary': digest_file(binary), 'resources': resource_hash}
            temporary = dist / ('smoke-stamp-' + str(uuid.uuid4()))
            with temporary.open('x') as stream:
                json.dump(saved, stream)
            os.replace(temporary, stamp)
        destination = scratch / ('native-binary-' + str(uuid.uuid4()))
        copy_file(binary, destination)
        destination.chmod(0o700)
        if digest_file(destination) != saved['binary'] or source_identity() != source:
            raise ValueError('Prepared binary/source changed during copy')
        report = {'mode': mode, 'key': key, 'reused': hit, 'reason': reason, 'binarySha256': saved['binary'],
                  'resourceSha256': resource_hash, 'executionCopy': str(destination)}
        with (scratch / ('build-reuse-' + str(uuid.uuid4()) + '.json')).open('x') as stream:
            json.dump(report, stream, indent=2)
        return destination


def observer_binary(repo):
    """Compile Swift once per verified compiler/source; execution still has its own child/log."""
    dist = repo / 'dist'
    dist.mkdir(exist_ok=True)
    if dist.is_symlink() or dist.resolve(strict=True) != dist:
        raise ValueError('Canonical observer preparation directory required')
    with preparation_lock(dist):
        source = repo / 'scripts/desktop/native_observer.swift'
        compiler = subprocess.check_output(['xcrun', 'swiftc', '--version'], timeout=20)
        sdk = subprocess.check_output(['xcrun', '--show-sdk-version'], timeout=20)
        key = hashlib.sha256(source.read_bytes() + compiler + sdk).hexdigest()
        binary = dist / 'smoke-observer'
        stamp = dist / 'smoke-observer.json'
        try:
            if binary.is_symlink() or stamp.is_symlink():
                raise ValueError('Observer aliases refused')
            if json.loads(stamp.read_text()) == {'key': key, 'binary': digest_file(binary)}:
                return binary
        except (OSError, ValueError):
            pass
        temporary = dist / ('smoke-observer-' + str(uuid.uuid4()))
        subprocess.run(['xcrun', 'swiftc', str(source), '-o', str(temporary)], check=True, capture_output=True, timeout=60)
        if hashlib.sha256(source.read_bytes() + compiler + sdk).hexdigest() != key:
            raise ValueError('Observer source changed during compilation')
        os.replace(temporary, binary)
        temporary_stamp = dist / ('smoke-observer-stamp-' + str(uuid.uuid4()))
        with temporary_stamp.open('x') as output:
            json.dump({'key': key, 'binary': digest_file(binary)}, output)
        os.replace(temporary_stamp, stamp)
        return binary
