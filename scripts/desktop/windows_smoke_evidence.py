"""Closed synthetic masked-image publication/download contract (no log upload).

A manifest is not evidence of visual inspection. The consumer must independently
open every relied-on image and retain textual findings before three-day expiry.
"""
import hashlib
import io
import json
from pathlib import Path
import re
import struct
import uuid
import zlib
import zipfile
import stat

import windows_smoke_state as state

VIEWS = ('trainer', 'sync', 'profile')
PRESETS = {'wide': (1280, 850), 'narrow': (420, 850)}
FILES = {f'{view}-{preset}.png' for view in VIEWS for preset in PRESETS}
LIMITS = ['windows11-deferred', 'trusted-native-input-unavailable', 'no-real-services',
          'older-upgrade-downgrade-unqualified', 'no-window-chrome', 'synthetic-masked-only']
STAGES = ['install', 'identity', 'hydration', 'navigation', 'goalsSave', 'restartReadback',
          'captureRestore', 'settlement', 'programReplacement', 'uninstall', 'dataPreservation']
MANIFEST_KEYS = {'schemaVersion', 'sourceSha', 'githubRunId', 'githubAttempt', 'os', 'image',
                 'osBuild', 'architecture', 'webview2Version', 'installerSha256', 'payloadSha256',
                 'outcomes', 'limits', 'images'}
IMAGE_KEYS = {'file', 'sha256', 'view', 'preset', 'width', 'height', 'runId', 'bootId',
              'captureMethod', 'inputMethod', 'masked'}


def exact(value, keys):
    if not isinstance(value, dict) or set(value) != set(keys):
        raise ValueError('Closed evidence schema refused')


def hex_digest(value, length=64):
    if not isinstance(value, str) or not re.fullmatch('[0-9a-f]{' + str(length) + '}', value):
        raise ValueError('Evidence digest refused')


def identifier(value):
    if not isinstance(value, str) or str(uuid.UUID(value)) != value:
        raise ValueError('Non-secret canonical correlation UUID required')


