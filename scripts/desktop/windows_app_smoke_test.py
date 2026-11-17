"""Before-use contracts; modeled cases are not actual installed-app evidence."""
import contextlib
import copy
import hashlib
import json
import os
from pathlib import Path
import struct
import subprocess
import sqlite3
import sys
import tempfile
import unittest
from unittest import mock
import uuid
import zlib
import zipfile

import windows_app_smoke as app
import windows_smoke_evidence as evidence
import windows_smoke_state as state
import windows_smoke_process as process


def png_bytes(size=(2, 2), *, blank=False, extra=None, transparent=False):
    width, height = size
    raw = b''.join(b'\0' + b''.join(bytes((0, 0, 0) if blank else ((x + y) % 256, x % 256, y % 256)) + (b'\0' if transparent else b'')
                                     for x in range(width)) for y in range(height))
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff)
    header = chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 6 if transparent else 2, 0, 0, 0))
    return (b'\x89PNG\r\n\x1a\n' + header + (chunk(*extra) if extra else b'')
            + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b''))


class EvidenceContracts(unittest.TestCase):
    def test_complete_bounded_decode_and_blank_privacy_and_framing_refusals(self):
        valid = png_bytes()
        self.assertEqual(evidence.png(valid, (2, 2)), (2, 2))
        for content, dimensions in [(valid[:-1], (2, 2)), (valid + b'private', (2, 2)),
                                    (valid, (420, 850)), (png_bytes(blank=True), (2, 2)), (png_bytes(transparent=True), (2, 2)),
                                    (png_bytes(extra=(b'tEXt', b'private')), (2, 2)),
                                    (png_bytes(extra=(b'iCCP', b'unbounded')), (2, 2)),
                                    (valid[:40] + b'bad' + valid[43:], (2, 2))]:
            with self.assertRaises(ValueError):
                evidence.png(content, dimensions)

    def manifest(self):
        run, boot = str(uuid.uuid4()), str(uuid.uuid4())
        return {'schemaVersion': 1, 'sourceSha': 'a' * 40, 'githubRunId': '123', 'githubAttempt': '1',
                'os': 'Windows Server 2025', 'image': '20261116.1', 'osBuild': '26100', 'architecture': 'x64',
                'webview2Version': '142.0.0.0', 'installerSha256': 'b' * 64, 'payloadSha256': 'c' * 64,
                'outcomes': {key: 'passed' for key in evidence.STAGES}, 'limits': evidence.LIMITS,
                'images': [{'file': f'{view}-{preset}.png', 'sha256': hashlib.sha256(b'codec-tested-separately').hexdigest(),
                            'view': view, 'preset': preset, 'width': size[0], 'height': size[1], 'runId': run, 'bootId': boot,
                            'captureMethod': 'webview2-capture-preview', 'inputMethod': 'synthetic-dom', 'masked': True}
                           for view in evidence.VIEWS for preset, size in evidence.PRESETS.items()]}

    @contextlib.contextmanager
    def staged(self):
        with tempfile.TemporaryDirectory() as name:
            root = Path(name).resolve()
            for name in evidence.FILES:
                (root / name).write_bytes(b'codec-tested-separately')
            manifest = self.manifest()
            (root / 'manifest.json').write_text(json.dumps(manifest))
            # Schema/path/provenance tests independently of the actual PNG codec.
            with mock.patch.object(evidence, 'png'):
                yield root, manifest

    def test_exact_allowlist_identity_and_closed_schema(self):
        with self.staged() as (root, valid):
            self.assertEqual(evidence.validate(root, expected_source='a' * 40, expected_run='123', expected_attempt='1'), valid)
            for change in [lambda v: v.update(secret='do-not-upload'),
                           lambda v: v.update(sourceSha='b' * 40),
                           lambda v: v['outcomes'].update(uninstall='not-run'),
                           lambda v: v['images'][0].update(file='../private.png'),
                           lambda v: v['images'][0].update(masked=False),
                           lambda v: v['images'][0].update(inputMethod='trusted-hardware'),
                           lambda v: v['images'][0].update(bootId=str(uuid.uuid4())),
                           lambda v: v['images'][0].update(capability='secret'),
                           lambda v: v['images'][0].update(sha256='d' * 64),
                           lambda v: v['images'][0].update(width=True),
                           lambda v: v['images'].append(v['images'][0]),
                           lambda v: v.update(image='C:\\private\\path')]:
                changed = copy.deepcopy(valid)
                change(changed)
                (root / 'manifest.json').write_text(json.dumps(changed))
                with self.assertRaises((ValueError, TypeError)):
                    evidence.validate(root, expected_source='a' * 40)
            (root / 'manifest.json').write_text(json.dumps(valid))
            (root / 'raw.log').write_text('never eligible')
            with self.assertRaises(ValueError):
                evidence.validate(root)

    def test_untrusted_download_archive_exact_members_before_extraction(self):
        with self.staged() as (root, valid):
            archive = root.parent / ('download-' + str(uuid.uuid4()) + '.zip')
            destination = root.parent / ('inspected-' + str(uuid.uuid4()))
            try:
                with zipfile.ZipFile(archive, 'x') as bundle:
                    for path in root.iterdir():
                        bundle.write(path, path.name)
                self.assertEqual(evidence.download_archive(archive, destination, expected_source='a' * 40, expected_run='123', expected_attempt='1'), valid)
                with self.assertRaises(FileExistsError):
                    evidence.download_archive(archive, destination, expected_source='a' * 40, expected_run='123', expected_attempt='1')
                with zipfile.ZipFile(archive, 'a') as bundle:
                    bundle.writestr('../escape.txt', b'not allowed')
                refused = root / 'must-not-exist'
                with self.assertRaises(ValueError):
                    evidence.download_archive(archive, refused, expected_source='a' * 40, expected_run='123', expected_attempt='1')
                self.assertFalse(refused.exists())
            finally:
                archive.unlink(missing_ok=True)
                if destination.exists():
                    for path in destination.iterdir():
                        path.unlink()
                    destination.rmdir()

    def test_missing_extra_duplicate_and_aliased_members_refuse(self):
        with self.staged() as (root, valid):
            path = root / 'trainer-wide.png'
            path.unlink()
            with self.assertRaises(ValueError):
                evidence.validate(root)
            target = root / 'target'
            target.write_bytes(b'codec-tested-separately')
            try:
                path.symlink_to(target)
            except OSError:
                pass  # Windows symlink privilege is not requested; hardlink below is mandatory.
            else:
                with self.assertRaises(ValueError):
                    state.read_file(path, 100)
                path.unlink()
            os.link(target, path)
            with self.assertRaises(ValueError):
                state.read_file(path, 100)
            raw = json.dumps(valid)
            (root / 'manifest.json').write_text(raw[:-1] + ',"sourceSha":"' + 'b' * 40 + '"}')
            with self.assertRaises(ValueError):
                json.loads((root / 'manifest.json').read_text(), object_pairs_hook=evidence.unique)


