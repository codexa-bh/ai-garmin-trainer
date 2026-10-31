import * as fs from "node:fs";
vi.mock("node:fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:fs")>()),
}));
import { execFileSync, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getOptionalEnv } from "../src/lib/env";
import { authCommand, runAuth } from "../src/lib/garmin/auth-command";
import {
  garminTokenEnvironment,
  inspectTokenLocation,
  prepareAuthDirectory,
  resolveTokenLocation,
} from "../src/lib/garmin/token-location";
import {
  GARMIN_MCP_PACKAGE_URL,
  GARMIN_MCP_SDK_REQUIREMENT,
} from "../src/lib/garmin/mcp-config";

const roots: string[] = [];
function directory() {
  const dir = fs.mkdtempSync(join(tmpdir(), "token path canary "));
  roots.push(dir);
  return dir;
}
afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of roots.splice(0))
    fs.rmSync(dir, { recursive: true, force: true });
});

describe("one explicit Garmin token location", () => {
  it("does not default env, and rejects missing, blank and unsupported path forms", () => {
    expect(getOptionalEnv({}).GARMIN_MCP_TOKEN_DIR).toBeUndefined();
    for (const value of [
      undefined,
      "",
      " ",
      "~/token",
      "${HOME}/token",
      "file:/token",
      "a\0b",
    ]) {
      expect(() => resolveTokenLocation(value)).toThrow();
      expect(inspectTokenLocation(value).ok).toBe(false);
    }
  });
  it("resolves relative paths against the selected checkout and absolute paths across worktrees", () => {
    expect(resolveTokenLocation("./.garmin-token", "/primary").directory).toBe(
      "/primary/.garmin-token",
    );
    expect(resolveTokenLocation("./.garmin-token", "/worktree").directory).toBe(
      "/worktree/.garmin-token",
    );
    expect(
      resolveTokenLocation("/durable/token path", "/worktree").directory,
    ).toBe("/durable/token path");
  });
  it("overrides alternate token stores, strips password inputs and forces stdio without mutating input", () => {
    const input = {
      ...process.env,
      GARMIN_MCP_TOKEN_DIR: "./token path",
      GARMINTOKENS: "secret canary",
      GARMINTOKENS_BASE64: "elsewhere",
      GARMIN_EMAIL: "secret",
      GARMIN_PASSWORD: "secret",
      GARMIN_EMAIL_FILE: "secret",
      GARMIN_PASSWORD_FILE: "secret",
      OPENAI_API_KEY: "sentinel-provider-key",
      DEEPSEEK_API_KEY: "sentinel-provider-key",
      OPENROUTER_API_KEY: "sentinel-provider-key",
      GARMIN_MCP_TRANSPORT: "sse",
    };
    const env = garminTokenEnvironment(input);
    expect(env.GARMINTOKENS).toBe(resolve("token path"));
    expect(env.GARMINTOKENS_BASE64).toBe(
      join(env.GARMINTOKENS!, "garmin_tokens.base64"),
    );
    expect(env.GARMIN_MCP_TOKEN_DIR).toBe(env.GARMINTOKENS);
    expect(env.GARMIN_MCP_TRANSPORT).toBe("stdio");
    for (const key of [
      "GARMIN_EMAIL",
      "GARMIN_PASSWORD",
      "GARMIN_EMAIL_FILE",
      "GARMIN_PASSWORD_FILE",
      "OPENAI_API_KEY",
      "DEEPSEEK_API_KEY",
      "OPENROUTER_API_KEY",
    ])
      expect(env[key]).toBeUndefined();
    expect(input.GARMINTOKENS).toBe("secret canary");
    expect(() =>
      garminTokenEnvironment({
        ...process.env,
        GARMIN_MCP_TOKEN_DIR: undefined,
        GARMINTOKENS: directory(),
        HOME: directory(),
      }),
    ).toThrow();
  });
  it("checks expected regular file metadata only, never unrelated files or secret contents", () => {
    const dir = directory();
    const file = join(dir, "garmin_tokens.json");
    expect(inspectTokenLocation(join(dir, "missing")).className).toBe(
      "garmin.auth_directory_missing",
    );
    fs.writeFileSync(join(dir, "state.json"), "token secret canary");
    expect(inspectTokenLocation(dir).className).toBe(
      "garmin.auth_file_missing",
    );
    fs.mkdirSync(file);
    expect(inspectTokenLocation(dir).className).toBe(
      "garmin.auth_file_wrong_type",
    );
    fs.rmdirSync(file);
    fs.writeFileSync(file, "");
    expect(inspectTokenLocation(dir).className).toBe("garmin.auth_file_empty");
    fs.writeFileSync(file, "not parsed: token secret canary");
    const read = vi.spyOn(fs, "readFileSync");
    const result = inspectTokenLocation(dir);
    expect(result.ok).toBe(true);
    expect(result.detail).toContain("does not establish");
    expect(read).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain(dir);
    expect(JSON.stringify(result)).not.toContain("token secret canary");
    expect(inspectTokenLocation(file).className).toBe(
      "garmin.auth_directory_wrong_type",
    );
  });
  it("returns safe inaccessible metadata errors and rejects symlink files/directories", () => {
    const dir = directory();
    const target = directory();
    fs.writeFileSync(join(target, "garmin_tokens.json"), "secret");
    fs.symlinkSync(
      join(target, "garmin_tokens.json"),
      join(dir, "garmin_tokens.json"),
    );
    expect(inspectTokenLocation(dir).ok).toBe(false);
    fs.symlinkSync(target, join(dir, "link"));
    expect(inspectTokenLocation(join(dir, "link")).ok).toBe(false);
    vi.spyOn(fs, "lstatSync").mockImplementation(() => {
      throw Object.assign(new Error("raw path secret canary"), {
        code: "EACCES",
      });
    });
    expect(inspectTokenLocation(dir).className).toBe(
      "garmin.auth_state_inaccessible",
    );
    expect(JSON.stringify(inspectTokenLocation(dir))).not.toContain("canary");
  });
  it("pins env-aware auth and rejects overrides, unattended prompts, overwrite and symlinks", () => {
    const dir = directory();
    const env = {
      ...process.env,
      GARMIN_MCP_TOKEN_DIR: dir,
      GARMINTOKENS: "other",
    };
    const command = authCommand(env, []);
    expect(command.args).toEqual([
      "--from",
      GARMIN_MCP_PACKAGE_URL,
      "--with",
      GARMIN_MCP_SDK_REQUIREMENT,
      "garmin-mcp-auth",
    ]);
    expect(command.env).toEqual(garminTokenEnvironment(env));
    expect(() => authCommand(env, ["--token-path", "other"])).toThrow(
      "no overrides",
    );
    expect(() => runAuth(env, [], false)).toThrow("operator-only");
    prepareAuthDirectory(resolveTokenLocation(dir));
    fs.writeFileSync(join(dir, "garmin_tokens.json"), "preserve");
    expect(() => prepareAuthDirectory(resolveTokenLocation(dir))).toThrow(
      "existing credentials",
    );
    expect(fs.readFileSync(join(dir, "garmin_tokens.json"), "utf8")).toBe(
      "preserve",
    );
    const empty = directory();
    fs.symlinkSync(dir, join(empty, "link"));
    expect(() => prepareAuthDirectory(resolveTokenLocation(empty))).toThrow();
  });
  it("auth entry point loads local env from the invocation checkout and refuses unattended login", () => {
    const cwd = directory();
    fs.writeFileSync(
      join(cwd, ".env.local"),
      `GARMIN_MCP_TOKEN_DIR=${join(cwd, "new token path")}\n`,
    );
    const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: "production" };
    delete env.GARMIN_MCP_TOKEN_DIR;
    delete env.__NEXT_PROCESSED_ENV;
    const result = spawnSync(
      process.execPath,
      [
        resolve("node_modules/tsx/dist/cli.mjs"),
        resolve("scripts/garmin-auth.ts"),
      ],
      { cwd, env, encoding: "utf8" },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("operator-only");
    expect(result.stderr).not.toContain(cwd);
  });

  it("Python consumers require the resolved setting and never use inherited alternate stores", () => {
    const dir = directory();
    fs.writeFileSync(join(dir, "garmin_tokens.json"), "fixture");
    const script =
      "from garmin_token_location import tokenstore\ntry:\n print(tokenstore())\nexcept ValueError:\n print('rejected')";
    const env = {
      ...process.env,
      PYTHONPATH: resolve("scripts"),
      PYTHONDONTWRITEBYTECODE: "1",
      GARMINTOKENS: dir,
      HOME: dir,
      GARMIN_MCP_TOKEN_DIR: "",
    };
    const probe = (value: string) =>
      execFileSync("python3", ["-c", script], {
        env: { ...env, GARMIN_MCP_TOKEN_DIR: value },
        encoding: "utf8",
      }).trim();
    expect(probe("")).toBe("rejected");
    expect(probe("relative")).toBe("rejected");
    expect(probe(join(dir, "missing"))).toBe("rejected");
    expect(probe(dir)).toBe(dir);
    for (const name of [
      "speed_stream",
      "distance_stream",
      "altitude_stream",
      "baseline",
    ]) {
      const source = fs.readFileSync(
        resolve(`scripts/garmin_fit_${name}.py`),
        "utf8",
      );
      expect(source).toContain("from garmin_token_location import tokenstore");
      expect(source).toContain("garmin.login(tokenstore())");
      expect(source).not.toContain("~/.garminconnect");
    }
  });
});
