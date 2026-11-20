# Garmin access risk

Garmin data is read only through Garmin's official **Personal API** (`https://personal.connectapi.garmin.com`, fixed origin, no redirects or override) with a key each user creates for their own account. Garmin documents it for individual users, not commercial applications serving multiple end users; this app is a local single-user tool and the operator-confirmed terms boundary is recorded in [redistribution](redistribution.md).

Accepted risks: the Personal API is new and may change; a key may expire or be revoked at Garmin's discretion; rate limits are not fully documented; other devices, manual or third-party uploads, multisport, power-meter and swim activities are covered by authored tests, not verified real-world data. Mitigations: read-only requests only, a closed endpoint and failure vocabulary, bounded response sizes, memory-only bearer tokens, no key in trainer/model/SQL/HTTP/debug/raw-archive context, private native key storage, serial request pacing with cancellation and finite budgets, coverage-based day finality that never claims a verified watch upload, checkpointed sync, and explicit user-visible failure states that separate rejected keys from network, service and rate-limit failures.

Older normalized rows imported by the retired unofficial connector (`garmin_mcp` source labels) stay readable history; they are not relabelled or re-imported.
