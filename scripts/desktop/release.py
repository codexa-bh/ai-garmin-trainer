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
import platform_target
from release_metadata import (
    REPOSITORY,
    UNRELEASED,
    check,
    exact_source,
    prepare,
    promotion,
    prepared_notes,
    version_value,
)
from release_note_fragments import collect
import release_timing as timing
import smoke_resources as resources

ROOT = Path(__file__).resolve().parents[2]


@resources.invocation
def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        'action',
        nargs='?',
        default='check',
        choices=(
            'check',
            'preflight',
            'prepare',
            'build',
            'package',
            'verify',
            'status',
            'draft',
            'publish',
            'release-set',
        ),
    )
    parser.add_argument(
        '--platform',
        choices=platform_target.PLATFORMS,
        default=platform_target.MACOS,
        help='Explicit artifact platform; default keeps the macOS ARM64 meaning',
    )
    parser.add_argument(
        '--platform-record',
        type=Path,
        action='append',
        default=[],
        help='release-set: one verified per-platform record (repeat per platform)',
    )
    parser.add_argument(
        '--release-set',
        type=Path,
        help='Remote actions: stored set, rechecked against explicit --platform-record inputs',
    )
    parser.add_argument('--version')
    parser.add_argument(
        '--preflight-context',
        type=Path,
        help='Disclosure preview/prepare: explicit version, platforms, baseline commit/schema and current schema JSON',
    )
    parser.add_argument(
        '--notes',
        type=Path,
        help='prepare: optional reviewed text placed before the generated fragment changes',
    )
    parser.add_argument('--commit', help='Full reviewed merged SHA, never inferred newest main')
    parser.add_argument('--repository', choices=(REPOSITORY,))
    parser.add_argument('--scratch', type=Path)
    parser.add_argument(
        '--bundle',
        type=Path,
        help='Legitimate desktop:build producer, never a copied/stamped substitute',
    )
    parser.add_argument('--record', type=Path)
    parser.add_argument('--prerelease', choices=('yes', 'no'))
    parser.add_argument('--latest', choices=('yes', 'no'))
    parser.add_argument(
        '--execute', action='store_true', help='Explicit effect intent, not release authorization'
    )
    args = parser.parse_args()
    if hasattr(os, 'umask'):
        os.umask(0o077)
    # Timing is private observation for scratch-backed actions; it selects, approves and retries nothing.
    with timing.recording(
        args.action,
        report=args.platform == platform_target.WINDOWS and args.action in ('package', 'verify'),
        version=args.version,
        commit=args.commit,
    ):
        run(parser, args)


def digest_key(platform_id):
    return 'installerSha256' if platform_id == platform_target.WINDOWS else 'dmgSha256'


def artifacts(platform_id):
    """Package/transport owners for an explicit platform (no inference)."""
    if platform_id == platform_target.WINDOWS:
        import windows_release

        return windows_release.package, windows_release.transported
    from release_artifact import package, transported

    return package, transported


