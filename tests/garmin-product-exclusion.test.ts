import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

/**
 * The official Personal API reader is the product's only Garmin path: no
 * connector, Python helper, external tool search or Garmin child process may
 * remain reachable from product source, packaging or activation.
 */
function files(root: string): string[] {
  return readdirSync(root).flatMap((name) => {
    const path = join(root, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}
const product = [
  ...files("src"),
  "scripts/desktop/runtime.ts",
  "scripts/desktop/config.ts",
  "scripts/desktop/settings.ts",
  "scripts/desktop/assemble.mjs",
  ...files("src-tauri/src"),
  "src-tauri/ui/setup.js",
  "src-tauri/ui/index.html",
];

/** Executable text only: comments and Rust unit-test modules are excluded. */
function code(path: string): string {
  let text = readFileSync(path, "utf8");
  if (path.endsWith(".rs")) text = text.split("#[cfg(test)]\nmod tests")[0];
  return text.replace(/\/\*[\s\S]*?\*\/|(^|[^:])\/\/.*$/gm, "$1");
}

it("keeps every retired connector, helper and external tool out of product source", () => {
  const forbidden =
    /garminconnect|Taxuspt|garmin_mcp\.git|mcp-client|GarminMcpClient|garmin_auth|garmin_fit_(?:baseline|speed|distance|altitude)|garmin_token_location|\buvx\b|UV_PYTHON|PYTHONDONTWRITEBYTECODE/;
  const offenders = product.filter((path) => forbidden.test(code(path)));
  expect(offenders).toEqual([]);
});

it("launches no child process from Garmin product code", () => {
  for (const path of files("src/lib/garmin"))
    expect(readFileSync(path, "utf8"), path).not.toMatch(
      /node:child_process|\bspawn\(|\bexecFile/,
    );
});

it("declares no Garmin connector dependency or terminal sign-in command", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
    dependencies: Record<string, string>;
    scripts: Record<string, string>;
  };
  expect(Object.keys(pkg.dependencies)).not.toContain("garminconnect");
  expect(pkg.dependencies["fit-file-parser"]).toBe("6.2.10");
  expect(pkg.scripts["garmin:auth"]).toBeUndefined();
  expect(
    readdirSync("scripts").filter((name) => /^garmin_.*\.py$/.test(name)),
  ).toEqual([]);
});
