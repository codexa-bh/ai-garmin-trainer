"""install.sh contract with fake system tools only; no network, disk image or real app."""

import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[2] / 'install.sh'
DOWNLOADS = 'https://github.com/codexa-bh/ai-garmin-trainer/releases/download/v1.2.3/'
IMAGE = 'AI-Trainer-for-Garmin-Connect-1.2.3-macos-arm64.dmg'
APP = 'AI Trainer for Garmin Connect.app'
FORMER_APP = 'Garmin Trainer.app'
TOOLS = ('uname', 'sysctl', 'pgrep', 'curl', 'shasum', 'hdiutil', 'ditto')
# One program stands in for every system tool the installer calls.
FAKE_TOOLS = r"""
import hashlib, os, shutil, sys
from pathlib import Path

tool, args = sys.argv[1], sys.argv[2:]
state = Path(os.environ['FAKE_STATE'])
with (state / 'calls.log').open('a') as log:
    log.write(tool + ' ' + ' '.join(args) + '\n')
if tool == 'uname':
    print(os.environ.get('FAKE_UNAME', 'Darwin'))
elif tool == 'sysctl':
    print(os.environ.get('FAKE_ARM64', '1'))
elif tool == 'pgrep':
    sys.exit(0 if (state / 'running').exists() else 1)
elif tool == 'curl':
    source = state / 'remote' / args[-1].rsplit('/', 1)[-1]
    if not source.is_file():
        sys.exit(22)
    if '-o' in args:
        shutil.copyfile(source, args[args.index('-o') + 1])
    else:
        sys.stdout.write(source.read_text())
elif tool == 'shasum':
    print(hashlib.sha256(Path(args[-1]).read_bytes()).hexdigest() + '  ' + args[-1])
elif tool == 'hdiutil' and args[0] == 'attach':
    mount = args[args.index('-mountpoint') + 1]
    shutil.copytree(state / 'image', mount, dirs_exist_ok=True)
elif tool == 'hdiutil':
    shutil.rmtree(args[1])
elif tool == 'ditto':
    if (state / 'copy-fails').exists():
        (Path(args[1]) / 'partial-copy').write_text('partial')
        sys.exit(1)
    shutil.copytree(args[0], args[1], dirs_exist_ok=True)
    if (state / 'starts-during-copy').exists():
        (state / 'running').touch()
"""