class LifecycleContracts(unittest.TestCase):
    def test_startup_diagnostics_never_publish_raw_logs_paths_or_capabilities(self):
        with tempfile.TemporaryDirectory() as name:
            root = Path(name).resolve()
            secret = 'private-capability-do-not-print'
            (root / 'native-1.log').write_text('Isolated admission refused at root-directory\nIsolated ordinary-run admission refused; no normal-state fallback.\n' + secret + '\nC:\\private\\settings.json\n')
            with (root / 'native-1.log').open('a') as log:
                log.write('Isolated runtime startup refused: Cannot create desktop window.\n')
                log.write('Isolated runtime startup refused: ' + secret + '\n')
                log.write('Desktop settings validation: database SQLITE_CANTOPEN\n')
                log.write('Desktop settings validation: fields ' + secret + '\n')
                log.write('Isolated desktop window hresult: -2147024809\nIsolated desktop window hresult: 123456\n')
            value = app.startup_diagnostic(root, 1, 1)
            self.assertEqual(value['runtimeStartupCodes'], ['desktop-window'])
            self.assertEqual(value['settingsValidation'], [{'stage': 'database', 'code': 'SQLITE_CANTOPEN'}, {'stage': 'fields', 'code': 'unavailable'}])
            self.assertEqual(value['windowHresults'], [-2147024809])
            self.assertTrue(value['runtimeStartupFailure'])
            self.assertGreater(value['nativeLogBytes'], 0)
            self.assertEqual(value['admissionStages'], ['root-directory'])
            self.assertTrue(value['admissionRefused'])
            self.assertNotIn(secret, json.dumps(value))
            self.assertNotIn('settings.json', json.dumps(value))
            (root / 'native-1.log').write_bytes(b'x' * (64 * 1024 + 1))
            self.assertFalse(app.startup_diagnostic(root, 1, None)['nativeLogAvailable'])
            self.assertTrue(app.startup_diagnostic(root, 2, 0xc0000135)['loaderDllMissing'])

    def test_direct_bounded_installer_arguments_and_failures(self):
        with mock.patch.object(app.process, 'execute', return_value=0) as run:
            app.execute_installer(Path('installer.exe'), ['/S', '/NS', '/D=C:\\owned program'], cwd=Path('.'))
            self.assertEqual(run.call_args.args, (Path('installer.exe'), ['/S', '/NS', '/D=C:\\owned program']))
            self.assertEqual(run.call_args.kwargs['timeout'], 120)
            self.assertNotIn('shell', run.call_args.kwargs)
        with mock.patch.object(app.process, 'execute', return_value=2):
            with self.assertRaises(ValueError):
                app.execute_installer(Path('installer.exe'), [], cwd=Path('.'))
        with mock.patch.object(app.process, 'execute', side_effect=subprocess.TimeoutExpired('installer', 120)):
            with self.assertRaises(subprocess.TimeoutExpired):
                app.execute_installer(Path('installer.exe'), [], cwd=Path('.'))

    def test_nsis_destination_tail_is_last_and_not_quoted_even_with_spaces(self):
        line = process.command_line('C:\\installer path\\setup.exe', ['/S', '/NS', '/D=C:\\owned program'])
        self.assertEqual(line, '"C:\\installer path\\setup.exe" /S /NS /D=C:\\owned program')
        for arguments in [['/D=C:\\owned', '/S'], ['/D="C:\\owned"'], ['/D=C:\\owned\nforeign'], ['/D=']]:
            with self.assertRaises(ValueError):
                process.command_line('setup.exe', arguments)

    def test_installed_payload_requires_all_verified_bytes_and_only_known_generated_uninstaller(self):
        expected = {'garmin-trainer-desktop.exe': 'a' * 64, 'resources/provenance.json': 'b' * 64}
        installed = {**expected, 'uninstall.exe': 'c' * 64}
        with mock.patch.object(app, 'inventory', return_value=installed), mock.patch.object(app.windows_package, 'pe_machine', return_value=0x14c):
            self.assertEqual(app.installed_payload(Path('program'), expected), installed)
            for changed in [{**expected, 'uninstall.exe': 'c' * 64, 'foreign': 'd' * 64},
                            {**installed, 'resources/provenance.json': 'd' * 64}, expected]:
                with mock.patch.object(app, 'inventory', return_value=changed):
                    with self.assertRaises(ValueError):
                        app.installed_payload(Path('program'), expected)

    def test_request_requires_current_boot_and_binds_run(self):
        run = object.__new__(app.InstalledRun)
        run.id = str(uuid.uuid4())
        run.boot = None
        with self.assertRaises(ValueError):
            run.request({'type': 'observe'}, str(uuid.uuid4()))
        run.boot = str(uuid.uuid4())
        request = run.request({'type': 'observe'}, str(uuid.uuid4()))
        self.assertEqual(request['expectedRunId'], run.id)
        self.assertEqual(request['expectedBoot'], run.boot)

    def test_foreign_host_refuses_before_installation(self):
        with mock.patch.dict(os.environ, {'GITHUB_ACTIONS': 'false'}), mock.patch.object(app, 'registration') as registry:
            with self.assertRaises(ValueError):
                app.prerequisite()
            registry.assert_not_called()

    def test_real_appdata_and_saved_state_loss_are_not_vacuous_scratch_survival(self):
        with tempfile.TemporaryDirectory() as name:
            root = Path(name).resolve()
            config, appdata = root / 'config', root / 'real-appdata-boundary'
            config.mkdir()
            appdata.mkdir()
            (config / 'settings-v2.json').write_text('authored')
            (appdata / 'marker').write_text('T0341-owned')
            path = root / 'synthetic.sqlite'
            with contextlib.closing(sqlite3.connect(path)) as database:
                database.executescript("create table profile(goals text); insert into profile values ('T0341-owned');")
                before = app.fingerprint(database)
            settings, markers = app.inventory(config), app.inventory(appdata)
            app.assert_preserved(path, before, config, settings, appdata, markers)
            for target in [config / 'settings-v2.json', appdata / 'marker']:
                original = target.read_bytes()
                target.write_text('changed')
                with self.assertRaises(ValueError):
                    app.assert_preserved(path, before, config, settings, appdata, markers)
                target.write_bytes(original)
            with contextlib.closing(sqlite3.connect(path)) as database:
                database.execute("update profile set goals='lost'")
                database.commit()
            with self.assertRaises(ValueError):
                app.assert_preserved(path, before, config, settings, appdata, markers)

    def test_settlement_observes_all_run_profiles_including_hidden_setup_webview(self):
        with tempfile.TemporaryDirectory() as name:
            run = object.__new__(app.InstalledRun)
            run.root = Path(name).resolve()
            run.database = run.root / 'synthetic.sqlite'
            run.child, run.origin = None, None
            run.config, run.backend_handles = {'port': 12345}, []
            run.pin = mock.MagicMock()
            with mock.patch.object(app, 'listening', return_value=False), mock.patch.object(app, 'webview_processes', return_value=0) as observed:
                run.stop()
            observed.assert_called_once_with(run.root)
            run.pin.lease.assert_called_once()

    def test_orphan_webview_refuses_settlement_without_name_or_pid_kills(self):
        with tempfile.TemporaryDirectory() as name:
            run = object.__new__(app.InstalledRun)
            run.root = Path(name).resolve()
            run.database = run.root / 'synthetic.sqlite'
            run.child, run.origin = None, None
            run.config = {'port': 12345}
            run.pin = mock.Mock()
            with mock.patch.object(app, 'listening', return_value=False), mock.patch.object(app, 'webview_processes', return_value=1), mock.patch.object(app.time, 'monotonic', side_effect=[0, 1, 31]), mock.patch.object(app.time, 'sleep'):
                with self.assertRaises(RuntimeError):
                    run.stop()
            run.pin.lease.assert_not_called()
            self.assertIn('settlement incomplete', run.shutdown_failure)

    def test_shutdown_timeout_blocks_uninstall_without_signaling_foreign_processes(self):
        run = object.__new__(app.InstalledRun)
        run.child = mock.Mock()
        run.child.poll.return_value = None
        run.child.wait.side_effect = subprocess.TimeoutExpired('owned', 30)
        with self.assertRaises(subprocess.TimeoutExpired):
            run.stop()
        run.child.stdin.close.assert_called_once()
        run.child.kill.assert_not_called()
        run.child.terminate.assert_not_called()
        self.assertIn('no uninstaller', run.shutdown_failure)


