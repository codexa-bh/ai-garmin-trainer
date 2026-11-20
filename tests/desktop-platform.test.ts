import { afterEach, describe, expect, it, vi } from "vitest";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join, win32 } from "node:path";
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

describe("desktop executable resolution", () => {
  it("refuses relative, shell, script and non-executable selections", () => {
    const root = directory();
    const database = join(root, "test.sqlite");
    writeFileSync(database, "authored-path");
    for (const command of ["uv; echo unsafe", "../uv", "bin\\uv"])
      expect(() =>
        activateConfiguration({
          DATABASE_PATH: database,
          GARMIN_MCP_COMMAND: command,
        }),
      ).toThrow();
    for (const name of windows
      ? ["uv.cmd", "uv.bat", "uv.ps1"]
      : ["uv-script"]) {
      const script = join(root, name);
      writeFileSync(script, windows ? "@echo off" : "#!/bin/sh\n");
      if (!windows) chmodSync(script, 0o600);
      // Existing paths are valid configuration, but unsupported executables
      // must stay unavailable without preventing offline desktop startup.
      const resolved = activateConfiguration({
        DATABASE_PATH: database,
        GARMIN_MCP_COMMAND: script,
      });
      expect(resolved.available.uvx).toBe(false);
      expect(resolved.uvx).toBe(
        windows
          ? win32.join(
              process.env.SystemRoot ?? "C:\\Windows",
              "unavailable-trainer-tool",
              "uvx.exe",
            )
          : "/unavailable-trainer-tool/uvx",
      );
    }
  });
  it("uses only the fixed per-user Windows uv locations, never PATH", () => {
    const home = directory();
    const saved = process.env.USERPROFILE;
    try {
      process.env.USERPROFILE = windows ? home : "C:\\Users\\synthetic";
      const bin = join(home, ".local", "bin");
      mkdirSync(bin, { recursive: true });
      writeFileSync(join(bin, "uv.exe"), "synthetic");
      const database = join(home, "test.sqlite");
      writeFileSync(database, "authored-path");
      const resolved = activateConfiguration({ DATABASE_PATH: database });
      if (windows) expect(resolved.uv).toBe(join(bin, "uv.exe"));
      else expect(resolved.uv).not.toBe(join(bin, "uv.exe")); // Unix never searches the Windows user profile.
      expect(() =>
        activateConfiguration({
          DATABASE_PATH: database,
          GARMIN_MCP_COMMAND: "uv.cmd",
        }),
      ).toThrow();
    } finally {
      if (saved === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = saved;
    }
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
