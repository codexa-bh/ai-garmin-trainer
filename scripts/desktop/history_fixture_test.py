import json
from pathlib import Path
import tempfile
import unittest
import urllib.error
import urllib.request
from history_fixture import (
    CALL_LIMIT,
    ENDPOINTS,
    SYNTHETIC_KEY,
    TOKEN_PATH,
    Fixture,
    activity_ids,
    fit_file,
    summary_row,
    zipped,
)


class AuthoredPersonalApiFixture(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name).resolve()
        self.root.chmod(0o700)
        self.capability = 'a' * 64
        self.fixture = Fixture(self.root, self.capability).start()
        self.origin = f'http://127.0.0.1:{self.fixture.port}'

    def tearDown(self):
        self.fixture.stop()
        self.temporary.cleanup()

    def request(self, method, path, headers=None, capability=None):
        request = urllib.request.Request(
            self.origin + path,
            method=method,
            data=b'' if method == 'POST' else None,
            headers={
                'x-trainer-fixture': self.capability if capability is None else capability,
                **(headers or {}),
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=5) as response:
                return response.status, response.read()
        except urllib.error.HTTPError as error:
            return error.code, error.read()

    def token(self):
        status, body = self.request(
            'POST', TOKEN_PATH, {'Authorization': 'ApiKey ' + SYNTHETIC_KEY}
        )
        self.assertEqual(status, 200)
        return body.decode()

    def test_requires_owned_root_and_closed_capability(self):
        for capability in ('', 'A' * 64, 'a' * 63):
            with self.assertRaises(ValueError):
                Fixture(self.root, capability)
        loose = self.root / 'loose'
        loose.mkdir(mode=0o755)
        with self.assertRaises(ValueError):
            Fixture(loose, self.capability)
        status, _ = self.request(
            'GET', '/userprofile-service/userprofile/settings', capability='b' * 64
        )
        self.assertEqual(status, 403)
        self.assertEqual(self.fixture.counts(), {})

    def test_token_exchange_accepts_only_the_authored_key_and_bearer_reads(self):
        status, _ = self.request('POST', TOKEN_PATH, {'Authorization': 'ApiKey other-key'})
        self.assertEqual(status, 401)
        bearer = self.token()
        self.assertRegex(bearer, r'^[A-Za-z0-9._~+/=-]{16,}$')
        status, _ = self.request('GET', '/userprofile-service/userprofile/settings')
        self.assertEqual(status, 401)
        status, body = self.request(
            'GET',
            '/userprofile-service/userprofile/settings',
            {'Authorization': 'Bearer ' + bearer},
        )
        self.assertEqual(status, 200)
        self.assertIn('availableTrainingDays', json.loads(body))
        counts = self.fixture.counts()
        self.assertTrue(set(counts) <= ENDPOINTS)
        self.assertEqual(counts['profile-settings'], 1)

    def test_closed_presets_and_unknown_paths(self):
        bearer = {'Authorization': 'Bearer ' + self.token()}
        with self.assertRaises(ValueError):
            self.fixture.set_preset('arbitrary')
        self.fixture.set_preset('rejected-key')
        status, _ = self.request('POST', TOKEN_PATH, {'Authorization': 'ApiKey ' + SYNTHETIC_KEY})
        self.assertEqual(status, 401)
        self.fixture.set_preset('rate-limited')
        status, _ = self.request('GET', '/usersummary-service/v2/dailysummaries', bearer)
        self.assertEqual(status, 429)
        self.fixture.set_preset('known')
        status, _ = self.request('GET', '/unknown-service/anything', bearer)
        self.assertEqual(status, 400)

    def test_daily_coverage_is_whole_days_except_today_and_bounded_ranges(self):
        from datetime import datetime, timedelta, timezone

        today = datetime.now(timezone.utc).date()
        yesterday = summary_row((today - timedelta(days=1)).isoformat(), 'known')
        self.assertEqual(yesterday['wellnessChronology']['totalDurationInMillis'], 86400000)
        current = summary_row(today.isoformat(), 'known')
        self.assertLess(current['wellnessChronology']['totalDurationInMillis'], 86400000)
        before = summary_row((today - timedelta(days=200)).isoformat(), 'known')
        self.assertFalse(before['includesWellnessData'])
        bearer = {'Authorization': 'Bearer ' + self.token()}
        status, _ = self.request(
            'GET',
            '/usersummary-service/v2/dailysummaries?startDate=2020-01-01&endDate=2026-01-01',
            bearer,
        )
        self.assertEqual(status, 400)

    def test_activity_files_are_authored_zip_fit_with_session_zones(self):
        archive = zipped(fit_file(1))
        self.assertEqual(archive[:4], b'PK\x03\x04')
        self.assertIn(b'.FIT', fit_file(1)[:16])
        ids = [garmin_id for garmin_id, _day, _sport in activity_ids('known')]
        self.assertEqual(len(ids), 3)
        self.assertEqual(len(activity_ids('new-activity')), 4)
        bearer = {'Authorization': 'Bearer ' + self.token()}
        status, body = self.request('GET', f'/download-service/files/activity/{ids[0]}', bearer)
        self.assertEqual((status, body[:4]), (200, b'PK\x03\x04'))
        status, _ = self.request('GET', '/download-service/files/activity/999', bearer)
        self.assertEqual(status, 404)

    def test_request_budget_is_finite(self):
        self.fixture.total = CALL_LIMIT
        status, _ = self.request('POST', TOKEN_PATH, {'Authorization': 'ApiKey ' + SYNTHETIC_KEY})
        self.assertEqual(status, 503)


if __name__ == '__main__':
    unittest.main()
