"""Prospective invocation-owned disposables, not scratch/worktree retention or historical cleanup.

Only explicit allocations are enrolled. Run roots, dynamic WebView state, diagnostics and
screenshots are never recursively removed. Failures/unknown effects prevent immediate
runner disposal, but never extend managed disposable retention.
"""
import contextlib
import contextvars
import functools
import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import sys
import uuid

_CURRENT = contextvars.ContextVar('smoke_disposables', default=None)
_DIRECTORY = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW


def identity(info):
    return info.st_dev, info.st_ino, stat.S_IFMT(info.st_mode), info.st_uid


def safe(info):
    if info.st_uid != os.getuid() or not (stat.S_ISDIR(info.st_mode) or stat.S_ISREG(info.st_mode)):
        raise ValueError('Foreign or unexpected disposable object')
    if stat.S_ISREG(info.st_mode) and info.st_nlink != 1:
        raise ValueError('Hardlinked disposable refused')


def snapshot(fd, tree, mutable=False):
    info = os.fstat(fd)
    safe(info)
    if not tree:
        if mutable:
            return {'.': identity(info)}
        digest = hashlib.sha256()
        os.lseek(fd, 0, os.SEEK_SET)
        with os.fdopen(os.dup(fd), 'rb') as stream:
            for block in iter(lambda: stream.read(1024 * 1024), b''):
                digest.update(block)
        return {'.': (*identity(info), info.st_size, digest.hexdigest())}
    result = {'.': identity(info)}
    for name in sorted(os.listdir(fd)):
        info = os.stat(name, dir_fd=fd, follow_symlinks=False)
        safe(info)
        child = os.open(name, _DIRECTORY if stat.S_ISDIR(info.st_mode) else os.O_RDONLY | os.O_NOFOLLOW, dir_fd=fd)
        try:
            if identity(os.fstat(child)) != identity(info):
                raise ValueError('Disposable changed while inspecting')
            if stat.S_ISDIR(info.st_mode):
                for relative, value in snapshot(child, True).items():
                    result[name if relative == '.' else name + '/' + relative] = value
            else:
                digest = hashlib.sha256()
                with os.fdopen(os.dup(child), 'rb') as stream:
                    for block in iter(lambda: stream.read(1024 * 1024), b''):
                        digest.update(block)
                after = os.fstat(child)
                if (after.st_size, after.st_mtime_ns, after.st_ctime_ns) != (info.st_size, info.st_mtime_ns, info.st_ctime_ns):
                    raise ValueError('Disposable changed while hashing')
                result[name] = (*identity(info), info.st_size, digest.hexdigest())
        finally:
            os.close(child)
    return result


