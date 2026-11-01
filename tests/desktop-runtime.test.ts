import { afterEach, describe, expect, it, vi } from "vitest";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import Database from "better-sqlite3";
import {
  desktopNextConfiguration,
  resolveExecutable,
} from "../scripts/desktop/config";
import { acceptsDesktopRequest } from "../scripts/desktop/http-policy";
import { assertDesktopDatabase } from "../src/lib/db/desktop-preflight";
import { acquireDatabaseWriter } from "../src/lib/db/writer-ownership";
import { migrateDatabase } from "../src/lib/db/migrations";

const directories: string[] = [];
const releases: Array<() => void> = [];
function directory(): string {
  const path = realpathSync(mkdtempSync(join(tmpdir(), "trainer-desktop-")));
  directories.push(path);
  return path;
}
afterEach(() => {
  for (const release of releases.splice(0)) release();
  for (const path of directories.splice(0))
    rmSync(path, { recursive: true, force: true });
});

describe("desktop reference boundary", () => {
  it("keeps production route/image caches out of immutable resources", () => {
    const original = {
      experimental: { isrFlushToDisk: true },
      images: { unoptimized: false },
    };
    const result = desktopNextConfiguration(original);
    expect(result.experimental?.isrFlushToDisk).toBe(false);
    expect(result.images?.unoptimized).toBe(true);
    expect(result.cacheMaxMemorySize).toBe(50 * 1024 * 1024);
    expect(original.experimental.isrFlushToDisk).toBe(true);
    expect(original.images.unoptimized).toBe(false);
  });
  it.each([false, true])(
    "applies immutable desktop config through the actual router loader (initial env captured: %s)",
    (captured) => {
      const base = directory();
      const script = `
      const {join}=require('node:path');
      const {configureDesktopNext}=require(join(process.cwd(),'scripts/desktop/config.ts'));
      const {loadEnvConfig}=require('@next/env');
      const loadConfig=require('next/dist/server/config').default;
      const {PHASE_PRODUCTION_SERVER}=require('next/constants');
      (async()=>{
        const captured=process.argv[2]==='true';
        if(captured) loadEnvConfig(process.argv[1],false,{info(){},error(){}},true);
        process.env.OPENAI_API_KEY='T0235-synthetic-private-overlay';
        configureDesktopNext({experimental:{isrFlushToDisk:true},images:{unoptimized:false}});
        if(captured){
          delete process.env.__NEXT_PRIVATE_STANDALONE_CONFIG;
          loadEnvConfig(process.argv[1],false,{info(){},error(){}},true);
        }
        // NextCustomServer's router loads config WITHOUT the direct conf option.
        const config=await loadConfig(PHASE_PRODUCTION_SERVER,process.argv[1],{silent:true});
        console.log(JSON.stringify({diskFlush:config.experimental.isrFlushToDisk,unoptimized:config.images.unoptimized,memoryBytes:config.cacheMaxMemorySize,overlayRetained:process.env.OPENAI_API_KEY==='T0235-synthetic-private-overlay',noProviderInConfig:!process.env.__NEXT_PRIVATE_STANDALONE_CONFIG.includes('T0235-synthetic-private-overlay')}));
      })().catch(()=>{console.error('Desktop config loader regression failed');process.exit(1)});
    `;
      const result = execFileSync(
        process.execPath,
        ["--import", "tsx", "-e", script, base, String(captured)],
        {
          cwd: process.cwd(),
          encoding: "utf8",
          env: {
            PATH: process.env.PATH,
            HOME: process.env.HOME,
            NODE_ENV: "production",
          },
        },
      );
      expect(JSON.parse(result)).toEqual({
        diskFlush: false,
        unoptimized: true,
        memoryBytes: 50 * 1024 * 1024,
        overlayRetained: true,
        noProviderInConfig: true,
      });
    },
  );
  it("retains the absolute private overlay across Next environment resets", () => {
    const base = directory();
    const database = join(base, "populated.sqlite");
    writeFileSync(database, "test-only-path-validation");
    // Stray files are never adopted or imported by the desktop boundary.
    const stray = join(base, ".env.local");
    writeFileSync(
      stray,
      "DATABASE_PATH=/wrong/default.sqlite\nOPENAI_API_KEY=stray-secret\n",
      { mode: 0o600 },
    );
    const snapshot = JSON.stringify({
      version: 1,
      fields: {
        DATABASE_PATH: database,
        GARMIN_HISTORY_START_DATE: "2025-01-01",
        AI_PROVIDER: "openai",
      },
      secrets: { OPENAI_API_KEY: "sentinel-private-frame" },
    });
    const script = `
      const {join}=require('node:path');
      (()=>{
        const {adoptConfiguration}=require(join(process.cwd(),'scripts/desktop/config.ts'));
        const {loadEnvConfig}=require('@next/env');
        adoptConfiguration(JSON.parse(process.argv[1]));
        const expected=process.env.DATABASE_PATH;
        loadEnvConfig(process.cwd(),false,{info(){},error(){}},true);
        console.log(JSON.stringify({database:process.env.DATABASE_PATH===expected,desktop:process.env.TRAINER_DESKTOP,provider:process.env.AI_PROVIDER,secretPreserved:process.env.OPENAI_API_KEY==='sentinel-private-frame',pythonBytecode:process.env.PYTHONDONTWRITEBYTECODE}));
      })();
    `;
    const result = execFileSync(
      process.execPath,
      ["--import", "tsx", "-e", script, snapshot],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          NODE_ENV: "production",
        },
      },
    );
    expect(JSON.parse(result)).toEqual({
      database: true,
      desktop: "1",
      provider: "openai",
      secretPreserved: true,
      pythonBytecode: "1",
    });
  });
  it("never resolves relative commands, shell text or unavailable tools through inherited PATH", () => {
    expect(resolveExecutable("./uv")).toBeUndefined();
    expect(resolveExecutable("uv; echo unsafe")).toBeUndefined();
    expect(resolveExecutable("/unavailable-trainer-test/uv")).toBeUndefined();
  });
});

