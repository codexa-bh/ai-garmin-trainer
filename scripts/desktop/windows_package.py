"""Non-installing identity of the unsigned per-user NSIS installer.

The installer is never executed. Its payload is listed and extracted with a
fixed-location 7-Zip (version bound into identity) into an exclusive owned directory, and every
member name is validated before extraction. The extracted program files and
resources form the payload inventory that build identity and release
verification compare with the legitimate producer outputs.
"""

import hashlib
import json
import os
from pathlib import Path, PurePosixPath, PureWindowsPath
import re
import stat
import subprocess
import uuid

import platform_files
from release_timing import stage

PRODUCT = 'AI Trainer for Garmin Connect'
BINARY = 'garmin-trainer-desktop.exe'
# 7-Zip's full extractor at its fixed install location (never PATH). A
# prerequisite like the MSVC toolchain; its version is bound into build identity.
SEVEN_ZIP_DIRS = ('ProgramFiles', 'ProgramW6432')
# Members NSIS itself adds for the installer UI/uninstaller, never app payload.
INSTALLER_ONLY = re.compile(r'^(\$PLUGINSDIR|\$TEMP|uninstall\.exe$|\[NSIS\]\.nsi$)', re.I)
MAX_MEMBERS = 60_000
MAX_BYTES = 2 * 1024 * 1024 * 1024


def installer_path(repo, version):
    return (
        repo
        / 'src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis'
        / f'{PRODUCT}_{version}_x64-setup.exe'
    )


def digest(path):
    value = hashlib.sha256()
    fd = platform_files.open_nofollow(path, os.O_RDONLY)
    with os.fdopen(fd, 'rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            value.update(block)
    return value.hexdigest()


def extractor():
    """The fixed-location 7-Zip console extractor, or a clear prerequisite error."""
    for variable in SEVEN_ZIP_DIRS:
        root = os.environ.get(variable)
        if root and re.match(r'^[A-Za-z]:\\', root):
            executable = Path(root) / '7-Zip' / '7z.exe'
            if executable.is_file() and not platform_files.is_link(executable.lstat()):
                return executable
    raise ValueError(
        '7-Zip (7z.exe in Program Files\\7-Zip) is required to verify the installer without running it'
    )


@stage('windows-list-members')
def members(seven_zip, installer):
    """Validated member list; installer bytes are only read."""
    listing = subprocess.run(
        [str(seven_zip), 'l', '-slt', '-ba', '-sccUTF-8', str(installer)],
        capture_output=True,
        timeout=300,
    )
    if listing.returncode:
        raise ValueError('Installer payload listing failed; installer is not trusted')
    entries, current = [], {}
    for line in listing.stdout.decode('utf8').splitlines() + ['']:
        if not line.strip():
            if current:
                entries.append(current)
                current = {}
            continue
        key, _, value = line.partition(' = ')
        current[key.strip()] = value
    names, total = [], 0
    for entry in entries:
        name = entry.get('Path', '')
        if entry.get('Folder') == '+':
            continue
        parts = PureWindowsPath(name).parts
        if (
            not name
            or PureWindowsPath(name).is_absolute()
            or PureWindowsPath(name).drive
            or any(part in ('', '.', '..') for part in parts)
            or ':' in name
            or any(ord(c) < 32 for c in name)
        ):
            raise ValueError('Unsafe installer member name refused')
        total += int(entry.get('Size') or 0)
        names.append(name)
    if (
        not names
        or len(names) > MAX_MEMBERS
        or total > MAX_BYTES
        or len(set(n.lower() for n in names)) != len(names)
    ):
        raise ValueError('Installer payload empty, duplicated or outside bounds')
    return sorted(names)


@stage('windows-payload')
def payload(seven_zip, installer, workspace):
    """Extract into an exclusive new directory and return {relative: sha256}."""
    names = members(seven_zip, installer)
    destination = workspace / ('payload-' + str(uuid.uuid4()))
    destination.mkdir()
    with stage('windows-extract'):
        result = subprocess.run(
            [str(seven_zip), 'x', '-y', '-bd', '-snl-', '-o' + str(destination), str(installer)],
            capture_output=True,
            timeout=600,
        )
    if result.returncode:
        raise ValueError('Installer payload extraction failed; nothing was installed')
    inventory = payload_inventory(destination)
    extracted = {PurePosixPath(*PureWindowsPath(name).parts).as_posix() for name in names}
    if not set(inventory) <= extracted:
        raise ValueError('Extracted payload differs from the validated member list')
    return destination, inventory


@stage('windows-extracted-inventory-hash')
def payload_inventory(destination):
    inventory = {}
    for path in sorted(destination.rglob('*')):
        info = path.lstat()
        if platform_files.is_link(info):
            raise ValueError('Installer payload link refused')
        if stat.S_ISDIR(info.st_mode):
            continue
        relative = path.relative_to(destination).as_posix()
        if INSTALLER_ONLY.search(relative):
            continue
        inventory[relative] = digest(path)
    return inventory


@stage('windows-producer-inventory-hash')
def expected(release_dir, resources):
    """Program files the installer must carry: the binary and every resource."""
    result = {BINARY: digest(release_dir / BINARY)}
    for path in sorted(resources.rglob('*')):
        info = path.lstat()
        if platform_files.is_link(info):
            raise ValueError('Producer resource link refused')
        if stat.S_ISREG(info.st_mode):
            relative = path.relative_to(resources.parent).as_posix()
            result[relative] = digest(path)
    return result


def check_payload(inventory, release_dir, resources):
    """The installer carries exactly the producer's binary and resources."""
    wanted = expected(release_dir, resources)
    if inventory != wanted:
        missing = sorted(set(wanted) - set(inventory))[:5]
        extra = sorted(set(inventory) - set(wanted))[:5]
        changed = sorted(k for k in set(wanted) & set(inventory) if wanted[k] != inventory[k])[:5]
        raise ValueError(
            'Installer payload differs from producer: '
            + json.dumps({'missing': missing, 'extra': extra, 'changed': changed})
        )
    return wanted


def pe_machine(path):
    """COFF machine of a PE image (0x8664 = x64)."""
    with path.open('rb') as stream:
        header = stream.read(4096)
    if header[:2] != b'MZ':
        return None
    offset = int.from_bytes(header[0x3C:0x40], 'little')
    if header[offset : offset + 4] != b'PE\0\0':
        return None
    return int.from_bytes(header[offset + 4 : offset + 6], 'little')
