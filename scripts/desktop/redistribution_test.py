"""Finite resource contracts: real texts/source bytes, not legal certificates."""
import hashlib
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch

import redistribution as notices


class RedistributionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def test_exact_source_download_cached_bytes_and_corruption_refusal(self):
        data = b'reviewed public source'
        entry = {'file': 'source.txt', 'url': 'https://example.invalid/source.txt',
                 'size': len(data), 'sha256': hashlib.sha256(data).hexdigest()}
        with patch.object(notices.urllib.request, 'urlopen', return_value=io.BytesIO(data)) as remote:
            path = notices.acquire(entry, self.root)
            self.assertEqual(path.read_bytes(), data)
            self.assertEqual(notices.acquire(entry, self.root), path)
            self.assertEqual(remote.call_count, 1)
        path.write_bytes(b'corrupt retained input')
        with patch.object(notices.urllib.request, 'urlopen') as remote:
            with self.assertRaisesRegex(ValueError, 'cache size/digest'):
                notices.acquire(entry, self.root)
            remote.assert_not_called()
        self.assertEqual(path.read_bytes(), b'corrupt retained input')

    def test_mismatched_download_never_becomes_a_cache_input(self):
        entry = {'file': 'source.txt', 'url': 'https://example.invalid/source.txt',
                 'size': 1, 'sha256': '0' * 64}
        with patch.object(notices.urllib.request, 'urlopen', return_value=io.BytesIO(b'x')):
            with self.assertRaisesRegex(ValueError, 'size/digest'):
                notices.acquire(entry, self.root)
        self.assertFalse((self.root / 'source.txt').exists())
        with self.assertRaisesRegex(ValueError, 'plain public filename'):
            notices.acquire({**entry, 'file': '../foreign'}, self.root)
        alias = self.root / 'source.txt'
        alias.symlink_to(self.root / 'foreign')
        with self.assertRaisesRegex(ValueError, 'Aliased'):
            notices.acquire(entry, self.root)

    def test_archive_notices_are_read_without_extracting_paths_or_links(self):
        path = self.root / 'source.tgz'
        with tarfile.open(path, 'w:gz') as archive:
            for name, data in [('package/LICENSE', b'actual copyright and license'),
                               ('package/docs/NOTICE.txt', b'actual attribution'),
                               ('package/code.py', b'not a notice')]:
                member = tarfile.TarInfo(name)
                member.size = len(data)
                archive.addfile(member, io.BytesIO(data))
            link = tarfile.TarInfo('package/LICENSE-link')
            link.type = tarfile.SYMTYPE
            link.linkname = '/foreign'
            archive.addfile(link)
        self.assertEqual(notices.archive_notices(path), [
            ('package/LICENSE', 'actual copyright and license'),
            ('package/docs/NOTICE.txt', 'actual attribution')])
        self.assertEqual(sorted(p.name for p in self.root.iterdir()), ['source.tgz'])

    def test_shipped_rasterizer_must_match_reviewed_archive(self):
        shipped = self.root / 'src-tauri/resources/runtime/node_modules/@resvg/resvg-wasm/index_bg.wasm'
        shipped.parent.mkdir(parents=True)
        archive = self.root / 'resvg-wasm.tgz'
        with tarfile.open(archive, 'w:gz') as output:
            member = tarfile.TarInfo('package/index_bg.wasm')
            member.size = len(b'reviewed wasm')
            output.addfile(member, io.BytesIO(b'reviewed wasm'))
        shipped.write_bytes(b'reviewed wasm')
        notices.verify_rasterizer(self.root, archive)
        shipped.write_bytes(b'different wasm')
        with self.assertRaisesRegex(ValueError, 'differs from the reviewed'):
            notices.verify_rasterizer(self.root, archive)
        shipped.unlink()
        with self.assertRaises(FileNotFoundError):
            notices.verify_rasterizer(self.root, archive)

    def test_excluded_groups_must_be_absent_from_the_runtime(self):
        runtime = self.root / 'src-tauri/resources/runtime'
        excluded = ['node_modules/sharp', 'node_modules/next/dist/compiled/@vercel/og']
        (runtime / 'node_modules/next/dist/compiled').mkdir(parents=True)
        notices.verify_excluded(self.root, excluded)
        (runtime / 'node_modules/next/dist/compiled/@vercel/og').mkdir(parents=True)
        with self.assertRaisesRegex(ValueError, 'compiled/@vercel/og'):
            notices.verify_excluded(self.root, excluded)

    def test_npm_uses_actual_texts_and_only_installed_production_versions(self):
        for name in ['production', 'development']:
            directory = self.root / 'node_modules' / name
            directory.mkdir(parents=True)
            (directory / 'package.json').write_text(json.dumps({'name': name, 'version': '1.0.0'}))
            (directory / 'LICENSE').write_text(name + ' actual text')
        lock = {'packages': {'': {}, 'node_modules/production': {'version': '1.0.0', 'license': 'MIT'},
                            'node_modules/development': {'version': '1.0.0', 'dev': True},
                            'node_modules/other-platform': {'version': '1.0.0', 'optional': True}}}
        (self.root / 'package-lock.json').write_text(json.dumps(lock))
        packages, texts = notices.npm_notices(self.root)
        self.assertEqual([p['name'] for p in packages], ['production'])
        self.assertEqual(texts, [('node_modules/production/LICENSE', 'production actual text')])
        (self.root / 'node_modules/production/package.json').write_text('{"name":"production","version":"2.0.0"}')
        with self.assertRaisesRegex(ValueError, 'differs from lock'):
            notices.npm_notices(self.root)

    def test_npm_notices_omit_excluded_packages_and_paths_only(self):
        for name, files in [('kept', ['LICENSE', 'dist/compiled/og/LICENSE', 'dist/compiled/other/LICENSE']),
                            ('dropped', ['LICENSE'])]:
            directory = self.root / 'node_modules' / name
            for file in files:
                (directory / file).parent.mkdir(parents=True, exist_ok=True)
                (directory / file).write_text(name + '/' + file)
            (directory / 'package.json').write_text(json.dumps({'name': name, 'version': '1.0.0'}))
        lock = {'packages': {'': {}, 'node_modules/kept': {'version': '1.0.0'},
                            'node_modules/dropped': {'version': '1.0.0', 'optional': True}}}
        (self.root / 'package-lock.json').write_text(json.dumps(lock))
        packages, texts = notices.npm_notices(
            self.root, ['node_modules/dropped', 'node_modules/kept/dist/compiled/og'])
        self.assertEqual([p['name'] for p in packages], ['kept'])
        self.assertEqual([name for name, _ in texts], ['node_modules/kept/LICENSE',
                                                       'node_modules/kept/dist/compiled/other/LICENSE'])

    def test_native_archive_binds_locked_sources_and_has_no_private_metadata(self):
        directory = self.root / 'dist/desktop-license-crates/component-1.0.0'
        directory.mkdir(parents=True)
        data = b'actual upstream license'
        (directory / 'LICENSE').write_bytes(data)
        checksum = {'package': 'a' * 64, 'files': {'LICENSE': notices.digest(data)}}
        (directory / '.cargo-checksum.json').write_text(json.dumps(checksum))
        (self.root / 'src-tauri').mkdir()
        (self.root / 'src-tauri/Cargo.lock').write_text(
            '[[package]]\nname = "component"\nversion = "1.0.0"\nsource = "registry"\nchecksum = "' + 'a' * 64 + '"\n')
        metadata = {'packages': [{'name': 'component', 'version': '1.0.0', 'source': 'registry',
                                 'license': 'MPL-2.0', 'manifest_path': '/private/never-public'},
                                {'name': 'first-party', 'source': None, 'version': '0.1.1'}]}
        with patch.object(notices.subprocess, 'run'), patch.object(
                notices.subprocess, 'check_output', return_value=json.dumps(metadata).encode()) as metadata_call:
            destination = self.root / 'native.tgz'
            packages, texts = notices.native_sources(self.root, destination, 'x86_64-pc-windows-msvc')
            # The closure is the selected platform's, never another target's.
            self.assertEqual(metadata_call.call_args.args[0][-1], 'x86_64-pc-windows-msvc')
            self.assertNotIn('/private/', json.dumps(packages))
            self.assertEqual(texts, [('component-1.0.0/LICENSE', data.decode())])
            with tarfile.open(destination) as archive:
                self.assertEqual(archive.getnames(), ['component-1.0.0/LICENSE'])
                member = archive.getmembers()[0]
                self.assertEqual((member.uid, member.gid, member.uname, member.gname), (0, 0, '', ''))
                self.assertEqual(archive.extractfile(member).read(), data)
            (directory / 'LICENSE').write_bytes(b'changed')
            with self.assertRaisesRegex(ValueError, 'checksum mismatch'):
                notices.native_sources(self.root, self.root / 'failed.tgz', 'aarch64-apple-darwin')


if __name__ == '__main__':
    unittest.main()
