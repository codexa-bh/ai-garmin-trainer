# Redistribution material and release conditions

First-party code/docs/assets use [Apache-2.0](../LICENSE), copyright 2026 Ivan Mlinaric — individual developer, as declared in npm/Cargo. The package remains private/unpublished to registries. Commercial use is permitted without warranty/support; upstream terms and current release review still apply. Notices/metadata/checksums are not legal certification.

## First-party license

First-party material already published under MIT stays available under MIT ([text at v0.1.4](../../../blob/v0.1.4/LICENSE)): source revisions whose `LICENSE` is MIT, and earlier releases including 0.1.1–0.1.4. Tags 0.1.1–0.1.3 carry no license file; earlier tags/assets/notes/embedded notices are not rewritten. Each release's third-party conditions remain in its own `REDISTRIBUTION-REVIEW.txt`. Apache-2.0 permits modification/debugging/rebuilding/relinking; no extra first-party permission is needed to exercise library rights.

### What the first-party license does not cover

- Dependencies retain upstream licenses, notices and source obligations, including MPL-2.0.
- OpenAI owns its names/logo (`src-tauri/ui/chatgpt-logo-white.svg`, used only on Continue with ChatGPT) and determines sign-in eligibility/plan use. [Access contract](chatgpt.md).
- Garmin owns its trademarks; no Garmin code/SDK or endorsement is included. Personal API keys remain subject to its terms below.
- Runtime OpenTopoMap tiles are not bundled. Preserve map attribution: © OpenStreetMap contributors; style © OpenTopoMap, CC-BY-SA.
- Upstream portions of `src-tauri/windows/installer.nsi` retain Tauri's Apache-2.0 OR MIT terms; its header identifies first-party modifications.

Apache-2.0 grants no trademark rights.

### Source and binary distribution

Source declares dependencies in npm/Cargo manifests/locks but contains no dependency code, so repository `LICENSE` needs no separate third-party notice file. Built apps contain code and must carry the material below. This review covers named/directly bundled components, not a legal audit of every transitive dependency.

## Material accompanying the actual app

macOS `Contents/Resources/resources/`, or Windows `resources\` beside the executable inside NSIS, contains:

- `FIRST-PARTY-LICENSE.txt`: exact repository Apache-2.0 license.
- `NODE-LICENSE.txt`: complete actual LICENSE from the platform's checksum-pinned official Node archive, including embedded third-party notices—not just MIT metadata.
- `THIRD-PARTY-NOTICES.txt`: conservative navigation/lock-metadata index, not object-by-object certification.
- `redistribution/NOTICES.txt`: actual license/copyright/NOTICE/attribution texts from installed production npm (including Next compiled components), verified vendored crates and reviewed extra sources. Source archives may include unbuilt portions; per-file licenses govern.
- `redistribution/index.json`: exact lock digests, package identities/source URLs/integrities/licenses/checksums and extra-source names/sizes/hashes, without machine paths/env.
- `redistribution/sources/`: reviewed archives/patches/license texts plus `native-crates.tar.gz`, the selected-platform Cargo closure including build dependencies, verified against lock and per-file vendor checksums. Preserve source licenses; archive metadata contains no machine identity.
- `REDISTRIBUTION-REVIEW.txt`: this guide. All material enters resource/final-artifact identity; missing required files refuse verification.

The production Next custom server excludes unused maps/types/dev/docs/analyzer output, `next/og`/ImageResponse with its Satori/resvg/Yoga/Geist group, and optional sharp optimizer. Their sources/notices are not shipped; assembler/verifier reject reappearance. Images remain unoptimized.

Activity rasterization uses `@resvg/resvg-wasm` 2.6.2, MPL-2.0, and system fonts—not bundled/downloaded fonts. The original npm archive accompanies and byte-matches `index_bg.wasm`. Corresponding sources include resvg-js2.6.2 (` 9ca05846`), patched resvg fork ` 3495d870`, woff2-rs ` 88cce4c` and 103 wasm32 crate archives checked against crates.io. This is upstream binary plus source basis, not an independently reproduced Wasm claim.

### Required additional attributions

`pathfinder_content` 0.5.0 (Patrick Walton/servo) declares MIT/Apache-2.0 but omits a license file: include its unmodified archive and standard license texts, without invented copyright dates/upstream-file claims. Preserve SQLite public-domain statements and better-sqlite3 MIT.

## Activity image renderer source and rebuilding

MPL resvg/usvg/resvg-js sources are supplied unmodified. To modify, inspect the upstream development recipe, rebuild through supplied wasm-pack/`wasm32-unknown-unknown` sources/crate closure, replace `node_modules/@resvg/resvg-wasm/index_bg.wasm` in a fresh locked checkout, update the reviewed archive pin, then build/verify a new ordinary app. Development tools are never installed as an automatic app action.

Changed bytes require new source/inventory identity, never altered stamped resources or relabelled original-release claims. Preserve upstream rights/notices and source-access directions alongside distribution; accompanying archives reduce reliance on mutable links, but the distributor retains source-availability responsibility. No trust bypass, certificate acquisition, private-data or installed-app replacement authority follows. Historical sharp/libvips/next-og releases retain their own immutable corpus/conditions.

## Helpers, external tools and publication gates

ChatGPT OAuth helper is first-party Apache-2.0. No Python helper/uv/Garmin connector is bundled or required; Ollama and Apple frameworks/tools are external prerequisites, not redistributed installations/configuration.

Official Garmin/FIT uses `fit-file-parser` 6.2.10 (MIT), buffer/base64-js (MIT) and ieee754 (BSD-3-Clause), with notices collected from production npm. `@garmin/fitsdk` is not used: its internal-business-purpose license disallows making the technology available to third parties. The operator confirmed Personal API terms permit this public per-user-key app ([decision](../../../pull/232)); this is not legal certification. Garmin's FAQ excludes commercial multi-end-user applications, so hosted/shared-key/commercial multi-user use is unsupported.

Before binary publication, review actual final inventory/source/notes/assets, current dependency exposure and missing/ambiguous upstream conditions. Record genuine residual-security disposition under the [release authority/gates](release.md#release-cut-runbook); source merge/local passes/predecessor completion supply no release consent. Owner approval cannot waive upstream conditions or failed guards. No certificate/key/trust profile or operator configuration is redistributed.
