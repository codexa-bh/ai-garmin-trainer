import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const script = fileURLToPath(
  new URL("../scripts/smoke-help.mjs", import.meta.url),
);
const otherCwd = fileURLToPath(new URL("../tests", import.meta.url));

function discover(...args) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: otherCwd,
    encoding: "utf8",
    timeout: 10_000,
  });
  expect(result.error).toBeUndefined();
  return result;
}

describe("read-only smoke command discovery", () => {
  it("shows help without building or launching from an unrelated cwd", () => {
    const result = discover();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      "Never prepares, builds or runs a scenario",
    );
    expect(discover("--help").stdout).toBe(result.stdout);
    expect(discover("-h").stdout).toBe(result.stdout);
  });

  it("lists unique IDs and shows each complete entry without its neighbor", () => {
    const result = discover("list");
    expect(result.status).toBe(0);
    const rows = result.stdout.trim().split("\n");
    const ids = rows.map((row) => row.split(" — ")[0]);
    expect(ids.length).toBeGreaterThan(20);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      const shown = discover("show", id);
      expect(shown.status).toBe(0);
      expect(shown.stdout).toContain(`## ${id} — `);
      expect(shown.stdout.match(/^## /gm)).toHaveLength(1);
      expect(shown.stdout).toContain("docs/smoke-commands.md");
      expect(shown.stdout).toContain("Shared setup/safety: docs/dev-bridge.md");
    }
    expect(result.stdout).toContain(
      "summary-native-copy — Opt-in real native responder; replaces system clipboard",
    );
    expect(result.stdout).toContain(
      "real-provider — Restricted task-bound paid/private recipes",
    );
  });

  it("finds relevant modes with literal case-insensitive AND terms", () => {
    const sync = discover("search", "SyNc", "import");
    expect(sync.status).toBe(0);
    expect(sync.stdout).toContain("synthetic-sync —");
    expect(sync.stdout).not.toContain("tables —");
    expect(discover("search", "  settings   keyless  ").stdout).toBe(
      discover("search", "settings", "keyless").stdout,
    );
    expect(discover("search", "onboarding", "blank").stdout).toContain(
      "history-setup —",
    );
    expect(discover("search", "chat", "authored").stdout).toContain("chat —");
    expect(discover("search", "paid").stdout).toContain(
      "real-provider — Restricted",
    );
  });

  it("shows limits, refusal and effects rather than granting scenario authority", () => {
    expect(discover("show", "synthetic-sync").stdout).toContain(
      "No private tokens, Garmin or provider",
    );
    expect(discover("show", "history-setup").stdout).toContain(
      "unavailable and refuse before private input access",
    );
    expect(discover("show", "summary-native-copy").stdout).toContain(
      "never reads/restores previous contents",
    );
    expect(discover("show", "real-provider").stdout).toContain(
      "not new-task consent",
    );
  });

  it.each(["no-such-scenario", ".*", "$(touch discovery-must-not-execute)"])(
    "treats an unmatched query literally: %s",
    (query) => {
      const result = discover("search", query);
      expect(result.status).toBe(1);
      expect(result.stdout).toContain("No matching smoke commands");
      expect(result.stderr).toBe("");
    },
  );

  it.each([
    ["run", "synthetic-sync"],
    ["list", "extra"],
    ["show"],
    ["show", "synthetic-sync", "extra"],
    ["show", "../package.json"],
    ["search"],
    ["search", " "],
    ["search", "sync", ""],
    ["--help", "extra"],
  ])("refuses invalid commands/arguments: %j", (...args) => {
    const result = discover(...args);
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(
      /Invalid discovery command|Unknown smoke entry/,
    );
    expect(result.stdout).toBe("");
  });
});
