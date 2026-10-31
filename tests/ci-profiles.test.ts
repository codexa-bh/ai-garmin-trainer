import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import manifest from "../package.json";

const read = (name: string) =>
  readFileSync(new URL(`../${name}`, import.meta.url), "utf8");

describe("economical CI profiles", () => {
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

  it("pins reviewed actions, locked installs and npm-download-only cache", () => {
    for (const name of ["ci.yml", "nightly-macos.yml"]) {
      const yaml = read(`.github/workflows/${name}`);
      const actions = [...yaml.matchAll(/uses: ([^\s]+)/g)].map(
        (match) => match[1],
      );
      expect(actions.length).toBeGreaterThan(0);
      for (const action of actions)
        expect(action).toMatch(/^actions\/(checkout|setup-node)@[0-9a-f]{40}$/);
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
