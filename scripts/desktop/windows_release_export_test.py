"""Native-export and hostile cross-host transport contracts; no real provider."""
import copy
import hashlib
import json
import os
from pathlib import Path
import stat
import tempfile
import unittest
from unittest.mock import patch
import zipfile

import release_set
from release_set_test import write_platform
import windows_release_export as transport
import windows_smoke_evidence as evidence


class ExportTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.record = write_platform(self.root / 'producer', 'windows-x64')
        self.source, self.run, self.attempt, self.artifact = 'a' * 40, '123', '1', '456'
        self.images = self.root / 'images'
        self.images.mkdir()
        (self.images / 'manifest.json').write_text('synthetic manifest')
        value = release_set.load(self.record)
        self.manifest = {'installerSha256': value['artifact']['sha256'], 'payloadSha256': value['payloadIdentity'],
                         'outcomes': {key: 'passed' for key in evidence.STAGES}}
        self.directory = self.root / 'export'
        env = {'GITHUB_SHA': self.source, 'GITHUB_RUN_ID': self.run, 'GITHUB_RUN_ATTEMPT': self.attempt,
               'GITHUB_EVENT_NAME': 'workflow_dispatch', 'GITHUB_REPOSITORY': value['repository']}
        with patch.dict(os.environ, env), patch.object(transport.platform_target, 'require_host'), patch.object(evidence, 'validate', return_value=self.manifest):
            transport.export(self.record, self.images, self.directory)
        self.archive = self.root / 'candidate.zip'
        self.zip()

    def zip(self, *, extra=None, omit=None, replace=None):
        with zipfile.ZipFile(self.archive, 'w') as bundle:
            for path in self.directory.iterdir():
                if path.name != omit:
                    bundle.writestr(path.name, (replace or {}).get(path.name, path.read_bytes()))
            if extra:
                bundle.writestr(*extra)

    def extract(self):
        return transport.extract(self.archive, self.root / 'download', source=self.source, run=self.run, attempt=self.attempt)

    def test_exact_export_download_and_current_byte_requalification(self):
        result = self.extract()
        self.assertEqual(result['outcomes'], self.manifest['outcomes'])
        destination = self.root / 'download'
        (destination / transport.IMPORTED).write_text(json.dumps({'source': self.source, 'run': self.run, 'attempt': self.attempt, 'artifact': self.artifact}))
        archive = self.root / 'download.zip'
        archive.write_bytes(self.archive.read_bytes())
        attributed = {'digest': 'sha256:' + release_set.digest(archive)[0], 'size_in_bytes': archive.stat().st_size}
        with patch.object(transport, 'provider', return_value=attributed) as provider:
            transport.verify_import(destination, expected_source=self.source)
            provider.assert_called_once_with(self.source, self.run, self.attempt, self.artifact)
            exe = next(destination.glob('*.exe'))
            exe.write_bytes(b'changed')
            with self.assertRaises(ValueError):
                transport.verify_import(destination, expected_source=self.source)
        with self.assertRaises(FileExistsError):
            self.extract()

    def test_forged_self_consistent_receipt_cannot_replace_provider_authenticated_bytes(self):
        self.extract()
        destination = self.root / 'download'
        archive = self.root / 'download.zip'
        archive.write_bytes(self.archive.read_bytes())
        (destination / transport.IMPORTED).write_text(json.dumps({'source': self.source, 'run': self.run, 'attempt': self.attempt, 'artifact': self.artifact}))
        record_path = write_platform(destination, 'windows-x64', payloadIdentity='9' * 64)
        record, selected, _ = transport.members(record_path)
        receipt_path = destination / transport.RECEIPT
        receipt = release_set.load(receipt_path)
        receipt.update(members=selected, payloadIdentity=record['payloadIdentity'])
        receipt_path.write_text(json.dumps(receipt))
        transport.validate(destination, source=self.source, run=self.run, attempt=self.attempt, imported=True)
        attributed = {'digest': 'sha256:' + release_set.digest(archive)[0], 'size_in_bytes': archive.stat().st_size}
        with patch.object(transport, 'provider', return_value=attributed):
            with self.assertRaisesRegex(ValueError, 'attributed native archive'):
                transport.verify_import(destination, expected_source=self.source)

    def test_cross_source_run_attempt_and_incomplete_scenario_refuse(self):
        receipt = json.loads((self.directory / transport.RECEIPT).read_text())
        for key, value in [('sourceSha', 'b' * 40), ('githubRunId', '124'), ('githubAttempt', '2'),
                           ('payloadIdentity', '0' * 64), ('outcomes', {}), ('extra', 'private')]:
            changed = copy.deepcopy(receipt)
            changed[key] = value
            self.zip(replace={transport.RECEIPT: json.dumps(changed).encode()})
            with self.subTest(key=key), self.assertRaises(ValueError):
                transport.extract(self.archive, self.root / ('bad-' + key), source=self.source, run=self.run, attempt=self.attempt)

    def test_traversal_symlinks_extra_duplicate_missing_and_changed_bytes_refuse(self):
        record = release_set.load(self.record)
        bad_link = zipfile.ZipInfo('alias')
        bad_link.create_system = 3
        bad_link.external_attr = (stat.S_IFLNK | 0o777) << 16
        for index, extra in enumerate([('../escape', b'x'), ('/absolute', b'x'), ('C:\\escape', b'x'),
                                       ('private.log', b'x'), (transport.RECEIPT, b'{}'), (bad_link, b'target')]):
            self.zip(extra=extra)
            with self.subTest(index=index), self.assertRaises(ValueError):
                transport.extract(self.archive, self.root / ('bad-extra-' + str(index)), source=self.source, run=self.run, attempt=self.attempt)
            self.assertFalse((self.root / ('bad-extra-' + str(index))).exists())
        self.zip(omit=transport.RECEIPT)
        with self.assertRaises(ValueError):
            self.extract()
        self.zip(replace={record['artifact']['name']: b'corrupt'})
        with self.assertRaises(ValueError):
            self.extract()

    def test_local_alias_and_hardlink_and_private_extras_refuse(self):
        name = release_set.load(self.record)['artifact']['name']
        exe = self.directory / name
        alias = self.root / 'hardlink'
        os.link(exe, alias)
        with self.assertRaises(ValueError):
            transport.validate(self.directory, source=self.source, run=self.run, attempt=self.attempt)
        alias.unlink()
        (self.directory / 'private.log').write_text('not eligible')
        with self.assertRaises(ValueError):
            transport.validate(self.directory, source=self.source, run=self.run, attempt=self.attempt)

    def test_export_refuses_nonmanual_or_mismatched_installed_candidate(self):
        env = {'GITHUB_SHA': self.source, 'GITHUB_RUN_ID': self.run, 'GITHUB_RUN_ATTEMPT': self.attempt,
               'GITHUB_EVENT_NAME': 'push', 'GITHUB_REPOSITORY': 'codexa-bh/ai-garmin-trainer'}
        with patch.dict(os.environ, env), patch.object(transport.platform_target, 'require_host'):
            with self.assertRaises(ValueError):
                transport.export(self.record, self.images, self.root / 'refused')
            env['GITHUB_EVENT_NAME'] = 'workflow_dispatch'
            with patch.dict(os.environ, env), patch.object(evidence, 'validate', return_value={**self.manifest, 'installerSha256': '0' * 64}):
                with self.assertRaises(ValueError):
                    transport.export(self.record, self.images, self.root / 'refused')
        self.assertFalse((self.root / 'refused').exists())

    def test_live_provider_requires_exact_workflow_attempt_source_success_artifact(self):
        workflow = {'id': 7, 'path': '.github/workflows/windows.yml'}
        run = {'id': 123, 'run_attempt': 1, 'workflow_id': 7, 'path': workflow['path'], 'head_sha': self.source,
               'event': 'workflow_dispatch', 'status': 'completed', 'conclusion': 'success',
               'repository': {'full_name': 'codexa-bh/ai-garmin-trainer'}}
        item = {'id': 456, 'name': transport.artifact_name(self.source, self.run, self.attempt), 'expired': False,
                'size_in_bytes': 12345, 'workflow_run': {'id': 123, 'head_sha': self.source}}
        def api(_path):
            if _path.startswith('/actions/workflows/'):
                return workflow
            if 'artifacts?' in _path:
                return {'total_count': 1, 'artifacts': [item]}
            return run
        with patch.object(transport, 'api', side_effect=api):
            self.assertEqual(transport.provider(self.source, self.run, self.attempt, self.artifact), item)
            for target, key, bad in [(run, 'run_attempt', 2), (run, 'workflow_id', 8), (run, 'head_sha', 'b' * 40),
                                     (run, 'event', 'push'), (run, 'conclusion', 'failure'), (item, 'expired', True),
                                     (item, 'name', 'random-run'), (item, 'size_in_bytes', transport.MAX_INSTALLER * 2)]:
                old = target[key]
                target[key] = bad
                with self.subTest(key=key), self.assertRaises(ValueError):
                    transport.provider(self.source, self.run, self.attempt, self.artifact)
                target[key] = old


if __name__ == '__main__':
    unittest.main()
