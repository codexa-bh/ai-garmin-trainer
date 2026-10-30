import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import next from "next";
import { adoptConfiguration, desktopNextConfiguration } from "./config";
import { acceptsDesktopRequest } from "./http-policy";
import { assertDesktopDatabase } from "../../src/lib/db/desktop-preflight";

const protocol = process.stdout.write.bind(process.stdout);
const report = (value: object) => protocol(`${JSON.stringify(value)}\n`);
// Framework/provider errors can contain private data. Only the allowlisted
// protocol reaches the native host; no raw runtime logs become UI/evidence.
console.log = console.info = console.warn = console.error = () => {};
let stage = "configuration";

async function main(): Promise<void> {
  const nonce = process.env.TRAINER_DESKTOP_NONCE;
  const configPath = process.argv[2];
  if (!nonce || !/^[a-f0-9-]{36}$/.test(nonce) || !configPath)
    throw new Error("Missing native launch identity.");
  delete process.env.TRAINER_DESKTOP_NONCE;
  let parentLost = false;
  let onParentLost: () => void = () => process.exit(1);
  // Native retains an otherwise-unused stdin pipe. EOF is reliable parent-death
  // evidence (process.ppid is a cached value in Node, not a liveness probe).
  process.stdin.once("end", () => {
    parentLost = true;
    setTimeout(() => {
      try {
        process.kill(-process.pid, "SIGKILL");
      } catch {
        process.exit(1);
      }
    }, 6000);
    try {
      process.kill(-process.pid, "SIGTERM");
    } catch {
      /* No remaining owned group. */
    }
    onParentLost();
  });
  process.stdin.resume();
  const tooling = adoptConfiguration(configPath);
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
    conf: desktopNextConfiguration(required.config),
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

main().catch(() => {
  report({ type: "failed", version: 1, code: stage });
  process.exit(1);
});
