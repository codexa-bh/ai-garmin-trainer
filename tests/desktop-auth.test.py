"""Deterministic private adapter tests, invoked by desktop-settings Vitest."""
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("desktop_auth", "scripts/desktop/garmin_auth.py")
auth = importlib.util.module_from_spec(spec)
spec.loader.exec_module(auth)


class Vendor:
    needs_mfa = False
    verification = True
    unsupported = False
    calls = []

    def __init__(self, **kwargs):
        self.credentials = bool(kwargs.get("email"))
        self.client = self
        if self.credentials:
            assert kwargs["email"] == "private@example.invalid"
            assert kwargs["password"] == "sentinel-password"
            assert kwargs["return_on_mfa"] is True
            assert kwargs["is_cn"] is False

    def login(self, store=None):
        self.calls.append("credential-login" if self.credentials else "token-verification")
        if self.credentials and self.unsupported:
            return "unknown-challenge", {}
        if self.credentials and self.needs_mfa:
            return "needs_mfa", {"private-state": "never-output"}
        if not self.credentials:
            assert (Path(store) / "garmin_tokens.json").exists()
        return None, None

    def resume_login(self, state, code):
        assert state == {"private-state": "never-output"}
        assert code == "sentinel-mfa"
        self.calls.append("mfa")
        return None, None

    def dump(self, path):
        (Path(path) / "garmin_tokens.json").write_text('{"test":"sentinel-token"}')

    def get_full_name(self):
        return "private-profile" if self.verification else ""


class AuthTests(unittest.TestCase):
    def setUp(self):
        Vendor.calls = []
        Vendor.needs_mfa = Vendor.unsupported = False
        Vendor.verification = True

    def run_auth(self, root, events):
        first = {"email": "private@example.invalid", "password": "sentinel-password"}
        auth.authenticate(Vendor, first, lambda: "sentinel-mfa", events.append, Path(root))
        self.assertEqual(first, {})

    def test_success_verifies_before_allowing_native_publication(self):
        with tempfile.TemporaryDirectory() as root:
            events = []
            self.run_auth(root, events)
            self.assertEqual(events, ["verifying", "verified"])
            self.assertEqual(Vendor.calls, ["credential-login", "token-verification"])
            for name in ["garmin_tokens.json", "garmin_tokens.base64"]:
                self.assertEqual((Path(root) / name).stat().st_mode & 0o777, 0o600)
            self.assertNotIn("sentinel", json.dumps(events))
            self.assertNotIn("private-profile", json.dumps(events))

    def test_mfa_uses_reviewed_resume_api(self):
        Vendor.needs_mfa = True
        with tempfile.TemporaryDirectory() as root:
            events = []
            self.run_auth(root, events)
            self.assertEqual(Vendor.calls, ["credential-login", "mfa", "token-verification"])
            self.assertEqual(events[-1], "verified")

    def test_failed_verification_never_emits_verified(self):
        Vendor.verification = False
        with tempfile.TemporaryDirectory() as root:
            events = []
            with self.assertRaises(PermissionError):
                self.run_auth(root, events)
            self.assertEqual(events, ["verifying"])
            self.assertFalse((Path(root) / "garmin_tokens.base64").exists())

    def test_unsupported_challenge_fails_without_token_dump(self):
        Vendor.unsupported = True
        with tempfile.TemporaryDirectory() as root:
            with self.assertRaises(NotImplementedError):
                self.run_auth(root, [])
            self.assertEqual(list(Path(root).iterdir()), [])

    def test_bounded_protocol_and_failure_mapping_never_stringify_vendor_errors(self):
        class SecretError(Exception):
            def __str__(self):
                raise AssertionError("Never stringify a vendor error")
        error = SecretError()
        self.assertEqual(auth.failure_code(error, False), "auth-unavailable")
        for name, expected in [("GarminConnectAuthenticationError", "credentials-rejected"), ("GarminConnectTooManyRequestsError", "rate-limited"), ("GarminConnectConnectionError", "network-service")]:
            self.assertEqual(auth.failure_code(type(name, (SecretError,), {})(), False), expected)
        self.assertEqual(auth.failure_code(PermissionError(), True), "mfa-rejected")
        self.assertEqual(auth.failure_code(NotImplementedError(), False), "unsupported-challenge")
        stream = io.TextIOWrapper(io.BytesIO(b'{"code":"sentinel-mfa"}\n'))
        self.assertEqual(auth.receive(stream), {"code": "sentinel-mfa"})
        for data in [b"{}", b"[]\n", b"x" * (auth.LIMIT + 1) + b"\n"]:
            with self.assertRaises((ValueError, json.JSONDecodeError)):
                auth.receive(io.TextIOWrapper(io.BytesIO(data)))


if __name__ == "__main__":
    os.umask(0o077)
    unittest.main()
