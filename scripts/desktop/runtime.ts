import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import next from "next";
import { adoptConfiguration, configureDesktopNext } from "./config";
import { acceptsDesktopRequest } from "./http-policy";
import { assertDesktopDatabase } from "../../src/lib/db/desktop-preflight";
import { releaseDatabaseWritersForProcessExit } from "../../src/lib/db/writer-ownership";
import {
  activationEnvironment,
  SECRET_SLOTS,
  validateSettings,
} from "./settings";
import { freshDatabase } from "./initialize";

const protocol = process.stdout.write.bind(process.stdout);
const report = (value: object) => protocol(`${JSON.stringify(value)}\n`);
// Framework/provider errors can contain private data. Only the allowlisted
// protocol reaches the native host; no raw runtime logs become UI/evidence.
console.log = console.info = console.warn = console.error = () => {};
let stage = "configuration";

async function main(): Promise<void> {
  const nonce = process.env.TRAINER_DESKTOP_NONCE;
  if (!nonce || !/^[a-f0-9-]{36}$/.test(nonce) || process.argv.length !== 2)
    throw new Error("Missing native launch identity.");
  delete process.env.TRAINER_DESKTOP_NONCE;
  let parentLost = false;
  let onParentLost: () => void = () => process.exit(1);
  // Native retains an otherwise-unused stdin pipe. EOF is reliable parent-death
  // evidence (process.ppid is a cached value in Node, not a liveness probe).
  process.stdin.once("end", () => {
    parentLost = true;
    setTimeout(() => {
      // SIGKILL cannot run Node exit hooks. Settle only this live process's exact
      // leases synchronously, then stop the owned group in the same callback.
      // No JS work can resume between release and kill; macOS open-file admission
      // independently prevents a competing writer during the bounded transition.
      try {
        releaseDatabaseWritersForProcessExit();
      } finally {
        try {
          process.kill(-process.pid, "SIGKILL");
        } catch {
          process.exit(1);
        }
      }
    }, 6000);
    try {
      process.kill(-process.pid, "SIGTERM");
    } catch {
      /* No remaining owned group. */
    }
    onParentLost();
  });
  const snapshot = await readPrivateFrame();
  const tooling = adoptConfiguration(snapshot);
  stage = "database";
  const adoptedDatabase = process.env.DATABASE_PATH!;
  assertDesktopDatabase(adoptedDatabase);
  stage = "resources";
  const root = process.cwd();
  const required = JSON.parse(
    readFileSync(join(root, ".next/required-server-files.json"), "utf8"),
  ) as { config: Record<string, unknown> };
  // Next custom-server mode keeps normal request/after semantics. The production
  // standalone dependency tree is assembled explicitly, not a source bootstrap.
  const app = next({
    dev: false,
    dir: root,
    conf: configureDesktopNext(required.config),
    hostname: "127.0.0.1",
  });
  await app.prepare();
  if (
    process.env.TRAINER_DESKTOP !== "1" ||
    process.env.DATABASE_PATH !== adoptedDatabase
  )
    throw new Error("Framework changed the validated adoption environment.");
  let origin = "";
  let ready = false;
  const handler = app.getRequestHandler();
  const server = createServer((request, response) => {
    if (!acceptsDesktopRequest(request.headers, origin)) {
      response.writeHead(403).end("Desktop origin refused.");
      return;
    }
    if (request.url === "/__desktop/ready") {
      if (!ready || request.headers["x-trainer-identity"] !== nonce) {
        response.writeHead(404).end();
        return;
      }
      response
        .writeHead(200, {
          "x-trainer-identity": nonce,
          "cache-control": "no-store",
        })
        .end("ready");
      return;
    }
    if (request.url === "/__desktop/memory-status") {
      if (
        !ready ||
        request.method !== "GET" ||
        request.headers["x-trainer-identity"] !== nonce
      ) {
        response.writeHead(404).end();
        return;
      }
      // Fixed metadata-only route in the same production composition. No caller
      // URL, private list, probe or generic native HTTP bridge.
      fetch(`${origin}/api/memory?view=status`, {
        signal: AbortSignal.timeout(2000),
      })
        .then(async (result) => {
          const body = Buffer.from(await result.arrayBuffer());
          if (!result.ok || body.length > 2048)
            throw new Error("Status unavailable");
          response
            .writeHead(200, {
              "x-trainer-identity": nonce,
              "cache-control": "no-store",
              "content-type": "application/json",
              "content-length": body.length,
            })
            .end(body);
        })
        .catch(() => {
          if (!response.headersSent) response.writeHead(503);
          response.end();
        });
      return;
    }
    handler(request, response).catch(() => {
      if (!response.headersSent) response.writeHead(500);
      response.end("Local request failed.");
    });
  });
  let stopping = false;
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    ready = false;
    // Drain HTTP and Next after() for at most 5s; native kills the owned group
    // after 8s. Interrupted provider/import writes are not rolled back/retried.
    const deadline = setTimeout(() => {
      if (!parentLost) process.exit(0);
    }, 5000);
    server.close(() => {
      app.close().then(
        () => {
          clearTimeout(deadline);
          if (!parentLost) process.exit(0);
        },
        () => {
          if (!parentLost) process.exit(1);
        },
      );
    });
  };
  onParentLost = shutdown;
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
  stage = "listener";
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No owned listener.");
  origin = `http://127.0.0.1:${address.port}`;
  process.env.NEXT_PUBLIC_APP_URL = origin;
  stage = "database-ownership";
  // Exercise the real production composition/DB owner before readiness. This
  // acquires the shared source/desktop lease and catches late admission races.
  const summary = await fetch(`${origin}/api/summary`, {
    signal: AbortSignal.timeout(15000),
  });
  await summary.arrayBuffer();
  if (!summary.ok) throw new Error("Database owner warmup failed.");
  const lease = JSON.parse(
    readFileSync(`${adoptedDatabase}.trainer-writer`, "utf8"),
  ) as { pid?: number; version?: number };
  if (lease.pid !== process.pid || lease.version !== 1)
    throw new Error("Selected database writer ownership was not established.");
  stage = "ready";
  ready = true;
  report({ type: "ready", version: 1, port: address.port, tooling });
}

