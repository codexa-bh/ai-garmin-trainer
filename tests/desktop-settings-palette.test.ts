import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const settings = readFileSync("src-tauri/ui/setup.css", "utf8");
const main = readFileSync("src/app/style.css", "utf8");

function declarations(sheet: string, selector: string) {
  const body = sheet.slice(
    sheet.indexOf(`${selector} {`) + selector.length + 2,
  );
  return body.slice(0, body.indexOf("}")).trim();
}

function tokens(sheet: string) {
  return Object.fromEntries(
    [...declarations(sheet, ":root").matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(
      ([, name, value]) => [name, value],
    ),
  );
}

describe("independent native Settings palette", () => {
  it("uses the current main app palette without importing its layout or backend", () => {
    const palette = tokens(settings);
    expect(Object.keys(palette)).toEqual([
      "--canvas",
      "--panel-strong",
      "--overlay",
      "--line",
      "--line-strong",
      "--text",
      "--muted",
      "--accent",
      "--accent-ink",
      "--focus",
    ]);
    for (const [name, value] of Object.entries(palette)) {
      expect(value, name).toBe(tokens(main)[name]);
    }
    expect(settings).not.toMatch(/@import|url\(|color-scheme/);
    const rules = settings.slice(settings.indexOf("body {"));
    expect(rules).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
    for (const [, token] of rules.matchAll(/var\((--[\w-]+)\)/g)) {
      expect(palette).toHaveProperty(token);
    }
  });

  it("maps controls, subtle dividers, feedback and the restart dialog by role", () => {
    const roles = [
      ["body", "background: var(--canvas)"],
      ["body", "color: var(--text)"],
      ["h2", "color: var(--muted)"],
      ["button", "background: var(--accent)"],
      ["button", "color: var(--accent-ink)"],
      ["#auth-status", "color: var(--focus)"],
      ["section", "border: 1px solid var(--line)"],
      ["select", "background: var(--panel-strong)"],
      ["select", "border: 1px solid var(--line-strong)"],
      ["select", "accent-color: var(--accent)"],
      ["label span", "color: var(--muted)"],
      [".helper", "color: var(--muted)"],
      ["#garmin-privacy", "border-top: 1px solid var(--line)"],
      ["#memory-section details", "border-top: 1px solid var(--line)"],
      ['.catalog-row [aria-pressed="true"]', "background: var(--focus)"],
      [".catalog-error", "color: var(--focus)"],
      [".provider-key input::placeholder", "color: var(--muted)"],
      ["#restart-required", "background: var(--panel-strong)"],
      ["#restart-required", "color: var(--text)"],
      ["#restart-required", "border: 1px solid var(--line-strong)"],
      ["#restart-required::backdrop", "background: var(--overlay)"],
      [":focus-visible", "outline: 3px solid var(--focus)"],
    ];
    for (const [selector, declaration] of roles) {
      expect(declarations(settings, selector), selector).toContain(declaration);
    }
  });

  it("retains control, responsive, disabled and modal geometry", () => {
    for (const [selector, declaration] of [
      ["body", "17px/1.5 system-ui"],
      ["main", "max-width: 820px"],
      ["button", "padding: 12px 18px"],
      ["button:disabled", "opacity: 0.5"],
      ["select", "padding: 8px"],
      ["select", "border-radius: 5px"],
      [".history-mode input", "width: 18px"],
      [".history-mode input", "height: 18px"],
      ["#restart-required", "width: min(440px, calc(100% - 32px))"],
      ["#restart-required", "padding: 24px"],
      ["#restart-required", "border-radius: 12px"],
      ["[hidden]", "display: none !important"],
      [":focus-visible", "outline-offset: 3px"],
    ]) {
      expect(declarations(settings, selector), selector).toContain(declaration);
    }
    expect(settings).toContain("@media (max-width: 720px)");
    expect(settings).toContain("@media (max-width: 440px)");
  });
});
