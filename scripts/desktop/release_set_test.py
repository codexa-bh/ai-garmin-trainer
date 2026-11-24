"""Release-set contract with fake providers only; no build, upload or network."""

import copy
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

import release_metadata as metadata
from release_remote import Release, set_body
import release_set
from release_test import FakeGitHub

NOTES = 'reviewed public notes'


def write_platform(
    directory, platform_id, version='1.2.3', commit='a' * 40, notes=NOTES, **changes
):
    directory.mkdir(parents=True, exist_ok=True)
    prefix = changes.pop('asset_prefix', 'AI-Trainer-for-Garmin-Connect')
    if platform_id == 'macos-arm64':
        name, target, record_name = (
            f'{prefix}-{version}-macos-arm64.dmg',
            'aarch64-apple-darwin',
            'release.json',
        )
        signing = 'unsigned-or-linker-adhoc; not notarized; no verified publisher'
    else:
        name, target, record_name = (
            f'{prefix}-{version}-windows-x64-setup.exe',
            'x86_64-pc-windows-msvc',
            'release-windows-x64.json',
        )
        signing = 'unsigned; no Authenticode signature or verified publisher (SmartScreen may warn)'
    data = (platform_id + ' verified final bytes').encode()
    (directory / name).write_bytes(data)
    sha = hashlib.sha256(data).hexdigest()
    (directory / (name + '.sha256')).write_bytes((sha + '  ' + name + '\n').encode())
    record = {
        'schemaVersion': 2,
        'platform': platform_id,
        'repository': metadata.REPOSITORY,
        'commit': commit,
        'sourceDirty': False,
        'version': version,
        'tag': 'v' + version,
        'target': target,
        'originalSource': 'b' * 64,
        'buildSource': 'c' * 64,
        'buildContext': 'd' * 64,
        'inventory': 'e' * 64,
        'payloadIdentity': 'f' * 64,
        'signing': signing,
        'notesSha256': hashlib.sha256(notes.encode()).hexdigest(),
        'artifact': {'name': name, 'size': len(data), 'sha256': sha},
    }
    if platform_id == 'macos-arm64' and changes.pop('legacy', False):
        record['schemaVersion'] = 1
        del record['platform']
    record.update(changes)
    path = directory / record_name
    path.write_text(json.dumps(record, indent=2) + '\n')
    return path


class ReleaseSetTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.mac = write_platform(self.root / 'mac', 'macos-arm64')
        self.win = write_platform(self.root / 'win', 'windows-x64')

    def test_explicit_two_platform_set_binds_source_notes_and_every_asset(self):
        value, files = release_set.build([self.win, self.mac], NOTES)
        self.assertEqual(value['platforms'], ['macos-arm64', 'windows-x64'])  # Canonical order.
        self.assertEqual(value['verification'], release_set.VERIFICATION)
        self.assertEqual(len(files), 6)
        names = [asset['name'] for item in value['entries'] for asset in item['assets']]
        self.assertIn('AI-Trainer-for-Garmin-Connect-1.2.3-windows-x64-setup.exe', names)
        self.assertIn('release.json', names)
        self.assertNotIn(str(self.root), json.dumps(value))  # No local paths in public data.
        release_set.validate(value)

    def test_single_platform_and_legacy_macos_records_remain_valid(self):
        legacy = write_platform(self.root / 'legacy', 'macos-arm64', legacy=True)
        value, _ = release_set.build([legacy], NOTES)
        self.assertEqual(value['platforms'], ['macos-arm64'])
        self.assertEqual(release_set.build([self.win], NOTES)[0]['platforms'], ['windows-x64'])

    def test_immutable_former_name_assets_remain_readable_without_relabelling(self):
        for platform in ('macos-arm64', 'windows-x64'):
            with self.subTest(platform=platform):
                path = write_platform(
                    self.root / ('former-' + platform),
                    platform,
                    version='0.1.4',
                    asset_prefix='Garmin-Trainer',
                    legacy=platform == 'macos-arm64',
                )
                value, files = release_set.build([path], NOTES)
                artifact = value['entries'][0]['assets'][0]
                self.assertTrue(artifact['name'].startswith('Garmin-Trainer-0.1.4-'))
                self.assertEqual(release_set.digest(files[artifact['name']])[0], artifact['sha256'])
                record = json.loads(path.read_text())
                record['artifact']['name'] = artifact['name'].replace('0.1.4', '0.1.3')
                with self.assertRaisesRegex(ValueError, 'platform/version'):
                    release_set.check_record(record, platform)

    def test_mixed_duplicate_unsupported_and_ambiguous_sets_refuse(self):
        cases = {
            'commit': write_platform(self.root / 'c', 'windows-x64', commit='9' * 40),
            'version': write_platform(self.root / 'v', 'windows-x64', version='1.2.4'),
            'notes': write_platform(self.root / 'n', 'windows-x64', notes='other notes'),
        }
        for field, other in cases.items():
            with (
                self.subTest(field=field),
                self.assertRaisesRegex(ValueError, 'Mixed release ' + field),
            ):
                release_set.build([self.mac, other], NOTES)
        with self.assertRaisesRegex(ValueError, 'Duplicate platform|Colliding'):
            release_set.build([self.win, write_platform(self.root / 'w2', 'windows-x64')], NOTES)
        with self.assertRaisesRegex(ValueError, 'nonempty'):
            release_set.build([], NOTES)
        with self.assertRaisesRegex(ValueError, 'notes'):
            release_set.build([self.mac], 'changed notes')
        for changes in [
            {'platform': 'linux-x64'},
            {'platform': None},
            {'schemaVersion': 3},
            {'target': 'aarch64-apple-darwin'},
            {'sourceDirty': True},
            {'signing': 'notarized by Microsoft'},
            {'payloadIdentity': 'short'},
        ]:
            bad = write_platform(
                self.root / ('bad-' + str(len(json.dumps(changes)))), 'windows-x64', **changes
            )
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                release_set.build([bad], NOTES)

    def test_changed_corrupt_missing_or_relabelled_assets_refuse(self):
        installer = self.win.parent / 'AI-Trainer-for-Garmin-Connect-1.2.3-windows-x64-setup.exe'
        original = installer.read_bytes()
        installer.write_bytes(b'corrupt')
        with self.assertRaisesRegex(ValueError, 'changed'):
            release_set.build([self.win], NOTES)
        installer.write_bytes(original)
        checksum = installer.with_name(installer.name + '.sha256')
        checksum.write_text('0' * 64 + '  ' + installer.name + '\n')
        with self.assertRaisesRegex(ValueError, 'checksum'):
            release_set.build([self.win], NOTES)
        checksum.unlink()
        with self.assertRaises(OSError):
            release_set.build([self.win], NOTES)
        renamed = write_platform(self.root / 'renamed', 'windows-x64')
        renamed.rename(renamed.with_name('release.json'))
        with self.assertRaisesRegex(ValueError, 'record name'):
            release_set.build([renamed.with_name('release.json')], NOTES)

    def test_stored_set_rechecks_current_bytes_before_any_use(self):
        scratch = self.root / 'scratch'
        scratch.mkdir()
        path = release_set.assemble([self.mac, self.win], NOTES, scratch, version='1.2.3')
        dirs = {'macos-arm64': self.mac.parent, 'windows-x64': self.win.parent}
        value, assets = release_set.assets(path, dirs)
        self.assertEqual(len(assets), 7)
        with self.assertRaises(FileExistsError):
            release_set.assemble([self.mac, self.win], NOTES, scratch)  # Never overwritten.
        with self.assertRaisesRegex(ValueError, 'version'):
            release_set.assemble([self.mac], NOTES, self.root / 'mac', version='9.9.9')
        (self.win.parent / 'AI-Trainer-for-Garmin-Connect-1.2.3-windows-x64-setup.exe').write_bytes(
            b'swapped after set'
        )
        with self.assertRaises(ValueError):
            release_set.assets(path, dirs)
        tampered = copy.deepcopy(value)
        tampered['platforms'].append('windows-x64')
        with self.assertRaises(ValueError):
            release_set.validate(tampered)


