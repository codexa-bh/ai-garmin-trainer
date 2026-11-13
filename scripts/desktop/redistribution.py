"""Assemble reviewed notices and source material, never select a project license.

Called only by the existing resource assembler under the ordinary producer lock.
Arbitrary archive paths are never extracted; upstream code is never executed.
Only two fixed public JS files are materialized to qualify Next's pinned patch.
Public indexes omit paths
from Cargo metadata and all local environment information.
"""
import concurrent.futures
import gzip
import hashlib
import io
import json
from pathlib import Path
import re
import shutil
import subprocess
import tarfile
import tempfile
import urllib.request


NOTICE_NAMES = ('license', 'licence', 'copying', 'copyright', 'notice',
                'authors', 'ftl.txt', 'ofl', 'patents')


def digest(data):
    return hashlib.sha256(data).hexdigest()


def notice_name(name):
    return Path(name).name.lower().startswith(NOTICE_NAMES)


def archive_notices(path):
    if path.suffix == '.txt':
        return [(path.name, path.read_text())] if notice_name(path.name) or path.name.startswith(('MIT', 'LGPL')) else []
    texts = []
    with tarfile.open(path) as archive:
        for member in archive:
            if member.isfile() and notice_name(member.name):
                if member.size > 2 * 1024 * 1024:
                    raise ValueError('Unexpectedly large upstream notice: ' + member.name)
                texts.append((member.name, archive.extractfile(member).read().decode('utf8', errors='replace')))
    return texts


def acquire(entry, cache):
    filename = entry['file']
    if Path(filename).name != filename or filename.startswith('.'):
        raise ValueError('Source input must have a plain public filename')
    path = cache / filename
    if path.is_symlink():
        raise ValueError('Aliased source cache input')
    if path.exists():
        data = path.read_bytes()
    else:
        if not entry['url'].startswith('https://'):
            raise ValueError('HTTPS source required')
        with urllib.request.urlopen(entry['url'], timeout=90) as response:
            data = response.read(entry['size'] + 1)
        if len(data) != entry['size'] or digest(data) != entry['sha256']:
            raise ValueError('Source input size/digest mismatch: ' + filename)
        with path.open('xb') as stream:
            stream.write(data)
    if len(data) != entry['size'] or digest(data) != entry['sha256']:
        raise ValueError('Source cache size/digest mismatch: ' + filename)
    return path


def verify_embedded_og(root, source, upstream_patch):
    """Qualify Next's own two-file patch, without modifying installed/runtime code."""
    compiled = root / 'node_modules/next/dist/compiled/@vercel/og'
    with tarfile.open(source) as archive, tempfile.TemporaryDirectory(dir=source.parent) as temporary:
        reconstructed = Path(temporary) / 'dist'
        reconstructed.mkdir()
        for name in ['index.node.js', 'index.edge.js']:
            (reconstructed / name).write_bytes(archive.extractfile('package/dist/' + name).read())
        subprocess.run(['/usr/bin/patch', '-t', '-N', '-p1', '-d', temporary, '-i', str(upstream_patch)],
                       check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30)
        for name in ['index.node.js', 'index.edge.js', 'resvg.wasm', 'yoga.wasm', 'Geist-Regular.ttf']:
            original = ((reconstructed / name).read_bytes() if name.endswith('.js')
                        else archive.extractfile('package/dist/' + name).read())
            if original != (compiled / name).read_bytes():
                raise ValueError('Embedded OG asset differs from source archive and Next patch: ' + name)
        for name in ['index.node.js.map', 'index.edge.js.map']:
            value = json.load(archive.extractfile('package/dist/' + name))
            if (not value['sources'] or len(value['sources']) != len(value['sourcesContent'])
                    or any(not isinstance(text, str) for text in value['sourcesContent'])):
                raise ValueError('Embedded OG preferred-source bodies incomplete')


def npm_notices(root):
    lock = json.loads((root / 'package-lock.json').read_text())
    packages, texts = [], []
    for relative, package in sorted(lock['packages'].items()):
        if not relative or package.get('dev'):
            continue
        directory = root / relative
        if not directory.exists():  # Optional packages for other platforms.
            continue
        installed = json.loads((directory / 'package.json').read_text())
        if installed['version'] != package['version']:
            raise ValueError('Installed npm version differs from lock: ' + relative)
        packages.append({'path': relative, 'name': installed['name'],
                         'version': installed['version'], 'license': package.get('license'),
                         'source': package.get('resolved'), 'integrity': package.get('integrity')})
        for path in sorted(directory.rglob('*')):
            local = path.relative_to(directory)
            if 'node_modules' in local.parts or not notice_name(path.name):
                continue
            if path.is_file() and not path.is_symlink():
                if path.stat().st_size > 2 * 1024 * 1024:
                    raise ValueError('Unexpectedly large npm notice: ' + str(local))
                texts.append((relative + '/' + local.as_posix(), path.read_text(errors='replace')))
    return packages, texts


