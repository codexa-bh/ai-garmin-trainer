"""Fragment grammar, ordering and rendering; filesystem-only temporary fixtures."""

import contextlib
import io
from pathlib import Path
import tempfile
import unittest

import release_note_fragments as fragments


def write(
    directory,
    name,
    *,
    task=None,
    pr='pending',
    category='Changed',
    required='true',
    body='- Note.',
    reason=None,
):
    task = task or name[:5]
    lines = [
        '---',
        f'task: {task}',
        f'pr: {pr}',
        f'category: {category}',
        f'release_note_required: {required}',
    ]
    if reason is not None:
        lines.append(f'reason: {reason}')
    path = directory / name
    path.write_text('\n'.join(lines + ['---', '', body, '']))
    return path


class FragmentTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.dir = Path(self.temp.name) / 'unreleased'
        self.dir.mkdir()

    def refuses(self, pattern, name='T0001-example.md', **fields):
        path = write(self.dir, name, **fields)
        with self.assertRaisesRegex(fragments.FragmentError, pattern):
            fragments.collect(self.dir)
        path.unlink()

    def test_missing_or_empty_directory_is_the_valid_empty_state(self):
        self.assertEqual(fragments.collect(self.dir / 'absent'), [])
        self.assertEqual(fragments.collect(self.dir), [])
        self.assertEqual(fragments.render([]), '')

    def test_valid_required_and_no_note_fragments_parse(self):
        write(self.dir, 'T0001-fix.md', pr='225', category='Fixed')
        write(
            self.dir,
            'T0002-tests.md',
            required='false',
            category='Internal',
            pr='none',
            reason='test-only',
            body='',
        )
        required, marker = fragments.collect(self.dir)
        self.assertTrue(required.required)
        self.assertEqual((required.task, required.category), ('T0001', 'Fixed'))
        self.assertFalse(marker.required)
        self.assertEqual(marker.reason, 'test-only')

    def test_each_invalid_input_names_its_file_and_field(self):
        self.refuses('category must be one of', category='Misc')
        self.refuses('release_note_required must be true or false', required='yes')
        self.refuses('pr must be', pr='#12')
        self.refuses('pr must be', pr='0')
        self.refuses('nonzero four-digit', task='T0000', name='T0000-example.md')
        self.refuses('matching the filename', task='T0002')
        self.refuses('filename must be', name='notes.md')
        self.refuses('filename must be', name='T001-short.md')
        self.refuses('needs a note body', body='')
        self.refuses('needs a nonempty reason', required='false', body='')
        self.refuses('reason belongs only', reason='why')

    def test_front_matter_grammar_refuses_malformed_input(self):
        path = self.dir / 'T0001-example.md'
        cases = {
            'must start and end': 'task: T0001\n',
            'must start and end ': '---\ntask: T0001\n',
            'nonempty "key: value"': '---\ntask T0001\n---\nbody\n',
            'unknown field': '---\ntask: T0001\nowner: me\n---\nbody\n',
            'duplicate field': '---\ntask: T0001\ntask: T0001\n---\nbody\n',
            'missing field': '---\ntask: T0001\n---\nbody\n',
        }
        for pattern, text in cases.items():
            path.write_text(text)
            with (
                self.subTest(pattern=pattern),
                self.assertRaisesRegex(fragments.FragmentError, pattern.strip()),
            ):
                fragments.collect(self.dir)

    def test_symlinks_and_subdirectories_are_refused_without_following(self):
        outside = Path(self.temp.name) / 'outside.md'
        outside.write_text('secret')
        (self.dir / 'T0001-link.md').symlink_to(outside)
        with self.assertRaisesRegex(fragments.FragmentError, 'symlinks and subdirectories'):
            fragments.collect(self.dir)
        (self.dir / 'T0001-link.md').unlink()
        (self.dir / 'nested').mkdir()
        with self.assertRaisesRegex(fragments.FragmentError, 'symlinks and subdirectories'):
            fragments.collect(self.dir)

    def test_supporting_files_are_ignored(self):
        (self.dir / 'README.md').write_text('# guide\n')
        (self.dir / 'TEMPLATE.md').write_text('not a fragment')
        (self.dir / '.gitkeep').write_text('')
        self.assertEqual(fragments.collect(self.dir), [])

    def test_order_is_category_then_filename_and_stable(self):
        write(self.dir, 'T0009-b.md', category='Fixed', body='- fixed b')
        write(self.dir, 'T0003-z.md', category='Added', body='- added z')
        write(self.dir, 'T0003-a.md', category='Fixed', body='- fixed a')
        write(self.dir, 'T0004-marker.md', required='false', reason='n/a', body='')
        rendered = fragments.render(fragments.collect(self.dir))
        self.assertEqual(
            rendered,
            '## Changes\n\n### Added\n\n- added z\n\n### Fixed\n\n- fixed a\n\n- fixed b\n',
        )
        self.assertEqual(rendered, fragments.render(list(reversed(fragments.collect(self.dir)))))

    def test_multiple_changes_from_one_task_and_multiline_bodies_survive(self):
        write(self.dir, 'T0005-one.md', body='- First\n  - Technical: detail')
        write(self.dir, 'T0005-two.md', body='- Second')
        self.assertEqual(
            fragments.render(fragments.collect(self.dir)),
            '## Changes\n\n### Changed\n\n- First\n  - Technical: detail\n\n- Second\n',
        )

    def test_command_entry_checks_and_previews_without_writing(self):
        write(self.dir, 'T0001-fix.md', category='Fixed', body='- Fixed it')
        before = {p.name: p.read_bytes() for p in self.dir.iterdir()}
        for action, expected in (('check', '1 required and 0 no-note'), ('preview', '- Fixed it')):
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                self.assertEqual(fragments.main([action, '--directory', str(self.dir)]), 0)
            self.assertIn(expected, out.getvalue())
        self.assertEqual(before, {p.name: p.read_bytes() for p in self.dir.iterdir()})
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            fragments.main(['preview', '--directory', str(self.dir / 'absent')])
        self.assertEqual(out.getvalue(), fragments.NO_CHANGES + '\n')
        write(self.dir, 'T0002-bad.md', category='Nope')
        err = io.StringIO()
        with contextlib.redirect_stderr(err):
            self.assertEqual(fragments.main(['check', '--directory', str(self.dir)]), 1)
        self.assertIn('T0002-bad.md', err.getvalue())


if __name__ == '__main__':
    unittest.main()
