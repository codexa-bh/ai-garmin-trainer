"""Cheap deterministic boundaries; actual macOS DMG/native evidence is separate."""
import contextlib
import copy
import json
import os
from pathlib import Path
import plistlib
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import release_artifact as artifact
import release_metadata as metadata
from release_remote import GitHub, Release, assets_for, build_preflight
from release_smoke import REQUIRED


class MetadataTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name).resolve()
        (self.root / 'src-tauri').mkdir()
        (self.root / 'release-notes').mkdir()
        for name, value in [('package.json', {'name': 'test', 'version': '0.1.0'}),
                            ('package-lock.json', {'version': '0.1.0', 'packages': {'': {'version': '0.1.0'}}}),
                            ('src-tauri/tauri.conf.json', {'version': '0.1.0'})]:
            (self.root / name).write_text(json.dumps(value))
        (self.root / 'src-tauri/Cargo.toml').write_text('[package]\nname = "garmin-trainer-desktop"\nversion = "0.1.0"\n')
        (self.root / 'src-tauri/Cargo.lock').write_text('[[package]]\nname = "garmin-trainer-desktop"\nversion = "0.1.0"\n\n[[package]]\nname = "dependency"\nversion = "0.1.0"\n')
        (self.root / 'release-notes/0.1.0.md').write_text('# Garmin Trainer 0.1.0\n\nStatus: unreleased\n\n' + metadata.WARNINGS)

    def tearDown(self):
        self.temp.cleanup()

    def test_current_repository_metadata_consistent(self):
        root = Path(__file__).resolve().parents[2]
        self.assertEqual(metadata.check(root)[0], json.loads((root / 'package.json').read_text())['version'])

    def test_checks_and_prepares_only_owned_versions_in_fixture(self):
        self.assertEqual(metadata.check(self.root)[0], '0.1.0')
        with self.assertRaisesRegex(ValueError, 'prepared'):
            metadata.check(self.root, prepared=True)
        metadata.prepare(self.root, '0.2.0-rc.1', 'Reviewed synthetic future changes')
        self.assertEqual(metadata.check(self.root, prepared=True)[0], '0.2.0-rc.1')
        self.assertIn('name = "dependency"\nversion = "0.1.0"', (self.root / 'src-tauri/Cargo.lock').read_text())
        with self.assertRaises(ValueError):
            metadata.prepare(self.root, '0.2.0-rc.1', 'no overwrite')

    def test_malformed_versions_and_mirrors_refuse(self):
        for version in ['v1.2.3', '01.2.3', '1.2', '1.2.3+ambiguous', '../1.2.3', '1.2.3-01']:
            with self.subTest(version=version), self.assertRaises(ValueError):
                metadata.version_value(version)
        (self.root / 'src-tauri/tauri.conf.json').write_text('{"version":"1.0.0"}')
        with self.assertRaisesRegex(ValueError, 'disagree'):
            metadata.check(self.root)

    def test_duplicate_json_and_conflicting_notes_refuse(self):
        (self.root / 'package.json').write_text('{"version":"0.1.0","version":"1.0.0"}')
        with self.assertRaisesRegex(ValueError, 'Duplicate'):
            metadata.check(self.root)

    def test_exact_source_requires_clean_pinned_canonical_remote_and_merged_commit(self):
        sha = 'a' * 40
        responses = {'rev-parse': sha, 'status': '', 'remote': 'git@github.com:' + metadata.REPOSITORY + '.git'}
        with patch('release_metadata.git', side_effect=lambda root, command, *args: responses[command]), patch('release_metadata.subprocess.run') as ancestry:
            with self.assertRaises(ValueError):
                metadata.exact_source(self.root, 'main', metadata.REPOSITORY)
            with self.assertRaises(ValueError):
                metadata.exact_source(self.root, sha, 'other/repo')
            responses['status'] = '?? unreviewed.py'
            with self.assertRaisesRegex(ValueError, 'clean'):
                metadata.exact_source(self.root, sha, metadata.REPOSITORY)
            responses['status'] = ''
            responses['remote'] = 'https://github.com/other/repo'
            with self.assertRaisesRegex(ValueError, 'remote'):
                metadata.exact_source(self.root, sha, metadata.REPOSITORY)
            responses['remote'] = 'git@github.com:' + metadata.REPOSITORY + '.git'
            metadata.prepare(self.root, '0.2.0', 'fixture')
            self.assertEqual(metadata.exact_source(self.root, sha, metadata.REPOSITORY)[0], '0.2.0')
            ancestry.assert_called_once()


class PayloadTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name).resolve()
        self.app = self.root / artifact.APP_NAME
        binary = self.app / 'Contents/MacOS/garmin-trainer-desktop'
        binary.parent.mkdir(parents=True)
        binary.write_bytes(b' '.join(REQUIRED))
        binary.chmod(0o755)

    def tearDown(self):
        self.temp.cleanup()

    def test_hash_accepts_read_atime_but_refuses_content_or_inode_change(self):
        path = self.root / 'fresh.dmg'
        path.write_bytes(b'synthetic final image')
        os.utime(path, ns=(1, path.stat().st_mtime_ns))
        self.assertEqual(artifact.digest(path), __import__('hashlib').sha256(path.read_bytes()).hexdigest())
        initial = path.stat()
        from types import SimpleNamespace
        changed = SimpleNamespace(**{name: getattr(initial, name) for name in
                                    ('st_dev', 'st_ino', 'st_size', 'st_mode', 'st_nlink', 'st_uid', 'st_mtime_ns', 'st_ctime_ns')})
        changed.st_ino += 1
        with patch.object(artifact.os, 'fstat', return_value=changed):
            with self.assertRaisesRegex(ValueError, 'replaced'):
                artifact.digest(path)

    def test_complete_identity_binds_modes_xattrs_and_bytes(self):
        initial = artifact.tree_identity(self.app)
        binary = self.app / 'Contents/MacOS/garmin-trainer-desktop'
        binary.chmod(0o644)
        self.assertNotEqual(artifact.tree_identity(self.app), initial)
        binary.chmod(0o755)
        self.assertEqual(artifact.tree_identity(self.app), initial)
        if hasattr(os, 'setxattr'):
            os.setxattr(binary, 'user.release-test', b'synthetic')
        else:
            subprocess.run(['/usr/bin/xattr', '-w', 'user.release-test', 'synthetic', str(binary)], check=True)
        self.assertNotEqual(artifact.tree_identity(self.app), initial)

    def test_payload_requires_runtime_notices_architecture_and_declared_signing(self):
        root = self.app / 'Contents/Resources/resources'
        for name in ['NODE-LICENSE.txt', 'THIRD-PARTY-NOTICES.txt', 'REDISTRIBUTION-REVIEW.txt',
                     'redistribution/index.json', 'redistribution/NOTICES.txt', 'redistribution/sources/native-crates.tar.gz',
                     'runtime/runtime.cjs', 'runtime/scripts/garmin_auth.py', 'runtime/scripts/garmin_auth.py.lock',
                     'runtime/node_modules/better-sqlite3/build/Release/better_sqlite3.node',
                     'runtime/node_modules/@img/sharp-darwin-arm64/lib/sharp-darwin-arm64-0.35.5.node',
                     'runtime/node_modules/@img/sharp-libvips-darwin-arm64/lib/libvips-cpp.8.18.7.dylib', 'node']:
            path = root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(b'synthetic bundled input')
        (root / 'node').chmod(0o755)
        (self.app / 'Contents/Info.plist').write_bytes(plistlib.dumps({
            'CFBundleIdentifier': 'com.codexa.garmin-trainer.desktop', 'CFBundleShortVersionString': '0.1.0',
            'CFBundleVersion': '0.1.0', 'CFBundleExecutable': 'garmin-trainer-desktop'}))
        def inspect(args, **kwargs):
            return subprocess.CompletedProcess(args, 0, b'arm64' if 'lipo' in args[0] else b'Signature=adhoc', b'')
        with patch.object(artifact, 'provenance', return_value={'files': []}), patch.object(artifact, 'run', side_effect=inspect):
            self.assertTrue(artifact.payload_checks(self.app, '0.1.0'))
            with self.assertRaisesRegex(ValueError, 'version'):
                artifact.payload_checks(self.app, '1.0.0')
            for required in ['NODE-LICENSE.txt', 'redistribution/index.json', 'redistribution/NOTICES.txt',
                             'redistribution/sources/native-crates.tar.gz']:
                path = root / required
                original = path.read_bytes()
                path.unlink()
                with self.subTest(required=required), self.assertRaises(FileNotFoundError):
                    artifact.payload_checks(self.app, '0.1.0')
                path.write_bytes(original)
            with patch.object(artifact, 'run', return_value=subprocess.CompletedProcess([], 0, b'x86_64', b'')):
                with self.assertRaisesRegex(ValueError, 'ARM64'):
                    artifact.payload_checks(self.app, '0.1.0')
            def certificate(args, **kwargs):
                return subprocess.CompletedProcess(args, 0, b'arm64' if 'lipo' in args[0] else b'Authority=Unexpected Developer ID', b'')
            with patch.object(artifact, 'run', side_effect=certificate):
                with self.assertRaisesRegex(ValueError, 'signing'):
                    artifact.payload_checks(self.app, '0.1.0')

    def test_private_sentinels_and_aliases_hardlinks_refuse(self):
        for name in ['.env.local', 'settings-v3.json', 'tokens.json', 'test.sqlite-wal', '__pycache__']:
            path = self.app / name
            path.write_text('synthetic private sentinel')
            with self.subTest(name=name), self.assertRaises(ValueError):
                artifact.tree_identity(self.app)
            path.unlink()
        alias = self.app / 'alias'
        alias.symlink_to('/Applications')
        with self.assertRaises(ValueError):
            artifact.tree_identity(self.app)
        alias.unlink()
        os.link(self.app / 'Contents/MacOS/garmin-trainer-desktop', alias)
        with self.assertRaises(ValueError):
            artifact.tree_identity(self.app)

    def fake_hdi(self, args, **kwargs):
        if args[1] == 'attach':
            mount = Path(args[args.index('-mountpoint') + 1])
            shutil.copytree(self.app, mount / artifact.APP_NAME)
            return subprocess.CompletedProcess(args, 0, plistlib.dumps({'system-entities': [{'mount-point': str(mount)}]}), b'')
        return subprocess.CompletedProcess(args, 0, b'', b'')

    def test_readonly_mount_settles_even_on_failed_consumer(self):
        with patch.object(artifact, 'run', side_effect=self.fake_hdi) as run:
            with self.assertRaisesRegex(ValueError, 'oracle'):
                with artifact.mounted(self.root / 'fixture.dmg', self.root) as payload:
                    self.assertEqual(artifact.tree_identity(payload), artifact.tree_identity(self.app))
                    raise ValueError('oracle failure')
            self.assertEqual(run.call_args.args[0][1], 'detach')
            attach = run.call_args_list[0].args[0]
            self.assertTrue(all(flag in attach for flag in ['-readonly', '-nobrowse', '-noautoopen']))
            self.assertEqual(json.loads(next(self.root.glob('mount-*.json')).read_text())['detach'], 'observed')

    def test_attach_timeout_is_unknown_not_retried_or_blind_detached(self):
        with patch.object(artifact, 'run', side_effect=subprocess.TimeoutExpired('hdiutil', 120)) as run:
            with self.assertRaises(subprocess.TimeoutExpired):
                with artifact.mounted(self.root / 'fixture.dmg', self.root):
                    self.fail('must not yield')
            self.assertEqual(run.call_count, 1)
            receipt = json.loads(next(self.root.glob('mount-*.json')).read_text())
            self.assertIn('unknown', receipt['attach'])
            self.assertEqual(receipt['detach'], 'not attempted')

    def test_transported_refuses_bad_record_and_rechecks_each_boot_and_settlement(self):
        record_path = self.root / 'release.json'
        record_path.write_text('{"artifact":{"name":"../escape.dmg"}}')
        with self.assertRaisesRegex(ValueError, 'Unsafe'):
            with artifact.transported(self.root, self.app, 'source', {}, {}, record_path, self.root):
                self.fail('must not yield')
        dmg = self.root / 'fixture.dmg'
        dmg.write_bytes(b'final image')
        record = {'artifact': {'name': dmg.name, 'sha256': artifact.digest(dmg)}}
        record_path.write_text(json.dumps(record))
        @contextlib.contextmanager
        def image(*args):
            yield self.app, record
        with patch.object(artifact, 'verified_image', image), patch.object(artifact, 'verify_ordinary') as verify:
            with artifact.transported(self.root, self.app, 'source', {}, {}, record_path, self.root) as (_, verify_current, _):
                verify_current()
                self.assertEqual(verify.call_count, 2)
            self.assertEqual(verify.call_count, 3)
            with self.assertRaisesRegex(ValueError, 'changed'):
                with artifact.transported(self.root, self.app, 'source', {}, {}, record_path, self.root):
                    dmg.write_bytes(b'corrupted image')

    def test_final_image_matches_metadata_and_refuses_corruption(self):
        dmg = self.root / 'fixture.dmg'
        dmg.write_bytes(b'final image')
        expected = artifact.tree_identity(self.app)
        record = {'synthetic': 'public record'}
        @contextlib.contextmanager
        def mounted(*args):
            yield self.app
        with patch.object(artifact, 'verify_ordinary'), patch.object(artifact, 'check', return_value=('0.1.0', 'notes')), patch.object(artifact, 'run'), patch.object(artifact, 'payload_checks', return_value=expected), patch.object(artifact, 'mounted', mounted), patch.object(artifact, 'record_for', return_value=record):
            with artifact.verified_image(self.root, self.app, 'source', {}, {}, dmg, self.root, record) as (_, observed):
                self.assertEqual(observed, record)
            with self.assertRaisesRegex(ValueError, 'record'):
                with artifact.verified_image(self.root, self.app, 'source', {}, {}, dmg, self.root, {'stale': True}):
                    self.fail('stale record must refuse')
            with self.assertRaisesRegex(ValueError, 'DMG changed'):
                with artifact.verified_image(self.root, self.app, 'source', {}, {}, dmg, self.root, record):
                    dmg.write_bytes(b'changed image')
        with patch.object(artifact, 'verify_ordinary'), patch.object(artifact, 'check', return_value=('0.1.0', 'notes')), patch.object(artifact, 'run'), patch.object(artifact, 'payload_checks', side_effect=[expected, {}]), patch.object(artifact, 'mounted', mounted):
            with self.assertRaisesRegex(ValueError, 'payload differs'):
                with artifact.verified_image(self.root, self.app, 'source', {}, {}, dmg, self.root):
                    self.fail('payload mutation must refuse')

    def test_package_creates_once_without_build_install_or_overwrite(self):
        def commands(args, **kwargs):
            if args[0] == '/usr/bin/ditto':
                shutil.copytree(args[-2], args[-1])
            elif args[1] == 'create':
                with Path(args[-1]).open('xb') as stream:
                    stream.write(b'final image')
        @contextlib.contextmanager
        def image(*args):
            yield self.app, {'artifact': {'sha256': 'a' * 64}}
        with patch.object(artifact.platform, 'system', return_value='Darwin'), patch.object(artifact.platform, 'machine', return_value='arm64'), patch.object(artifact, 'check', return_value=('0.1.0', 'notes')), patch.object(artifact, 'verify_ordinary'), patch.object(artifact, 'payload_checks', return_value=artifact.tree_identity(self.app)), patch.object(artifact, 'run', side_effect=commands) as run, patch.object(artifact, 'verified_image', image):
            record = artifact.package(self.root, self.app, 'source', {}, {}, self.root)
            self.assertTrue(record.is_file())
            self.assertTrue(next(record.parent.glob('*.sha256')).is_file())
            self.assertEqual(run.call_count, 2)
            creation = run.call_args.args[0]
            self.assertEqual(creation[1], 'create')
            self.assertNotIn('-ov', creation)
            self.assertFalse(any('build' in str(arg) or 'install' in str(arg) for call in run.call_args_list for arg in call.args[0]))

    def test_macos_copy_preserves_xattrs_before_enrollment_sealing(self):
        import smoke_resources
        destination = self.root / 'copy.app'
        def copy(args, **kwargs):
            shutil.copytree(args[-2], args[-1], dirs_exist_ok=True)
            Path(args[-1]).chmod(0o700)  # Actual ditto retains an existing destination's root mode.
        with patch('smoke_resources.subprocess.run', side_effect=copy) as run:
            smoke_resources.copy_tree(self.app, destination, macos_metadata=True)
        self.assertEqual(artifact.tree_identity(destination), artifact.tree_identity(self.app))
        self.assertEqual(run.call_args.args[0][:3], ['/usr/bin/ditto', '--rsrc', '--extattr'])
        with self.assertRaises(FileExistsError):
            smoke_resources.copy_tree(self.app, destination, macos_metadata=True)

    def test_packaging_refuses_existing_workspace_without_changing_it(self):
        workspace = self.root / 'release-fixed'
        workspace.mkdir()
        sentinel = workspace / 'keep'
        sentinel.write_text('do not replace')
        with patch.object(artifact.platform, 'system', return_value='Darwin'), patch.object(artifact.platform, 'machine', return_value='arm64'), patch.object(artifact, 'check', return_value=('0.1.0', 'notes')), patch.object(artifact.uuid, 'uuid4', return_value='fixed'):
            with self.assertRaises(FileExistsError):
                artifact.package(self.root, self.app, 'source', {}, {}, self.root)
        self.assertEqual(sentinel.read_text(), 'do not replace')


