"""The finite desktop target map shared by build, identity, package and release.

Exactly two targets exist. Builds are native-host only; nothing here guesses a
target from an imported record or falls back after a failed selection.
"""

import json
from pathlib import Path
import platform
import sys

INPUTS = Path(__file__).resolve().with_name('runtime-inputs.json')
MACOS = 'macos-arm64'
WINDOWS = 'windows-x64'
PLATFORMS = (MACOS, WINDOWS)
# Host platform identity as Node reports it, per target (runtime-inputs.json `host`).
_PYTHON_HOST = {
    ('darwin', 'arm64'): MACOS,
    ('win32', 'amd64'): WINDOWS,
    ('win32', 'x86_64'): WINDOWS,
}


def targets():
    value = json.loads(INPUTS.read_text())
    if value.get('version') != 2 or sorted(value.get('targets', {})) != sorted(PLATFORMS):
        raise ValueError('Unsupported desktop target map')
    return value['targets']


def target(platform_id):
    if platform_id not in PLATFORMS:
        raise ValueError('Unsupported desktop platform: choose macos-arm64 or windows-x64')
    return targets()[platform_id]


def host():
    """The single target this host can build and verify natively."""
    selected = _PYTHON_HOST.get((sys.platform, platform.machine().lower()))
    if selected is None:
        raise ValueError('Desktop builds require a native macOS ARM64 or Windows x64 host')
    return selected


def require_host(platform_id):
    target(platform_id)
    if host() != platform_id:
        raise ValueError(
            platform_id + ' artifacts are built and verified only on their native host'
        )
    return platform_id
