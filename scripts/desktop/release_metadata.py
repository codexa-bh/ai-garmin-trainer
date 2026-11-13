"""Version and exact-source contract. No build, tag or provider mutations here."""
import json
import re
import subprocess
from pathlib import Path

from ordinary_identity import document

REPOSITORY = 'codexa-bh/ai-garmin-trainer'
WARNINGS = ('Unsigned and not notarized; macOS may refuse to open this app.\n'
            'Existing databases require the matching source CLI, a stopped owner and verified backups; startup never upgrades them.\n'
            'Bundled notices are not redistribution authorization.\n')
VERSION = r'(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?'


def version_value(value):
    if not isinstance(value, str) or not re.fullmatch(VERSION, value):
        raise ValueError('Version must be unambiguous SemVer without build metadata')
    if '-' in value and any(part.isdigit() and len(part) > 1 and part[0] == '0' for part in value.split('-', 1)[1].split('.')):
        raise ValueError('Numeric prerelease identifiers cannot have leading zeros')
    return value


def cargo_version(text):
    matches = re.findall(r'(?ms)^\[package\]\nname = "garmin-trainer-desktop"\nversion = "([^"]+)"', text)
    if len(matches) != 1:
        raise ValueError('Expected one root Cargo package version')
    return matches[0]


def lock_version(text):
    matches = re.findall(r'(?m)^name = "garmin-trainer-desktop"\nversion = "([^"]+)"', text)
    if len(matches) != 1:
        raise ValueError('Expected one root Cargo lock version')
    return matches[0]


def check(root, expected=None, *, prepared=False):
    package = document(root / 'package.json')
    version = version_value(package.get('version'))
    lock = document(root / 'package-lock.json')
    tauri = document(root / 'src-tauri/tauri.conf.json')
    mirrors = [lock.get('version'), lock['packages'][''].get('version'), tauri.get('version'),
               cargo_version((root / 'src-tauri/Cargo.toml').read_text()),
               lock_version((root / 'src-tauri/Cargo.lock').read_text())]
    if any(value != version for value in mirrors) or expected not in (None, version):
        raise ValueError('Version mirrors/expected version disagree')
    notes = root / 'release-notes' / (version + '.md')
    text = notes.read_text()
    if notes.is_symlink() or not text.startswith('# Garmin Trainer ' + version + '\n\nStatus: '):
        raise ValueError('Versioned notes missing or mismatched')
    status = text.splitlines()[2]
    if status not in ('Status: unreleased', 'Status: prepared') or (prepared and status != 'Status: prepared'):
        raise ValueError('Reviewed prepared notes required for a real release')
    if not all(line in text for line in WARNINGS.splitlines()):
        raise ValueError('Release signing/upgrade/rights warnings missing')
    return version, text


def prepare(root, version, body):
    """Local metadata diff only, intended for a separate future cut PR."""
    old, _ = check(root)
    version_value(version)
    destination = root / 'release-notes' / (version + '.md')
    if old == version or destination.exists() or destination.is_symlink() or not body.strip():
        raise ValueError('Select a new version and nonempty reviewed notes; no overwrite')
    changes = {}
    for name in ('package.json', 'package-lock.json'):
        path = root / name
        value = document(path)
        value['version'] = version
        if name == 'package-lock.json':
            value['packages']['']['version'] = version
        changes[path] = json.dumps(value, indent=2) + '\n'
    # The Tauri file is hand-formatted with non-ASCII text: change only its one
    # version token, then prove the parsed document differs in nothing else.
    path = root / 'src-tauri/tauri.conf.json'
    text, count = re.subn(r'("version": ")' + re.escape(old) + '"', lambda match: match[1] + version + '"', path.read_text())
    if count != 1 or json.loads(text) != {**document(path), 'version': version}:
        raise ValueError('Ambiguous Tauri metadata')
    changes[path] = text
    for name, reader in [('src-tauri/Cargo.toml', cargo_version), ('src-tauri/Cargo.lock', lock_version)]:
        path = root / name
        text = path.read_text()
        reader(text)
        # Scope the replacement to the owned crate, never dependency versions.
        text, count = re.subn(r'(name = "garmin-trainer-desktop"\nversion = ")[^"]+("\n)',
                             lambda match: match[1] + version + match[2], text)
        if count != 1:
            raise ValueError('Ambiguous Cargo metadata')
        changes[path] = text
    with destination.open('x') as stream:
        stream.write('# Garmin Trainer ' + version + '\n\nStatus: prepared\n\n' + WARNINGS + '\n' + body.strip() + '\n')
    for path, text in changes.items():
        path.write_text(text)
    check(root, version, prepared=True)


def git(root, *args):
    return subprocess.check_output(['git', *args], cwd=root, text=True, timeout=30).strip()


def exact_source(root, commit, repository):
    if repository != REPOSITORY or not re.fullmatch(r'[0-9a-f]{40}', commit or ''):
        raise ValueError('Explicit canonical repository and full reviewed commit required')
    if root.resolve(strict=True) != root or git(root, 'rev-parse', 'HEAD') != commit:
        raise ValueError('Canonical checkout HEAD differs from selected commit')
    if git(root, 'status', '--porcelain', '--untracked-files=all'):
        raise ValueError('Release inputs must be clean including untracked/deleted files')
    if git(root, 'remote', 'get-url', 'origin') not in (
            'git@github.com:' + repository + '.git', 'https://github.com/' + repository + '.git',
            'https://github.com/' + repository):
        raise ValueError('Unexpected source remote')
    # Explicitly refreshed origin/main is a prerequisite; do not retarget HEAD to its tip.
    subprocess.run(['git', 'merge-base', '--is-ancestor', commit, 'origin/main'], cwd=root, check=True, timeout=30)
    return check(root, prepared=True)