def native_sources(root, destination):
    vendor = root / 'dist/desktop-license-crates'
    subprocess.run(['cargo', 'vendor', '--locked', '--manifest-path', 'src-tauri/Cargo.toml',
                    '--versioned-dirs', str(vendor)], cwd=root, check=True,
                   stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=300)
    metadata = json.loads(subprocess.check_output(
        ['cargo', 'metadata', '--locked', '--manifest-path', 'src-tauri/Cargo.toml',
         '--format-version', '1', '--filter-platform', 'aarch64-apple-darwin'],
        cwd=root, timeout=90))
    # Cargo's generated registry-package block; unknown/git sources fail closed.
    locked = {(name, version): checksum for name, version, checksum in re.findall(
        r'\[\[package\]\]\nname = "([^"]+)"\nversion = "([^"]+)"\nsource = "[^"]+"\nchecksum = "([0-9a-f]{64})"',
        (root / 'src-tauri/Cargo.lock').read_text())}
    packages, texts = [], []
    with destination.open('xb') as output, gzip.GzipFile(fileobj=output, mode='wb', mtime=0) as compressed:
        with tarfile.open(fileobj=compressed, mode='w|') as archive:
            for package in sorted(metadata['packages'], key=lambda p: (p['name'], p['version'])):
                if package['source'] is None:  # First-party crate, not a registry input.
                    continue
                name, version = package['name'], package['version']
                directory = vendor / (name + '-' + version)
                checksum = json.loads((directory / '.cargo-checksum.json').read_text())
                if checksum['package'] != locked[(name, version)]:
                    raise ValueError('Native source differs from locked registry archive')
                for relative, expected in sorted(checksum['files'].items()):
                    path = directory / relative
                    if path.is_symlink() or not path.is_file() or '..' in Path(relative).parts or Path(relative).is_absolute():
                        raise ValueError('Unexpected native source alias/path')
                    data = path.read_bytes()
                    if digest(data) != expected:
                        raise ValueError('Native source checksum mismatch: ' + name + '/' + relative)
                    member = tarfile.TarInfo(name + '-' + version + '/' + relative)
                    member.size = len(data)
                    member.mode = 0o755 if path.stat().st_mode & 0o111 else 0o644
                    archive.addfile(member, io.BytesIO(data))
                    if notice_name(relative):
                        texts.append((name + '-' + version + '/' + relative, data.decode('utf8', errors='replace')))
                packages.append({'name': name, 'version': version, 'license': package['license'],
                                 'checksum': checksum['package'],
                                 'source': 'https://static.crates.io/crates/' + name + '/' + name + '-' + version + '.crate'})
    return packages, texts


def assemble(root):
    resources = root / 'src-tauri/resources'
    output = resources / 'redistribution'
    sources = output / 'sources'
    sources.mkdir(parents=True, exist_ok=False)
    cache = root / 'dist/redistribution-inputs'
    cache.mkdir(parents=True, exist_ok=True)
    reviewed = json.loads((root / 'scripts/desktop/redistribution-inputs.json').read_text())
    for relative, expected in reviewed['basis'].items():
        if json.loads((root / relative).read_text())['version'] != expected:
            raise ValueError('Reviewed redistribution inputs need updating for ' + relative)
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        inputs = list(pool.map(lambda entry: acquire(entry, cache), reviewed['sources']))
    og = [path for entry, path in zip(reviewed['sources'], inputs) if entry['name'].startswith('@vercel/og@')]
    if len(og) != 1:
        raise ValueError('Exactly one reviewed OG source archive required')
    verify_embedded_og(root, og[0], cache / reviewed['ogPatch'])
    texts = []
    for entry, path in zip(reviewed['sources'], inputs):
        shutil.copyfile(path, sources / entry['file'])
        texts.extend((entry['name'] + '/' + name, text) for name, text in archive_notices(path))
    native, native_texts = native_sources(root, sources / 'native-crates.tar.gz')
    npm, npm_texts = npm_notices(root)
    texts.extend(native_texts)
    texts.extend(npm_texts)
    with (output / 'NOTICES.txt').open('x') as stream:
        stream.write('Actual third-party license/NOTICE texts; conservative source superset.\n'
                     'Per-file licenses control; this is not a project license or legal certification.\n'
                     'Node and its embedded components: see ../NODE-LICENSE.txt.\n'
                     'Source, attribution and limited permissions: see ../REDISTRIBUTION-REVIEW.txt.\n\n')
        for name, text in texts:
            stream.write('\n===== ' + name + ' =====\n' + text + '\n')
    public = {'version': 1, 'npmLockSha256': digest((root / 'package-lock.json').read_bytes()),
              'cargoLockSha256': digest((root / 'src-tauri/Cargo.lock').read_bytes()),
              'reviewedSources': reviewed['sources'], 'native': native, 'npm': npm,
              'nativeSourceArchiveSha256': digest((sources / 'native-crates.tar.gz').read_bytes())}
    (output / 'index.json').write_text(json.dumps(public, indent=2) + '\n')
    print(f'Redistribution material: {len(inputs)} reviewed inputs, {len(native)} native packages, '
          f'{len(npm)} installed production npm packages, {len(texts)} notice texts.')


if __name__ == '__main__':
    assemble(Path(__file__).resolve().parents[2])