def run(parser, args):
    version, notes = check(ROOT, None if args.action in ('prepare', 'preflight') else args.version)
    if args.action == 'preflight':
        from release_preflight import preview

        if args.preflight_context is None:
            parser.error(
                'preflight requires --preflight-context with explicit baseline/platform/schema context'
            )
        if args.version is not None and args.version != version:
            body, _ = promotion(ROOT, args.notes.read_text() if args.notes else '')
            notes = prepared_notes(version_value(args.version), body)
            version = args.version
        elif args.notes is not None:
            parser.error('--notes is prospective only; choose a new --version')
        print(json.dumps(preview(ROOT, notes, version, args.preflight_context)))
        return
    if args.action == 'release-set':
        # Portable digest assembly of already-verified per-platform records; it
        # never re-admits a foreign host's producer or performs remote effects.
        from release_set import assemble

        if args.scratch is None or not args.platform_record:
            parser.error('release-set requires --scratch and one --platform-record per platform')
        path = assemble(args.platform_record, notes, args.scratch, version=args.version)
        print(
            json.dumps(
                {
                    'releaseSet': str(path),
                    'verification': 'portable digests only; per-platform producer admission happened on each native host',
                }
            )
        )
        return
    if args.action == 'check':
        pending = collect(ROOT / UNRELEASED)
        print(
            json.dumps(
                {
                    'version': version,
                    'status': 'consistent; no release effects',
                    'unreleasedFragments': len(pending),
                }
            )
        )
        return
    if args.action == 'prepare':
        if args.version is None:
            parser.error('prepare requires an explicitly selected future --version')
        version_value(args.version)
        reviewed = args.notes.read_text() if args.notes else ''
        # Validate and plan before any effect, for both the dry run and --execute.
        body, consumed = promotion(ROOT, reviewed)
        if args.platform == platform_target.WINDOWS and args.preflight_context is None:
            parser.error('Windows preparation requires --preflight-context')
        if args.preflight_context is not None:
            from release_preflight import validate

            value = validate(
                ROOT, prepared_notes(args.version, body), args.version, args.preflight_context
            )
            if args.platform == platform_target.WINDOWS and args.platform not in value['platforms']:
                raise ValueError('Windows preparation context omits Windows')
        if args.execute:
            # Preparation also refuses unexplained dirty input before generating a diff.
            from release_metadata import git

            if git(ROOT, 'status', '--porcelain', '--untracked-files=all'):
                raise ValueError('Metadata preparation requires clean source')
            prepare(ROOT, args.version, reviewed, preflight_context=args.preflight_context)
        print(
            json.dumps(
                {
                    'executed': args.execute,
                    'operation': 'local metadata diff only',
                    'version': args.version,
                    'promotedFragments': [path.name for path in consumed],
                }
            )
        )
        return
    if args.action == 'build' or args.action in ('status', 'draft', 'publish'):
        if not args.repository or not args.commit or not args.version:
            parser.error('exact-source actions require --repository, --commit and --version')
        exact_source(ROOT, args.commit, args.repository)
        if args.action == 'build':
            if args.execute:
                platform_target.require_host(args.platform)
                if args.scratch is None:
                    parser.error(
                        'release build requires --scratch for read-only remote preflight evidence'
                    )
                from release_remote import GitHub, build_preflight

                scratch = resources.configure(args.scratch)
                timing.attach(scratch)
                journal = scratch / ('release-build-preflight-' + str(uuid.uuid4()) + '.jsonl')
                timing.reference('remote-preflight-journal', journal.name)
                with journal.open('x') as stream, timing.stage('remote-preflight'):
                    build_preflight(GitHub(stream), args.commit, args.version)
                exact_source(ROOT, args.commit, args.repository)
                build_ordinary(ROOT, args.platform)
                exact_source(ROOT, args.commit, args.repository)
            print(
                json.dumps(
                    {
                        'executed': args.execute,
                        'operation': 'ordinary full build only; no packaging or remote effects',
                    }
                )
            )
            return
    if args.action == 'package' and not args.execute:
        kind = (
            'unsigned per-user NSIS installer'
            if args.platform == platform_target.WINDOWS
            else 'DMG'
        )
        print(
            json.dumps(
                {
                    'executed': False,
                    'platform': args.platform,
                    'operation': 'local '
                    + kind
                    + ' only; use --execute with --bundle and --scratch',
                }
            )
        )
        return
    platform_target.require_host(args.platform)
    package, transported = artifacts(args.platform)
    if args.scratch is None or args.bundle is None:
        parser.error('artifact actions require --scratch and original --bundle')
    scratch = resources.configure(args.scratch)
    timing.attach(scratch)
    bundle = args.bundle
    source = source_snapshot(ROOT)['source']
    with ordinary_preparation(ROOT, bundle, source, scratch) as (verified, inventory):
        if args.action == 'package':
            record = package(ROOT, bundle, source, verified, inventory, scratch)
            timing.correlate(**{digest_key(args.platform): document(record)['artifact']['sha256']})
            size = record.parent / 'size-report.json'
            print(
                json.dumps(
                    {
                        'record': str(record),
                        'platform': args.platform,
                        'artifact': document(record)['artifact'],
                        'localOnly': True,
                        'size': document(size) if size.exists() else None,
                    }
                )
            )
            return
        if args.record is None:
            parser.error('verification/remote actions require --record')
        with transported(ROOT, bundle, source, verified, inventory, args.record, scratch) as (
            _,
            verify_current,
            record,
        ):
            timing.correlate(
                commit=record['commit'],
                version=record['version'],
                **{digest_key(args.platform): record['artifact']['sha256']},
            )
            if args.action == 'verify':
                print(json.dumps({'verified': record, 'launched': False}))
                return
            if (
                record['commit'] != args.commit
                or record['version'] != args.version
                or record['sourceDirty']
            ):
                raise ValueError('Selected record is not the exact clean reviewed release source')
            if hashlib.sha256(notes.encode()).hexdigest() != record['notesSha256']:
                raise ValueError('Reviewed notes differ from artifact record')
            if args.prerelease is None or args.latest is None:
                parser.error(
                    'remote actions require explicit --prerelease yes|no and --latest yes|no'
                )
            if args.platform != platform_target.MACOS:
                raise ValueError(
                    'Remote actions publish one verified release set; use release-set first (fake-provider tested only)'
                )
            from release_remote import GitHub, Release

            journal = scratch / ('release-remote-' + str(uuid.uuid4()) + '.jsonl')
            print(json.dumps({'journal': str(journal)}), flush=True)
            timing.reference('remote-journal', journal.name)
            selected_set, selected_assets = remote_assets(args, record, notes)

            def before_effect():
                verify_current()
                exact_source(ROOT, args.commit, args.repository)
                current_set, current_assets = remote_assets(args, record, notes)
                if (current_set, current_assets) != (selected_set, selected_assets):
                    raise ValueError('Selected release set changed before remote effect')

            with journal.open('x') as stream:
                operation = Release(
                    GitHub(stream),
                    record,
                    notes,
                    selected_assets,
                    args.prerelease == 'yes',
                    args.latest == 'yes',
                    before_effect=before_effect,
                    release_set=selected_set,
                )
                before_effect()
                with timing.stage('remote-' + args.action):
                    result = operation.act(args.action, execute=args.execute)
                before_effect()
            # Restates inputs this invocation just requalified, for the human approval handoff.
            print(json.dumps({'selectedTuple': operation.selected_tuple()}))
            print(json.dumps(result))


