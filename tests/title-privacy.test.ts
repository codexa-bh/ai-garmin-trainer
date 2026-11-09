import { expect, it } from "vitest";
import { titleSource } from "@/lib/chat/title-privacy";
import { minimizeSummarySource } from "@/lib/memory/summary-policy";
it("preserves legacy title-only pre-call refusals, including the weekly-review limitation", () => {
  for (const text of [
    "Don't save my weekly review; weekends suit me because of childcare",
    "Do not remember this",
    "Do not store this in memory",
  ]) {
    expect(titleSource(text)).toBeNull();
    expect(
      minimizeSummarySource({
        eventSeq: 1,
        admissionSeq: 1,
        version: 1,
        sourceId: "authored",
        eligible: true,
        user: text,
        referent: null,
      })?.user,
    ).toBe(text);
  }
  for (const text of [
    "Don't save this week's plan",
    'Quoted: "Do not remember this"',
  ])
    expect(titleSource(text)).toBe(text);
  expect(titleSource("  A\r\nB  ")).toBe("A\nB");
  expect(titleSource(" ")).toBeNull();
  expect(() => titleSource("bad\ud800")).toThrow("summary_invalid_unicode");
});
