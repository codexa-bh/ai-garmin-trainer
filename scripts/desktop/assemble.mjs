import { build } from "esbuild";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import {
  cp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const inputs = JSON.parse(
  await readFile(join(root, "scripts/desktop/runtime-inputs.json"), "utf8"),
);
// Native-host builds only: the finite target map selects exactly one target.
const targets = Object.entries(inputs.targets ?? {}).filter(
  ([, entry]) =>
    entry.host[0] === process.platform && entry.host[1] === process.arch,
);
if (inputs.version !== 2 || targets.length !== 1)
  throw new Error(
    "Desktop assembly supports only macOS ARM64 and Windows x64 hosts.",
  );
const [platformId, target] = targets[0];
const windows = platformId === "windows-x64";
const python = windows ? "python" : "python3";
// UTF-8 mode: Windows Python would otherwise decode text files as cp1252.
const pythonFlags = windows ? ["-X", "utf8"] : [];
const identity = JSON.parse(
  execFileSync(
    python,
    [
      ...pythonFlags,
      "-c",
      "import json; from pathlib import Path; import sys; sys.path.insert(0, 'scripts/desktop'); from ordinary_identity import source_snapshot, context_identity; r=Path.cwd(); s=source_snapshot(r); c=context_identity(r,s); print(json.dumps({**s, 'context':c['key'], 'components':c['components']}))",
    ],
    { cwd: root, encoding: "utf8" },
  ),
);
const resources = join(root, "src-tauri/resources");
const runtime = join(resources, "runtime");
const cache = join(root, "dist/desktop-inputs");
await mkdir(cache, { recursive: true });
const archive = join(cache, target.nodeArchive);
try {
  await readFile(archive);
} catch {
  const response = await fetch(`${inputs.nodeSource}${target.nodeArchive}`, {
    signal: AbortSignal.timeout(120000),
  });
  if (!response.ok) throw new Error("Pinned Node download failed.");
  await writeFile(archive, Buffer.from(await response.arrayBuffer()));
}
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
if (sha(await readFile(archive)) !== target.nodeSha256)
  throw new Error(
    "Pinned Node checksum mismatch; cached input retained for diagnosis.",
  );
// The OS archivers only, never a PATH lookup (Windows 10+ ships bsdtar).
execFileSync(
  windows
    ? join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe")
    : "/usr/bin/tar",
  [windows ? "-xf" : "-xzf", archive, "-C", cache],
);
// This is a fixed generated build directory, never task data/worktree cleanup.
await rm(resources, { recursive: true, force: true });
await mkdir(runtime, { recursive: true });
for (const path of [".next", "node_modules", "package.json"]) {
  await cp(join(root, ".next/standalone", path), join(runtime, path), {
    recursive: true,
    dereference: true,
  });
}
// Next's generated standalone trace targets its stock server.js, not the
// documented custom-server API. Include the pinned production Next package so
// app.prepare() cannot fall through to the developer checkout, minus content
// the production server never loads: source maps, type declarations,
// development-only runtimes, docs, the bundle analyzer and the unused
// next/og (ImageResponse) renderer. dist/esm stays: client manifests name it.
const unusedNext = (path) =>
  /\.(map|d\.ts)$|\.runtime\.dev\.js$/.test(path) ||
  /^dist\/(docs|bundle-analyzer|compiled\/@vercel\/og)(\/|$)/.test(path);
const nextSource = join(root, "node_modules/next");
await rm(join(runtime, "node_modules/next"), { recursive: true, force: true });
await cp(nextSource, join(runtime, "node_modules/next"), {
  recursive: true,
  dereference: true,
  filter: (path) =>
    !unusedNext(path.slice(nextSource.length + 1).replaceAll("\\", "/")),
});
// Next traces its optional sharp image optimizer; images are unoptimized in
// the desktop configuration and activity images use @resvg/resvg-wasm, so
// sharp and its native libvips must not ship (nor their source corpus).
for (const path of ["sharp", "@img"])
  await rm(join(runtime, "node_modules", path), {
    recursive: true,
    force: true,
  });
const present = async (path) =>
  (await stat(join(runtime, path)).catch(() => null)) !== null;
for (const path of [
  "node_modules/sharp",
  "node_modules/@img",
  "node_modules/next/dist/compiled/@vercel/og",
])
  if (await present(path))
    throw new Error(`Excluded runtime content still present: ${path}.`);
if (!(await present("node_modules/@resvg/resvg-wasm/index_bg.wasm")))
  throw new Error("Activity image rasterizer missing from runtime.");
await cp(join(root, ".next/static"), join(runtime, ".next/static"), {
  recursive: true,
});
try {
  await cp(join(root, "public"), join(runtime, "public"), { recursive: true });
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
// The only packaged helper script. Garmin access is in-process (official
// HTTPS reader and FIT decoder in runtime.cjs); no Python is ever packaged.
await mkdir(join(runtime, "scripts"));
await cp(
  join(root, "scripts/desktop/chatgpt-oauth.mjs"),
  join(runtime, "scripts/chatgpt-oauth.mjs"),
);
const node = join(resources, target.node);
await cp(join(cache, target.nodeRoot, target.nodeBinary), node);
await cp(
  join(cache, target.nodeRoot, "LICENSE"),
  join(resources, "NODE-LICENSE.txt"),
);
// The project's own Apache-2.0 license, unchanged; third-party terms stay separate.
await cp(join(root, "LICENSE"), join(resources, "FIRST-PARTY-LICENSE.txt"));
await build({
  entryPoints: [join(root, "scripts/desktop/runtime.ts")],
  outfile: join(runtime, "runtime.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  external: ["next", "better-sqlite3", "@next/env"],
});
// Prove bundled runtime/SQLite ABI before native packaging; system Node cannot
// mask a missing binary. No application DB is opened by this in-memory probe.
// Windows Node needs its system root even with an otherwise cleared environment.
const system = windows
  ? Object.fromEntries(
      ["SystemRoot", "SystemDrive", "windir", "TEMP", "TMP"].flatMap((key) =>
        process.env[key] ? [[key, process.env[key]]] : [],
      ),
    )
  : {};
execFileSync(
  node,
  [
    "-e",
    `if(process.arch!==${JSON.stringify(process.arch)}||process.platform!==${JSON.stringify(process.platform)})process.exit(1); const D=require('better-sqlite3');const d=new D(':memory:');d.prepare('select 1').get();d.close()`,
  ],
  { cwd: runtime, stdio: "pipe", env: { ...system, NODE_ENV: "production" } },
);
const startup = spawnSync(node, [join(runtime, "runtime.cjs")], {
  cwd: runtime,
  encoding: "utf8",
  env: {
    ...system,
    PATH: windows
      ? join(system.SystemRoot ?? "C:\\Windows", "System32")
      : "/usr/bin:/bin",
    NODE_ENV: "production",
  },
  timeout: 10000,
});
if (startup.status !== 1 || !startup.stdout.includes('"code":"configuration"'))
  throw new Error(
    "Packaged runtime imports/preflight entrypoint failed; no config or DB was opened.",
  );
const initialized = spawnSync(
  node,
  [join(runtime, "runtime.cjs"), "--initialize-database"],
  {
    cwd: runtime,
    input: '{"version":1}\n',
    env: { ...system, NODE_ENV: "production" },
    timeout: 15000,
    maxBuffer: 8 * 1024 * 1024,
  },
);
if (
  initialized.status !== 0 ||
  !initialized.stdout?.subarray(0, 16).equals(Buffer.from("SQLite format 3\0"))
)
  throw new Error(
    "Packaged fresh-only initializer failed; no selected file was opened.",
  );
// Preserve the reviewed conditions with the actual payload, not only in source docs.
await cp(
  join(root, "docs/redistribution.md"),
  join(resources, "REDISTRIBUTION-REVIEW.txt"),
);
execFileSync(python, [...pythonFlags, "scripts/desktop/redistribution.py"], {
  cwd: root,
  stdio: "inherit",
});
const files = [];
async function inventory(dir, relative = "") {
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const path = join(relative, item.name);
    if (
      /^(\.env($|\.)|data$|logs$|\.garmin)/.test(item.name) ||
      /\.(sqlite|db)(-|$)/.test(item.name)
    )
      throw new Error(`Private runtime input in resource tree: ${item.name}`);
    if (item.isDirectory()) await inventory(join(dir, item.name), path);
    else if (item.isFile())
      files.push({
        // Portable record paths: "/" separators on every platform.
        path: path.split(sep).join("/"),
        sha256: sha(await readFile(join(dir, item.name))),
      });
    else throw new Error("Unexpected resource alias/device.");
  }
}
const lock = JSON.parse(
  await readFile(join(root, "package-lock.json"), "utf8"),
);
const notices = Object.entries(lock.packages)
  .filter(([name, pkg]) => name && !pkg.dev)
  .map(
    ([name, pkg]) =>
      `${name}: ${pkg.version}; ${pkg.license ?? "review upstream license"}`,
  )
  .join("\n");
await writeFile(
  join(resources, "THIRD-PARTY-NOTICES.txt"),
  `Unsigned build. Notices are not redistribution authorization.\nFirst-party code and assets: Apache-2.0, see FIRST-PARTY-LICENSE.txt. Third-party components keep their own terms.\nNode and embedded components: see NODE-LICENSE.txt.\nActual npm/native/upstream license texts: see redistribution/NOTICES.txt.\nSources and exact input digests: see redistribution/index.json and redistribution/sources/.\nSee REDISTRIBUTION-REVIEW.txt for the first-party license scope, attribution, rebuild directions and remaining publication gates.\nProduction npm dependency metadata (conservative superset, not legal certification):\n${notices}\n`,
);
// Bind the generated notices and source corpus as well as runtime resources.
await inventory(resources);
await writeFile(
  join(resources, "provenance.json"),
  JSON.stringify(
    {
      version: 2,
      sourceFingerprint: identity.source,
      buildSourceFingerprint: identity.buildSource,
      buildContext: identity.context,
      buildContextComponents: identity.components,
      platform: platformId,
      inputs: { ...inputs, targets: { [platformId]: target } },
      source: execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: root,
        encoding: "utf8",
      }).trim(),
      sourceDirty: Boolean(
        execFileSync("git", ["status", "--porcelain"], {
          cwd: root,
          encoding: "utf8",
        }).trim(),
      ),
      lockSha256: sha(await readFile(join(root, "package-lock.json"))),
      files,
    },
    null,
    2,
  ),
);
console.log(
  `${platformId} resources assembled; ${files.length} files; pinned Node/SQLite ABI passed. See src-tauri/resources/provenance.json.`,
);
