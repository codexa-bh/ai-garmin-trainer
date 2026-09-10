import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const source = fileURLToPath(new URL("../", import.meta.url));
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function checkout() {
  const root = mkdtempSync(join(tmpdir(), "next declarations "));
  roots.push(root);
  copyFileSync(join(source, "package.json"), join(root, "package.json"));
  copyFileSync(join(source, ".gitignore"), join(root, ".gitignore"));
  return root;
}

function git(root: string, args: string[]) {
  const result = spawnSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    timeout: 10_000,
  });
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
  return result.stdout.trim();
}

describe("generated Next.js declarations", () => {
  it.each(["success", "generation-fails", "compiler-fails"])(
    "runs the real npm typecheck script in order and fails closed: %s",
    (scenario) => {
      const root = checkout();
      const bin = join(root, "node_modules/.bin");
      mkdirSync(bin, { recursive: true });
      writeFileSync(
        join(bin, "next"),
        `#!/bin/sh
printf 'next %s\\n' "$*" >> calls
[ "$SCENARIO" != generation-fails ] || exit 23
printf 'generated\\n' > next-env.d.ts
`,
        { mode: 0o755 },
      );
      writeFileSync(
        join(bin, "tsc"),
        `#!/bin/sh
printf 'tsc %s\\n' "$*" >> calls
[ -f next-env.d.ts ] || exit 24
[ "$SCENARIO" != compiler-fails ] || exit 25
`,
        { mode: 0o755 },
      );
      expect(existsSync(join(root, "next-env.d.ts"))).toBe(false);
      const result = spawnSync("npm", ["run", "typecheck"], {
        cwd: root,
        encoding: "utf8",
        timeout: 15_000,
        env: { ...process.env, SCENARIO: scenario },
      });
      expect(result.error).toBeUndefined();
      expect(result.status, result.stdout + result.stderr).toBe(
        scenario === "success" ? 0 : scenario === "generation-fails" ? 23 : 25,
      );
      expect(readFileSync(join(root, "calls"), "utf8")).toBe(
        scenario === "generation-fails"
          ? "next typegen\n"
          : "next typegen\ntsc --noEmit\n",
      );
    },
  );

  it("keeps repeated generated mode changes out of Git without ignoring source declarations", () => {
    expect(git(source, ["ls-files", "--", "next-env.d.ts"])).toBe("");
    const root = checkout();
    git(root, ["init", "--quiet"]);
    git(root, ["add", "package.json", ".gitignore"]);
    const baseline = git(root, ["status", "--porcelain"]);
    for (const mode of ["types", "dev/types", "types", "dev/types"]) {
      mkdirSync(join(root, ".next", mode), { recursive: true });
      writeFileSync(join(root, ".next", mode, "routes.d.ts"), "export {};\n");
      writeFileSync(
        join(root, "next-env.d.ts"),
        `/// <reference types="next" />\n/// <reference types="next/image-types/global" />\nimport "./.next/${mode}/routes.d.ts";\n`,
      );
      expect(git(root, ["check-ignore", "next-env.d.ts"])).toBe(
        "next-env.d.ts",
      );
      expect(git(root, ["status", "--porcelain"])).toBe(baseline);
    }
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "src", "next-env.d.ts"), "export {};\n");
    expect(
      git(root, ["status", "--porcelain", "--untracked-files=all"]),
    ).toContain("?? src/next-env.d.ts");
  });
});
