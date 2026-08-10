import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import {
  GARMIN_MCP_COMMIT,
  GARMIN_MCP_SDK_REQUIREMENT,
} from "../src/lib/garmin/client";

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
    "local MCP-only source beta; no package publication, container image, desktop bundle, public release, deployment, or beta invitation",
  node: {
    engine: pkg.engines?.node,
    dependencyCount: Object.keys(pkg.dependencies ?? {}).length,
    devDependencyCount: Object.keys(pkg.devDependencies ?? {}).length,
    lockfileSha256: sha256("package-lock.json"),
    packageManager: "npm lockfile present",
  },
  garminMcp: {
    connector: "Taxuspt/garmin_mcp",
    pinnedCommit: GARMIN_MCP_COMMIT,
    mcpSdkRequirement: GARMIN_MCP_SDK_REQUIREMENT,
    resolutionBoundary:
      "uvx invocation includes an exact MCP SDK 1.x requirement because the pinned connector imports mcp.server.fastmcp and MCP 2.x removes that module path",
    transport: "local stdio only",
    authState: "presence only; token contents excluded",
  },
  python: {
    boundary:
      "uvx resolves pinned garmin_mcp and Python transitive dependencies during source-beta setup",
    unresolvedExternalBetaBlocker:
      "Qualified license/security review remains required before external invitation or redistribution; this evidence does not provide legal conclusions.",
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
