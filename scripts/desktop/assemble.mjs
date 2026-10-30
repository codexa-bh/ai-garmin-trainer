import { build } from "esbuild";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const inputs = JSON.parse(
  await readFile(join(root, "scripts/desktop/runtime-inputs.json"), "utf8"),
);
if (process.platform !== "darwin" || process.arch !== "arm64")
  throw new Error("Desktop assembly requires macOS ARM64.");
const resources = join(root, "src-tauri/resources");
const target = join(resources, "runtime");
const cache = join(root, "dist/desktop-inputs");
await mkdir(cache, { recursive: true });
const archive = join(cache, inputs.nodeArchive);
try {
  await readFile(archive);
} catch {
  const response = await fetch(`${inputs.nodeSource}${inputs.nodeArchive}`, {
    signal: AbortSignal.timeout(120000),
  });
  if (!response.ok) throw new Error("Pinned Node download failed.");
  await writeFile(archive, Buffer.from(await response.arrayBuffer()));
}
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
if (sha(await readFile(archive)) !== inputs.nodeSha256)
  throw new Error(
    "Pinned Node checksum mismatch; cached input retained for diagnosis.",
  );
execFileSync("/usr/bin/tar", ["-xzf", archive, "-C", cache]);
// This is a fixed generated build directory, never task data/worktree cleanup.
await rm(resources, { recursive: true, force: true });
await mkdir(target, { recursive: true });
for (const path of [".next", "node_modules", "package.json"]) {
  await cp(join(root, ".next/standalone", path), join(target, path), {
    recursive: true,
    dereference: true,
  });
}
// Next's generated standalone trace targets its stock server.js, not the
// documented custom-server API. Include the complete pinned production Next
// package so app.prepare() cannot fall through to the developer checkout.
await cp(join(root, "node_modules/next"), join(target, "node_modules/next"), {
  recursive: true,
  dereference: true,
});
await cp(join(root, ".next/static"), join(target, ".next/static"), {
  recursive: true,
});
try {
  await cp(join(root, "public"), join(target, "public"), { recursive: true });
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
await mkdir(join(target, "scripts"));
for (const name of [
  "garmin_token_location",
  "garmin_fit_baseline",
  "garmin_fit_speed_stream",
  "garmin_fit_distance_stream",
  "garmin_fit_altitude_stream",
]) {
  await cp(
    join(root, "scripts", `${name}.py`),
    join(target, "scripts", `${name}.py`),
  );
}
await cp(
  join(cache, `node-v${inputs.nodeVersion}-darwin-arm64/bin/node`),
  join(resources, "node"),
);
await cp(
  join(cache, `node-v${inputs.nodeVersion}-darwin-arm64/LICENSE`),
  join(resources, "NODE-LICENSE.txt"),
);
await build({
  entryPoints: [join(root, "scripts/desktop/runtime.ts")],
  outfile: join(target, "runtime.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  external: ["next", "better-sqlite3", "@next/env"],
});
// Prove bundled runtime/SQLite ABI before native packaging; system Node cannot
// mask a missing binary. No application DB is opened by this in-memory probe.
execFileSync(
  join(resources, "node"),
  [
    "-e",
    "if(process.arch!=='arm64')process.exit(1); const D=require('better-sqlite3');const d=new D(':memory:');d.prepare('select 1').get();d.close()",
  ],
  { cwd: target, stdio: "pipe" },
);
const startup = spawnSync(
  join(resources, "node"),
  [join(target, "runtime.cjs")],
  {
    cwd: target,
    encoding: "utf8",
    env: { PATH: "/usr/bin:/bin", NODE_ENV: "production" },
    timeout: 10000,
  },
);
if (startup.status !== 1 || !startup.stdout.includes('"code":"configuration"'))
  throw new Error(
    "Packaged runtime imports/preflight entrypoint failed; no config or DB was opened.",
  );
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
      files.push({ path, sha256: sha(await readFile(join(dir, item.name))) });
    else throw new Error("Unexpected resource alias/device.");
  }
}
await inventory(resources);
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
  `Local unsigned build only. No distribution authorization.\nNode: see NODE-LICENSE.txt.\nTauri: Apache-2.0 OR MIT (Cargo.lock pins native inputs).\nNext production dependencies (lockfile license metadata, not legal certification):\n${notices}\n`,
);
await writeFile(
  join(resources, "provenance.json"),
  JSON.stringify(
    {
      version: 1,
      inputs,
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
  `ARM64 resources assembled; ${files.length} files; pinned Node/SQLite ABI passed. See src-tauri/resources/provenance.json.`,
);
