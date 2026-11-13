# Redistribution material and release conditions

Binary publication is separate from source delivery, local packaging and isolated testing. The owner has authorized unsigned public distribution of the first-party code/assets and the limited library-related permissions below. **No general project/source license has been selected.** This authorization does not replace upstream conditions, current security review or exact-source/artifact release approval. Notices, package metadata and checksums are not legal certification.

## Limited first-party permissions

To the extent permission in first-party material is needed to exercise the rights of recipients of covered third-party libraries, the owner permits modification of those library portions, reverse engineering for debugging such modifications, and rebuilding/recombining/relinking the application with interface-compatible modified libraries. These permissions are limited to that purpose; they do not select a general license for unrelated first-party code/assets or restrict any rights independently granted by upstream licenses. No warranty or support for modified builds is promised.

Do not change signing, trust or OS security policy to run a modified build. The ordinary build's provenance/inventory checks intentionally reject altered stamped resources. Reassemble and rebuild a new ordinary app from matching source with the intended modified library; never relabel an old stamp or claim that modified bytes are the original verified release.

## Material accompanying the actual app

Under `Garmin Trainer.app/Contents/Resources/resources/`:

- `NODE-LICENSE.txt` is the **actual complete LICENSE from the checksum-pinned official Node archive**, including its embedded third-party notices. Node is not represented solely by its MIT package metadata.
- `THIRD-PARTY-NOTICES.txt` is a navigation/lock-metadata index, intentionally a conservative superset rather than a certification of every object.
- `redistribution/NOTICES.txt` contains actual copyright/LICENSE/NOTICE/attribution texts collected from installed production npm packages (including Next's compiled components), checksum-verified vendored native crate sources, and the separately reviewed upstream source inputs. Source-archive notices can cover unbuilt portions; each original per-file license remains controlling.
- `redistribution/index.json` records exact npm/Cargo lock digests, installed production package identities/source URLs/integrities, native package licenses/checksums/source URLs, and names/sizes/SHA-256 for the reviewed extra sources. It contains no build-machine paths or environment values.
- `redistribution/sources/` accompanies the binary with the reviewed source archives, patches, standard license texts and `native-crates.tar.gz`. The native archive contains the selected-platform Cargo source closure, including build dependencies, verified against Cargo.lock and per-file vendor checksums. Original source licenses remain intact; archive ownership/timestamps contain no build-machine identity.
- `REDISTRIBUTION-REVIEW.txt` is this document. All these resources, including notices and sources, enter the actual resource inventory and final DMG identity. Missing required corpus files refuse release verification.

The full production Next package is retained for the custom server. Its compiled `@vercel/og` 1.0.1, Satori, resvg/Yoga and font material is therefore reviewed even though the trainer does not call `next/og` or `ImageResponse`. The upstream `vercel/og` repository URL returns 404; **do not infer clearance or lack of rights from that response**. The original npm archive accompanies the app and contains both JavaScript source maps with all 201 source bodies, including the original TypeScript wrapper. Next's own pinned `@vercel/og` patch also accompanies the archive. Its two JavaScript files are reconstructed from the original archive plus that patch in an isolated build directory and compared byte-for-byte to the installed compiled files; unchanged Wasm/font assets are compared directly. The installed/runtime files are never patched by this qualification. Original bundled npm dependency source/notice inputs, resvg-js/Yoga source, and the font license are also supplied.

### Required additional attributions

- The included **Geist** font identifies itself as Version 1.800, copyright 2024 The Geist Project Authors (`https://github.com/vercel/geist-font.git`), with authors Basement.studio, Vercel, Andrés Briganti, Guido Ferreyra and Mateo Zaragoza. It is licensed under the **SIL Open Font License 1.1**; the complete text accompanies the corpus. No font is relicensed as first-party code.
- `css-box-shadow` 1.0.0-3 credits **Brent Jackson** and explicitly declares MIT in its package and README. `twrnc` 3.4.0 credits **Jared Henderson** and declares MIT. Their inspected npm/repository distributions omit a separate license-text file. Preserve these attributions, their unmodified source archives/declarations and the accompanying standard MIT text; do not invent copyright dates or claim that the absent file was supplied upstream.
- FreeType is used under its FreeType License; its actual `FTL.TXT` is included. Portions of this software are copyright © the FreeType Project (`https://freetype.org`). All rights reserved.
- Sharp/libvips' source notices retain the component-specific LGPL, MPL, Apache, BSD, MIT, fontconfig, libpng, IJG, zlib and AOM patent terms. The full GPLv3/LGPLv3 text is included; LGPL components are not silently described as MIT. Unmodified SQLite's public-domain statements remain in its upstream source; better-sqlite3 retains its own MIT license.

## Sharp/libvips source and relinking

`sharp` 0.35.5 uses the ARM64 addon and `@img/sharp-libvips-darwin-arm64` 1.3.4 / libvips 8.18.7. The optional statically linked Wasm package 0.35.5 is also retained. Library replacement/relinking is not limited to the native shared-library path.

The corpus contains the declared native component source versions, the original sharp and sharp-libvips recipes, their fetched patches, glib's pinned gvdb source, and the version-matched wasm-vips/resvg sources. Consult each archive's original README, build scripts, Cargo.lock and license files; dependency source URLs/checksums in those locks identify the original registry source archives. The application/native crate source closure is additionally packaged as `native-crates.tar.gz`; each indexed `.crate` URL is the corresponding original registry archive.

For a source rebuild, obtain this application's exact released source commit and run its locked `npm ci`. Unpack the relevant upstream source archives into a **new development directory**, inspect the included upstream `sharp-libvips` `build.sh`, `build/posix.sh`, `versions.properties`, platform toolchain files and patches. They document the component builds and modifications, including the combined dylib. Use the supplied sharp source's build scripts and `src/binding.gyp` to rebuild/relink the addon against the intended modified library. For Wasm, use the supplied wasm-vips source/build recipe and sharp's Emscripten workflow, then rebuild the corresponding sharp Wasm module. Upstream build recipes may install development tools; inspect them before deliberately running them, never as an automatic app action.

The original upstream Wasm recipe fetched `HEAD`; the retained immutable source revision matches its recorded component versions at the observed upstream build. This is a reconstruction basis, **not a claim of independently reproduced upstream binaries/toolchain provenance**. Original package digests, actual source bodies, patches and these limits remain visible for owner review. No copied binary is relabeled as rebuilt or proven reproducible.

Apply intended library changes through the source assembly/build route and build a new ordinary app, then verify its new inventory and behavior. Its source/artifact identity will differ from the released bytes. Preserve upstream rights/notices and the limited permissions above; no private data, installed app replacement, certificate acquisition or trust bypass is implied. Third-party source access directions must remain available alongside any distribution; accompanying source archives reduce reliance on mutable external links. The distributor remains responsible for applicable source-availability obligations, not a future recipient or a checksum service.

## Helpers, external tools and publication gates

The actual bundled Python helpers and OAuth helper are first-party sources covered by owner authority. Python, uv, Ollama, the pinned `Taxuspt/garmin_mcp` connector and its Python dependencies are **not bundled tool installations**: explicit integration use acquires them separately. The selected connector's pinned MIT text has been inspected; external package/API/service terms and unofficial Garmin limitations remain applicable. There is no Garmin endorsement or official OAuth approval.

Apple frameworks/system tools are platform prerequisites, not copied installations. No certificate, key, trust profile or external operator configuration is redistributed.

Before publication, review the **actual final inventory** against this source/notice corpus, current dependency findings/exposure, any missing or ambiguous upstream conditions, and the exact final source/notes/assets. Obtain genuine residual-security disposition and exact artifact approval. Missing authority or unsatisfied upstream conditions still block publication; owner approval cannot waive them. No package-metadata-only scan, local pass, source merge or predecessor completion supplies release approval. See the [release runbook](release.md).