class Disposables:
    def __init__(self):
        self.roots = {}
        self.items = []
        self.guards = []
        self.retention = None
        self.scratch = None
        self.receipt = None
        self.categories = None

    def configure(self, scratch):
        scratch = Path(scratch)
        info = scratch.stat()
        if not scratch.is_absolute() or scratch.resolve(strict=True) != scratch or scratch.is_symlink() or not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o022:
            raise ValueError('Canonical owner-controlled invocation scratch required')
        if self.scratch is not None and self.scratch != scratch:
            raise ValueError('One invocation scratch required')
        self.scratch = scratch
        if self.categories is None:
            from smoke_categories import CategoryPaths
            self.categories = CategoryPaths(scratch)
        for target in (self.categories.evidence, self.categories.disposable):
            target_info = target.lstat()
            if (not stat.S_ISDIR(target_info.st_mode) or target_info.st_uid != os.getuid()
                    or target_info.st_mode & 0o077 or target.resolve(strict=True) != target):
                raise ValueError('Canonical owner-private invocation storage required; never chmod/adopt')
        if self.receipt is None:
            self.receipt = self.categories.evidence / ('resource-disposition-' + str(uuid.uuid4()) + '.json')
        self.pin(scratch)
        self.pin(self.categories.evidence)
        self.pin(self.categories.disposable)
        return self.categories.evidence

    def pin(self, directory):
        directory = Path(directory)
        if self.scratch is None or not directory.is_relative_to(self.scratch):
            raise ValueError('Disposable parent escapes invocation scratch')
        if directory in self.roots:
            self.check_root(directory)
            return
        if directory != self.scratch:
            self.pin(directory.parent)
            fd = os.open(directory.name, _DIRECTORY, dir_fd=self.roots[directory.parent][0])
        else:
            fd = os.open(directory, _DIRECTORY)
        try:
            info = os.fstat(fd)
            safe(info)
            if directory.resolve(strict=True) != directory or identity(directory.lstat()) != identity(info):
                raise ValueError('Disposable parent changed or aliased')
            self.roots[directory] = (fd, identity(info))
        except BaseException:
            os.close(fd)
            raise

    def check_root(self, directory):
        for root, (_, expected) in self.roots.items():
            if directory.is_relative_to(root) and (root.resolve(strict=True) != root or identity(root.lstat()) != expected):
                raise ValueError('Pinned disposable parent changed')

    def register(self, path, tree=False):
        path = Path(path)
        self.pin(path.parent)
        parent = self.roots[path.parent][0]
        fd = os.open(path.name, _DIRECTORY if tree else os.O_RDONLY | os.O_NOFOLLOW, dir_fd=parent)
        try:
            info = os.fstat(fd)
            safe(info)
            if tree != stat.S_ISDIR(info.st_mode):
                raise ValueError('Wrong disposable class')
            entry = {'path': path, 'fd': fd, 'tree': tree, 'inventory': None,
                     'identity': identity(info), 'status': 'retained', 'bytes': info.st_size if not tree else 0}
            self.items.append(entry)
            return entry
        except BaseException:
            os.close(fd)
            raise

    def seal(self, entry):
        self.check_root(entry['path'].parent)
        entry['inventory'] = snapshot(entry['fd'], entry['tree'], entry['path'].suffix == '.sqlite')
        entry['bytes'] = sum(value[4] for value in entry['inventory'].values() if len(value) > 4) if entry['tree'] else os.fstat(entry['fd']).st_size

    def verify(self, entry, parent, name):
        self.check_root(entry['path'].parent)
        info = os.stat(name, dir_fd=parent, follow_symlinks=False)
        safe(info)
        if identity(info) != entry['identity'] or entry['inventory'] is None:
            raise ValueError('Replaced or incomplete disposable allocation')
        if entry['fd'] is None:
            # Mutable SQLite is never held open while native writer admission runs.
            entry['fd'] = os.open(name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=parent)
            if identity(os.fstat(entry['fd'])) != entry['identity']:
                raise ValueError('Disposable changed while reopening after settlement')
        if snapshot(entry['fd'], entry['tree'], entry['path'].suffix == '.sqlite') != entry['inventory']:
            raise ValueError('Mixed, replaced or changed immutable disposable inventory')
        # Unknown sidecars/leases are not adopted and must remain available for diagnosis.
        if not entry['tree'] and entry['path'].suffix == '.sqlite':
            for suffix in ('-wal', '-shm', '-journal', '.trainer-writer'):
                try:
                    os.stat(name + suffix, dir_fd=parent, follow_symlinks=False)
                except FileNotFoundError:
                    continue
                raise ValueError('Unsettled or unregistered SQLite sidecar/lease; retain database')

    def remove_tree(self, fd, expected, prefix=''):
        # The object is quarantined and its complete immutable inventory already verified.
        # Recheck each opened object; never traverse links or chmod a borrowed path.
        for name in sorted(os.listdir(fd)):
            relative = prefix + name
            info = os.stat(name, dir_fd=fd, follow_symlinks=False)
            safe(info)
            if relative not in expected or identity(info) != expected[relative][:4]:
                raise ValueError('Disposable changed during removal; retained remainder')
            if stat.S_ISDIR(info.st_mode):
                child = os.open(name, _DIRECTORY, dir_fd=fd)
                try:
                    if identity(os.fstat(child)) != identity(info):
                        raise ValueError('Disposable directory changed during removal')
                    os.fchmod(child, 0o700)  # Only our verified read-only probe-copy directory.
                    self.remove_tree(child, expected, relative + '/')
                finally:
                    os.close(child)
                os.rmdir(name, dir_fd=fd)
            else:
                os.unlink(name, dir_fd=fd)

    def dispose(self, entry):
        if entry['status'] == 'removed':
            return  # Never adopt a later replacement at an already-disposed name.
        path = entry['path']
        parent = self.roots[path.parent][0]
        self.verify(entry, parent, path.name)
        quarantine = '.smoke-dispose-' + str(uuid.uuid4())
        os.mkdir(quarantine, mode=0o700, dir_fd=parent)
        staging = os.open(quarantine, _DIRECTORY, dir_fd=parent)
        try:
            # Atomic move first, then reverify what actually moved before destructive work.
            os.rename(path.name, 'object', src_dir_fd=parent, dst_dir_fd=staging)
            entry['quarantine'] = str(path.parent / quarantine / 'object')
            self.verify(entry, staging, 'object')
            if entry['tree']:
                os.fchmod(entry['fd'], 0o700)
                self.remove_tree(entry['fd'], entry['inventory'])
                os.rmdir('object', dir_fd=staging)
            else:
                os.unlink('object', dir_fd=staging)
            entry['status'] = 'removed'
        finally:
            os.close(staging)
        os.rmdir(quarantine, dir_fd=parent)

    def finish(self, failed):
        if self.scratch is None:
            return
        reason = 'failed/interrupted/unknown invocation; no immediate disposal' if failed else self.retention
        if not reason:
            try:
                for guard in self.guards:
                    guard()
                for entry in self.items:
                    self.verify(entry, self.roots[entry['path'].parent][0], entry['path'].name)
            except Exception as error:
                reason = type(error).__name__ + ': ' + str(error)
        try:
            if self.categories:
                self.categories.archive(self)  # Evidence before owned bulk disposal.
        except Exception as error:
            reason = type(error).__name__ + ': ' + str(error)
        for entry in self.items:
            if not entry['tree']:
                if entry['fd'] is not None:
                    entry['bytes'] = os.fstat(entry['fd']).st_size
                else:
                    try:
                        info = os.stat(entry['path'].name, dir_fd=self.roots[entry['path'].parent][0], follow_symlinks=False)
                        if identity(info) == entry['identity']:
                            entry['bytes'] = info.st_size
                    except OSError:
                        pass  # Missing/replaced failed allocations remain a truthful retained deferral.
        receipt = self.receipt
        def report():
            return {'invocationFailed': failed, 'retentionReason': reason,
                    'allocationRoots': [str(root) for root in self.roots],
                    'evidenceRoot': str(self.categories.evidence) if self.categories else None,
                    'disposableRoot': str(self.categories.disposable) if self.categories else None,
                    'recoveryHold': False,
                    'disposableRetention': 'unchanged; select necessary reproduction evidence before closure',
                    'preserved': 'Run roots, compact evidence/PNG/logs, dynamic WebView/home state and unknown sidecars; never historical, borrowed or worktree cleanup.',
                    'artifacts': [{key: str(value) if isinstance(value, Path) else value for key, value in entry.items() if key in ('path', 'status', 'bytes', 'quarantine')} for entry in self.items]}
        # Evidence must be writable before deletion; exclusive manifest survives partial disposal.
        self.check_root(receipt.parent)
        parent = self.roots[receipt.parent][0]
        with os.fdopen(os.open(receipt.name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=parent), 'w') as output:
            json.dump(report(), output, indent=2)
            output.flush()
            os.fsync(output.fileno())
        cleanup_error = None
        if not reason:
            for entry in self.items:
                try:
                    self.dispose(entry)
                except Exception as error:
                    cleanup_error = error
                    reason = type(error).__name__ + ': ' + str(error)
                    break
        temporary = receipt.with_suffix('.partial')
        self.check_root(receipt.parent)
        with os.fdopen(os.open(temporary.name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=parent), 'w') as output:
            json.dump(report(), output, indent=2)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary.name, receipt.name, src_dir_fd=parent, dst_dir_fd=parent)
        print(json.dumps({'resourceDisposition': str(receipt), 'removedBytes': sum(entry['bytes'] for entry in self.items if entry['status'] == 'removed'), 'retentionReason': reason}))
        if not failed and (cleanup_error or (reason and not self.retention)):
            raise RuntimeError('Owned disposal deferred/failed; inspect disposition receipt') from cleanup_error

    def close(self):
        for entry in self.items:
            if entry['fd'] is not None:
                os.close(entry['fd'])
        for fd, _ in self.roots.values():
            os.close(fd)


