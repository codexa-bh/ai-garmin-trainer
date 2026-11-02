"""Minimal managed Pivan path/evidence adapter; disposal stays with smoke_resources."""
import hashlib
import json
import os
from pathlib import Path
import stat
import subprocess


class CategoryPaths:
    def __init__(self, scratch):
        self.root = scratch
        self.task = None
        self.evidence = scratch
        self.disposable = scratch
        self.runs = []
        task = os.environ.get('PIVAN_TASK_PATH')
        if task:
            task = Path(task)
            # Standalone explicit scratch never acquires task identity merely
            # because a Pivan session happens to be in its environment.
            if (task.is_absolute() and len(task.parents) >= 3
                    and scratch == task.parents[2] / 'tmp' / task.parent.name[:5] / task.name[:5]):
                self.task = task
                self.evidence = self.category('path', 'evidence')
                self.disposable = self.category('path', 'disposable')

    def category(self, command, category):
        result = subprocess.run(['pivan-harness', 'task-scratch', command, str(self.task), '--category', category,
                                 *(['--create'] if command == 'path' else [])],
                                text=True, capture_output=True, timeout=30)
        if result.returncode:
            raise RuntimeError('Compatible category tooling required: ' + result.stderr[:500])
        path = Path(result.stdout.strip())
        if path != self.root / category:
            raise ValueError('Category resolver returned a foreign allocation')
        return path

    def runtime_path(self, path):
        if self.task and Path(path).is_relative_to(self.evidence):
            return self.disposable / Path(path).relative_to(self.evidence)
        return path

    def preserve(self):
        if self.task:
            self.category('preserve', 'disposable')

    def archive(self, ledger):
        if not self.task:
            return
        from smoke_resources import safe, identity
        for run in self.runs:
            ledger.check_root(run)
            destination = self.evidence / run.name
            ledger.check_root(self.evidence)
            os.mkdir(run.name, mode=0o700, dir_fd=ledger.roots[self.evidence][0])
            ledger.pin(destination)
            # Compact receipts/logs and native-confined PNGs, never successful
            # app/binary/DB/WebView copies. Failure holds the original allocation.
            files = [path for path in run.iterdir() if path.suffix in ('.json', '.log')]
            screenshots = run / 'screenshots'
            if screenshots.exists():
                os.mkdir('screenshots', mode=0o700, dir_fd=ledger.roots[destination][0])
                ledger.pin(destination / 'screenshots')
                files += list(screenshots.iterdir())
            if len(files) > 512:
                raise ValueError('Run evidence inventory exceeds bound; preserve allocation')
            total = 0
            index = []
            for path in files:
                info = path.lstat()
                total += info.st_size
                if total > 64 * 1024 * 1024:
                    raise ValueError('Compact evidence exceeds64MiB; retain original allocation')
                safe(info)
                if not stat.S_ISREG(info.st_mode) or info.st_size > 16 * 1024 * 1024:
                    raise ValueError('Unsafe/oversized run evidence; preserve allocation')
                ledger.pin(path.parent)
                source = os.open(path.name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=ledger.roots[path.parent][0])
                try:
                    before = os.fstat(source)
                    if identity(before) != identity(info):
                        raise ValueError('Run evidence changed while opening')
                    output = destination / path.relative_to(run)
                    ledger.check_root(output.parent)
                    handle = os.open(output.name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=ledger.roots[output.parent][0])
                    digest = hashlib.sha256()
                    with os.fdopen(handle, 'wb') as stream:
                        with os.fdopen(os.dup(source), 'rb') as input_file:
                            for block in iter(lambda: input_file.read(1024 * 1024), b''):
                                stream.write(block)
                                digest.update(block)
                        stream.flush()
                        os.fsync(stream.fileno())
                    index.append({'original': str(path), 'evidence': str(output), 'bytes': before.st_size,
                                  'sha256': digest.hexdigest()})
                    after = os.fstat(source)
                    if (after.st_size, after.st_mtime_ns, after.st_ctime_ns) != (before.st_size, before.st_mtime_ns, before.st_ctime_ns):
                        raise ValueError('Run evidence changed during persistence')
                finally:
                    os.close(source)
            handle = os.open('evidence-index.json', os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=ledger.roots[destination][0])
            with os.fdopen(handle, 'w') as output:
                json.dump(index, output, indent=2)
                output.flush()
                os.fsync(output.fileno())
