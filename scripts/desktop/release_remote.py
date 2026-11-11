"""Finite GitHub release operations: observation, draft/upload, separate publication.

No rebuild, clobber, deletion, tag move or automatic mutation retry. Transport failures
are unknown effects, recorded before returning control for read-only reconciliation.
"""
import hashlib
import json
import subprocess
from urllib.parse import quote

from release_artifact import digest, regular
from release_metadata import REPOSITORY


class GitHub:
    def __init__(self, journal):
        self.journal = journal

    def note(self, value):
        self.journal.write(json.dumps(value, sort_keys=True) + '\n')
        self.journal.flush()
        import os
        os.fsync(self.journal.fileno())

    def api(self, endpoint, method='GET', data=None, *, asset=None):
        mutation = method != 'GET'
        if mutation:
            self.note({'effect': method + ' ' + endpoint, 'outcome': 'unknown until reconciled'})
        args = ['gh', 'api', endpoint, '--method', method]
        if data is not None:
            args += ['--input', '-']
        if asset:
            args += ['--header', 'Content-Type: application/octet-stream', '--input', str(asset)]
        try:
            result = subprocess.run(args, input=json.dumps(data).encode() if data is not None else None,
                                    capture_output=True, timeout=180)
            if result.returncode:
                if not mutation and b'(HTTP 404)' in result.stderr:
                    return None
                raise RuntimeError('GitHub request refused/unavailable; inspect exact read-only status, never retry blindly')
            value = json.loads(result.stdout)
        except BaseException:
            self.note({'effect': method + ' ' + endpoint, 'outcome': 'failed or unknown; original request not retried'})
            raise
        self.note({'effect': method + ' ' + endpoint, 'outcome': 'observed', 'id': value.get('id') if isinstance(value, dict) else None})
        return value

    def download_hash(self, endpoint, expected_size):
        # Bounded streamed download: no second bulk artifact or unbounded communicate().
        import os
        import select
        import time
        if type(expected_size) is not int or not 0 < expected_size <= 2 * 1024 * 1024 * 1024:
            raise ValueError('Remote asset size is outside supported bounds')
        child = subprocess.Popen(['gh', 'api', endpoint, '--header', 'Accept: application/octet-stream'],
                                 stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        value, count = hashlib.sha256(), 0
        deadline = time.monotonic() + 180
        try:
            while True:
                remaining = deadline - time.monotonic()
                if remaining <= 0 or not select.select([child.stdout], [], [], remaining)[0]:
                    raise TimeoutError('Remote digest download deadline')
                block = os.read(child.stdout.fileno(), 1024 * 1024)
                if not block:
                    break
                count += len(block)
                if count > expected_size:
                    raise ValueError('Remote asset exceeds selected size')
                value.update(block)
            if child.wait(timeout=max(.01, deadline - time.monotonic())) or count != expected_size:
                raise ValueError('Remote asset download failed or size differs')
            return value.hexdigest()
        finally:
            if child.poll() is None:
                child.kill()  # Only this live read-only download handle.
                child.wait(timeout=10)
            child.stdout.close()


def build_preflight(github, commit, version):
    prefix = 'repos/' + REPOSITORY
    tag = github.api(prefix + '/git/ref/tags/' + quote('v' + version, safe=''))
    if tag is not None and (tag.get('object', {}).get('type') != 'commit' or tag['object'].get('sha') != commit):
        raise ValueError('Remote tag conflicts with selected build source')
    release = github.api(prefix + '/releases/tags/' + quote('v' + version, safe=''))
    if release is not None:
        raise ValueError('Existing release/draft: reconcile and reuse its selected artifact, never rebuild during release recovery')


def assets_for(record_path, record):
    dmg = record_path.parent / record['artifact']['name']
    checksum = record_path.parent / (dmg.name + '.sha256')
    if digest(dmg) != record['artifact']['sha256'] or regular(dmg).st_size != record['artifact']['size']:
        raise ValueError('Selected DMG changed')
    if checksum.read_text() != record['artifact']['sha256'] + '  ' + dmg.name + '\n':
        raise ValueError('Selected checksum differs')
    # release.json is intentionally compact/public; paths and environment never enter it.
    return {path.name: {'path': path, 'size': regular(path).st_size, 'sha256': digest(path)}
            for path in (dmg, checksum, record_path)}


def release_body(record, notes):
    return notes + '\nSource: ' + record['repository'] + '@' + record['commit'] + '\nDMG SHA-256: ' + record['artifact']['sha256'] + '\nSigning: ' + record['signing'] + '\n'


class Release:
    def __init__(self, github, record, notes, assets, prerelease, latest, *, before_effect=None):
        if record['repository'] != REPOSITORY or record['sourceDirty']:
            raise ValueError('Remote release requires canonical clean exact-source artifact')
        if type(prerelease) is not bool or type(latest) is not bool or (prerelease and latest):
            raise ValueError('Explicit noncontradictory prerelease/latest intent required')
        if ('-' in record['version']) != prerelease:
            raise ValueError('Prerelease version/channel intent disagrees')
        self.gh, self.record, self.assets = github, record, assets
        self.before_effect = before_effect
        self.prerelease, self.latest = prerelease, latest
        self.body = release_body(record, notes)
        self.prefix = 'repos/' + REPOSITORY
        self.tag = record['tag']

    def mutate(self, endpoint, method, data=None, *, asset=None):
        if self.before_effect:
            self.before_effect()
        for selected in self.assets.values():
            if digest(selected['path']) != selected['sha256']:
                raise ValueError('Selected local asset changed before remote effect')
        return self.gh.api(endpoint, method, data, asset=asset)

    def observe(self):
        tag = self.gh.api(self.prefix + '/git/ref/tags/' + quote(self.tag, safe=''))
        # Helpers create lightweight immutable refs. Unknown/annotated tags refuse rather than guessing.
        if tag is not None and (tag.get('object', {}).get('type') != 'commit' or tag['object'].get('sha') != self.record['commit']):
            raise ValueError('Remote tag conflicts; never move/delete it')
        release = self.gh.api(self.prefix + '/releases/tags/' + quote(self.tag, safe=''))
        if release is not None:
            if tag is None or release.get('tag_name') != self.tag or release.get('name') != 'Garmin Trainer ' + self.record['version'] or release.get('body') != self.body or release.get('prerelease') != self.prerelease:
                raise ValueError('Remote release identity/body/channel conflict')
            # Explicitly enumerate all assets, bounded pages; never accept a truncated set.
            listing = self.gh.api(self.prefix + '/releases/' + str(release['id']) + '/assets?per_page=100')
            if not isinstance(listing, list) or len(listing) >= 100:
                raise ValueError('Remote asset set unavailable or unbounded')
            names = [asset['name'] for asset in listing]
            if len(set(names)) != len(names) or set(names) - self.assets.keys():
                raise ValueError('Unexpected/duplicate remote assets; never clobber/delete')
            for asset in listing:
                expected = self.assets[asset['name']]
                if asset.get('size') != expected['size'] or asset.get('state') != 'uploaded':
                    raise ValueError('Remote asset incomplete/conflicting; reconcile without replacement')
                observed = asset.get('digest')
                if observed is None:
                    observed = 'sha256:' + self.gh.download_hash(self.prefix + '/releases/assets/' + str(asset['id']), expected['size'])
                if observed != 'sha256:' + expected['sha256']:
                    raise ValueError('Remote asset digest differs')
            release = {**release, 'assets': listing}
        return tag, release

    def act(self, action, *, execute=False):
        if action not in ('status', 'draft', 'publish'):
            raise ValueError('Unknown remote operation')
        tag, release = self.observe()
        if action == 'status' or not execute:
            return {'executed': False, 'tagPresent': tag is not None, 'release': release,
                    'next': 'Explicit separately authorized ' + action + ' --execute only; observation grants no consent'}
        if release and not release['draft']:
            if set(asset['name'] for asset in release['assets']) != set(self.assets):
                raise ValueError('Published release asset set incomplete')
            return {'executed': False, 'alreadyPublished': True, 'releaseId': release['id']}
        if action == 'draft':
            if tag is None:
                self.mutate(self.prefix + '/git/refs', 'POST', {'ref': 'refs/tags/' + self.tag,
                                                              'sha': self.record['commit']})
                tag, release = self.observe()
                if tag is None:
                    raise ValueError('Tag creation not observed; reconcile before another action')
            if release is None:
                self.mutate(self.prefix + '/releases', 'POST', {
                    'tag_name': self.tag, 'target_commitish': self.record['commit'],
                    'name': 'Garmin Trainer ' + self.record['version'], 'body': self.body,
                    'draft': True, 'prerelease': self.prerelease, 'make_latest': 'false'})
                _, release = self.observe()
                if release is None or not release['draft']:
                    raise ValueError('Draft creation not observed; no retry')
            present = {asset['name'] for asset in release['assets']}
            for name, asset in self.assets.items():
                if name in present:
                    continue
                # Revalidate every selected byte immediately before the effect.
                if digest(asset['path']) != asset['sha256']:
                    raise ValueError('Local upload asset changed')
                self.mutate('https://uploads.github.com/' + self.prefix + '/releases/' + str(release['id']) + '/assets?name=' + quote(name, safe=''),
                            'POST', asset=asset['path'])
                self.observe()  # Exact ID/set/digest check after each effect, no clobber/rebuild.
            _, release = self.observe()
            if len(release['assets']) != len(self.assets):
                raise ValueError('Draft upload incomplete')
            return {'executed': True, 'draft': True, 'releaseId': release['id']}
        if tag is None or release is None or set(asset['name'] for asset in release['assets']) != set(self.assets):
            raise ValueError('Separate publication requires a complete verified existing draft')
        for asset in self.assets.values():
            if digest(asset['path']) != asset['sha256']:
                raise ValueError('Local artifact changed before publication')
        self.mutate(self.prefix + '/releases/' + str(release['id']), 'PATCH',
                    {'draft': False, 'prerelease': self.prerelease, 'make_latest': 'true' if self.latest else 'false'})
        _, observed = self.observe()
        if observed is None or observed['draft']:
            raise ValueError('Publication outcome not observed; reconcile only, no retry')
        if self.latest:
            latest = self.gh.api(self.prefix + '/releases/latest')
            if latest is None or latest['id'] != observed['id']:
                raise ValueError('Publication/latest observation disagrees; do not republish')
        return {'executed': True, 'published': True, 'releaseId': observed['id']}
