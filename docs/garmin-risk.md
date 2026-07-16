# Unofficial Garmin connector risk

This prototype uses `Taxuspt/garmin_mcp` pinned to commit `2974244bfda1595b00836b3f942f579ec2d6f7d6` because public Garmin Developer Program pages do not expose sufficient Activity/Health endpoint detail for this private MVP.

Accepted risks: undocumented endpoint breakage, token expiry, rate limiting, account challenges, and future migration work. Mitigations are stdio-only local execution, a read-operation allowlist, no password collection in the app, conservative retries, checkpointed sync, and explicit user-visible failure states.