@unittest.skipUnless(sys.platform == 'win32', 'Windows native ACL/file-ID/namespace owner contract')
class WindowsStateContracts(unittest.TestCase):
    def test_job_waits_for_forwarded_child_after_parent_exits(self):
        with tempfile.TemporaryDirectory() as name:
            root = Path(name).resolve()
            marker = root / 'descendant-completed'
            child = 'from pathlib import Path; import time; time.sleep(.3); Path(' + repr(str(marker)) + ').write_text("owned")'
            parent = 'import subprocess,sys; subprocess.Popen([sys.executable,"-c",' + repr(child) + '])'
            self.assertEqual(process.execute(Path(sys.executable), ['-c', parent], cwd=root, timeout=15), 0)
            self.assertEqual(marker.read_text(), 'owned')

    def test_job_timeout_settles_only_its_owned_tree(self):
        with tempfile.TemporaryDirectory() as name:
            root = Path(name).resolve()
            parent = 'import subprocess,sys,time; subprocess.Popen([sys.executable,"-c","import time; time.sleep(30)"]); time.sleep(30)'
            with self.assertRaises(subprocess.TimeoutExpired) as result:
                process.execute(Path(sys.executable), ['-c', parent], cwd=root, timeout=1)
            self.assertTrue(result.exception.owned_tree_settled)

    def test_readonly_live_backend_handle_identity_and_settlement(self):
        child = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(30)'])
        pinned = None
        try:
            pinned = state.PinnedProcess(child.pid, Path(sys.executable).resolve())
            self.assertFalse(pinned.settled())
            with self.assertRaises(ValueError):
                state.PinnedProcess(child.pid, Path(sys.executable).resolve().with_name('foreign.exe'))
            child.terminate()  # This test's retained live child only.
            child.wait(timeout=10)
            self.assertTrue(pinned.settled())
        finally:
            if child.poll() is None:
                child.terminate()
                child.wait(timeout=10)
            if pinned:
                pinned.close()

    def test_exclusive_private_creation_and_native_namespace_lease(self):
        with tempfile.TemporaryDirectory() as name:
            root = state.mkdir(Path(name).resolve() / 'owned')
            with self.assertRaises(OSError):
                state.mkdir(root)
            pin = state.PinnedRoot(root)
            other = state.PinnedRoot(root)
            try:
                with pin.lease():
                    with self.assertRaises(ValueError):
                        with other.lease():
                            pass
                with other.lease():
                    pass
                state.write_file(root / 'owned.txt', b'authored')
                self.assertEqual(state.read_file(root / 'owned.txt', 100), b'authored')
                with self.assertRaises(FileExistsError):
                    state.write_file(root / 'owned.txt', b'no overwrite')
            finally:
                other.close()
                pin.close()