def unique(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('Duplicate manifest key')
        result[key] = value
    return result


def png(data, expected):
    """Bounded full framing/CRC/deflate/filter decode; reject text/metadata bags
    and uniform/blank pixels. Nonblank is not a substitute for human inspection."""
    if not 45 <= len(data) <= 4 * 1024 * 1024 or not data.startswith(b'\x89PNG\r\n\x1a\n'):
        raise ValueError('Bounded PNG required')
    offset, chunks, packed, size, channels = 8, [], bytearray(), None, None
    while offset < len(data):
        if offset + 12 > len(data):
            raise ValueError('Truncated PNG')
        length, kind = struct.unpack('>I4s', data[offset:offset + 8])
        end = offset + 12 + length
        if end > len(data) or length > 4 * 1024 * 1024:
            raise ValueError('PNG chunk bound')
        content = data[offset + 8:offset + 8 + length]
        crc = struct.unpack('>I', data[end - 4:end])[0]
        if zlib.crc32(kind + content) & 0xffffffff != crc:
            raise ValueError('PNG CRC refused')
        if kind not in [b'IHDR', b'IDAT', b'IEND', b'sRGB', b'gAMA', b'pHYs', b'cHRM']:
            raise ValueError('PNG metadata/content type outside allowlist')
        if kind == b'IHDR':
            if chunks or length != 13:
                raise ValueError('PNG IHDR ordering')
            width, height, depth, color, compression, filtering, interlace = struct.unpack('>IIBBBBB', content)
            if (width, height) != expected or depth != 8 or color not in (2, 6) or compression or filtering or interlace:
                raise ValueError('PNG dimensions/encoding refused; no resize fallback')
            size, channels = (width, height), 3 if color == 2 else 4
        elif kind == b'IDAT':
            if not size or b'IEND' in chunks or (b'IDAT' in chunks and chunks[-1] != b'IDAT'):
                raise ValueError('PNG IDAT ordering')
            packed.extend(content)
        elif kind == b'IEND':
            if length or end != len(data) or not packed:
                raise ValueError('PNG IEND refused')
        elif len(content) > 64:
            raise ValueError('PNG metadata bound')
        chunks.append(kind)
        offset = end
    if not chunks or chunks[-1] != b'IEND' or not size:
        raise ValueError('PNG incomplete')
    stride = size[0] * channels
    bound = (stride + 1) * size[1]
    decoder = zlib.decompressobj()
    raw = decoder.decompress(packed, bound + 1)
    if len(raw) != bound or not decoder.eof or decoder.unused_data or decoder.unconsumed_tail:
        raise ValueError('PNG deflate framing/bound')
    prior, colors = bytearray(stride), set()
    for y in range(size[1]):
        start = y * (stride + 1)
        filtering, row = raw[start], bytearray(raw[start + 1:start + 1 + stride])
        if filtering not in range(5):
            raise ValueError('PNG row filter')
        for x in range(stride):
            a = row[x - channels] if x >= channels else 0
            b, c = prior[x], prior[x - channels] if x >= channels else 0
            if filtering == 1:
                prediction = a
            elif filtering == 2:
                prediction = b
            elif filtering == 3:
                prediction = (a + b) // 2
            elif filtering == 4:
                p = a + b - c
                distances = (abs(p - a), abs(p - b), abs(p - c))
                prediction = (a, b, c)[distances.index(min(distances))]
            else:
                prediction = 0
            row[x] = (row[x] + prediction) & 255
        if len(colors) < 16:
            for x in range(0, stride, channels):
                alpha = row[x + 3] if channels == 4 else 255
                colors.add(bytes((value * alpha + 255 * (255 - alpha) + 127) // 255 for value in row[x:x + 3]))
                if len(colors) >= 16:
                    break
        prior = row
    if len(colors) < 3:
        raise ValueError('Blank/uniform PNG refused')
    return size


def validate(directory, *, expected_source=None, expected_run=None, expected_attempt=None):
    directory = state.canonical(Path(directory))
    # Exact members, including directories/hidden files: never wildcard upload.
    if {path.name for path in directory.iterdir()} != FILES | {'manifest.json'}:
        raise ValueError('Evidence directory members differ from exact allowlist')
    manifest = json.loads(state.read_file(directory / 'manifest.json', 32 * 1024), object_pairs_hook=unique)
    exact(manifest, MANIFEST_KEYS)
    if type(manifest['schemaVersion']) is not int or manifest['schemaVersion'] != 2:
        raise ValueError('Evidence schema version refused')
    hex_digest(manifest['sourceSha'], 40)
    for key in ['installerSha256', 'payloadSha256']:
        hex_digest(manifest[key])
    for key in ['githubRunId', 'githubAttempt']:
        if not isinstance(manifest[key], str) or not re.fullmatch('[1-9][0-9]{0,19}', manifest[key]):
            raise ValueError('GitHub identity refused')
    for key, expected in [('sourceSha', expected_source), ('githubRunId', expected_run), ('githubAttempt', expected_attempt)]:
        if expected is not None and manifest[key] != expected:
            raise ValueError('Evidence differs from requested source/run/attempt')
    if manifest['os'] != 'Windows Server 2025' or manifest['architecture'] != 'x64':
        raise ValueError('Unexpected platform evidence')
    for key in ['image', 'osBuild', 'webview2Version']:
        if not isinstance(manifest[key], str) or not re.fullmatch('[A-Za-z0-9._-]{1,96}', manifest[key]):
            raise ValueError('Unsafe runtime identity')
    if manifest['limits'] != LIMITS or manifest['outcomes'] != {key: 'passed' for key in STAGES}:
        raise ValueError('Incomplete scenario or unsupported evidence claim')
    images = manifest['images']
    if not isinstance(images, list) or len(images) != 6:
        raise ValueError('Six correlated images required')
    seen = set()
    for image in images:
        exact(image, IMAGE_KEYS)
        view, preset = image['view'], image['preset']
        if view not in VIEWS or preset not in PRESETS or image['file'] != f'{view}-{preset}.png' or image['file'] in seen:
            raise ValueError('Image allowlist/correlation refused')
        seen.add(image['file'])
        identifier(image['runId'])
        identifier(image['bootId'])
        if (image['captureMethod'] != 'webview2-capture-preview' or image['inputMethod'] != 'synthetic-dom'
                or image['masked'] is not True or type(image['width']) is not int or type(image['height']) is not int
                or (image['width'], image['height']) != PRESETS[preset]):
            raise ValueError('Untrusted image method/mask/geometry')
        hex_digest(image['sha256'])
        content = state.read_file(directory / image['file'], 4 * 1024 * 1024)
        if hashlib.sha256(content).hexdigest() != image['sha256']:
            raise ValueError('Image digest mismatch')
        png(content, PRESETS[preset])
    if seen != FILES:
        raise ValueError('Missing images')
    if len({image['runId'] for image in images}) != 1 or len({image['bootId'] for image in images}) != 1:
        raise ValueError('Mixed capture runs/boots')
    return manifest


def download_archive(archive, destination, *, expected_source, expected_run, expected_attempt):
    """Validate untrusted zip membership before any exclusive extraction. Caller
    supplies a newly allocated local task evidence destination, never a mirror."""
    archive = state.canonical(Path(archive))
    state.canonical(destination.parent)
    content = state.read_file(archive, 26 * 1024 * 1024)
    with zipfile.ZipFile(io.BytesIO(content)) as bundle:
        members = bundle.infolist()
        if len(members) != 7 or {item.filename for item in members} != FILES | {'manifest.json'}:
            raise ValueError('Archive membership outside exact allowlist')
        if sum(item.file_size for item in members) > 6 * 4 * 1024 * 1024 + 32 * 1024:
            raise ValueError('Archive decompression bound')
        for item in members:
            mode = item.external_attr >> 16
            if item.is_dir() or (stat.S_IFMT(mode) not in (0, stat.S_IFREG)) or item.flag_bits & 1:
                raise ValueError('Archive nonregular/encrypted member refused')
            limit = 32 * 1024 if item.filename == 'manifest.json' else 4 * 1024 * 1024
            if not 0 < item.file_size <= limit:
                raise ValueError('Archive member bound')
        destination.mkdir(mode=0o700)  # Existing is refusal; never overwrite.
        for item in members:
            with bundle.open(item) as stream:
                content = stream.read(item.file_size + 1)
            if len(content) != item.file_size:
                raise ValueError('Archive member size/framing changed')
            state.write_file(destination / item.filename, content)
    return validate(destination, expected_source=expected_source, expected_run=expected_run, expected_attempt=expected_attempt)


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive', type=Path)
    parser.add_argument('--directory', type=Path, required=True)
    parser.add_argument('--source', required=True)
    parser.add_argument('--run', required=True)
    parser.add_argument('--attempt', required=True)
    args = parser.parse_args()
    options = {'expected_source': args.source, 'expected_run': args.run, 'expected_attempt': args.attempt}
    value = download_archive(args.archive, args.directory, **options) if args.archive else validate(args.directory, **options)
    print(json.dumps({'validatedSource': value['sourceSha'], 'run': value['githubRunId'], 'attempt': value['githubAttempt'],
                      'images': len(value['images']), 'visualInspection': 'required separately'}))
