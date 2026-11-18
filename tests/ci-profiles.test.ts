import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import manifest from "../package.json";

const normalizeNewlines = (text: string) => text.replace(/\r\n/g, "\n");
const read = (name: string) =>
  normalizeNewlines(
    readFileSync(new URL(`../${name}`, import.meta.url), "utf8"),
  );

describe("economical CI profiles", () => {
  it("reads LF and Windows CRLF checkout text with identical YAML semantics", () => {
    const yaml = "on:\n  workflow_dispatch:\npermissions:\n  contents: read\n";
    expect(normalizeNewlines(yaml.replace(/\n/g, "\r\n"))).toBe(yaml);
    expect(normalizeNewlines(yaml)).toBe(yaml);
  });

  it("preserves every blocking gate, fresh type generation and existing full semantics", () => {
    const fast =
      "npm run format && npm run lint && npm run architecture && npm run knip && npm run typecheck && npm run test";
    expect(manifest.scripts["validate:ci"]).toBe(fast);
    expect(manifest.scripts.validate).toBe(`${fast} && npm run build`);
    expect(manifest.scripts.typecheck).toBe("next typegen && tsc --noEmit");
    expect(manifest.scripts.test).toBe("vitest run && npm run smoke:test");
    expect(manifest.scripts["desktop:resources"]).toBe(
      "npm run build && npm run desktop:assemble",
    );
    expect(manifest.scripts["desktop:assemble"]).toBe(
      "node scripts/desktop/assemble.mjs",
    );
    expect(fast).not.toMatch(/build|desktop|coverage/);
  });

  it("retains routine Validate identity and no build/native allocation", () => {
    const ci = read(".github/workflows/ci.yml");
    expect(ci).toContain("name: Validate");
    expect(ci).toContain("run: npm run validate:ci");
    expect(ci).toContain("cancel-in-progress: true");
    expect(ci).toContain("runs-on: ubuntu-24.04");
    expect(ci.match(/branches: \[main\]/g)).toHaveLength(2);
    expect(ci).not.toMatch(
      /run: npm run validate\s*$|macos|cargo|desktop:|upload-artifact|actions\/cache@/m,
    );
  });

  it("binds main decision and downstream checkout to exactly the same source", () => {
    const nightly = read(".github/workflows/nightly-macos.yml");
    expect(nightly).toContain('cron: "17 2 * * *"');
    expect(nightly).toContain("github.ref == 'refs/heads/main'");
    expect(nightly).toContain("needs.change-gate.outputs.should_run == 'true'");
    expect(nightly).toContain(
      "ref: ${{ needs.change-gate.outputs.source_sha }}",
    );
    expect(nightly).toContain(
      'test "$(git rev-parse HEAD)" = "$TESTED_SOURCE"',
    );
    expect(nightly).toContain('test "$(uname -m)" = arm64');
    expect(nightly).toContain("runs-on: macos-15");
    expect(nightly).toContain("cancel-in-progress: false");
    expect(nightly).toContain("run: CI=true npm run validate");
    expect(nightly).toContain("npm run desktop:assemble");
    expect(nightly).toContain("npm run desktop:test:native");
    expect(nightly).toContain(
      'npm run smoke:quick -- --scratch "$CI_SMOKE_SCRATCH" --resources-ready',
    );
    expect(nightly).not.toMatch(
      /desktop:resources|desktop:build|smoke:native|smoke:release|upload-artifact|actions\/cache@/,
    );
    expect(nightly.match(/actions: read/g)).toHaveLength(1);
  });

  it("runs Windows only on explicit selected-ref dispatch and binds checkout to its immutable SHA", () => {
    const windows = read(".github/workflows/windows.yml");
    const events = windows.split("on:\n")[1]?.split("\npermissions:")[0];
    expect(
      [...(events ?? "").matchAll(/^ {2}([a-z_]+):/gm)].map(
        (match) => match[1],
      ),
    ).toEqual(["workflow_dispatch"]);
    expect(events).toContain("release_export:");
    expect(events).toContain("type: boolean\n        default: false");
    expect(windows).not.toMatch(
      /pull_request|workflow_call|schedule:|\n {2}push:/,
    );
    expect(windows).toContain("TESTED_SOURCE: ${{ github.sha }}");
    expect(windows).toContain("ref: ${{ env.TESTED_SOURCE }}");
    expect(windows).toContain(
      "if ((git rev-parse HEAD) -ne $env:TESTED_SOURCE)",
    );
    expect(windows).toContain(
      "Source: $env:TESTED_SOURCE; run: $env:GITHUB_RUN_ID",
    );
  });

  it("retains exact-source Windows x64 build checks and only finite synthetic-image uploads", () => {
    const windows = read(".github/workflows/windows.yml");
    expect(windows).toContain("runs-on: windows-2025");
    expect(windows).toContain("name: Windows x64 build foundation");
    expect(windows).toContain("TESTED_SOURCE: ${{ github.sha }}");
    expect(windows).toContain(
      "throw 'Checked-out source differs from tested source'",
    );
    expect(windows).toContain("npm run desktop:build");
    expect(windows).toContain("--platform windows-x64");
    expect(windows).toContain("cargo test --locked");
    expect(windows).toContain("Windows Server, not Windows 11");
    expect(windows).toMatch(/timeout-minutes: \d+/);
    expect(windows).not.toMatch(
      /actions\/cache@|secrets\.|write-all|contents: write|pull_request_target|Start-Process[^\n]*setup\.exe/,
    );
    expect(windows).toContain("npm run smoke:windows -- --producer");
    expect(windows).toContain("retention-days: 3");
    expect(windows).toContain("if-no-files-found: error");
    const upload = windows
      .split("      - name: Upload only validated synthetic masked evidence")[1]
      ?.split("      - name:")[0];
    expect(upload).not.toMatch(
      /always\(\)|\*|\.sqlite|\.log|\.exe|include-hidden-files: true/,
    );
    const paths = [
      ...(upload ?? "").matchAll(/outputs\.evidence\s*\}\}\/([^\n]+)/g),
    ].map((match) => match[1]);
    expect(paths.sort()).toEqual([
      "manifest.json",
      "profile-narrow.png",
      "profile-wide.png",
      "sync-narrow.png",
      "sync-wide.png",
      "trainer-narrow.png",
      "trainer-wide.png",
    ]);
    // The Ubuntu Validate identity and macOS nightly stay unchanged.
    expect(read(".github/workflows/ci.yml")).not.toContain("windows");
    expect(read(".github/workflows/nightly-macos.yml")).not.toContain(
      "upload-artifact",
    );
  });

  it("keeps exact candidate export separate, explicit, success-only and bounded", () => {
    const windows = read(".github/workflows/windows.yml");
    const select = windows
      .split(
        "      - name: Select exact qualified public-safe Windows release files",
      )[1]
      ?.split("      - name:")[0];
    const upload = windows
      .split(
        "      - name: Upload only the selected Windows release triple and receipt",
      )[1]
      ?.split("      - name:")[0];
    expect(select).toContain("if: ${{ inputs.release_export }}");
    expect(select).toContain("windows_release_export.py export --record");
    expect(select).toContain("--images $env:WINDOWS_IMAGES");
    expect(upload).toContain("if: ${{ inputs.release_export }}");
    expect(upload).toContain("retention-days: 3");
    expect(upload).toContain(
      "windows-release-${{ github.run_id }}-${{ github.run_attempt }}-${{ env.TESTED_SOURCE }}",
    );
    expect(upload).not.toMatch(
      /always\(\)|\*|\.sqlite|\.log|include-hidden-files: true/,
    );
    expect(upload?.match(/outputs\.directory\s*\}\}\//g)).toHaveLength(4);
    expect(upload).toContain("/release-windows-x64.json");
    expect(upload).toContain("/windows-release-export.json");
    expect(windows).toContain("timeout-minutes: 60");
    expect(windows.indexOf("id: export")).toBeGreaterThan(
      windows.indexOf("id: installed"),
    );
  });

  it("pins reviewed actions, locked installs and npm-download-only cache", () => {
    for (const name of ["ci.yml", "nightly-macos.yml", "windows.yml"]) {
      const yaml = read(`.github/workflows/${name}`);
      const actions = [...yaml.matchAll(/uses: ([^\s]+)/g)].map(
        (match) => match[1],
      );
      expect(actions.length).toBeGreaterThan(0);
      for (const action of actions)
        expect(action).toMatch(
          /^actions\/(checkout|setup-node|setup-python|upload-artifact)@[0-9a-f]{40}$/,
        );
      expect(yaml).toContain("contents: read");
      expect(yaml).toContain("persist-credentials: false");
      expect(yaml).toContain("npm ci --no-fund");
      expect(yaml).toContain("cache-dependency-path: package-lock.json");
      expect(yaml).not.toMatch(
        /secrets\.|write-all|contents: write|pull_request_target/,
      );
    }
  });
});
