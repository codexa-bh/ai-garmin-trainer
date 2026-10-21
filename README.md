# AI Garmin Connect Trainer

A private, local-first training companion: import your Garmin Connect history, explore activity and recovery trends, and chat with a coach grounded in your data.

- **Trainer chat** — streaming answers using normalized Garmin data, guarded read-only SQL/math tools, and conversation context.
- **Activity Dashboard** — searchable synced activities with summary stats, heart-rate, elevation, speed, and other available detail charts.
- **Health** — daily metrics plus weekly/monthly rollups for training and recovery context.
- **Personalization** — an editable Profile and General Plan, chat-confirmed weekly plans/reviews with original commitments and secondary history, and optional inspectable, editable, deletable semantic memory.
- **Provider choice** — direct DeepSeek/OpenAI, explicit loopback Ollama chat, or opt-in OpenRouter. Cloud providers receive bounded chat/Garmin context; local storage does not mean all AI processing stays on your machine.

**Local-only, single-user, no app sign-in.** Run on loopback only; do not expose it on your LAN, a public host, or a tunnel. Garmin access uses a pinned **unofficial** connector, not Garmin's official Developer Program APIs; undocumented endpoints may change or stop working. This private source repository is not a public release, deployment, or beta invitation.

[Installation](#installation) · [Runtime/restart guide](docs/local-runtime.md) · [Garmin authentication](docs/garmin-auth.md) · [Safety and privacy](#safety-and-privacy)

## Screenshots

Actual desktop views of the running local app with operator-authorized data. These are examples, not demo fixtures or guarantees of coaching accuracy. Click an image for full size.

### Trainer chat

![Trainer chat showing an existing snowboard activity analysis and a table of session totals](docs/screenshots/trainer-chat.png)

A bounded excerpt from an existing conversation, with a structured answer based on imported activity history. No new prompt was sent for this capture.

### Activity Dashboard

![Activity Dashboard showing a selected hike, summary stats, and heart-rate, elevation, and speed charts](docs/screenshots/activity-dashboard.png)

Search synced activities and inspect available normalized detail. This crop shows the summary and charts above the route-map section.

### Daily Health

![Daily Health showing sleep duration and stages, calories, resting heart rate, HRV, stress, steps, and intensity minutes](docs/screenshots/health-daily.png)

Browse imported daily health records; coverage and values depend on what Garmin provides. Today's values are not necessarily final.

### Monthly Health

![Monthly Health rollups showing sleep duration, sleep score, and deep-sleep averages from February through September](docs/screenshots/health-monthly.png)

Compare period averages with labeled charts and per-period values. Weekly rollups are available in the same view.

Captured on 18 September 2026 from the loopback development app at a 1440-pixel desktop width. Dashboard/Health images are cropped for focus; no displayed metrics were altered. Screenshots may lag later UI changes.

## Installation

This is an advanced-user source setup for **authorized readers of the private repository**. macOS Apple Silicon is the primary prepared platform; Ubuntu LTS still requires reproducibility evidence. Windows and other platforms are not claimed supported. These instructions are cross-checked against the repository scripts, not a certification of clean-machine installation.

### 1. Install prerequisites and clone

Install **Git, Node.js 22+ with npm, and Python 3.12-capable `uv`/`uvx`**. Native Node dependencies may require your platform's compiler/build tools. Install Ollama separately only if you choose local chat or local embeddings; bootstrap does not install system software.

Authenticate Git with an account authorized for this private repository, then:

```bash
git clone https://github.com/codexa-bh/ai-garmin-trainer.git
cd ai-garmin-trainer
npm ci
cp .env.example .env.local
```

For an existing checkout, keep your existing `.env.local` rather than overwriting it. Run all subsequent npm commands from the checkout directory. Install dependencies **before** running doctor, Garmin auth, or database commands.

### 2. Configure local storage and a chat provider

Edit ignored `.env.local` privately:

- Keep the app URL on localhost/loopback and choose `DATABASE_PATH` for local SQLite. Relative paths resolve from the running checkout; use a durable absolute path when sharing configuration across worktrees.
- Keep the example's pinned Garmin MCP command/args, including connector commit `3610be6feed93088d85b0f35aba9d7d07c2505a7` and exact `mcp==1.28.1`. Set one explicit `GARMIN_MCP_TOKEN_DIR`; the example uses the ignored `./.garmin-token` directory. It is a directory path, never token contents.
- Choose one chat-provider route below. Replace only the keys needed for your choice; placeholder example keys are treated as missing.

| Chat route                | Configuration                                                                                                                                                                                                    |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Automatic cloud selection | Keep `AI_PROVIDER=auto`; configure `DEEPSEEK_API_KEY` or `OPENAI_API_KEY`. Auto is DeepSeek-first and selects OpenAI when no valid DeepSeek key is configured, not a promise of runtime failover.                |
| Explicit direct provider  | Set `AI_PROVIDER=deepseek` or `AI_PROVIDER=openai` and its matching key; use `DEEPSEEK_MODEL` or `AI_MODEL` as appropriate.                                                                                      |
| Local Ollama              | Start your separately installed loopback Ollama daemon, run `ollama pull qwen3.5:4b`, set `AI_PROVIDER=ollama`, and keep `OLLAMA_BASE_URL=http://127.0.0.1:11434/v1`. Bootstrap does not prepare the chat model. |
| Opt-in OpenRouter         | Set `AI_PROVIDER=openrouter` and `OPENROUTER_API_KEY`; review [model availability, privacy, and tool-reliability limitations](docs/local-runtime.md#opt-in-openrouter-chat) first. Auto ignores OpenRouter keys. |

No Google OAuth client, app password, or email allowlist is required. Do not commit `.env.local`, provider keys, SQLite files, backups, or Garmin token directories. Keep secret files owner-private.

### 3. Check configuration and authenticate Garmin

```bash
npm run doctor
```

Doctor reports configuration/readiness without printing secret values. On a first setup, missing database/schema or Garmin auth state can be expected; address other configuration failures, complete auth and bootstrap below, and then recheck. Doctor's token-file check proves presence only, not token validity or expiry.

Reuse existing Garmin credentials where possible. For new authentication, run this **yourself in a private interactive terminal**, only after setting `GARMIN_MCP_TOKEN_DIR`:

```bash
npm run garmin:auth
```

The command uses the pinned connector and refuses unattended invocation or existing-credential overwrite. The app never asks for your Garmin password. Do not paste auth output, passwords, MFA codes, or tokens into chat or issues. Read [Garmin setup/recovery](docs/garmin-auth.md) before migrating or replacing any existing store.

### 4. Bootstrap and open the app

```bash
npm run bootstrap:local
```

Bootstrap prepares locked dependencies when needed, checks SQLite status and migrates only when needed, prepares effective Ollama **memory embeddings** if configured, builds, runs doctor, and starts or reuses the verified loopback app.

Open **<http://127.0.0.1:3000>**. There is no app sign-in screen. Use the app's **Sync** view to import your Garmin history when you are ready; installing/starting the app alone does not populate a fresh database. Then browse Activities/Health or ask the trainer a question.

For subsequent source updates, run `npm run restart:local` to rebuild/restart. See the [runtime guide](docs/local-runtime.md#local-restart-modes) for development mode, alternate loopback ports, listener ownership, Ollama daemon lifecycle, and recovery. Restart does not install dependencies or migrate the database; use bootstrap when setup/schema preparation is needed.

Manual recovery order is `npm ci`, `npm run db:status -- --json`, `npm run db:migrate` **only when needed**, `npm run build`, then `npm run start:local`. See [source setup and data lifecycle](docs/source-beta-readiness.md) before backup, restore, reset, or uninstall.

### Optional: semantic memory and developer diagnostics

Leave `MEMORY_ENABLED=false` to run without semantic memory. For embedded SQLite semantic memory, follow [the memory guide](docs/memory.md): local embeddings use `MEMORY_EMBEDDING_PROVIDER=ollama` with `nomic-embed-text`; OpenAI-compatible embeddings use `OPENAI_API_KEY`, not a separate memory-only key, and may incur cost. No Qdrant/Docker/hosted vector account is required.

Ollama/OpenRouter chat does **not** select the memory extractor: guarded extraction uses configured DeepSeek/OpenAI when available, otherwise deterministic fallback. Review the memory guide before enabling it if you want processing to remain local.

Keep `LLM_DEBUG_TRACES=false` for normal use. Enable it only for private loopback development; traces visible in Settings may include private normalized Garmin/chat/tool context.

## Repository guide

Start with [architecture](docs/architecture.md), then read only the detailed docs relevant to your work:

- [Design choices and boundaries](docs/design-choices-and-boundaries.md) — component responsibilities, AI reasoning, guarded SQL/math, local storage, and import boundaries.
- [Coaching instructions and sources](docs/coaching-instructions-and-sources.md) — evidence, limitations, and instruction maintenance.
- [Memory](docs/memory.md) — Profile, semantic memory, extraction, embeddings, and deletion controls.
- [Validation](docs/validation.md) and [developer process](docs/developer-process.md) — local smoke, same-task data back-sync, and task-created data cleanup.
- [Source readiness and data lifecycle](docs/source-beta-readiness.md) — supported boundary, backup/restore, diagnostics, and dependency evidence.

Key code entry points are `src/app/trainer-dashboard.tsx`, `src/app/style.css`, `src/app/api/`, `src/lib/ai/`, `src/lib/garmin/`, and `src/lib/memory/`.

## Weekly plans and reviews

Training Plan opens to **This Week**, using your device's Monday–Sunday calendar. **Upcoming** exposes the following week (including plans prepared on Sunday); **General Plan** retains the existing independent manual editor. Saved general plans remain usable; more than 60 elapsed days since revision offers an optional review cue, not an expiry or automatic rewrite. **History** loads bounded summaries and individual past documents, not an entire archive.

Discuss a weekly plan in chat using the general template, current Garmin evidence and your feedback. A displayed **Weekly draft — not saved** is not a commitment until you explicitly confirm it. Confirmation saves the exact proposal; a review and next plan can be confirmed atomically together. Drafts expire after 24 hours and cannot be confirmed after an intervening assistant reply, replacement, deletion of the chat, timezone change or conflicting saved revision—request a fresh draft. Ambiguous assent should prompt clarification, not saving.

New weekly drafts include model-selected KPIs with targets, units, evidence and explained full-target points totalling **100**. Reviews compare actuals with the **Original commitment** rubric and name its revision; latest adaptations remain separate context. Useful, relevant extra work can exceed 100, with explained partial substitution credit, no double-counting and unmet specific goals still visible (cycling kilometres are not hiking kilometres). There is no fixed app-authored scoring formula or score widget.

The first confirmed plan stays available as **Original commitment**; current/upcoming revisions update only the latest copy. Legacy plans without a rubric get clearly provisional assumptions grounded in recorded commitments, not targets invented from results. No recorded plan means no completion score; missing evidence is unavailable, not zero. Partial-week progress retains the original denominator, as-of cutoff and explicit gaps, not an unsupported definitive total. The displayed latest-plan snapshot at review save is contextual metadata, not necessarily the scored original.

Historical plans are read-only. Sunday is not automatically a finished week. Late evidence or corrections require fresh evidence and a newly confirmed review through chat; existing documents are not automatically rescored or rewritten. Saved date ranges/calendar bases never silently shift with a device timezone change. No workouts, background reminders, automatic saves or Garmin write-back are introduced.

Weekly artifacts and the general template survive chat/Profile and Garmin deletion. Chat deletion invalidates pending proposal authority, not confirmed documents. Schema upgrade is additive; use the normal backed-up migration procedure below. Source delivery does not upgrade a running database automatically or authorize a restart.

## Daily-health freshness

Complete daily-health coverage does not mean final totals. Each sync refreshes today and yesterday on the existing UTC sync calendar. Within the inclusive 14-day trailing window, older complete dates refresh when any stats, sleep, or body-battery fetch evidence is missing or at least 24 hours old. Missing/partial trailing dates still retry every run; historical gap/repair and checkpoint backfill remain separate. This costs at most 42 trailing tool calls per sync, normally six for repeated complete data within 24 hours. Refreshes preserve prior non-null fields when Garmin omits them and accept valid zero/downward corrections. Delayed uploads outside the window may still require a targeted re-sync; source agreement does not prove finality.

## Validation

Run `npm run validate` for formatting, linting, type checking, tests, and production build. Additional evidence commands and live-smoke requirements are documented in [validation](docs/validation.md). A successful build is not proof of working Garmin authentication, remote-provider readiness, or clean-machine setup.

## Safety and privacy

- Source control stays in the private repository `https://github.com/codexa-bh/ai-garmin-trainer` for backup/collaboration only. This does not authorize public hosting, LAN exposure, deployment, release, or beta invitations.
- Local app access has no sign-in gate; loopback/private operation and local secret handling are required.
- Garmin access is local-only through stdio to a pinned unofficial connector; HTTP transport and connector write operations are not used.
- The selected cloud AI provider receives bounded chat/Garmin context. Review provider privacy/routing settings; local SQLite storage is not an assurance of fully local processing.
- The trainer sees app-normalized summaries and bounded current-turn SQL/math or detail-tool evidence; it never sees Garmin credentials, token/auth/cookie fields, connector config, environment values, filesystem paths, unrestricted raw payloads, or unrestricted stream dumps.
- The configured AI provider handles medical-domain responses without an additional app-authored response restriction; diagnosis and treatment content is still excluded from durable personalization memory.
- Profile, active chat transcript, Garmin facts, and semantic memory are separate. New chat resets short-term context. Memory stores bounded user-derived facts after completed persisted turns, may intentionally create no entry, and remains lower authority than current corrections, active transcript, Profile, and Garmin/tool evidence. It can be inspected, edited, deleted, cleared, or disabled.
- Clear chat/profile, clear semantic memory, and Garmin deletion are separate controls. See [data lifecycle](docs/source-beta-readiness.md#local-data-lifecycle) and [memory](docs/memory.md) before deleting data or resetting Garmin access.
