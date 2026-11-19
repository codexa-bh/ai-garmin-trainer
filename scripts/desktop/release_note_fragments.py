#!/usr/bin/env python3
"""Task-scoped release-note fragments: parse, validate and render. Never writes files.

Contributors add one fragment per change under release-notes/unreleased/. Existing
`release.py prepare` promotes the required ones into the next version's note and
consumes them; this module only reads and renders.
"""

import argparse
from dataclasses import dataclass
from pathlib import Path
import re
import sys

CATEGORIES = ('Added', 'Changed', 'Fixed', 'Removed', 'Security', 'Internal')
FIELDS = ('task', 'pr', 'category', 'release_note_required')
OPTIONAL_FIELDS = ('reason',)
SUPPORT_FILES = ('readme.md', 'template.md')
FILENAME = re.compile(r'(T[0-9]{4})-[a-z0-9]+(?:-[a-z0-9]+)*\.md')
TASK = re.compile(r'T(?!0000$)[0-9]{4}')
PR = re.compile(r'pending|none|[1-9][0-9]*')
NO_CHANGES = 'No changes recorded since the previous release.'


class FragmentError(ValueError):
    """A fragment or the fragment directory is unusable; the message names the path."""


@dataclass(frozen=True)
class Fragment:
    path: Path
    task: str
    category: str
    required: bool
    reason: str
    body: str


def parse(path):
    """Parse one fragment file with a small explicit front-matter grammar."""
    try:
        text = path.read_text(encoding='utf-8')
    except (OSError, UnicodeDecodeError) as error:
        raise FragmentError(f'{path.name}: unreadable fragment ({error})') from error
    lines = text.split('\n')
    if lines[0] != '---' or '---' not in lines[1:]:
        raise FragmentError(f'{path.name}: front matter must start and end with a --- line')
    end = lines.index('---', 1)
    meta = {}
    for number, line in enumerate(lines[1:end], start=2):
        key, separator, value = line.partition(':')
        key, value = key.strip(), value.strip()
        if not separator or not key or not value:
            raise FragmentError(f'{path.name}:{number}: expected a nonempty "key: value" line')
        if key not in FIELDS + OPTIONAL_FIELDS:
            raise FragmentError(f'{path.name}:{number}: unknown field {key!r}')
        if key in meta:
            raise FragmentError(f'{path.name}:{number}: duplicate field {key!r}')
        meta[key] = value
    missing = [key for key in FIELDS if key not in meta]
    if missing:
        raise FragmentError(f'{path.name}: missing field(s): {", ".join(missing)}')
    match = FILENAME.fullmatch(path.name)
    if not match:
        raise FragmentError(f'{path.name}: filename must be T<4-digit task>-<kebab-slug>.md')
    if not TASK.fullmatch(meta['task']) or meta['task'] != match[1]:
        raise FragmentError(
            f'{path.name}: task {meta["task"]!r} must be a nonzero four-digit ID matching the filename'
        )
    if not PR.fullmatch(meta['pr']):
        raise FragmentError(f'{path.name}: pr must be pending, none or a positive PR number')
    if meta['category'] not in CATEGORIES:
        raise FragmentError(f'{path.name}: category must be one of {", ".join(CATEGORIES)}')
    if meta['release_note_required'] not in ('true', 'false'):
        raise FragmentError(f'{path.name}: release_note_required must be true or false')
    required = meta['release_note_required'] == 'true'
    body = '\n'.join(lines[end + 1 :]).strip()
    if required and not body:
        raise FragmentError(f'{path.name}: a required fragment needs a note body')
    if required and 'reason' in meta:
        raise FragmentError(f'{path.name}: reason belongs only on release_note_required: false')
    if not required and 'reason' not in meta:
        raise FragmentError(f'{path.name}: a no-note fragment needs a nonempty reason')
    return Fragment(path, meta['task'], meta['category'], required, meta.get('reason', ''), body)


def collect(directory):
    """Validate every fragment in the directory, in stable filename order.

    A missing directory is the valid empty state. README.md/TEMPLATE.md and non-Markdown
    files are supporting files; symlinks and subdirectories are refused, never followed.
    """
    if directory.is_symlink():
        raise FragmentError(f'{directory.name}: fragment directory must not be a symlink')
    if not directory.exists():
        return []
    fragments = []
    for path in sorted(directory.iterdir(), key=lambda item: item.name):
        if path.is_symlink() or path.is_dir():
            raise FragmentError(f'{path.name}: symlinks and subdirectories are not fragments')
        if path.suffix != '.md' or path.name.lower() in SUPPORT_FILES:
            continue
        fragments.append(parse(path))
    return fragments


def required_fragments(fragments):
    """Required notes in publication order: category, then filename."""
    return sorted(
        (item for item in fragments if item.required),
        key=lambda item: (CATEGORIES.index(item.category), item.path.name),
    )


def render(fragments):
    """Categorized Markdown for required fragments; empty text when there are none."""
    required = required_fragments(fragments)
    if not required:
        return ''
    parts = ['## Changes']
    for category in CATEGORIES:
        entries = [item.body for item in required if item.category == category]
        if entries:
            parts.append(f'### {category}\n\n' + '\n\n'.join(entries))
    return '\n\n'.join(parts) + '\n'


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=('check', 'preview'))
    parser.add_argument(
        '--directory',
        type=Path,
        default=Path(__file__).resolve().parents[2] / 'release-notes' / 'unreleased',
    )
    args = parser.parse_args(argv)
    try:
        fragments = collect(args.directory)
    except FragmentError as error:
        print(f'error: {error}', file=sys.stderr)
        return 1
    if args.action == 'check':
        required = len(required_fragments(fragments))
        print(f'{required} required and {len(fragments) - required} no-note fragment(s) valid')
    else:
        print(render(fragments) or NO_CHANGES + '\n', end='')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
