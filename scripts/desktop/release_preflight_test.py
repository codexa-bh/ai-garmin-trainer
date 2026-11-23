"""Actual preview/prepare CLI in disposable Git repositories; no native/provider effects."""

import json
import subprocess
import unittest
from unittest.mock import patch

import release_metadata as metadata
import release_preflight as preflight
import release_cli_test
from release_remote import set_body, release_body


class PreflightTests(unittest.TestCase):
    cli = release_cli_test.PrepareCliTests.cli
    tree = release_cli_test.PrepareCliTests.tree

    def commit(self):
        subprocess.run(['git', 'add', '.'], cwd=self.root, check=True)
        subprocess.run(
            [
                'git',
                '-c',
                'user.name=t',
                '-c',
                'user.email=t@example.com',
                'commit',
                '-qm',
                'context',
            ],
            cwd=self.root,
            check=True,
        )
        return metadata.git(self.root, 'rev-parse', 'HEAD')

    def setUp(self):
        release_cli_test.PrepareCliTests.setUp(self)
        self.schema = self.root / preflight.SCHEMA_PATH
        self.schema.parent.mkdir(parents=True)
        self.schema.write_text('export const LATEST_SCHEMA_VERSION = 28;\n')
        baseline = self.commit()
        self.schema.write_text('export const LATEST_SCHEMA_VERSION = 30;\n')
        self.context_path = self.root / 'context.json'
        self.context = {
            'version': '0.2.0',
            'platforms': ['windows-x64'],
            'baseline': {'commit': baseline, 'version': '0.1.0', 'schema': 28},
            'schema': 30,
        }
        self.context_path.write_text(json.dumps(self.context))
        self.reviewed = self.root / 'reviewed.md'
        self.reviewed.write_text(
            '\n'.join(
                [
                    *preflight.WINDOWS,
                    *preflight.MACOS,
                    *preflight.RECOVERY,
                    preflight.WINDOWS_MIGRATION,
                    'Version 0.1.0 uses schema 28; this release uses schema 30.',
                ]
            )
        )
        self.commit()

    def args(self, action='preflight'):
        return [
            action,
            '--version',
            '0.2.0',
            '--notes',
            str(self.reviewed),
            '--preflight-context',
            str(self.context_path),
        ]

    def test_preview_is_actual_set_renderer_with_unresolved_identity_and_no_effects(self):
        before = self.tree()
        with patch('release.build_ordinary') as build, patch('release_remote.GitHub') as provider:
            result = self.cli(*self.args())
        build.assert_not_called()
        provider.assert_not_called()
        self.assertEqual(before, self.tree())
        notes = metadata.prepared_notes(
            '0.2.0', metadata.promotion(self.root, self.reviewed.read_text())[0]
        )
        identity = {
            'repository': metadata.REPOSITORY,
            'commit': 'UNRESOLVED — preview only',
            'entries': [
                {
                    'platform': 'windows-x64',
                    'assets': [{'sha256': 'UNRESOLVED — preview only'}],
                    'signing': 'unsigned; no Authenticode',
                }
            ],
        }
        self.assertEqual(result['body'], set_body(identity, notes))
        identity['commit'] = 'a' * 40
        identity['entries'][0]['assets'][0]['sha256'] = 'b' * 64
        self.assertEqual(
            result['body']
            .replace('UNRESOLVED — preview only', 'a' * 40, 1)
            .replace('UNRESOLVED — preview only', 'b' * 64),
            set_body(identity, notes),
        )
        self.assertIn('not release eligibility', result['result'])

    def test_windows_prepare_checks_then_consumes_only_required_fragment(self):
        result = self.cli(*self.args('prepare'), '--platform', 'windows-x64', '--execute')
        self.assertTrue(result['executed'])
        self.assertFalse(self.fix.exists())
        self.assertTrue(self.marker.exists())
        notes = metadata.check(self.root)[1]
        self.assertEqual(
            self.cli('preflight', '--preflight-context', str(self.context_path))['body'],
            preflight.preview(self.root, notes, '0.2.0', self.context_path)['body'],
        )

    def test_missing_each_disclosure_refuses_before_writes_builds_provider_or_consumption(self):
        original = self.reviewed.read_text()
        for disclosure in (*preflight.WINDOWS, *preflight.RECOVERY, preflight.WINDOWS_MIGRATION):
            self.reviewed.write_text(original.replace(disclosure, 'omitted'))
            before = self.tree()
            for action in ('preflight', 'prepare'):
                with (
                    self.subTest(disclosure=disclosure, action=action),
                    patch('release.build_ordinary') as build,
                    patch('release_remote.GitHub') as provider,
                    self.assertRaisesRegex(ValueError, 'disclosure missing'),
                ):
                    self.cli(*self.args(action), *(['--execute'] if action == 'prepare' else []))
                build.assert_not_called()
                provider.assert_not_called()
                self.assertEqual(before, self.tree())
                self.assertTrue(self.fix.exists())
        self.reviewed.write_text(original)

    def test_mac_only_and_dual_platform_scope(self):
        self.context['platforms'] = ['macos-arm64']
        self.context_path.write_text(json.dumps(self.context))
        text = '\n'.join(
            [
                *preflight.MACOS,
                *preflight.RECOVERY,
                'Version 0.1.0 uses schema 28; this release uses schema 30.',
            ]
        )
        self.reviewed.write_text(text)
        result = self.cli(*self.args())
        notes = metadata.prepared_notes('0.2.0', metadata.promotion(self.root, text)[0])
        self.assertEqual(
            result['body'],
            release_body(
                {
                    'repository': metadata.REPOSITORY,
                    'commit': 'UNRESOLVED — preview only',
                    'artifact': {'sha256': 'UNRESOLVED — preview only'},
                    'signing': 'unsigned; not notarized',
                },
                notes,
            ),
        )
        self.context['platforms'].append('windows-x64')
        self.context_path.write_text(json.dumps(self.context))
        with self.assertRaisesRegex(ValueError, 'Windows x64 alpha'):
            self.cli(*self.args())
        self.reviewed.write_text(
            text + '\n' + '\n'.join([*preflight.WINDOWS, preflight.WINDOWS_MIGRATION])
        )
        self.assertIn('macOS ARM64, Windows x64', self.cli(*self.args())['body'])

    def test_no_schema_change_distinct_from_unknown_and_contradictory_context(self):
        self.schema.write_text('export const LATEST_SCHEMA_VERSION = 28;\n')
        self.context['schema'] = 28
        self.context_path.write_text(json.dumps(self.context))
        self.reviewed.write_text(
            '\n'.join(preflight.WINDOWS) + '\nNo database schema change: 28 → 28.'
        )
        self.cli(*self.args())
        self.reviewed.write_text('\n'.join(preflight.WINDOWS))
        with self.assertRaisesRegex(ValueError, 'No database schema change'):
            self.cli(*self.args())
        for field, changed in [
            ('schema', None),
            ('schema', 30),
            ('platforms', []),
            ('platforms', ['other']),
            ('version', '0.9.0'),
            ('baseline', {}),
        ]:
            original = self.context[field]
            self.context[field] = changed
            self.context_path.write_text(json.dumps(self.context))
            with self.subTest(field=field, value=changed), self.assertRaises(ValueError):
                self.cli(*self.args())
            self.context[field] = original
        self.context_path.write_text(json.dumps(self.context))

    def test_changed_notes_malformed_fragments_and_missing_context_never_reuse_preview(self):
        self.cli(*self.args())
        self.reviewed.write_text(
            self.reviewed.read_text().replace('Windows x64 alpha', 'Windows x64')
        )
        before = self.tree()
        with self.assertRaisesRegex(ValueError, 'Windows x64 alpha'):
            self.cli(*self.args('prepare'), '--execute')
        self.assertEqual(before, self.tree())
        with self.assertRaises(SystemExit):
            self.cli('preflight')
        with self.assertRaises(SystemExit):
            self.cli('prepare', '--version', '0.2.0', '--platform', 'windows-x64', '--execute')
        self.fix.write_text('malformed')
        with self.assertRaises(ValueError):
            self.cli(*self.args())


if __name__ == '__main__':
    unittest.main()