describe("desktop loopback policy", () => {
  const origin = "http://127.0.0.1:49152";
  it("allows the exact origin and native/CLI requests only on the owned host", () => {
    expect(acceptsDesktopRequest({ host: "127.0.0.1:49152" }, origin)).toBe(
      true,
    );
    expect(
      acceptsDesktopRequest(
        { host: "127.0.0.1:49152", origin, "sec-fetch-site": "same-origin" },
        origin,
      ),
    ).toBe(true);
  });
  it("refuses foreign/null origin, DNS rebinding and cross-site requests", () => {
    for (const headers of [
      { host: "evil.test:49152" },
      { host: "127.0.0.1:49152", origin: "http://localhost:49152" },
      { host: "127.0.0.1:49152", origin: "null" },
      { host: "127.0.0.1:49152", "sec-fetch-site": "cross-site" },
      { host: "127.0.0.1:49152", "sec-fetch-site": "same-site" },
    ])
      expect(acceptsDesktopRequest(headers, origin)).toBe(false);
  });
});

describe("desktop database admission", () => {
  it("refuses missing, empty, corrupt and unsupported-schema files without creating/upgrading them", () => {
    const path = join(directory(), "existing.sqlite");
    expect(() => assertDesktopDatabase(path)).toThrow();
    expect(existsSync(path)).toBe(false);
    writeFileSync(path, "");
    expect(() => assertDesktopDatabase(path)).toThrow();
    writeFileSync(path, "not sqlite");
    expect(() => assertDesktopDatabase(path)).toThrow();
    rmSync(path);
    const db = new Database(path);
    db.exec(
      "create table app_metadata(key text primary key,value text,updated_at integer);insert into app_metadata values('schema_version','999',0)",
    );
    db.close();
    const original = readFileSync(path);
    expect(() => assertDesktopDatabase(path)).toThrow(/schema/);
    expect(readFileSync(path)).toEqual(original);
  });
  it("accepts a current-schema populated copy without changing bytes; refuses aliases", () => {
    const path = join(directory(), "copy.sqlite");
    const db = new Database(path);
    migrateDatabase(db);
    db.prepare(
      "insert into conversation(id,title,created_at,updated_at) values (?,?,?,?)",
    ).run("test-only", "Desktop admission", 1, 1);
    db.close();
    const original = readFileSync(path);
    expect(() => assertDesktopDatabase(path)).not.toThrow();
    expect(readFileSync(path)).toEqual(original);
    const alias = `${path}.alias`;
    symlinkSync(path, alias);
    expect(() => assertDesktopDatabase(alias)).toThrow();
  });
  it("never steals a stale/unknown lease or follows its alias", () => {
    const path = join(directory(), "copy.sqlite");
    const lease = `${path}.trainer-writer`;
    writeFileSync(lease, "unknown owner", { mode: 0o600 });
    expect(() => acquireDatabaseWriter(path)).toThrow(/lease/);
    expect(readFileSync(lease, "utf8")).toBe("unknown owner");
  });
  it("shares canonical source ownership across parent aliases and module reloads without extra exit listeners", async () => {
    const root = directory();
    const actual = join(root, "source.sqlite");
    const alias = join(root, "directory-alias");
    symlinkSync(root, alias);
    const release = acquireDatabaseWriter(join(alias, "source.sqlite"));
    releases.push(release);
    const listeners = process.listenerCount("exit");
    vi.resetModules();
    const fresh = await import("../src/lib/db/writer-ownership");
    expect(() => fresh.acquireDatabaseWriter(actual)).not.toThrow();
    expect(process.listenerCount("exit")).toBe(listeners);
    expect(existsSync(`${actual}.trainer-writer`)).toBe(true);
  });
  it("releases only its exact owned lease", () => {
    const path = join(directory(), "new.sqlite");
    const release = acquireDatabaseWriter(path);
    releases.push(release);
    expect(existsSync(`${path}.trainer-writer`)).toBe(true);
    release();
    expect(existsSync(`${path}.trainer-writer`)).toBe(false);
  });
});
