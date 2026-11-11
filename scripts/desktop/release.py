#!/usr/bin/env python3
"""Local release foundation. Default/check never build, tag, upload, publish or install."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import signal
import uuid

from ordinary_identity import build_ordinary, ordinary_preparation, source_snapshot, document
from release_artifact import package, transported
from release_metadata import REPOSITORY, check, exact_source, prepare, version_value
import smoke_resources as resources

ROOT = Path(__file__).resolve().parents[2]


@resources.invocation
def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', nargs='?', default='check', choices=('check', 'prepare', 'build', 'package', 'verify', 'status', 'draft', 'publish'))
    parser.add_argument('--version')
    parser.add_argument('--notes', type=Path, help='Reviewed body for future metadata preparation only')
    parser.add_argument('--commit', help='Full reviewed merged SHA, never inferred newest main')
    parser.add_argument('--repository', choices=(REPOSITORY,))
    parser.add_argument('--scratch', type=Path)
    parser.add_argument('--bundle', type=Path, help='Legitimate desktop:build producer, never a copied/stamped substitute')
    parser.add_argument('--record', type=Path)
    parser.add_argument('--prerelease', choices=('yes', 'no'))
    parser.add_argument('--latest', choices=('yes', 'no'))
    parser.add_argument('--execute', action='store_true', help='Explicit effect intent, not release authorization')
    args = parser.parse_args()
    os.umask(0o077)
    version, notes = check(ROOT, None if args.action == 'prepare' else args.version)
    if args.action == 'check':
        print(json.dumps({'version': version, 'status': 'consistent; no release effects'}))
        return
    if args.action == 'prepare':
        if args.version is None or args.notes is None:
            parser.error('prepare requires an explicitly selected future --version and --notes body')
        version_value(args.version)
        if args.execute:
            # Preparation also refuses unexplained dirty input before generating a diff.
            from release_metadata import git
            if git(ROOT, 'status', '--porcelain', '--untracked-files=all'):
                raise ValueError('Metadata preparation requires clean source')
            prepare(ROOT, args.version, args.notes.read_text())
        print(json.dumps({'executed': args.execute, 'operation': 'local metadata diff only', 'version': args.version}))
        return
    if args.action == 'build' or args.action in ('status', 'draft', 'publish'):
        if not args.repository or not args.commit or not args.version:
            parser.error('exact-source actions require --repository, --commit and --version')
        exact_source(ROOT, args.commit, args.repository)
        if args.action == 'build':
            if args.execute:
                if args.scratch is None:
                    parser.error('release build requires --scratch for read-only remote preflight evidence')
                from release_remote import GitHub, build_preflight
                scratch = resources.configure(args.scratch)
                journal = scratch / ('release-build-preflight-' + str(uuid.uuid4()) + '.jsonl')
                with journal.open('x') as stream:
                    build_preflight(GitHub(stream), args.commit, args.version)
                exact_source(ROOT, args.commit, args.repository)
                build_ordinary(ROOT)
                exact_source(ROOT, args.commit, args.repository)
            print(json.dumps({'executed': args.execute, 'operation': 'ordinary full build only; no packaging or remote effects'}))
            return
    if args.action == 'package' and not args.execute:
        print(json.dumps({'executed': False, 'operation': 'local DMG only; use --execute with --bundle and --scratch'}))
        return
    if args.scratch is None or args.bundle is None:
        parser.error('artifact actions require --scratch and original --bundle')
    scratch = resources.configure(args.scratch)
    bundle = args.bundle
    source = source_snapshot(ROOT)['source']
    with ordinary_preparation(ROOT, bundle, source, scratch) as (verified, inventory):
        if args.action == 'package':
            record = package(ROOT, bundle, source, verified, inventory, scratch)
            print(json.dumps({'record': str(record), 'artifact': document(record)['artifact'], 'localOnly': True}))
            return
        if args.record is None:
            parser.error('verification/remote actions require --record')
        with transported(ROOT, bundle, source, verified, inventory, args.record, scratch) as (_, verify_current, record):
            if args.action == 'verify':
                print(json.dumps({'verified': record, 'launched': False}))
                return
            if record['commit'] != args.commit or record['version'] != args.version or record['sourceDirty']:
                raise ValueError('Selected record is not the exact clean reviewed release source')
            if hashlib.sha256(notes.encode()).hexdigest() != record['notesSha256']:
                raise ValueError('Reviewed notes differ from artifact record')
            if args.prerelease is None or args.latest is None:
                parser.error('remote actions require explicit --prerelease yes|no and --latest yes|no')
            from release_remote import GitHub, Release, assets_for
            journal = scratch / ('release-remote-' + str(uuid.uuid4()) + '.jsonl')
            print(json.dumps({'journal': str(journal)}), flush=True)
            def before_effect():
                verify_current()
                exact_source(ROOT, args.commit, args.repository)
            with journal.open('x') as stream:
                operation = Release(GitHub(stream), record, notes, assets_for(args.record, record),
                                    args.prerelease == 'yes', args.latest == 'yes', before_effect=before_effect)
                verify_current()
                result = operation.act(args.action, execute=args.execute)
                verify_current()
                exact_source(ROOT, args.commit, args.repository)
            print(json.dumps(result))


if __name__ == '__main__':
    def interrupted(_signal, _frame):
        raise KeyboardInterrupt('Release operation interrupted; inspect owned outputs and read-only remote status')
    signal.signal(signal.SIGTERM, interrupted)
    main()
