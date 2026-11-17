"""Windows installer payload/record refusals with an authored fake extractor.

Runs on any host: 7-Zip and the installer are simulated, so these prove the
checks, not a real NSIS build (that is the Windows CI job's actual artifact).
"""
import hashlib
import json
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

    def __call__(self, command, **kwargs):
        if command[1] == 'l':
            text = ''.join(f'Path = {name}\nFolder = -\nSize = {len(data)}\n\n'
                           for name, data in self.members.items())
            return subprocess.CompletedProcess(command, 0, text.encode(), b'')
        if command[1] == 'x':
            self.extractions += 1
            destination = Path(next(arg for arg in command if arg.startswith('-o'))[2:])
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
        files = {'node.exe': pe(0x8664), 'NODE-LICENSE.txt': b'Node license',
                 'runtime/runtime.cjs': b'runtime'}
        for name, data in files.items():
            (resources / name).parent.mkdir(parents=True, exist_ok=True)
            (resources / name).write_bytes(data)
        (self.release / windows_package.BINARY).write_bytes(pe(0x8664))
        self.members = {windows_package.BINARY: pe(0x8664), 'uninstall.exe': b'nsis uninstaller',
                        '$PLUGINSDIR/nsDialogs.dll': b'ui plugin'}
        for name, data in files.items():
            self.members['resources/' + name] = data
        self.installer = self.root / 'setup.exe'
        self.installer.write_bytes(b'authored installer bytes')

    def payload(self, members=None):
        fake = FakeSevenZip(members or self.members)
        work = self.root / ('work-' + str(fake.__hash__()))
        work.mkdir()
        with patch('windows_package.subprocess.run', side_effect=fake):
            _, inventory = windows_package.payload(Path('7z.exe'), self.installer, work)
        return inventory, fake

    def test_payload_equals_producer_binary_and_resources_excluding_installer_ui(self):
        inventory, fake = self.payload()
        self.assertEqual(fake.extractions, 1)
        self.assertNotIn('uninstall.exe', inventory)
        self.assertEqual(windows_package.check_payload(inventory, self.release, self.release / 'resources'), inventory)

    def test_changed_missing_or_extra_payload_refuses(self):
        for change in [lambda m: m.update({'resources/runtime/runtime.cjs': b'changed'}),
                       lambda m: m.pop('resources/NODE-LICENSE.txt'),
                       lambda m: m.update({'resources/extra.dll': b'unexpected'})]:
            members = dict(self.members)
            change(members)
            inventory, _ = self.payload(members)
            with self.subTest(change=change), self.assertRaisesRegex(ValueError, 'differs from producer'):
                windows_package.check_payload(inventory, self.release, self.release / 'resources')

    def test_unsafe_member_names_refuse_before_extraction(self):
        for name in ['../escape.exe', 'C:/Windows/evil.dll', '\\\\server\\share\\x', 'a/../../b',
                     'stream.txt:ads', 'ctl\x01name']:
            members = {**self.members, name: b'x'}
            fake = FakeSevenZip(members)
            with self.subTest(name=name), patch('windows_package.subprocess.run', side_effect=fake), \
                    self.assertRaisesRegex(ValueError, 'Unsafe installer member'):
                windows_package.payload(Path('7z.exe'), self.installer, self.root)
            self.assertEqual(fake.extractions, 0)
        duplicate = {**self.members, 'RESOURCES/node.exe': b'x'}
        with patch('windows_package.subprocess.run', side_effect=FakeSevenZip(duplicate)), \
                self.assertRaisesRegex(ValueError, 'duplicated'):
            windows_package.payload(Path('7z.exe'), self.installer, self.root)

    def test_architecture_private_and_excluded_content_refuse(self):
        self.assertEqual(windows_package.pe_machine(self.release / windows_package.BINARY), 0x8664)
        (self.root / 'arm64.exe').write_bytes(pe(0xAA64))
        self.assertEqual(windows_package.pe_machine(self.root / 'arm64.exe'), 0xAA64)
        (self.root / 'text.exe').write_bytes(b'not a PE')
        self.assertIsNone(windows_package.pe_machine(self.root / 'text.exe'))
        for name in ['resources/settings-v3.json', 'resources/.env.local', 'resources/data/trainer.sqlite-wal',
                     'resources/runtime/node_modules/sharp/index.js']:
            with self.subTest(name=name), self.assertRaises(ValueError):
                windows_release.payload_checks({name: '0' * 64}, self.release, '1.2.3')

    def test_record_shape_names_platform_signing_and_exact_installer(self):
        self.assertEqual(windows_release.asset_name('1.2.3'), 'Garmin-Trainer-1.2.3-windows-x64-setup.exe')
        self.assertNotIn('notar', windows_release.SIGNING.lower())
        verified = {'provenance': {'sourceDirty': False, 'source': 'a' * 40, 'sourceFingerprint': 'b' * 64,
                                   'buildSourceFingerprint': 'c' * 64}, 'context': 'd' * 64, 'inventory': 'e' * 64}
        with patch('windows_release.git', side_effect=lambda repo, *args: 'a' * 40 if args[0] == 'rev-parse' else ''):
            record = windows_release.record_for(self.root, self.installer, '1.2.3', 'notes', verified, 'f' * 64)
        self.assertEqual((record['schemaVersion'], record['platform'], record['target']),
                         (2, 'windows-x64', 'x86_64-pc-windows-msvc'))
        self.assertEqual(record['artifact']['sha256'], hashlib.sha256(self.installer.read_bytes()).hexdigest())
        self.assertNotIn(str(self.root), json.dumps(record))

    def test_package_never_overwrites_and_refuses_non_windows_hosts(self):
        with patch('platform_target.host', return_value='macos-arm64'), \
                self.assertRaisesRegex(ValueError, 'native host'):
            windows_release.package(self.root, self.release, 'a' * 64, {}, {}, self.root)
        record = self.root / windows_release.RECORD
        record.write_text(json.dumps({'platform': 'macos-arm64', 'artifact': {'name': 'x.dmg'}}))
        with patch('platform_target.host', return_value='windows-x64'), \
                self.assertRaisesRegex(ValueError, 'non-Windows'):
            with windows_release.transported(self.root, self.release, 'a' * 64, {}, {}, record, self.root):
                pass


if __name__ == '__main__':
    unittest.main()
