import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

// Execute the actual script in a path with spaces. All process/network/build
// boundaries are fakes, including Bash's kill builtin: no real PID is touched.
function restart(args: string[], overrides: Record<string, string> = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "restart modes ")));
  roots.push(root);
  const repo = join(root, "repo with spaces");
  const bin = join(root, "bin");
  mkdirSync(join(repo, "scripts"), { recursive: true });
  mkdirSync(bin);
  const script = join(repo, "scripts/restart-local.sh");
  copyFileSync(new URL("../scripts/restart-local.sh", import.meta.url), script);
  const calls = join(root, "calls");
  const bashEnv = join(root, "bash-env");
  writeFileSync(bashEnv, 'kill() { printf "kill %s\\n" "$*" >> "$CALLS"; }\n');
  const fake = `#!/bin/bash
set -eu
command="\${0##*/}"
printf '%s %s\\n' "$command" "$*" >> "$CALLS"
case "$command" in
  ps)
    printf '900001 next-server\\n900002 npm run dev\\n'
    ;;
  lsof)
    case "$*" in
      '-a -p 900001 -d cwd -Fn') printf 'n%s\\n' "$REPO" ;;
      '-a -p 900002 -d cwd -Fn') printf 'n%s\\n' "$ROOT/foreign repo" ;;
      *-tiTCP:*)
        if [ -f "$ROOT/launched" ]; then
          if [ "$SCENARIO" = wrong-owner ]; then echo 900002; else echo 900001; fi
        elif [ "$SCENARIO" = foreign ]; then echo 900002
        fi
        ;;
    esac
    ;;
  npm)
    if [ "$*" = 'run build' ]; then
      [ "$SCENARIO" != build-fail ] || exit 1
    else
      printf 'launch PORT=%s args=%s\\n' "\${PORT:-unset}" "$*" >> "$CALLS"
      touch "$ROOT/launched"
    fi
    ;;
  curl)
    [ "$SCENARIO" != not-ready ] && [ -f "$ROOT/launched" ]
    ;;
  sleep) /bin/sleep 0.01 ;;
esac
`;
  for (const name of ["ps", "lsof", "npm", "curl", "sleep"]) {
    writeFileSync(join(bin, name), fake, { mode: 0o755 });
  }
  const result = spawnSync("/bin/bash", [script, ...args], {
    encoding: "utf8",
    timeout: 10_000,
    env: {
      NODE_ENV: "test",
      PATH: `${bin}:/usr/bin:/bin`,
      ROOT: root,
      REPO: repo,
      CALLS: calls,
      BASH_ENV: bashEnv,
      TMPDIR: root,
      SCENARIO: "success",
      AI_GARMIN_RESTART_LOG: join(root, "logs/server.log"),
      ...overrides,
    },
  });
  expect(result.error).toBeUndefined();
  return {
    status: result.status,
    output: result.stdout + result.stderr,
    calls: existsSync(calls) ? readFileSync(calls, "utf8") : "",
  };
}

describe("local restart CLI", () => {
  it.each([[], ["--mode", "production"], ["--mode=production"]])(
    "builds then starts production for %j",
    (...args) => {
      const result = restart(args);
      expect(result.status).toBe(0);
      expect(result.output).toContain("mode=production");
      expect(result.calls).toContain("npm run build");
      expect(result.calls).toContain("launch PORT=3000 args=run start:local");
      expect(result.calls.indexOf("npm run build")).toBeLessThan(
        result.calls.indexOf("npm run start:local"),
      );
      expect(result.calls).not.toContain("npm run dev");
    },
  );

  it.each(["--mode=dev", "--mode"])("skips build for %s", (option) => {
    const result = restart(option === "--mode" ? [option, "dev"] : [option]);
    expect(result.status).toBe(0);
    expect(result.output).toContain("mode=dev");
    expect(result.calls).toContain(
      "npm run dev -- --hostname 127.0.0.1 --port 3000",
    );
    expect(result.calls).not.toContain("npm run build");
    expect(result.calls).not.toContain("npm run start:local");
  });

  it.each(["dev", "production"])(
    "preserves port and safety handling in %s",
    (mode) => {
      for (const args of [[], ["--port", "3211"], ["--port=3211"]]) {
        const port = args.length ? "3211" : "3210";
        const result = restart(["--mode", mode, ...args], {
          AI_GARMIN_RESTART_PORT: "3210",
        });
        expect(result.status).toBe(0);
        expect(result.output).toContain(`ready_url=http://127.0.0.1:${port}/`);
        expect(result.calls).toContain(`lsof -nP -tiTCP:${port} -sTCP:LISTEN`);
        expect(result.calls).toContain(
          mode === "dev" ? `--port ${port}` : `launch PORT=${port}`,
        );
        expect(result.calls).toContain("kill 900001\n");
        expect(result.calls).not.toMatch(/kill[^\n]*900002/);
      }
    },
  );

  it.each([
    ["--mode"],
    ["--mode="],
    ["--mode", ""],
    ["--mode", "preview"],
    ["--mode", "--port", "3001"],
    ["--port"],
    ["--port="],
    ["--port", "0"],
    ["--port", "65536"],
    ["--port", "abc"],
    ["--unknown"],
  ])("rejects invalid arguments without side effects: %j", (...args) => {
    const result = restart(args);
    expect(result.status).toBe(2);
    expect(result.output).toContain("Usage:");
    expect(result.calls).toBe("");
  });

  it("rejects invalid environment ports before touching processes", () => {
    const result = restart(["--mode=dev"], {
      AI_GARMIN_RESTART_PORT: "invalid",
    });
    expect(result.status).toBe(2);
    expect(result.calls).toBe("");
  });

  it.each(["--help", "-h"])(
    "shows modes/default in %s without side effects",
    (arg) => {
      const result = restart([arg]);
      expect(result.status).toBe(0);
      expect(result.output).toContain("--mode dev|production");
      expect(result.output).toContain("production (default)");
      expect(result.calls).toBe("");
    },
  );

  it.each(["dev", "production"])("refuses a foreign listener in %s", (mode) => {
    const result = restart(["--mode", mode], { SCENARIO: "foreign" });
    expect(result.status).toBe(1);
    expect(result.output).toContain("refusing to kill unrelated listeners");
    expect(result.calls).not.toContain("npm ");
    expect(result.calls).not.toMatch(/kill[^\n]*900002/);
  });

  it("does not launch after a failed production build", () => {
    const result = restart([], { SCENARIO: "build-fail" });
    expect(result.status).toBe(1);
    expect(result.calls).toContain("npm run build");
    expect(result.calls).not.toContain("npm run start:local");
  });

  it.each(["dev", "production"])(
    "requires readiness and owned listeners in %s",
    (mode) => {
      for (const scenario of ["not-ready", "wrong-owner"]) {
        const result = restart(["--mode", mode], { SCENARIO: scenario });
        expect(result.status).toBe(1);
        expect(result.output).toContain(
          scenario === "not-ready"
            ? "Server did not become ready"
            : "no port-3000 listener belongs to this repo",
        );
      }
    },
  );

  it("retains the explicit readiness URL override", () => {
    const result = restart(["--mode=dev"], {
      AI_GARMIN_RESTART_READY_URL: "http://127.0.0.1:3000/health",
    });
    expect(result.status).toBe(0);
    expect(result.calls).toContain("curl -fsS http://127.0.0.1:3000/health");
  });
});
