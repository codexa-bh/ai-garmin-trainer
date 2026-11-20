# Redistribution material and release conditions

Binary publication is separate from source delivery, local packaging and isolated testing. The owner has authorized unsigned public distribution of the first-party code/assets and the limited library-related permissions below. **No general project/source license has been selected.** This authorization does not replace upstream conditions, current security review or exact-source/artifact release approval. Notices, package metadata and checksums are not legal certification.

## Limited first-party permissions

To the extent permission in first-party material is needed to exercise the rights of recipients of covered third-party libraries, the owner permits modification of those library portions, reverse engineering for debugging such modifications, and rebuilding/recombining/relinking the application with interface-compatible modified libraries. These permissions are limited to that purpose; they do not select a general license for unrelated first-party code/assets or restrict any rights independently granted by upstream licenses. No warranty or support for modified builds is promised.

Do not change signing, trust or OS security policy to run a modified build. The ordinary build's provenance/inventory checks intentionally reject altered stamped resources. Reassemble and rebuild a new ordinary app from matching source with the intended modified library; never relabel an old stamp or claim that modified bytes are the original verified release.

## Material accompanying the actual app

Under `Garmin Trainer.app/Contents/Resources/resources/` (Windows x64: `resources\` beside the installed `garmin-trainer-desktop.exe`, carried inside the NSIS installer):

- `NODE-LICENSE.txt` is the **actual complete LICENSE from the checksum-pinned official Node archive for that platform** (`darwin-arm64` or `win-x64`), including its embedded third-party notices. Node is not represented solely by its MIT package metadata.
- `THIRD-PARTY-NOTICES.txt` is a navigation/lock-metadata index, intentionally a conservative superset rather than a certification of every object.
- `redistribution/NOTICES.txt` contains actual copyright/LICENSE/NOTICE/attribution texts collected from installed production npm packages (including Next's compiled components), checksum-verified vendored native crate sources, and the separately reviewed upstream source inputs. Source-archive notices can cover unbuilt portions; each original per-file license remains controlling.
- `redistribution/index.json` records exact npm/Cargo lock digests, installed production package identities/source URLs/integrities, native package licenses/checksums/source URLs, and names/sizes/SHA-256 for the reviewed extra sources. It contains no build-machine paths or environment values.
- `redistribution/sources/` accompanies the binary with the reviewed source archives, patches, standard license texts and `native-crates.tar.gz`. The native archive contains the selected-platform Cargo source closure, including build dependencies, verified against Cargo.lock and per-file vendor checksums. Original source licenses remain intact; archive ownership/timestamps contain no build-machine identity.
- `REDISTRIBUTION-REVIEW.txt` is this document. All these resources, including notices and sources, enter the actual resource inventory and final DMG identity. Missing required corpus files refuse release verification.

The production Next package is retained for the custom server, minus content its production server never loads (source maps, type declarations, development runtimes, docs, bundle analyzer). Next's compiled `next/og` renderer (`@vercel/og` with Satori, resvg/Yoga and the Geist font) and Next's optional `sharp` image optimizer are **excluded from the app**: the trainer does not call `next/og`/`ImageResponse` and images are unoptimized. Their source/notice groups are therefore no longer shipped; the assembler and release verifier fail if any excluded group reappears in the runtime.

Activity images are rasterized by `@resvg/resvg-wasm` 2.6.2 (MPL-2.0) using macOS system fonts; no font is bundled. The original npm archive accompanies the app and its shipped `index_bg.wasm` is verified byte-for-byte against it. The corresponding source accompanies it too: `resvg-js` 2.6.2 (tag commit `9ca05846`), the resvg fork revision `3495d870` and `woff2-rs` revision `88cce4c` that it patches in, and the 103 crates.io archives of its wasm32 Rust dependency closure (checksums verified against the crates.io index). The npm archive's Wasm build is upstream's; this is a source basis, **not a claim of an independently reproduced binary**.

### Required additional attributions

- `pathfinder_content` 0.5.0 (Patrick Walton, servo/pathfinder) declares `MIT/Apache-2.0` but its crate omits a license file; its unmodified archive and the standard MIT and Apache-2.0 texts accompany the corpus. Do not invent copyright dates or claim the file was supplied upstream.
- Unmodified SQLite's public-domain statements remain in its upstream source; better-sqlite3 retains its own MIT license.

## Activity image renderer source and rebuilding

The MPL-2.0 resvg/usvg/resvg-js sources above are supplied unmodified. To use a modified renderer, rebuild the Wasm module from the supplied `resvg-js` source with its documented wasm-pack/`wasm32-unknown-unknown` route and the supplied crate closure, replace `node_modules/@resvg/resvg-wasm/index_bg.wasm` in a fresh locked `npm ci` checkout, update the reviewed archive pin accordingly and build a new ordinary app. Upstream build recipes may install development tools; inspect them before deliberately running them, never as an automatic app action.

Apply intended library changes through the source assembly/build route and build a new ordinary app, then verify its new inventory and behavior. Its source/artifact identity will differ from released bytes. Preserve upstream rights/notices and the limited permissions above; no private data, installed app replacement, certificate acquisition or trust bypass is implied. Third-party source access directions must remain available alongside any distribution; accompanying source archives reduce reliance on mutable external links. The distributor remains responsible for applicable source-availability obligations, not a future recipient or a checksum service.

Releases up to and including 0.1.2 shipped sharp/libvips and `next/og`; their published corpus and conditions are unchanged and remain described by those releases' own `REDISTRIBUTION-REVIEW.txt`.

## Helpers, external tools and publication gates

The bundled ChatGPT OAuth helper is a first-party source covered by owner authority. No Python helper, Python/uv installation or Garmin connector is bundled or required; optional Ollama is not bundled. There is no Garmin endorsement.

Garmin access uses Garmin's official Personal API with a key each user creates for their own account. Activity files are decoded with `fit-file-parser` 6.2.10 (MIT; its dependencies `buffer` (MIT), `base64-js` (MIT) and `ieee754` (BSD-3-Clause)), a production npm dependency compiled into the server bundle whose notices enter the corpus through the normal production-package collection. Garmin's own `@garmin/fitsdk` is **not used**: its FIT Protocol License Agreement is an internal-business-purpose licence that forbids making the technology available to third parties, so it was not accepted for a public source/app. The Personal API's terms are shown when a user creates a key behind Garmin login; the operator confirmed they permit this public source app in which each user supplies their own key ([T0350 decision](https://github.com/codexa-bh/ai-garmin-trainer/pull/232)). That confirmation is not a legal certification. Garmin's public FAQ describes the API as for individual users, "not intended for commercial applications serving multiple end users": hosted, shared-key or commercial multi-user use is unsupported. A binary release that includes the reader remains a separate release decision (see [release](release.md)).

Apple frameworks/system tools are platform prerequisites, not copied installations. No certificate, key, trust profile or external operator configuration is redistributed.

Before publication, review the **actual final inventory** against this source/notice corpus, current dependency findings/exposure, any missing or ambiguous upstream conditions, and the exact final source/notes/assets. Obtain genuine residual-security disposition and exact artifact approval. Missing authority or unsatisfied upstream conditions still block publication; owner approval cannot waive them. No package-metadata-only scan, local pass, source merge or predecessor completion supplies release approval. See the [release runbook](release.md).