@unittest.skipIf(sys.platform == 'win32', 'POSIX shell installer for macOS')
class InstallScriptTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name).resolve()
        self.state = root / 'state'
        self.remote = self.state / 'remote'
        self.work = root / 'work'
        self.destination = root / 'Applications'
        bin_directory = root / 'bin'
        for directory in (self.remote, self.work, self.destination, bin_directory):
            directory.mkdir(parents=True)
        tools = root / 'fake_tools.py'
        tools.write_text(FAKE_TOOLS)
        for name in TOOLS:
            stub = bin_directory / name
            stub.write_text(f'#!/bin/sh\nexec "$FAKE_PYTHON" "$FAKE_TOOLS" {name} "$@"\n')
            stub.chmod(0o755)
        self.env = {
            'PATH': f'{bin_directory}:/usr/bin:/bin',
            'TMPDIR': str(self.work),
            'FAKE_PYTHON': sys.executable,
            'FAKE_TOOLS': str(tools),
            'FAKE_STATE': str(self.state),
        }
        self.app(self.state / 'image', APP, 'new')
        self.publish()

    def app(self, parent, name, marker):
        bundle = parent / name / 'Contents'
        bundle.mkdir(parents=True)
        (bundle / 'marker').write_text(marker)
        return parent / name

    def publish(self, *, image=IMAGE, checksum=None, urls=None):
        data = b'disk image ' + image.encode()
        (self.remote / image).write_bytes(data)
        digest = checksum or hashlib.sha256(data).hexdigest()
        (self.remote / (image + '.sha256')).write_text(digest + '  ' + image + '\n')
        urls = urls or [
            DOWNLOADS + image,
            DOWNLOADS + image + '.sha256',
            DOWNLOADS + image.replace('-macos-arm64.dmg', '-windows-x64-setup.exe'),
        ]
        release = {'tag_name': 'v1.2.3', 'assets': [{'browser_download_url': u} for u in urls]}
        (self.remote / 'latest').write_text(json.dumps(release, indent=2))

    def install(self, **environment):
        # Always pass the destination: the default is the real /Applications.
        return subprocess.run(
            ['/bin/bash', str(SCRIPT), str(self.destination)],
            env={**self.env, **environment},
            capture_output=True,
            text=True,
            timeout=60,
        )

    def calls(self, tool):
        log = self.state / 'calls.log'
        lines = log.read_text().splitlines() if log.exists() else []
        return [line for line in lines if line.startswith(tool + ' ')]

    def marker(self, name=APP):
        return (self.destination / name / 'Contents/marker').read_text()

    def assert_refused(self, result, message):
        self.assertNotEqual(result.returncode, 0, result.stdout)
        self.assertIn(message, result.stderr)
        self.assertEqual(list(self.work.iterdir()), [])
        leftovers = [path.name for path in self.destination.iterdir() if path.name.startswith('.')]
        self.assertEqual(leftovers, [])

    def test_installs_the_verified_latest_release_and_cleans_up(self):
        result = self.install()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.marker(), 'new')
        self.assertEqual([path.name for path in self.destination.iterdir()], [APP])
        self.assertEqual(list(self.work.iterdir()), [])
        self.assertEqual(len(self.calls('hdiutil detach')), 1)
        self.assertIn('Installed ' + APP, result.stdout)
        self.assertNotIn(FORMER_APP, result.stdout)

    def test_replaces_only_the_installed_app(self):
        installed = self.app(self.destination, APP, 'old')
        (installed / 'Contents/removed-in-new-version').write_text('old')
        self.app(self.destination, 'Other.app', 'other')
        self.assertEqual(self.install().returncode, 0)
        self.assertEqual(self.marker(), 'new')
        self.assertFalse((installed / 'Contents/removed-in-new-version').exists())
        self.assertEqual(self.marker('Other.app'), 'other')

    def test_preserves_an_existing_staging_lookalike(self):
        existing = self.destination / f'.{APP}.installing'
        existing.mkdir()
        marker = existing / 'unrelated'
        marker.write_text('preserved')
        result = self.install()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(marker.read_text(), 'preserved')
        self.assertEqual(self.marker(), 'new')
        self.assertEqual(
            sorted(path.name for path in self.destination.iterdir()), [existing.name, APP]
        )

    def test_keeps_the_former_named_app_and_says_so(self):
        self.app(self.destination, FORMER_APP, 'former')
        result = self.install()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.marker(FORMER_APP), 'former')
        self.assertIn(FORMER_APP, result.stdout)

    def test_installs_a_release_published_under_the_former_name(self):
        (self.state / 'image' / APP).rename(self.state / 'image' / FORMER_APP)
        self.publish(image='Garmin-Trainer-0.1.4-macos-arm64.dmg')
        result = self.install()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.marker(FORMER_APP), 'new')

    def test_checksum_mismatch_installs_nothing(self):
        self.app(self.destination, APP, 'old')
        self.publish(checksum='0' * 64)
        self.assert_refused(self.install(), 'checksum')
        self.assertEqual(self.marker(), 'old')
        self.assertEqual(self.calls('hdiutil'), [])

    def test_refuses_while_the_app_is_running_before_any_download(self):
        self.app(self.destination, APP, 'old')
        (self.state / 'running').touch()
        self.assert_refused(self.install(), 'running')
        self.assertEqual(self.marker(), 'old')
        self.assertEqual(self.calls('curl'), [])

    def test_refuses_if_the_app_starts_during_the_copy(self):
        self.app(self.destination, APP, 'old')
        (self.state / 'starts-during-copy').touch()
        self.assert_refused(self.install(), 'running')
        self.assertEqual(self.marker(), 'old')
        self.assertEqual(len(self.calls('hdiutil detach')), 1)

    def test_failed_copy_leaves_the_installed_app_unchanged(self):
        self.app(self.destination, APP, 'old')
        (self.state / 'copy-fails').touch()
        self.assert_refused(self.install(), 'copy failed')
        self.assertEqual(self.marker(), 'old')
        self.assertEqual(len(self.calls('hdiutil detach')), 1)

    def test_refuses_foreign_ambiguous_or_missing_downloads(self):
        foreign = 'https://example.invalid/releases/download/v1.2.3/' + IMAGE
        for urls in ([foreign], [DOWNLOADS + IMAGE, DOWNLOADS + 'second-macos-arm64.dmg'], ['x']):
            with self.subTest(urls=urls):
                (self.state / 'calls.log').unlink(missing_ok=True)
                self.publish(urls=urls)
                result = self.install()
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(len(self.calls('curl')), 1)  # Only the release lookup.
                self.assertEqual(list(self.destination.iterdir()), [])

    def test_refuses_unexpected_image_contents(self):
        self.app(self.state / 'image', 'Second.app', 'second')
        self.assert_refused(self.install(), 'disk image contents')
        self.assertEqual(list(self.destination.iterdir()), [])

    def test_refuses_other_systems_before_contacting_github(self):
        for environment in ({'FAKE_UNAME': 'Linux'}, {'FAKE_ARM64': ''}):
            with self.subTest(environment=environment):
                result = self.install(**environment)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(self.calls('curl'), [])
                self.assertEqual(list(self.destination.iterdir()), [])
