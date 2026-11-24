"""Windows installer payload/record refusals with an authored fake extractor.

Runs on any host: 7-Zip and the installer are simulated, so these prove the
checks, not a real NSIS build (that is the Windows CI job's actual artifact).
"""

import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import windows_package
import windows_release


def pe(machine):
    header = bytearray(512)
    header[:2] = b'MZ'
    header[0x3C:0x40] = (0x80).to_bytes(4, 'little')
    header[0x80:0x84] = b'PE\0\0'
    header[0x84:0x86] = machine.to_bytes(2, 'little')
    return bytes(header)


class FakeSevenZip:
    """Lists/extracts an authored member map as 7-Zip would (never runs anything)."""

    def __init__(self, members):
        self.members = members
        self.extractions = 0
        self.destinations = []

    def __call__(self, command, **kwargs):
        if command[1] == 'l':
            text = ''.join(
                f'Path = {name}\nFolder = -\nSize = {len(data)}\n\n'
                for name, data in self.members.items()
            )
            return subprocess.CompletedProcess(command, 0, text.encode(), b'')
        if command[1] == 'x':
            self.extractions += 1
            destination = Path(next(arg for arg in command if arg.startswith('-o'))[2:])
            self.destinations.append(destination)
            for name, data in self.members.items():
                path = destination.joinpath(*name.replace('\\', '/').split('/'))
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(data)
            return subprocess.CompletedProcess(command, 0, b'', b'')
        raise AssertionError('Unexpected extractor command')


class WindowsPayloadTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.release = self.root / 'release'
        resources = self.release / 'resources'
        files = {
            'node.exe': pe(0x8664),
            'NODE-LICENSE.txt': b'Node license',
            'runtime/runtime.cjs': b'runtime',
        }
        for name, data in files.items():
            (resources / name).parent.mkdir(parents=True, exist_ok=True)
            (resources / name).write_bytes(data)
        (self.release / windows_package.BINARY).write_bytes(pe(0x8664))
        self.members = {
            windows_package.BINARY: pe(0x8664),
            'uninstall.exe': b'nsis uninstaller',
            '$PLUGINSDIR/nsDialogs.dll': b'ui plugin',
        }
        for name, data in files.items():
            self.members['resources/' + name] = data
        self.installer = self.root / 'setup.exe'
        self.installer.write_bytes(b'authored installer bytes')

    def payload(self, members=None):
        fake = FakeSevenZip(members or self.members)
        work = Path(tempfile.mkdtemp(prefix='work-', dir=self.root))
        with patch('windows_package.subprocess.run', side_effect=fake):
            _, inventory = windows_package.payload(Path('7z.exe'), self.installer, work)
        return inventory, fake

    def test_repeated_payloads_get_fresh_scratch_even_when_extractor_hashes_match(self):
        with patch.object(FakeSevenZip, '__hash__', return_value=1):
            first, a = self.payload()
            second, b = self.payload()
            changed, c = self.payload({**self.members, 'resources/runtime/runtime.cjs': b'altered'})
        self.assertEqual(first, second)
        self.assertNotEqual(first, changed)
        self.assertEqual([a.extractions, b.extractions, c.extractions], [1, 1, 1])
        self.assertEqual(len({*a.destinations, *b.destinations, *c.destinations}), 3)

    def test_inventory_hashes_same_size_edits_even_with_restored_mtime(self):
        original, fake = self.payload()
        extracted = fake.destinations[0]
        relative = 'resources/runtime/runtime.cjs'
        target = extracted / relative
        before = target.stat()
        target.write_bytes(b'altered')
        os.utime(target, ns=(before.st_atime_ns, before.st_mtime_ns))
        changed = windows_package.payload_inventory(extracted)
        self.assertNotEqual(original[relative], changed[relative])
        with self.assertRaisesRegex(ValueError, 'differs from producer'):
            windows_package.check_payload(changed, self.release, self.release / 'resources')
        producer = self.release / relative
        before = producer.stat()
        producer.write_bytes(b'altered')
        os.utime(producer, ns=(before.st_atime_ns, before.st_mtime_ns))
        self.assertNotEqual(
            original[relative],
            windows_package.expected(self.release, self.release / 'resources')[relative],
        )
        with self.assertRaisesRegex(ValueError, 'differs from producer'):
            windows_package.check_payload(original, self.release, self.release / 'resources')

    def test_resource_link_checks_precede_directory_or_content_admission(self):
        resources = self.release / 'resources'
        for call, message in [
            (lambda: windows_package.payload_inventory(resources), 'payload link'),
            (lambda: windows_package.expected(self.release, resources), 'resource link'),
        ]:
            with (
                self.subTest(message=message),
                patch('windows_package.platform_files.is_link', return_value=True),
                patch('windows_package.digest', return_value='a' * 64),
                self.assertRaisesRegex(ValueError, message),
            ):
                call()

    def test_partial_extraction_failure_or_cancellation_is_not_reused(self):
        for failure in (False, True):
            fake = FakeSevenZip(self.members)
            partial = []

            def incomplete(command, **kwargs):
                if command[1] != 'x':
                    return fake(command, **kwargs)
                destination = Path(next(arg for arg in command if arg.startswith('-o'))[2:])
                partial.append(destination)
                (destination / windows_package.BINARY).write_bytes(b'partial')
                if failure:
                    raise KeyboardInterrupt()
                return subprocess.CompletedProcess(command, 2, b'', b'')

            with patch('windows_package.subprocess.run', side_effect=incomplete):
                with self.assertRaises(KeyboardInterrupt if failure else ValueError):
                    windows_package.payload(Path('7z.exe'), self.installer, self.root)
            with patch('windows_package.subprocess.run', side_effect=fake):
                destination, inventory = windows_package.payload(
                    Path('7z.exe'), self.installer, self.root
                )
            self.assertNotEqual(destination, partial[0])
            self.assertTrue((partial[0] / windows_package.BINARY).exists())
            windows_package.check_payload(inventory, self.release, self.release / 'resources')

    def test_payload_equals_producer_binary_and_resources_excluding_installer_ui(self):
        inventory, fake = self.payload()
        self.assertEqual(fake.extractions, 1)
        self.assertNotIn('uninstall.exe', inventory)
        self.assertEqual(
            windows_package.check_payload(inventory, self.release, self.release / 'resources'),
            inventory,
        )

    def test_changed_missing_or_extra_payload_refuses(self):
        for change in [
            lambda m: m.update({'resources/runtime/runtime.cjs': b'changed'}),
            lambda m: m.pop('resources/NODE-LICENSE.txt'),
            lambda m: m.update({'resources/extra.dll': b'unexpected'}),
        ]:
            members = dict(self.members)
            change(members)
            inventory, _ = self.payload(members)
            with (
                self.subTest(change=change),
                self.assertRaisesRegex(ValueError, 'differs from producer'),
            ):
                windows_package.check_payload(inventory, self.release, self.release / 'resources')

    def test_unsafe_member_names_refuse_before_extraction(self):
        for name in [
            '../escape.exe',
            'C:/Windows/evil.dll',
            '\\\\server\\share\\x',
            'a/../../b',
            'stream.txt:ads',
            'ctl\x01name',
        ]:
            members = {**self.members, name: b'x'}
            fake = FakeSevenZip(members)
            with (
                self.subTest(name=name),
                patch('windows_package.subprocess.run', side_effect=fake),
                self.assertRaisesRegex(ValueError, 'Unsafe installer member'),
            ):
                windows_package.payload(Path('7z.exe'), self.installer, self.root)
            self.assertEqual(fake.extractions, 0)
        duplicate = {**self.members, 'RESOURCES/node.exe': b'x'}
        with (
            patch('windows_package.subprocess.run', side_effect=FakeSevenZip(duplicate)),
            self.assertRaisesRegex(ValueError, 'duplicated'),
        ):
            windows_package.payload(Path('7z.exe'), self.installer, self.root)

    def test_architecture_private_and_excluded_content_refuse(self):
        self.assertEqual(windows_package.pe_machine(self.release / windows_package.BINARY), 0x8664)
        (self.root / 'arm64.exe').write_bytes(pe(0xAA64))
        self.assertEqual(windows_package.pe_machine(self.root / 'arm64.exe'), 0xAA64)
        (self.root / 'text.exe').write_bytes(b'not a PE')
        self.assertIsNone(windows_package.pe_machine(self.root / 'text.exe'))
        for name in [
            'resources/settings-v3.json',
            'resources/.env.local',
            'resources/data/trainer.sqlite-wal',
            'resources/runtime/node_modules/sharp/index.js',
        ]:
            with self.subTest(name=name), self.assertRaises(ValueError):
                windows_release.payload_checks({name: '0' * 64}, self.release, '1.2.3')

    def test_first_party_license_missing_empty_or_changed_refuses(self):
        resources = self.release / 'resources'
        sqlite = 'runtime/node_modules/better-sqlite3/build/Release/better_sqlite3.node'
        files = {name: b'required resource' for name in windows_release.REQUIRED}
        files[sqlite] = pe(0x8664)
        files['runtime/node_modules/@resvg/resvg-wasm/index_bg.wasm'] = b'rasterizer'
        for name, data in files.items():
            (resources / name).parent.mkdir(parents=True, exist_ok=True)
            (resources / name).write_bytes(data)
        payload = {
            'resources/' + path.relative_to(resources).as_posix(): windows_package.digest(path)
            for path in resources.rglob('*')
            if path.is_file()
        }
        payload[windows_package.BINARY] = windows_package.digest(
            self.release / windows_package.BINARY
        )
        name = 'resources/FIRST-PARTY-LICENSE.txt'
        recorded = {
            'platform': 'windows-x64',
            'files': [{'path': 'FIRST-PARTY-LICENSE.txt', 'sha256': payload[name]}],
        }
        with patch('windows_release.provenance', return_value=recorded):
            self.assertTrue(windows_release.payload_checks(payload, self.release, '1.2.3'))
            changed = {**payload, name: '0' * 64}
            with self.assertRaisesRegex(ValueError, 'provenance mismatch'):
                windows_release.payload_checks(changed, self.release, '1.2.3')
        with patch('windows_release.provenance', return_value={**recorded, 'files': []}):
            omitted = {key: value for key, value in payload.items() if key != name}
            with self.assertRaisesRegex(ValueError, 'resource/notice missing'):
                windows_release.payload_checks(omitted, self.release, '1.2.3')
            (resources / 'FIRST-PARTY-LICENSE.txt').write_bytes(b'')
            with self.assertRaisesRegex(ValueError, 'resource/notice missing'):
                windows_release.payload_checks(payload, self.release, '1.2.3')

    def test_record_shape_names_platform_signing_and_exact_installer(self):
        self.assertEqual(
            windows_release.asset_name('1.2.3'),
            'AI-Trainer-for-Garmin-Connect-1.2.3-windows-x64-setup.exe',
        )
        self.assertNotIn('notar', windows_release.SIGNING.lower())
        verified = {
            'provenance': {
                'sourceDirty': False,
                'source': 'a' * 40,
                'sourceFingerprint': 'b' * 64,
                'buildSourceFingerprint': 'c' * 64,
            },
            'context': 'd' * 64,
            'inventory': 'e' * 64,
        }
        with patch(
            'windows_release.git',
            side_effect=lambda repo, *args: 'a' * 40 if args[0] == 'rev-parse' else '',
        ):
            record = windows_release.record_for(
                self.root, self.installer, '1.2.3', 'notes', verified, 'f' * 64
            )
        self.assertEqual(
            (record['schemaVersion'], record['platform'], record['target']),
            (2, 'windows-x64', 'x86_64-pc-windows-msvc'),
        )
        self.assertEqual(
            record['artifact']['sha256'], hashlib.sha256(self.installer.read_bytes()).hexdigest()
        )
        self.assertNotIn(str(self.root), json.dumps(record))

    def test_package_never_overwrites_and_refuses_non_windows_hosts(self):
        with (
            patch('platform_target.host', return_value='macos-arm64'),
            self.assertRaisesRegex(ValueError, 'native host'),
        ):
            windows_release.package(self.root, self.release, 'a' * 64, {}, {}, self.root)
        record = self.root / windows_release.RECORD
        record.write_text(json.dumps({'platform': 'macos-arm64', 'artifact': {'name': 'x.dmg'}}))
        with (
            patch('platform_target.host', return_value='windows-x64'),
            self.assertRaisesRegex(ValueError, 'non-Windows'),
        ):
            with windows_release.transported(
                self.root, self.release, 'a' * 64, {}, {}, record, self.root
            ):
                pass


if __name__ == '__main__':
    unittest.main()
