# AI Trainer for Garmin Connect

![Set your targets for the week. Your Garmin data keeps score. Your AI coach reviews it with you.](docs/screenshots/banner.png)

**A private AI coach for your Garmin data.** It runs on your Mac, keeps your history in a local database and uses the AI model you choose.

Windows: the app also builds for Windows, but it has no maintainer yet. If you can help maintain and test it, [reply on this issue](../../issues/279).

[Install on macOS](#installation) · [Releases](../../releases/latest) · [Privacy](#privacy) · [Status and limits](#status-and-limits)

_An independent open-source project, not affiliated with or endorsed by Garmin._

## Why it is different

I use Garmin for hiking and navigation, but wanted a training plan built around my own goals: climbing, longer outings, strength and consistency. So I built a separate coach that uses the data I already record.

- **You set the targets. Your data keeps score.** Agree a few goals for the week in chat, like 1,000 m of climbing or a two-and-a-half-hour outing. The app measures what it can from your Garmin data, and the week ends with lines like "Weekly ascent: 1,068 / 1,000 m → 20/20". Then the trainer goes through it with you and drafts the next week.
- **Any question, your whole history.** Ask which of your last three hikes was the hardest, or how you slept before a race. The trainer looks it up across everything you have recorded, in every sport, and does the math.
- **No mystery scores.** The app adds no readiness or recovery number of its own. The only score is the one you agreed, and when the trainer compares or ranks, it says what it counted and what was missing.
- **It never asks for your Garmin password.** You create a key in Garmin Connect and paste it in. The app uses Garmin's official Personal API and can only read.
- **Your history lives on your computer.** There is no account to create and no server behind the app. Only what a question needs is sent to the AI model you chose.
- **Use the AI you already pay for.** Sign in with your ChatGPT subscription, bring an OpenAI, DeepSeek or OpenRouter key, or run a local model with Ollama. The app never switches models on its own.

It is an independent app, not an interface to Garmin Coach or Garmin's suggested workouts: you build your own weekly plan with the AI. It works alongside Garmin Connect, not instead of it. Your watch still syncs to Garmin; this app reads a copy, uses that data as evidence for coaching and measurement, and never writes anything back.

### Things you can ask

- "Am I actually getting fitter? Compare my heart rate on similar hikes two years ago and now."
- "Compare my snowboard seasons. A season runs November to May."
- "Give me July and August side by side: steps, kilometres, ascent, calories and time in each heart-rate zone."
- "We're two-thirds through the month. Am I on track to beat last month's ascent?"
- "Yesterday's hike felt much harder than it should have. Look at the week before it and tell me why."
- "How does the terrain on today's hike line up with my heart-rate zones?"
- "Sync my data, score last week against our KPIs and set targets for the next one."

## What is inside

### Weekly plans and KPIs

![Trainer chat reviewing last week against its KPI targets and saving next week's plan](docs/screenshots/chat.png)

Plan each week with the trainer in chat. You agree a handful of KPIs, each with a target and the points it is worth. At the end of the week the trainer reviews it with you and drafts the next one. Say "draft only, do not save" when you want to discuss a plan without saving it.

![The current week's KPI targets, measured actuals and provisional points](docs/screenshots/weekly-plan.png)

The app measures the actual values from your Garmin data where it can and shows target, actual and points in one grid. A General Plan holds your longer-term direction.

![Weekly KPI achievement and hiking ascent compared with each week's target](docs/screenshots/weekly-progress.png)

Progress charts show each KPI against its weekly target over the last one to twelve months. You don't enter anything by hand: every time you sync, the app re-measures this week and last week from the new Garmin data and updates the points.

### Activities

![A hike with its route map, heart-rate, elevation and speed charts, and heart-rate zones](docs/screenshots/activity.png)

Search your activities and open any of them: heart rate, elevation and speed charts, time in heart-rate zones, laps, a route map and Garmin's training effect.

![A hike split into climbs, descents and rolling sections, each with distance, ascent, grade, duration, pace and average heart rate](docs/screenshots/terrain-sections.png)

Hikes and walks are split into climbs, descents and flatter sections, each with its distance, ascent, grade, pace and average heart rate. The sections are estimated from the elevation data. The trainer reads the same breakdown, so you can ask where on the route your heart rate climbed.

![A resort day listed run by run](docs/screenshots/snow-runs.png)

Resort skiing and snowboarding days are listed run by run, with lift totals.

### Health

![Seven days of calories, sleep, steps, resting heart rate and HRV side by side](docs/screenshots/health.png)

Compare seven days side by side, or switch to weekly and monthly averages: sleep and sleep stages, HRV, stress, Body Battery, resting heart rate, VO2 max, calories, steps and intensity minutes. Missing data is shown as missing, never as zero.

## Installation

You need:

- an Apple Silicon Mac (the build targets macOS 12 or later; that minimum is not tested certification);
- a Garmin Connect account with data from a Garmin device;
- one AI model provider from the [table below](#choose-a-model).

The latest macOS release is [AI Trainer for Garmin Connect 0.1.6](../../releases/tag/v0.1.6). It uses the same database format as 0.1.5 and 0.1.4; no migration is needed when upgrading from either version.

1. **Install.** Run this in Terminal:

   ```bash
   curl -fsSL https://raw.githubusercontent.com/eye1/ai-garmin-trainer/main/install.sh | bash
   ```

   [`install.sh`](install.sh) downloads the latest release, verifies its published checksum and copies the app to Applications. It needs no `sudo` and does not touch your data.

2. **Open the app** from Applications.
3. **Follow the first-run Settings.** Create a new database, then add a model provider. [Settings](docs/settings.md#first-run-and-settings) explains each step.
4. **Connect Garmin.** Create a Personal API key in Garmin Connect (Settings → Personal API key), paste it into Connect Garmin, finish, then quit and reopen the app. [Garmin connection](docs/garmin-auth.md) has the details.
5. **Import your data.** Open Sync and choose Sync latest, then Import older data for your history. A long history can take several runs.
6. **Ask.** Pick a model under the chat box and ask your first question.

![Garmin connection settings showing that a key is saved, without exposing it](docs/screenshots/connect-garmin.png)

You can also download the `.dmg` from [Releases](../../releases/latest) and copy the app to Applications yourself. The app is not signed or notarized, so macOS blocks the first launch of a copy downloaded in a browser. To allow it, try to open the app once, then open System Settings → Privacy & Security, scroll to Security, click **Open Anyway** next to the message about the app and confirm. If macOS reports the app as damaged instead, use the Terminal install.

### Choose a model

| Provider             | What you need                         | Good to know                                                                                            |
| -------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| ChatGPT subscription | A ChatGPT plan; sign in from Settings | Uses your plan's usage, with no API key. [ChatGPT access](docs/chatgpt.md)                              |
| OpenAI API           | An API key                            | Billed by OpenAI per use, separately from a ChatGPT plan                                                |
| DeepSeek             | An API key                            | Billed by DeepSeek per use                                                                              |
| OpenRouter           | An API key                            | Privacy and reliability depend on the model. [OpenRouter](docs/local-runtime.md#opt-in-openrouter-chat) |
| Ollama               | Ollama running on this Mac            | Chat requests stay on your Mac. You install and manage Ollama and its models yourself                   |

There is no default model and no automatic fallback. How well the trainer works depends on the model: it must call tools reliably, which small local models may not do.

### Upgrading

There is no auto-update. Quit the app, then run the install command again; it replaces the app and leaves your data alone. Retain a compatible prior app and verified database/settings backups. Versions up to 0.1.4 were named _Garmin Trainer_; installing the renamed app does not replace that app automatically. Both names use the same data and settings; do not run them together. See [installing a release](docs/release.md#installing-a-published-release--only-after-an-actual-authorized-release).

**A version that changes the database format needs a manual upgrade first.** The app never upgrades your database on its own, and today the upgrade runs from a source checkout of that version. Back up your database, then follow [database upgrades](docs/release.md#existing-database-upgrades-and-recovery). The release notes say when an upgrade is needed.

## Privacy

- **Stored on your Mac:** your Garmin data, chats, plans and profile, in a database file at a location you choose. The app has no account, telemetry or server of its own.
- **Sent to Garmin:** read-only requests to Garmin's Personal API with your key. The app never asks for your Garmin email, password or verification code.
- **Sent to the AI model:** your question plus bounded context: your profile, the conversation and the data the trainer looks up for it. With supported models, requested activity-panel images (including route maps) may also be sent. With a cloud provider this leaves your Mac. Chat titles and memory use a model you select separately, even when chat uses local Ollama. Your Garmin key, the database file and raw activity files are never sent.
- **Sent to OpenTopoMap:** opening an activity with a route loads map tiles, so the map server sees which area you are viewing.
- **Your API keys stay on your Mac** in a settings file that only your macOS user can open. Like many developer tools' config files, it is not encrypted, so it is as safe as your Mac account and your backups. [Key storage](docs/garmin-auth.md#storage-and-privacy)
- **Memory across chats is off by default.** When it is on, deleting a chat does not clear what the trainer already remembered; clear it in Memory. [Memory](docs/memory.md)
- **Local debug traces** can contain your chats and Garmin data. Do not share them.

Run the app only for yourself on your own Mac. It has no sign-in of its own, and other programs running as your macOS user can reach it, so do not expose it to a network or through a tunnel. Chats and profile, Garmin data, plans and memory are deleted separately; read [data lifecycle](docs/source-beta-readiness.md#local-data-lifecycle) before deleting anything.

## Status and limits

- **Early software.** Version 0.1.x, built by one developer.
- **Apple Silicon Macs only.** The experimental, unsupported Windows x64 alpha remains at [v0.1.4](../../releases/tag/v0.1.4), not Latest. See [Windows limits](docs/windows.md).
- **Unsigned.** The download is not signed or notarized.
- **Garmin's Personal API is new.** It may change, keys can expire or be revoked, and its rate limits are not fully documented. [Garmin access risk](docs/garmin-risk.md)
- **Personal use only.** Garmin offers the Personal API to individuals for their own data. Hosting this app for other people or sharing a key is not supported.
- **Read-only.** The app does not send workouts, plans or settings to Garmin or to your watch.
- **Not medical advice.** Answers come from an AI model and can be wrong, even when they cite your data. [How the trainer is instructed](docs/coaching-instructions-and-sources.md)

Found a bug? Open an [issue](../../issues). Never paste keys, debug traces or database files into an issue or a screenshot.

## Build from source

Install Git, Node 22 or later with npm, the Xcode Command Line Tools, Rust and Python 3.12 ([pinned versions](docs/validation.md#local-tool-setup)).

```bash
git clone https://github.com/eye1/ai-garmin-trainer.git
cd ai-garmin-trainer
npm ci
npm run desktop:build
open 'src-tauri/target/aarch64-apple-darwin/release/bundle/macos/AI Trainer for Garmin Connect.app'
```

The app is configured only in its Settings; `.env.example` documents variables for maintenance scripts, not for the app. [Desktop](docs/desktop.md) covers the build, private storage and recovery, and how to [use an existing database](docs/desktop.md#explicit-private-state-adoption).

`npm run validate` runs the quality checks, tests and build after the pinned tool setup. A passing build does not show that Garmin or a model provider works; [validation](docs/validation.md) explains what each check proves.

## Documentation

Read the guide that owns the area you are changing:

- [Architecture](docs/architecture.md), [design](docs/design-choices-and-boundaries.md), [component index](docs/component-responsibilities.md).
- [Settings](docs/settings.md), [desktop](docs/desktop.md), [runtime and models](docs/local-runtime.md), [ChatGPT](docs/chatgpt.md).
- [Sync and Health](docs/sync-and-health.md), [Garmin fields and backfill](docs/garmin-extra-data.md), [key handling](docs/garmin-auth.md).
- [Memory](docs/memory.md), [summary protocol](docs/cross-chat-summary.md), [conversation history](docs/conversation-history.md).
- [Training Plan](docs/training-plan.md), [KPIs](docs/weekly-kpis.md), [coaching and sources](docs/coaching-instructions-and-sources.md).
- [Validation](docs/validation.md), [developer duties](docs/developer-process.md), [smoke playbook](docs/dev-bridge.md), [smoke inputs](docs/smoke-inputs.md). Find smoke commands with `npm run smoke:help -- search <terms>`.
- [Release](docs/release.md), [release notes](release-notes/releases/), [note format](release-notes/README.md), [redistribution](docs/redistribution.md), [readiness and data lifecycle](docs/source-beta-readiness.md).

## License

Own code/assets: [Apache-2.0](LICENSE). Dependencies, names/logos/maps retain their terms; [license scope](docs/redistribution.md#first-party-license).

Garmin and Garmin Connect are trademarks of Garmin Ltd. or its subsidiaries. ChatGPT and OpenAI are trademarks of OpenAI. This project is not affiliated with, endorsed by or sponsored by either company.
