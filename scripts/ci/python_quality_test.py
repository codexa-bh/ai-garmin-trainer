"""Tracked-file coverage and failure propagation for Python quality commands."""

import importlib.util
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location(
    'python_quality', Path(__file__).resolve().parents[1] / 'python_quality.py'
)
quality = importlib.util.module_from_spec(spec)
spec.loader.exec_module(quality)


class PythonQualityTest(unittest.TestCase):
    def test_tracked_coverage_and_nonzero_status(self):
        files = b'scripts/a.py\0tests/case.py\0scripts/a_test.py\0scripts/b.py\0'
        for check, command, selected in [
            (
                'format',
                ['ruff', 'format', '--check'],
                ['scripts/a.py', 'tests/case.py', 'scripts/a_test.py', 'scripts/b.py'],
            ),
            (
                'lint',
                ['ruff', 'check'],
                ['scripts/a.py', 'tests/case.py', 'scripts/a_test.py', 'scripts/b.py'],
            ),
            ('deadcode', ['vulture', '--min-confidence', '60'], ['scripts/a.py', 'scripts/b.py']),
        ]:
            with (
                self.subTest(check=check),
                patch.object(sys, 'argv', ['quality', check]),
                patch.object(quality.subprocess, 'check_output', return_value=files) as tracked,
                patch.object(quality.subprocess, 'call', return_value=17) as run,
            ):
                self.assertEqual(quality.main(), 17)
                tracked.assert_called_once_with(
                    ['git', 'ls-files', '-z', '--', '*.py'],
                    cwd=Path(quality.__file__).resolve().parent.parent,
                )
                run.assert_called_once_with(
                    [sys.executable, '-m', *command, *selected],
                    cwd=Path(quality.__file__).resolve().parent.parent,
                )


if __name__ == '__main__':
    unittest.main()
