"""Check tracked Python, excluding tests only from dead-code usage/definitions."""

import argparse
from pathlib import Path
import subprocess
import sys


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('check', choices=('format', 'lint', 'deadcode'))
    check = parser.parse_args().check
    root = Path(__file__).resolve().parent.parent
    tracked = subprocess.check_output(
        ['git', 'ls-files', '-z', '--', '*.py'], cwd=root
    ).decode().split('\0')
    files = [name for name in tracked if name]
    if not files:
        parser.error('No tracked Python files found')
    if check == 'deadcode':
        files = [
            name for name in files
            if not (name.startswith('tests/') or name.endswith('_test.py'))
        ]
        command = ['vulture', '--min-confidence', '60']
    elif check == 'format':
        command = ['ruff', 'format', '--check']
    else:
        command = ['ruff', 'check']
    return subprocess.call([sys.executable, '-m', *command, *files], cwd=root)


if __name__ == '__main__':
    raise SystemExit(main())
