"""The finite target map and host selection; no build."""
import json
import unittest
from unittest.mock import patch

import platform_target


class PlatformTargetTests(unittest.TestCase):
    def test_exactly_two_pinned_targets_with_official_node_archives(self):
        targets = platform_target.targets()
        self.assertEqual(sorted(targets), ['macos-arm64', 'windows-x64'])
        windows = targets['windows-x64']
        self.assertEqual((windows['triple'], windows['bundle'], windows['node']),
                         ('x86_64-pc-windows-msvc', 'nsis', 'node.exe'))
        self.assertEqual(windows['nodeSha256'], 'cbc74b5e0982c9dbb41525fd8fb5dcd32fbee237863f7829072f4639a1ce5f20')
        self.assertEqual(targets['macos-arm64']['nodeSha256'],
                         'c9e1dbc748b33ed2d14f42445191ecaf14c56259c7a9a26d0042c49ec2b66428')
        inputs = json.loads(platform_target.INPUTS.read_text())
        for target in targets.values():
            self.assertTrue(target['nodeArchive'].startswith('node-v' + inputs['nodeVersion'] + '-'))

    def test_unsupported_platforms_and_foreign_hosts_refuse(self):
        for bad in ['linux-x64', 'windows-arm64', 'macos-x64', '']:
            with self.assertRaises(ValueError):
                platform_target.target(bad)
        for host in [('linux', 'x86_64'), ('win32', 'arm64'), ('darwin', 'x86_64')]:
            with self.subTest(host=host), patch('platform_target.sys.platform', host[0]), \
                    patch('platform_target.platform.machine', return_value=host[1]):
                with self.assertRaises(ValueError):
                    platform_target.host()
        with patch('platform_target.sys.platform', 'win32'), patch('platform_target.platform.machine', return_value='AMD64'):
            self.assertEqual(platform_target.host(), 'windows-x64')
            with self.assertRaisesRegex(ValueError, 'native host'):
                platform_target.require_host('macos-arm64')
        with patch('platform_target.sys.platform', 'darwin'), patch('platform_target.platform.machine', return_value='arm64'):
            self.assertEqual(platform_target.require_host('macos-arm64'), 'macos-arm64')
            with self.assertRaisesRegex(ValueError, 'native host'):
                platform_target.require_host('windows-x64')


if __name__ == '__main__':
    unittest.main()
