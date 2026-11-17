"""Portable no-follow/owner/lock primitives on the actual host OS."""
import os
from pathlib import Path
import subprocess
import tempfile
import threading
import time
import unittest

import platform_files


class PlatformFilesTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()

    def test_owned_regular_file_is_opened_in_binary_mode(self):
        path = self.root / 'lock'
        fd = platform_files.open_nofollow(path, os.O_RDWR | os.O_CREAT)
        try:
            self.assertTrue(platform_files.owned(fd))
            os.write(fd, b'a\nb')
            os.lseek(fd, 0, os.SEEK_SET)
            self.assertEqual(os.read(fd, 10), b'a\nb')  # No newline translation.
        finally:
            os.close(fd)

    def test_links_and_reparse_points_are_refused(self):
        target = self.root / 'target'
        target.write_text('x')
        link = self.root / 'link'
        try:
            link.symlink_to(target)
        except OSError:
            self.skipTest('Symbolic links unavailable to this account')
        with self.assertRaises(OSError):
            platform_files.open_nofollow(link, os.O_RDONLY)
        self.assertTrue(platform_files.is_link(link.lstat()))
        if platform_files.WINDOWS:
            junction = self.root / 'junction'
            directory = self.root / 'directory'
            directory.mkdir()
            subprocess.run(['cmd', '/c', 'mklink', '/J', str(junction), str(directory)], check=True,
                           capture_output=True)
            self.assertTrue(platform_files.is_link(junction.lstat()))

    def test_exclusive_lock_serializes_owners(self):
        path = self.root / 'native-smoke.lock'
        order = []
        first = platform_files.open_nofollow(path, os.O_RDWR | os.O_CREAT)
        second = platform_files.open_nofollow(path, os.O_RDWR | os.O_CREAT)
        try:
            with platform_files.exclusive(first):
                def contender():
                    with platform_files.exclusive(second):
                        order.append('second')
                thread = threading.Thread(target=contender)
                thread.start()
                time.sleep(0.5)
                order.append('first')
            thread.join(timeout=30)
            self.assertEqual(order, ['first', 'second'])
        finally:
            os.close(first)
            os.close(second)


if __name__ == '__main__':
    unittest.main()
