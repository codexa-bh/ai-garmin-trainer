---
task: T0369
pr: 253
category: Fixed
release_note_required: true
---

- A momentary ChatGPT connection interruption during the connection currentness check no longer marks a working ChatGPT account as disconnected; the check retries one transient failure within its original deadline and still requires current confirmation.