@contextlib.contextmanager
def preserve_failure():
    """A secondary settlement/receipt error must not replace the original scenario error."""
    original = sys.exc_info()[1]
    try:
        yield
    except BaseException as error:
        if original is None:
            raise
        print('Secondary settlement failure retained: ' + type(error).__name__, file=sys.stderr)
        ledger = _CURRENT.get()
        if ledger and ledger.scratch:
            try:
                with (ledger.scratch / ('settlement-failure-' + str(uuid.uuid4()) + '.json')).open('x') as output:
                    json.dump({'original': type(original).__name__, 'secondary': type(error).__name__,
                               'resourcesRetained': True}, output)
            except OSError:
                print('Secondary settlement receipt unavailable; retain allocations.', file=sys.stderr)


def invocation(main):
    @functools.wraps(main)
    def wrapped(*args, **kwargs):
        ledger = Disposables()
        token = _CURRENT.set(ledger)
        failed = True
        try:
            result = main(*args, **kwargs)
            failed = False
            return result
        finally:
            try:
                ledger.finish(failed)
            except BaseException:
                if not failed:
                    raise
                # Never replace an original scenario/cancellation/preservation/receipt failure.
                print('Resource-disposition write/verification failed; unremoved allocations remain subject to unchanged retention. Select necessary reproduction evidence before closure.', file=sys.stderr)
            finally:
                ledger.close()
                _CURRENT.reset(token)
    return wrapped


