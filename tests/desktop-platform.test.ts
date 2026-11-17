import { afterEach, describe, expect, it } from "vitest";
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
import { join } from "node:path";
import Database from "better-sqlite3";
import { resolveExecutable } from "../scripts/desktop/config";
import {
  isCanonicalLocalPath,
  windowsLocalForm,
} from "../src/lib/db/local-path";
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
  it("accepts only local drive-letter Windows spellings", () => {
    for (const ok of [
      "C:\\",
      "C:\\Users\\Ana Lopez\\AppData\\Roaming\\trainer.sqlite",
      "D:\\Données\\训练\\trainer.sqlite",
    ])
      expect(windowsLocalForm(ok), ok).toBe(true);
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
    ])
      expect(windowsLocalForm(bad), bad).toBe(false);
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
    expect(resolveExecutable("uv; echo unsafe")).toBeUndefined();
    expect(resolveExecutable("../uv")).toBeUndefined();
    expect(resolveExecutable("bin\\uv")).toBeUndefined();
    const script = join(root, windows ? "uv.cmd" : "uv-script");
    writeFileSync(script, windows ? "@echo off" : "#!/bin/sh\n");
    if (!windows) chmodSync(script, 0o600);
    expect(resolveExecutable(script)).toBeUndefined();
  });
  it("uses only the fixed per-user Windows uv locations, never PATH", () => {
    const home = directory();
    const saved = process.env.USERPROFILE;
    try {
      process.env.USERPROFILE = windows ? home : "C:\\Users\\synthetic";
      const bin = join(home, ".local", "bin");
      mkdirSync(bin, { recursive: true });
      writeFileSync(join(bin, "uv.exe"), "synthetic");
      const resolved = resolveExecutable("uv", "win32");
      if (windows) expect(resolved).toBe(join(bin, "uv.exe"));
      else expect(resolved).toBeUndefined(); // No drive root on this host.
      expect(resolveExecutable("uv.cmd", "win32")).toBeUndefined();
    } finally {
      if (saved === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = saved;
    }
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
