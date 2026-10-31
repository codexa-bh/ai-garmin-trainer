# /// script
# requires-python = ">=3.12"
# dependencies = ["garminconnect==0.3.2"]
# ///
"""First-party private desktop auth protocol; never invoke the upstream CLI.

Native owns timeout, cancellation, staging and final no-overwrite publication.
Only allowlisted states reach stdout. Credentials arrive on stdin, not argv/env.
"""
import base64
import contextlib
import json
import logging
import os
from pathlib import Path
import queue
import shutil
import sys
import threading

LIMIT = 32768


def receive(stream):
    line = stream.buffer.readline(LIMIT + 1)
    if len(line) > LIMIT or not line.endswith(b"\n"):
        raise ValueError("protocol")
    result = json.loads(line)
    if not isinstance(result, dict):
        raise ValueError("protocol")
    return result


def emit(stream, state, code=None):
    value = {"state": state}
    if code:
        value["code"] = code
    stream.write(json.dumps(value) + "\n")
    stream.flush()


def authenticate(factory, first, mfa, emit_state, staging):
    """Supplied library seam permits deterministic challenge/privacy tests."""
    if set(first) != {"email", "password"}:
        raise ValueError("protocol")
    if any(not isinstance(first[k], str) or not first[k] or len(first[k]) > 8192 for k in first):
        raise ValueError("protocol")
    client = factory(email=first.pop("email"), password=first.pop("password"),
                     prompt_mfa=mfa, return_on_mfa=True, is_cn=False)
    result = client.login()
    if not isinstance(result, tuple) or len(result) != 2:
        raise NotImplementedError("challenge")
    if result[0] == "needs_mfa":
        resumed = client.resume_login(result[1], mfa())
        if not isinstance(resumed, tuple) or resumed[0] not in (None, "", "success"):
            raise NotImplementedError("repeated challenge")
    elif result[0] not in (None, "", "success"):
        raise NotImplementedError("challenge")
    emit_state("verifying")
    client.client.dump(str(staging))
    del client
    token = staging / "garmin_tokens.json"
    if token.is_symlink() or not token.is_file() or not 0 < token.stat().st_size < 1024 * 1024:
        raise ValueError("tokens")
    # Pin-compatible independent token login loads the authenticated profile.
    # The profile is used only as a boolean proof, never emitted or persisted.
    verifier = factory(is_cn=False)
    verifier.login(str(staging))
    if not verifier.get_full_name():
        raise PermissionError("verification")
    del verifier
    for path in staging.iterdir():
        if path.is_symlink() or not path.is_file():
            raise ValueError("tokens")
        os.chmod(path, 0o600)
    companion = staging / "garmin_tokens.base64"
    with companion.open("xb") as output:
        output.write(base64.b64encode(token.read_bytes()))
    os.chmod(companion, 0o600)
    emit_state("verified")


def failure_code(error, in_mfa):
    # Type/status only, never stringify an exception (may contain credentials).
    name = type(error).__name__
    status = getattr(getattr(error, "response", None), "status_code", None)
    if name == "GarminConnectTooManyRequestsError" or status == 429:
        return "rate-limited"
    if name == "GarminConnectAuthenticationError" or status in (401, 403) or isinstance(error, PermissionError):
        return "mfa-rejected" if in_mfa else "credentials-rejected"
    if isinstance(error, NotImplementedError):
        return "unsupported-challenge"
    if name in ("GarminConnectConnectionError", "ConnectionError", "Timeout", "ConnectTimeout", "ReadTimeout", "HTTPError"):
        return "network-service"
    return "auth-unavailable"


def main():
    os.umask(0o077)
    logging.disable(logging.CRITICAL)
    protocol = os.fdopen(os.dup(sys.stdout.fileno()), "w")
    private_input = sys.stdin
    in_mfa = False
    # Redirect OS descriptors too, not just Python print/logging. Only this
    # duplicate protocol descriptor can reach the native status pipe.
    with open(os.devnull, "w") as sink, contextlib.redirect_stdout(sink), contextlib.redirect_stderr(sink):
        os.dup2(sink.fileno(), 1)
        os.dup2(sink.fileno(), 2)
        try:
            from garminconnect import Garmin
            staging = Path(sys.argv[1])
            if not staging.is_absolute() or staging.is_symlink() or not staging.is_dir():
                raise ValueError("staging")
            first = receive(private_input)
            responses = queue.Queue(maxsize=1)

            def parent_pipe():
                try:
                    while True:
                        value = receive(private_input)
                        responses.put_nowait(value)
                except Exception:
                    # EOF, malformed or duplicate input: fail closed even if the
                    # native host died during a blocked vendor network request.
                    shutil.rmtree(staging, ignore_errors=True)
                    os._exit(1)

            threading.Thread(target=parent_pipe, daemon=True).start()

            def mfa():
                nonlocal in_mfa
                if in_mfa:
                    raise NotImplementedError("repeated challenge")
                in_mfa = True
                emit(protocol, "needs-mfa")
                value = responses.get(timeout=180)
                if set(value) != {"code"} or not isinstance(value["code"], str) or not 1 <= len(value["code"]) <= 128:
                    raise ValueError("protocol")
                return value.pop("code")

            authenticate(Garmin, first, mfa, lambda state: emit(protocol, state), staging)
        except Exception as error:
            emit(protocol, "failed", failure_code(error, in_mfa))
            return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
