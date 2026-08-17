# Unofficial Garmin connector risk

This prototype uses `Taxuspt/garmin_mcp` pinned to commit `3610be6feed93088d85b0f35aba9d7d07c2505a7` because public Garmin Developer Program pages do not expose sufficient Activity/Health endpoint detail for this private MVP.

Accepted risks: undocumented endpoint breakage, token expiry, rate limiting, account challenges, and future migration work. Mitigations are stdio-only local execution, a read-operation allowlist, no password collection in the app, conservative retries, checkpointed sync, and explicit user-visible failure states.