def configure(scratch):
    ledger = _CURRENT.get()
    return ledger.configure(scratch) if ledger else scratch


def runtime_path(path):
    ledger = _CURRENT.get()
    return ledger.categories.runtime_path(path) if ledger and ledger.categories else path


def run_directory(path):
    result = directory(runtime_path(path))
    ledger = _CURRENT.get()
    if ledger and ledger.categories:
        ledger.categories.runs.append(result)
    return result


def disposition():
    ledger = _CURRENT.get()
    return str(ledger.receipt) if ledger and ledger.receipt else None


def retain(reason):
    ledger = _CURRENT.get()
    if ledger:
        ledger.retention = reason


def guard(check):
    ledger = _CURRENT.get()
    if ledger:
        ledger.guards.append(check)


def directory(path):
    path.mkdir(mode=0o700)  # Exclusive: a UUID/name is not itself ownership proof.
    ledger = _CURRENT.get()
    if ledger:
        ledger.pin(path)
    return path


def file_created(path):
    ledger = _CURRENT.get()
    if ledger:
        entry = ledger.register(path)
        ledger.seal(entry)  # Writable files pin inode/type only, never require unchanged DB bytes.
        if path.suffix == '.sqlite':
            # An open runner descriptor would correctly fail native lsof writer admission.
            os.close(entry['fd'])
            entry['fd'] = None


def copy_file(source, destination):
    if source.is_symlink() or not source.is_file():
        raise ValueError('Canonical regular copy source required')
    ledger = _CURRENT.get()
    with open(destination, 'xb', opener=lambda p, flags: os.open(p, flags | os.O_NOFOLLOW, 0o600)) as output:
        entry = ledger.register(destination) if ledger else None  # Pin before a partial copy can fail.
        with source.open('rb') as input_file:
            shutil.copyfileobj(input_file, output)
    shutil.copymode(source, destination, follow_symlinks=False)
    if ledger:
        ledger.seal(entry)


def copy_tree(source, destination, prepare=None):
    directory(destination)
    ledger = _CURRENT.get()
    entry = ledger.register(destination, tree=True) if ledger else None
    shutil.copytree(source, destination, dirs_exist_ok=True, symlinks=True)
    if prepare:
        prepare(destination)
    if ledger:
        ledger.seal(entry)  # Exact prelaunch inventory; unexpected later content refuses removal.