// Consume exactly one bounded line; leave stdin open as the ownership pipe.
function readPrivateFrame(): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let bytes = Buffer.alloc(0);
    const timer = setTimeout(
      () => finish(new Error("Activation timeout.")),
      10000,
    );
    function finish(error?: Error, value?: unknown) {
      clearTimeout(timer);
      process.stdin.off("data", onData);
      process.stdin.off("end", onEnd);
      bytes.fill(0);
      if (error) reject(error);
      else resolve(value);
    }
    function onEnd() {
      finish(new Error("Activation pipe closed."));
    }
    function onData(chunk: Buffer) {
      const next = Buffer.concat([bytes, chunk]);
      bytes.fill(0);
      bytes = next;
      if (bytes.length > 128 * 1024)
        return finish(new Error("Activation too large."));
      const end = bytes.indexOf(10);
      if (end < 0) return;
      try {
        if (end !== bytes.length - 1)
          throw new Error("Unexpected activation data.");
        const value: unknown = JSON.parse(
          bytes.subarray(0, end).toString("utf8"),
        );
        finish(undefined, value);
      } catch {
        finish(new Error("Invalid activation."));
      }
    }
    process.stdin.on("data", onData);
    process.stdin.once("end", onEnd);
    process.stdin.resume();
  });
}

async function entry(): Promise<void> {
  if (
    process.argv[2] === "--initialize-database" &&
    process.argv.length === 3
  ) {
    try {
      const bytes = freshDatabase(await readPrivateFrame());
      await new Promise<void>((resolve, reject) => {
        protocol(bytes, (error) => (error ? reject(error) : resolve()));
      });
      process.exit(0);
    } catch {
      process.exit(1);
    }
  }
  if (
    ["--validate-new-activation", "--validate-existing-activation"].includes(
      process.argv[2],
    ) &&
    process.argv.length === 3
  ) {
    try {
      const fresh = process.argv[2] === "--validate-new-activation";
      const fields = activationEnvironment(
        await readPrivateFrame(),
        fresh ? "new" : "existing",
      );
      if (!fresh) assertDesktopDatabase(fields.DATABASE_PATH);
      for (const slot of SECRET_SLOTS) delete fields[slot];
      report({ ok: true, fields });
      process.exit(0);
    } catch {
      report({ ok: false });
      process.exit(1);
    }
  }
  if (process.argv[2] === "--validate-settings" && process.argv.length === 3) {
    try {
      const fields = validateSettings(await readPrivateFrame());
      assertDesktopDatabase(fields.DATABASE_PATH);
      report({ ok: true, fields });
      process.exit(0);
    } catch {
      report({ ok: false });
      process.exit(1);
    }
  }
  await main();
}
entry().catch(() => {
  report({ type: "failed", version: 1, code: stage });
  process.exit(1);
});
