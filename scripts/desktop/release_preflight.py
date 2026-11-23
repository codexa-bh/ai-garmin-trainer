"""Cheap prospective disclosure checks; no artifact, provider or approval authority."""

import json
import re

import platform_target
from release_metadata import REPOSITORY, git, version_value
from ordinary_identity import document

SCHEMA_PATH = 'src/lib/db/migrations.ts'
# Narrow, documented literal assertions, not a semantic grader for arbitrary notes.
WINDOWS = (
    'Windows x64 alpha',
    'no Authenticode verified publisher',
    'Windows Server 2025 x64',
    'not Windows 11, Windows 10 or ARM support',
    'nor qualification of trusted input, normal onboarding or real-service access',
)
MACOS = (
    'macOS',
    'not notarized',
    'minimum macOS 12.0 is not minimum-OS certification',
)
RECOVERY = (
    'explicit database upgrade',
    'prior compatible app',
    'database backup and settings',
)
WINDOWS_MIGRATION = 'Windows existing-database migration via the source CLI is not qualified'


def schema(text):
    values = re.findall(r'^export const LATEST_SCHEMA_VERSION = ([1-9][0-9]*);$', text, re.M)
    if len(values) != 1:
        raise ValueError('Preflight needs one source LATEST_SCHEMA_VERSION')
    return int(values[0])


def context(root, path, version):
    value = document(path)
    if not isinstance(value, dict) or set(value) != {'version', 'platforms', 'baseline', 'schema'}:
        raise ValueError('Preflight context requires version, platforms, baseline and schema')
    if version_value(value['version']) != version:
        raise ValueError('Preflight context version differs from selected notes')
    platforms = value['platforms']
    if (
        not isinstance(platforms, list)
        or not platforms
        or any(item not in platform_target.PLATFORMS for item in platforms)
        or len(set(platforms)) != len(platforms)
    ):
        raise ValueError('Preflight requires explicit unique supported platforms')
    baseline = value['baseline']
    if (
        not isinstance(baseline, dict)
        or set(baseline) != {'commit', 'version', 'schema'}
        or not isinstance(baseline['commit'], str)
        or not re.fullmatch(r'[0-9a-f]{40}', baseline['commit'])
        or type(baseline['schema']) is not int
        or type(value['schema']) is not int
    ):
        raise ValueError('Preflight baseline needs full commit, version and integer schema')
    version_value(baseline['version'])
    # Explicit immutable input only: no tag/Latest lookup, network or DB access.
    commit = baseline['commit']
    git(root, 'merge-base', '--is-ancestor', commit, 'HEAD')
    prior = json.loads(git(root, 'show', commit + ':package.json'))['version']
    old_schema = schema(git(root, 'show', commit + ':' + SCHEMA_PATH))
    current_schema = schema((root / SCHEMA_PATH).read_text())
    if (prior, old_schema, current_schema) != (
        baseline['version'],
        baseline['schema'],
        value['schema'],
    ) or old_schema > current_schema:
        raise ValueError('Preflight baseline/current source version or schema contradicts context')
    return value


def validate(root, notes, version, path):
    value = context(root, path, version)
    baseline = value['baseline']
    old, new = baseline['schema'], value['schema']
    required = [
        'unsigned',
        'matching source CLI',
        'stopped owner',
        'verified backups',
        'startup never upgrades them',
        'Bundled notices are not redistribution authorization',
    ]
    if platform_target.WINDOWS in value['platforms']:
        required.extend(WINDOWS)
    if platform_target.MACOS in value['platforms']:
        required.extend(MACOS)
    if old == new:
        required.append(f'No database schema change: {old} → {new}.')
    else:
        required.extend(RECOVERY)
        required.append(
            f'Version {baseline["version"]} uses schema {old}; this release uses schema {new}.'
        )
        if platform_target.WINDOWS in value['platforms']:
            required.append(WINDOWS_MIGRATION)
    text = notes.replace('**', '').casefold()
    missing = [
        item
        for item in required
        if not re.search(r'(?<!\w)' + re.escape(item.casefold()) + r'(?!\w)', text)
    ]
    if missing:
        raise ValueError('Release disclosure missing: ' + '; '.join(missing))
    declarations = re.findall(
        r'Version ([0-9A-Za-z.-]+) uses schema ([0-9]+); this release uses schema ([0-9]+)\.', notes
    )
    unchanged = re.findall(r'No database schema change: ([0-9]+) → ([0-9]+)\.', notes)
    if any(item != (baseline['version'], str(old), str(new)) for item in declarations) or any(
        item != (str(old), str(new)) or old != new for item in unchanged
    ):
        raise ValueError('Release schema disclosure contradicts explicit context')
    return value


def preview(root, notes, version, path):
    value = validate(root, notes, version, path)
    # Use the publisher itself, not a parallel public-body template. Unresolved
    # values cannot masquerade as selected source/artifact identities.
    from release_remote import release_body, set_body
    from release_artifact import SIGNING as MACOS_SIGNING
    from windows_release import SIGNING as WINDOWS_SIGNING

    unresolved = 'UNRESOLVED — preview only'
    if value['platforms'] == [platform_target.MACOS]:
        body = release_body(
            {
                'repository': REPOSITORY,
                'commit': unresolved,
                'artifact': {'sha256': unresolved},
                'signing': MACOS_SIGNING,
            },
            notes,
        )
    else:
        body = set_body(
            {
                'repository': REPOSITORY,
                'commit': unresolved,
                'entries': [
                    {
                        'platform': item,
                        'assets': [{'sha256': unresolved}],
                        'signing': WINDOWS_SIGNING
                        if item == platform_target.WINDOWS
                        else MACOS_SIGNING,
                    }
                    for item in value['platforms']
                ],
            },
            notes,
        )
    return {
        'result': 'disclosure check only; not release eligibility',
        'body': body,
        'context': value,
    }
