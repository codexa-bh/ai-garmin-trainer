import { spawn, type ChildProcess } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const adapter = fileURLToPath(
  new URL("../scripts/restart-readiness.mjs", import.meta.url),
);
const bootstrap = new URL("../scripts/bootstrap-local.mjs", import.meta.url)
  .href;
const fixtures: { root: string; children: ChildProcess[] }[] = [];
afterEach(() => {
  for (const { root, children } of fixtures.splice(0)) {
    for (const child of children)
      if (child.exitCode === null) child.kill("SIGTERM");
    const pidFile = join(root, "daemon.pid");
    if (existsSync(pidFile)) {
      try {
        process.kill(Number(readFileSync(pidFile, "utf8")), "SIGTERM");
      } catch {
        /* already stopped */
      }
    }
    rmSync(root, { recursive: true, force: true });
  }
});

async function fixture(overrides: Record<string, string> = {}) {
  const root = mkdtempSync(join(tmpdir(), "ollama readiness "));
  const children: ChildProcess[] = [];
  fixtures.push({ root, children });
  mkdirSync(join(root, "bin"));
  const port = await new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as { port: number };
      server.close(() => resolve(address.port));
    });
  });
  const env = {
    ...process.env,
    PATH: `${join(root, "bin")}:${dirname(process.execPath)}:/usr/bin:/bin`,
    ROOT: root,
    MEMORY_ENABLED: "true",
    MEMORY_EMBEDDING_PROVIDER: "ollama",
    MEMORY_EMBEDDING_MODEL: "custom-embed",
    MEMORY_EMBEDDING_BASE_URL: `http://127.0.0.1:${port}`,
    MEMORY_TIMEOUT_MS: "1000",
    OLLAMA_HOST: "http://0.0.0.0:9999",
    SCENARIO: "success",
    ...overrides,
  };
  // Fake only the external CLI/DB boundaries, not readiness or HTTP logic.
  const cli = `#!${process.execPath}
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const root = process.env.ROOT;
const scenario = process.env.SCENARIO;
const action = process.argv[2];
fs.appendFileSync(path.join(root, 'calls'), action + ' ' + (process.argv[3] || '') + ' host=' + process.env.OLLAMA_HOST + '\\n');
if (action === '--version') process.exit(['missing-cli', 'missing-pull-cli'].includes(scenario) ? 1 : 0);
if (action === 'pull') {
  if (scenario === 'pull-fail') process.exit(1);
  fs.writeFileSync(path.join(root, 'installed'), 'yes');
  process.exit(0);
}
if (action !== 'serve' || scenario === 'spawn-fail') process.exit(1);
if (scenario === 'startup-timeout') { fs.writeFileSync(path.join(root, 'daemon.pid'), String(process.pid)); setInterval(() => {}, 1000); return; }
const server = http.createServer((req, res) => {
  fs.appendFileSync(path.join(root, 'requests'), req.url + '\\n');
  res.setHeader('Content-Type', 'application/json');
  if (req.url === '/api/tags') {
    const installed = !['pull', 'pull-fail', 'missing-pull-cli'].includes(scenario) || fs.existsSync(path.join(root, 'installed'));
    res.end(JSON.stringify({models: installed ? [{name: 'custom-embed:latest'}] : []}));
  } else {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      const parsed = JSON.parse(body);
      if (parsed.model !== 'custom-embed' || parsed.input !== 'memory readiness probe') { res.statusCode = 400; res.end('{}'); return; }
      if (scenario === 'non-2xx') res.statusCode = 500;
      if (scenario === 'redirect') { res.statusCode = 302; res.setHeader('Location', 'http://example.invalid'); }
      res.end(JSON.stringify(scenario === 'malformed' ? {embeddings: [[]]} : scenario === 'error-response' ? {error: 'SECRET-REMOTE-DETAIL', embeddings: [[1]]} : scenario === 'invalid-vector' ? {embeddings: [[null, '1']]} : {embeddings: [[0.25, -1, 2]]}));
    });
  }
});
const url = new URL(process.env.OLLAMA_HOST);
server.listen(Number(url.port), url.hostname, () => fs.writeFileSync(path.join(root, 'daemon.pid'), String(process.pid)));
`;
  writeFileSync(join(root, "bin", "ollama"), cli, { mode: 0o755 });
  writeFileSync(
    join(root, "bin", "npm"),
    `#!${process.execPath}
const fs = require('node:fs');
fs.appendFileSync(process.env.ROOT + '/calls', 'db-status\\n');
if (process.env.SCENARIO === 'db-fail') { console.error('SECRET-DATABASE-DETAIL'); process.exit(1); }
console.log(JSON.stringify({ok:true, needsMigration:process.env.SCENARIO === 'migration', memoryUserDisabled:process.env.SCENARIO === 'disabled'}));
`,
    { mode: 0o755 },
  );
  function launch(script = adapter, extraEnv: Record<string, string> = {}) {
    const child = spawn(process.execPath, [script], {
      cwd: root,
      env: { ...env, ...extraEnv },
      stdio: ["ignore", "pipe", "pipe"],
    });
    children.push(child);
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      output += String(chunk);
    });
    const result = new Promise<{ code: number | null; output: string }>(
      (resolve, reject) => {
        const timer = setTimeout(() => {
          child.kill("SIGTERM");
          reject(new Error("adapter deadline exceeded"));
        }, 22_000);
        child.once("error", (error) => {
          clearTimeout(timer);
          reject(error);
        });
        child.once("close", (code) => {
          clearTimeout(timer);
          resolve({ code, output });
        });
      },
    );
    return { child, result };
  }
  async function existingDaemon() {
    const child = spawn(join(root, "bin", "ollama"), ["serve"], {
      cwd: root,
      env: { ...env, OLLAMA_HOST: env.MEMORY_EMBEDDING_BASE_URL },
      stdio: "ignore",
    });
    children.push(child);
    for (let i = 0; i < 100; i++) {
      try {
        if ((await fetch(`${env.MEMORY_EMBEDDING_BASE_URL}/api/tags`)).ok)
          return child;
      } catch {
        /* await owned fixture listener */
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error("fixture daemon not ready");
  }
  const calls = () =>
    existsSync(join(root, "calls"))
      ? readFileSync(join(root, "calls"), "utf8")
      : "";
  return { root, env, launch, existingDaemon, calls };
}

describe("shared Ollama readiness and restart lifetime", () => {
  const skippedConfigurations: Record<string, string>[] = [
    { MEMORY_ENABLED: "false" },
    { MEMORY_EMBEDDING_PROVIDER: "openai" },
    { SCENARIO: "disabled" },
  ];
  it.each(skippedConfigurations)(
    "skips inapplicable effective memory: %j",
    async (env) => {
      const f = await fixture(env);
      const result = await f.launch().result;
      expect(result.code).toBe(0);
      expect(result.output).toContain("Ollama: skip");
      expect(f.calls()).not.toContain("--version");
      expect(f.calls()).not.toContain("serve");
    },
  );

  it("loads local env while retaining process-env precedence", async () => {
    const f = await fixture({ MEMORY_ENABLED: "false" });
    writeFileSync(
      join(f.root, ".env.local"),
      "MEMORY_ENABLED=true\nMEMORY_EMBEDDING_PROVIDER=ollama\n",
    );
    expect((await f.launch().result).output).toContain("memory disabled");
  });

  it.each(["db-fail", "migration"])(
    "fails closed on %s without leaking DB details",
    async (SCENARIO) => {
      const f = await fixture({ SCENARIO });
      const result = await f.launch().result;
      expect(result.code).toBe(1);
      expect(result.output).toContain("Remediation:");
      expect(result.output).not.toContain("SECRET-DATABASE-DETAIL");
      expect(f.calls()).not.toContain("--version");
    },
  );

  it.each([
    "http://example.com:11434",
    "not a url",
    "http://127.0.0.1:11434/api",
    "http://secret@127.0.0.1:11434",
  ])("rejects unsupported endpoints without side effects: %s", async (url) => {
    const f = await fixture({ MEMORY_EMBEDDING_BASE_URL: url });
    expect((await f.launch().result).code).toBe(1);
    expect(f.calls()).not.toContain("--version");
  });

  it("reuses existing daemon/model even without a working CLI", async () => {
    const f = await fixture({ SCENARIO: "missing-cli" });
    const daemon = await f.existingDaemon();
    const result = await f.launch().result;
    expect(result.code).toBe(0);
    expect(result.output).toContain(
      "reuse model=custom-embed pull=false; embedding probe passed",
    );
    expect(f.calls().match(/serve /g)).toHaveLength(1);
    expect(daemon.exitCode).toBeNull();
  });

  it("starts detached, targets the configured endpoint and survives two adapter exits", async () => {
    const f = await fixture();
    expect((await f.launch().result).output).toContain(
      "start model=custom-embed",
    );
    const pid = Number(readFileSync(join(f.root, "daemon.pid"), "utf8"));
    expect(() => process.kill(pid, 0)).not.toThrow();
    expect((await f.launch().result).output).toContain(
      "reuse model=custom-embed",
    );
    expect(f.calls().match(/serve /g)).toHaveLength(1);
    expect(f.calls()).toContain(
      `serve  host=${f.env.MEMORY_EMBEDDING_BASE_URL}`,
    );
  });

  it("pulls visibly once, passing the configured model and endpoint as arguments/env", async () => {
    const f = await fixture({ SCENARIO: "pull" });
    const result = await f.launch().result;
    expect(result.code).toBe(0);
    expect(result.output).toContain(
      "Pulling configured Ollama embedding model custom-embed",
    );
    expect(f.calls()).toContain(
      `pull custom-embed host=${f.env.MEMORY_EMBEDDING_BASE_URL}`,
    );
    expect((await f.launch().result).code).toBe(0);
    expect(f.calls().match(/pull custom-embed/g)).toHaveLength(1);
  });

  it.each([
    "missing-cli",
    "spawn-fail",
    "pull-fail",
    "malformed",
    "error-response",
    "invalid-vector",
    "non-2xx",
    "redirect",
  ])("fails preparation for %s without reporting success", async (SCENARIO) => {
    const f = await fixture({ SCENARIO });
    const result = await f.launch().result;
    expect(result.code).toBe(1);
    expect(result.output).toContain("Restart readiness failed:");
    expect(result.output).not.toContain("embedding probe passed");
    expect(result.output).not.toContain("SECRET-REMOTE-DETAIL");
  });

  it("does not stop an independently owned daemon after a failed probe", async () => {
    const f = await fixture({ SCENARIO: "malformed" });
    const daemon = await f.existingDaemon();
    expect((await f.launch().result).code).toBe(1);
    expect(daemon.exitCode).toBeNull();
    expect(() => process.kill(daemon.pid!, 0)).not.toThrow();
  });

  it("requires a CLI when a reachable daemon lacks the configured model", async () => {
    const f = await fixture({ SCENARIO: "missing-pull-cli" });
    const daemon = await f.existingDaemon();
    const result = await f.launch().result;
    expect(result.code).toBe(1);
    expect(result.output).toContain("CLI is required to pull");
    expect(daemon.exitCode).toBeNull();
  });

  it("accepts a concurrent startup winner without stopping it", async () => {
    const f = await fixture();
    const results = await Promise.all([f.launch().result, f.launch().result]);
    expect(results.map((result) => result.code)).toEqual([0, 0]);
    const pid = Number(readFileSync(join(f.root, "daemon.pid"), "utf8"));
    expect(() => process.kill(pid, 0)).not.toThrow();
    expect((await f.launch().result).output).toContain(
      "reuse model=custom-embed",
    );
  });

  it("retains bootstrap session ownership and its cleanup behavior", async () => {
    const f = await fixture();
    const runner = join(f.root, "bootstrap-session.mjs");
    writeFileSync(
      runner,
      `import {ensureOllama, configuredMemory, cleanup} from ${JSON.stringify(bootstrap)};
const owned = {};
await ensureOllama({memory: configuredMemory(process.env), owned});
if (!owned.ollama) throw new Error('lost session ownership');
cleanup(owned);
await new Promise(resolve => owned.ollama.once('exit', resolve));
console.log('bootstrap child stopped');
`,
    );
    const result = await f.launch(runner).result;
    expect(result.code).toBe(0);
    expect(result.output).toContain("bootstrap child stopped");
  });

  it("cancels startup and stops only the invocation-owned child", async () => {
    const f = await fixture({ SCENARIO: "startup-timeout" });
    const { child, result } = f.launch();
    for (let i = 0; i < 100 && !existsSync(join(f.root, "daemon.pid")); i++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(existsSync(join(f.root, "daemon.pid"))).toBe(true);
    child.kill("SIGTERM");
    expect((await result).code).toBe(1);
  });

  it("bounds an unavailable daemon startup", async () => {
    const f = await fixture({ SCENARIO: "startup-timeout" });
    const result = await f.launch().result;
    expect(result.code).toBe(1);
    expect(result.output).toContain("readiness deadline");
  }, 22_000);
});
