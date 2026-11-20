import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { execFileSync } from "node:child_process";

const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
  engines?: { node?: string };
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

function argValue(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
}

function sha256(path: string): string | null {
  if (!existsSync(path)) return null;
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function maybeAudit(): unknown {
  if (!process.argv.includes("--audit"))
    return { skipped: "pass --audit to run npm audit --json" };
  try {
    return JSON.parse(
      execFileSync("npm", ["audit", "--json"], { encoding: "utf8" }),
    );
  } catch (error) {
    const output = (error as { stdout?: Buffer | string }).stdout;
    if (output) {
      try {
        return JSON.parse(String(output));
      } catch {
        return {
          errorClass: "audit.unparseable",
          detail: String(output).slice(0, 1200),
        };
      }
    }
    return {
      errorClass: "audit.failed",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

const output = argValue("--output");
const evidence = {
  generatedAt: new Date().toISOString(),
  boundary:
    "local single-user macOS ARM64 desktop; npm audit evidence only, not Node/Rust/compiled-vendor clearance or binary publication approval",
  node: {
    engine: pkg.engines?.node,
    dependencyCount: Object.keys(pkg.dependencies ?? {}).length,
    devDependencyCount: Object.keys(pkg.devDependencies ?? {}).length,
    lockfileSha256: sha256("package-lock.json"),
    packageManager: "npm lockfile present",
  },
  garmin: {
    access:
      "official Garmin Personal API over HTTPS with a user-owned key; activity files decoded in-process by fit-file-parser (production npm dependency)",
    externalTools:
      "none: no Python, uv, uvx or Garmin connector is installed, probed or launched by the product",
    unresolvedExternalBetaBlocker:
      "Qualified license/security review, explicit residual-risk disposition and exact-source/artifact approval remain required before binary publication; this evidence does not provide legal conclusions.",
  },
  audit: maybeAudit(),
};

if (output) {
  const path = resolve(output);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(`dependency evidence written to ${path}`);
} else {
  console.log(JSON.stringify(evidence, null, 2));
}