def remote_assets(args, record, notes):
    """Keep native macOS admission; foreign inputs need attributed transport, not trust flags."""
    from release_remote import assets_for
    import release_set

    if args.release_set is None:
        if args.platform_record:
            raise ValueError('--platform-record remote inputs require --release-set')
        return None, assets_for(args.record, record)
    dirs = {}
    for path in args.platform_record:
        platform = release_set.platform_of(release_set.load(path))
        if platform in dirs or path.name != release_set.RECORD_NAME[platform]:
            raise ValueError('Duplicate or misnamed platform record')
        dirs[platform] = path.parent
    if dirs.get(platform_target.MACOS) != args.record.parent:
        raise ValueError('Release set must select the originally admitted local macOS record')
    value, assets = release_set.assets(args.release_set, dirs)
    if any(
        value[key] != record[key]
        for key in ('repository', 'commit', 'version', 'tag', 'notesSha256')
    ):
        raise ValueError('Release set differs from the admitted source')
    if hashlib.sha256(notes.encode()).hexdigest() != value['notesSha256']:
        raise ValueError('Reviewed notes differ from release set')
    if platform_target.WINDOWS in dirs:
        from windows_release_export import verify_import

        verify_import(dirs[platform_target.WINDOWS], expected_source=args.commit)
    return value, assets


if __name__ == '__main__':

    def interrupted(_signal, _frame):
        raise KeyboardInterrupt(
            'Release operation interrupted; inspect owned outputs and read-only remote status'
        )

    signal.signal(signal.SIGTERM, interrupted)
    main()
