import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

// A cooperative admission lease, not a SQLite transaction or a multi-user lock.
// Never steal a stale lease: PID reuse and delayed writers make that unsafe.
const registryKey = Symbol.for("ai-garmin-trainer.database-writers.v1");

function processLeases(): Map<string, string> {
  // Next chunks, development reloads and isolated module reloads share one
  // process owner, not one listener/lease per module evaluation.
  const shared = globalThis as typeof globalThis & {
    [registryKey]?: Map<string, string>;
  };
  if (!shared[registryKey]) {
    const registry = new Map<string, string>();
    shared[registryKey] = registry;
    process.once("exit", () => {
      for (const [path, identity] of registry) removeOwnedLease(path, identity);
    });
  }
  return shared[registryKey];
}

function removeOwnedLease(path: string, identity: string): void {
  if (existsSync(path) && readFileSync(path, "utf8") === identity)
    unlinkSync(path);
}

export function acquireDatabaseWriter(databasePath: string): () => void {
  const requested = resolve(databasePath);
  const exists = existsSync(requested);
  if (exists) {
    const stat = lstatSync(requested);
    if (!stat.isFile() || stat.nlink !== 1)
      throw new Error("Database must be a regular, unaliased local file.");
  }
  // Source mode retains conventional /var -> /private/var parent semantics;
  // canonicalizing the lease prevents alias-based concurrent writer admission.
  // Desktop's stricter explicit-reference preflight remains independent.
  const database = exists
    ? realpathSync(requested)
    : join(realpathSync(dirname(requested)), basename(requested));
  const path = `${database}.trainer-writer`;
  const leases = processLeases();
  const prior = leases.get(path);
  if (prior && existsSync(path) && readFileSync(path, "utf8") === prior)
    return () => {};
  leases.delete(path);
  const identity = JSON.stringify({
    version: 1,
    pid: process.pid,
    id: randomUUID(),
  });
  let fd: number;
  try {
    fd = openSync(path, "wx", 0o600);
  } catch {
    throw new Error(
      "Database writer lease exists or cannot be created. Quit the other app; inspect stale ownership before recovery. Never remove a live lease.",
    );
  }
  try {
    writeFileSync(fd, identity);
  } finally {
    closeSync(fd);
  }
  const release = () => {
    removeOwnedLease(path, identity);
    leases.delete(path);
  };
  try {
    if (process.platform === "darwin" && existsSync(database)) {
      const result = spawnSync("/usr/sbin/lsof", ["-t", "--", database], {
        encoding: "utf8",
        timeout: 5000,
      });
      if (
        result.error ||
        ![0, 1].includes(result.status ?? -1) ||
        result.stdout
          .trim()
          .split(/\s+/)
          .some((pid) => pid && pid !== String(process.pid))
      )
        throw new Error(
          "Database is open elsewhere or writer ownership could not be verified. Quit its owner first.",
        );
    }
    leases.set(path, identity);
    return release;
  } catch (error) {
    release();
    throw error;
  }
}