class ReleaseSetRemoteTests(unittest.TestCase):
    """The existing publisher consumes a set; real effects only via FakeGitHub."""

    def setUp(self):
        ReleaseSetTests.setUp(self)
        scratch = self.root / 'scratch'
        scratch.mkdir()
        self.set_path = release_set.assemble([self.mac, self.win], NOTES, scratch)
        self.dirs = {'macos-arm64': self.mac.parent, 'windows-x64': self.win.parent}
        self.value, self.assets = release_set.assets(self.set_path, self.dirs)
        self.gh = FakeGitHub()
        self.operation = Release(
            self.gh, None, NOTES, self.assets, False, True, release_set=self.value
        )

    def test_dry_runs_have_zero_effects_and_body_names_each_platform(self):
        for action in ['status', 'draft', 'publish']:
            self.assertFalse(self.operation.act(action)['executed'])
        self.assertEqual(self.gh.effects, [])
        body = set_body(self.value, NOTES)
        self.assertIn('Platforms: macOS ARM64, Windows x64', body)
        self.assertIn('Windows x64 signing: unsigned; no Authenticode', body)
        self.assertNotIn('notariz', body.split('Windows x64 signing:')[1].lower())

    def test_draft_uploads_every_set_asset_then_separate_publication(self):
        self.assertTrue(self.operation.act('draft', execute=True)['draft'])
        self.assertEqual(sorted(asset['name'] for asset in self.gh.assets), sorted(self.assets))
        self.assertEqual(len(self.gh.effects), 2 + len(self.assets))  # tag, draft, 7 uploads
        self.assertTrue(self.operation.act('publish', execute=True)['published'])
        self.assertEqual(self.operation.selected_tuple()['platforms'][1]['platform'], 'windows-x64')

    def test_partial_or_unknown_effects_reconcile_readonly_without_retry(self):
        for step in range(1, 2 + len(self.assets) + 2):
            with self.subTest(step=step):
                self.gh = FakeGitHub()
                operation = Release(
                    self.gh, None, NOTES, self.assets, False, True, release_set=self.value
                )
                self.gh.fail_after = step
                with self.assertRaises(TimeoutError):
                    operation.act('draft', execute=True)
                    operation.act('publish', execute=True)
                self.assertEqual(len(self.gh.effects), step)
                operation.act('status')
                self.assertEqual(len(self.gh.effects), step)

    def test_asset_selection_must_equal_the_set(self):
        partial = dict(self.assets)
        partial.pop('release-windows-x64.json')
        with self.assertRaisesRegex(ValueError, 'differ from the release set'):
            Release(self.gh, None, NOTES, partial, False, True, release_set=self.value)
        with self.assertRaisesRegex(ValueError, 'notes'):
            Release(self.gh, None, 'other', self.assets, False, True, release_set=self.value)
        self.assertEqual(self.gh.effects, [])


if __name__ == '__main__':
    unittest.main()
