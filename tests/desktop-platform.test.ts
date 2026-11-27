import { afterEach, describe, expect, it, vi } from "vitest";
import {
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { activateConfiguration } from "./desktop-configuration-fixture";
import { isCanonicalLocalPath } from "../src/lib/db/local-path";
import { acquireDatabaseWriter } from "../src/lib/db/writer-ownership";

const windows = process.platform === "win32";
const directories: string[] = [];
const releases: Array<() => void> = [];
function directory(): string {
  const path = realpathSync.native(
    mkdtempSync(join(tmpdir(), "trainer-platform-")),
  );
  directories.push(path);
  return path;
}
afterEach(() => {
  for (const release of releases.splice(0)) release();
  for (const path of directories.splice(0))
    rmSync(path, { recursive: true, force: true });
});

describe("desktop local path form", () => {
  it("accepts only local drive-letter Windows spellings before canonical filesystem resolution", () => {
    const canonical = vi.spyOn(realpathSync, "native");
    try {
      for (const ok of [
        "C:\\",
        "C:\\Users\\Ana Lopez\\AppData\\Roaming\\trainer.sqlite",
        "D:\\Données\\训练\\trainer.sqlite",
      ]) {
        canonical.mockReturnValue(ok);
        expect(isCanonicalLocalPath(ok, "win32"), ok).toBe(true);
      }
      for (const bad of [
        "\\\\server\\share\\trainer.sqlite",
        "\\\\?\\C:\\trainer.sqlite",
        "\\\\.\\C:\\trainer.sqlite",
        "C:trainer.sqlite",
        "C:/Users/trainer.sqlite",
        "C:\\Users\\..\\trainer.sqlite",
        "C:\\Users\\.\\trainer.sqlite",
        "C:\\Users\\\\trainer.sqlite",
        "C:\\trainer.sqlite:secret",
        "C:\\NUL",
        "C:\\com1.txt",
        "C:\\Lpt9",
        "C:\\trailing.",
        "C:\\trailing ",
        "C:\\a?b",
        "/Users/trainer.sqlite",
      ]) {
        canonical.mockClear();
        expect(isCanonicalLocalPath(bad, "win32"), bad).toBe(false);
        expect(canonical).not.toHaveBeenCalled();
      }
    } finally {
      canonical.mockRestore();
    }
  });
  it("requires the exact existing canonical spelling on the host", () => {
    const root = directory();
    const file = join(root, "Trainer Ü.sqlite");
    writeFileSync(file, "x");
    expect(isCanonicalLocalPath(file)).toBe(true);
    expect(isCanonicalLocalPath(join(root, "missing.sqlite"))).toBe(false);
    expect(isCanonicalLocalPath("relative.sqlite")).toBe(false);
    if (windows) {
      // Case aliases resolve to one final path and are not the canonical spelling.
      expect(isCanonicalLocalPath(file.toUpperCase())).toBe(false);
      expect(isCanonicalLocalPath(file.replaceAll("\\", "/"))).toBe(false);
    }
  });
});

describe("desktop Garmin activation", () => {
  it("installs the key as a process capability, never environment, and searches no tool paths", () => {
    const root = directory();
    const database = join(root, "test.sqlite");
    writeFileSync(database, "authored-path");
    const key = "synthetic-garmin-key-0001";
    const active = activateConfiguration(
      { DATABASE_PATH: database },
      { garminKey: key },
    );
    expect(active.garmin).toBe(true);
    expect(active.envText).not.toContain(key);
    // Only the new non-secret startup switch is added; credentials/tool
    // configuration remain absent, not a generic GARMIN_* exemption.
    expect(active.env).toEqual(["GARMIN_AUTO_SYNC"]);
    expect(JSON.parse(active.envText).GARMIN_AUTO_SYNC).toBe("true");
    // Fixed system directories only; no Homebrew/user tool search for Garmin.
    if (!windows) expect(active.path).toBe("/usr/bin:/bin");
    expect(activateConfiguration({ DATABASE_PATH: database }).garmin).toBe(
      false,
    );
  });
  it("admits only a closed loopback fixture beside the key and refuses any other shape", () => {
    const root = directory();
    const database = join(root, "test.sqlite");
    writeFileSync(database, "authored-path");
    const garminFixture = {
      origin: "http://127.0.0.1:40000",
      capability: "f".repeat(64),
    };
    const active = activateConfiguration(
      { DATABASE_PATH: database },
      { garminKey: "synthetic-garmin-key-0001", garminFixture },
    );
    expect(active.garmin).toBe(true);
    expect(active.envText).not.toContain(garminFixture.capability);
    for (const bad of [
      { ...garminFixture, origin: "https://personal.connectapi.garmin.com" },
      { ...garminFixture, origin: "http://192.168.1.2:40000" },
      { ...garminFixture, capability: "short" },
      { ...garminFixture, extra: true },
    ])
      expect(() =>
        activateConfiguration(
          { DATABASE_PATH: database },
          { garminKey: "synthetic-garmin-key-0001", garminFixture: bad },
        ),
      ).toThrow();
  });
  it("refuses retired connector fields and malformed keys instead of selecting a fallback", () => {
    const root = directory();
    const database = join(root, "test.sqlite");
    writeFileSync(database, "authored-path");
    for (const field of ["GARMIN_MCP_COMMAND", "GARMIN_MCP_TOKEN_DIR"])
      expect(() =>
        activateConfiguration({ DATABASE_PATH: database, [field]: "/x" }),
      ).toThrow();
    for (const garminKey of ["short", "has space key", "x".repeat(4097), 7])
      expect(() =>
        activateConfiguration({ DATABASE_PATH: database }, { garminKey }),
      ).toThrow();
  });
});

describe.runIf(windows)("Windows private creation", () => {
  it("never relies on a umask for backend descendants", () => {
    const source = readFileSync("scripts/desktop/config.ts", "utf8");
    expect(source).toContain(
      'if (process.platform !== "win32") process.umask(0o077);',
    );
  });
});

describe.runIf(windows)("Windows database writer admission", () => {
  it("refuses while another process holds the database open and never steals", async () => {
    const path = join(directory(), "held.sqlite");
    const db = new Database(path);
    db.exec("create table t(x)");
    db.close();
    const original = readFileSync(path);
    // A separate synthetic process holds the file with ordinary sharing.
    const holder = spawn(
      process.execPath,
      [
        "-e",
        "const D=require('better-sqlite3');const d=new D(process.argv[1]);d.prepare('select 1').get();process.stdout.write('open');setInterval(()=>{},1000)",
        path,
      ],
      { cwd: process.cwd(), stdio: ["ignore", "pipe", "ignore"] },
    );
    await new Promise<void>((resolve) =>
      holder.stdout!.once("data", () => resolve()),
    );
    try {
      expect(() => acquireDatabaseWriter(path)).toThrow(/open elsewhere/);
      expect(() => readFileSync(`${path}.trainer-writer`)).toThrow();
      expect(readFileSync(path)).toEqual(original);
    } finally {
      holder.kill();
      await new Promise((resolve) => holder.once("exit", resolve));
    }
    const release = acquireDatabaseWriter(path);
    releases.push(release);
    // A case alias shares the same canonical lease.
    expect(() => acquireDatabaseWriter(path.toUpperCase())).not.toThrow();
    expect(readFileSync(`${path}.trainer-writer`, "utf8")).toContain('"pid"');
  });
});