class FakeGitHub:
    def __init__(self):
        self.tag = self.release = None
        self.assets = []
        self.effects = []
        self.fail_after = None
        self.bad_digest = False
        self.fallbacks = 0

    def download_hash(self, endpoint, size):
        self.fallbacks += 1
        return self.assets[0]['expectedHash']

    def api(self, endpoint, method='GET', data=None, *, asset=None):
        if method == 'GET':
            if '/git/ref/' in endpoint:
                return copy.deepcopy(self.tag)
            if endpoint.endswith('/releases/latest'):
                return copy.deepcopy(self.release)
            if '/assets?' in endpoint:
                return copy.deepcopy(self.assets)
            return copy.deepcopy(self.release)
        self.effects.append((endpoint, method))
        if '/git/refs' in endpoint:
            self.tag = {'object': {'type': 'commit', 'sha': data['sha']}}
        elif asset:
            self.assets.append({'id': len(self.assets) + 1, 'name': asset.name, 'size': asset.stat().st_size,
                                'state': 'uploaded', 'digest': 'sha256:' + ('0' * 64 if self.bad_digest else artifact.digest(asset)),
                                'expectedHash': artifact.digest(asset)})
        elif method == 'POST':
            self.release = {**data, 'id': 42}
        else:
            self.release.update(data)
        if self.fail_after == len(self.effects):
            raise TimeoutError('response lost after effect')
        return {'id': 42}


class RemoteTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name).resolve()
        self.dmg = self.root / 'fixture.dmg'
        self.dmg.write_bytes(b'verified final DMG bytes')
        self.record = {'repository': metadata.REPOSITORY, 'sourceDirty': False, 'commit': 'a' * 40,
                       'version': '1.2.3', 'tag': 'v1.2.3', 'signing': artifact.SIGNING,
                       'artifact': {'name': self.dmg.name, 'size': self.dmg.stat().st_size, 'sha256': artifact.digest(self.dmg)}}
        self.record_path = self.root / 'release.json'
        self.record_path.write_text(json.dumps(self.record))
        (self.root / (self.dmg.name + '.sha256')).write_text(self.record['artifact']['sha256'] + '  ' + self.dmg.name + '\n')
        self.assets = assets_for(self.record_path, self.record)
        self.gh = FakeGitHub()
        self.operation = Release(self.gh, self.record, 'reviewed public notes', self.assets, False, True)

    def tearDown(self):
        self.temp.cleanup()

    def test_build_preflight_is_readonly_and_refuses_conflicts_or_rebuild_recovery(self):
        build_preflight(self.gh, self.record['commit'], self.record['version'])
        self.assertEqual(self.gh.effects, [])
        self.gh.tag = {'object': {'type': 'commit', 'sha': 'b' * 40}}
        with self.assertRaisesRegex(ValueError, 'tag conflicts'):
            build_preflight(self.gh, self.record['commit'], self.record['version'])
        self.gh.tag = None
        self.operation.act('draft', execute=True)
        with self.assertRaisesRegex(ValueError, 'never rebuild'):
            build_preflight(self.gh, self.record['commit'], self.record['version'])
        self.assertEqual(len(self.gh.effects), 5)

    def test_default_dry_runs_and_status_have_zero_mutations(self):
        for action in ['status', 'draft', 'publish']:
            self.assertFalse(self.operation.act(action)['executed'])
        self.assertEqual(self.gh.effects, [])

    def test_draft_upload_and_separate_publish_same_bytes_idempotent(self):
        self.assertTrue(self.operation.act('draft', execute=True)['draft'])
        self.assertTrue(self.gh.release['draft'])
        self.assertEqual(len(self.gh.effects), 5)
        self.operation.act('draft', execute=True)
        self.assertEqual(len(self.gh.effects), 5)
        self.assertTrue(self.operation.act('publish', execute=True)['published'])
        self.assertFalse(self.gh.release['draft'])
        self.assertEqual(len(self.gh.effects), 6)
        self.assertTrue(self.operation.act('publish', execute=True)['alreadyPublished'])

    def test_every_interruption_is_reconciled_readonly_no_retry(self):
        for step in range(1, 7):
            with self.subTest(step=step):
                self.gh = FakeGitHub()
                operation = Release(self.gh, self.record, 'reviewed public notes', self.assets, False, True)
                self.gh.fail_after = step
                with self.assertRaises(TimeoutError):
                    operation.act('draft', execute=True)
                    operation.act('publish', execute=True)
                self.assertEqual(len(self.gh.effects), step)
                operation.act('status')
                self.assertEqual(len(self.gh.effects), step)

    def test_conflicting_tag_body_assets_digest_and_channel_refuse(self):
        self.gh.tag = {'object': {'type': 'commit', 'sha': 'b' * 40}}
        with self.assertRaisesRegex(ValueError, 'tag conflicts'):
            self.operation.act('draft', execute=True)
        self.assertEqual(self.gh.effects, [])
        self.gh.tag = None
        self.operation.act('draft', execute=True)
        self.gh.assets[0]['digest'] = 'sha256:' + '0' * 64
        with self.assertRaisesRegex(ValueError, 'digest'):
            self.operation.act('publish', execute=True)
        self.gh.assets[0]['digest'] = None
        self.operation.act('status')
        self.assertEqual(self.gh.fallbacks, 1)
        self.gh.release['body'] = 'unexpected notes'
        with self.assertRaisesRegex(ValueError, 'conflict'):
            self.operation.act('draft', execute=True)
        with self.assertRaises(ValueError):
            Release(self.gh, self.record, '', self.assets, True, True)

    def test_publication_requires_complete_draft_and_local_assets_unchanged(self):
        with self.assertRaisesRegex(ValueError, 'complete'):
            self.operation.act('publish', execute=True)
        self.assertEqual(self.gh.effects, [])
        self.operation.act('draft', execute=True)
        self.dmg.write_bytes(b'changed after verification')
        with self.assertRaisesRegex(ValueError, 'changed'):
            self.operation.act('publish', execute=True)
        self.assertEqual(len(self.gh.effects), 5)

    def test_unexpected_duplicate_partial_assets_and_corrupt_fallback_refuse(self):
        self.operation.act('draft', execute=True)
        saved = copy.deepcopy(self.gh.assets)
        for mutate in [lambda: self.gh.assets.append(copy.deepcopy(self.gh.assets[0])),
                       lambda: self.gh.assets[0].update(name='private-unexpected.log'),
                       lambda: self.gh.assets[0].update(state='starter'),
                       lambda: self.gh.assets[0].update(digest=None, expectedHash='0' * 64)]:
            self.gh.assets = copy.deepcopy(saved)
            mutate()
            with self.assertRaises(ValueError):
                self.operation.act('publish', execute=True)
            self.assertEqual(len(self.gh.effects), 5)

    def test_download_hash_is_streamed_bounded_and_nonmutating(self):
        spawn = subprocess.Popen
        import sys
        with tempfile.TemporaryFile(mode='w+') as journal:
            github = GitHub(journal)
            for content, size, valid in [('abc', 3, True), ('too-long', 2, False), ('short', 8, False)]:
                with patch('release_remote.subprocess.Popen', side_effect=lambda *args, **kwargs: spawn([sys.executable, '-c', 'import sys; sys.stdout.write(' + repr(content) + ')'], **kwargs)):
                    if valid:
                        self.assertEqual(github.download_hash('read-only-endpoint', size), __import__('hashlib').sha256(content.encode()).hexdigest())
                    else:
                        with self.assertRaises(ValueError):
                            github.download_hash('read-only-endpoint', size)

    def test_transport_journals_unknown_effect_and_never_retries(self):
        with tempfile.TemporaryFile(mode='w+') as journal:
            github = GitHub(journal)
            with patch('release_remote.subprocess.run', side_effect=subprocess.TimeoutExpired('gh', 180)) as run:
                with self.assertRaises(subprocess.TimeoutExpired):
                    github.api('repos/test/test/releases', 'POST', {'draft': True})
                self.assertEqual(run.call_count, 1)
            journal.seek(0)
            entries = [json.loads(line) for line in journal]
            self.assertEqual(len(entries), 2)
            self.assertIn('unknown', entries[0]['outcome'])
            self.assertIn('unknown', entries[1]['outcome'])


if __name__ == '__main__':
    unittest.main()
