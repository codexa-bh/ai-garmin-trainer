/** @vitest-environment jsdom */
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { AssistantContent } from "../src/app/dashboard/markdown";

afterEach(cleanup);

function lists(content: string) {
  cleanup();
  render(<AssistantContent content={content} />);
  return screen.queryAllByRole("list").map((list) => ({
    tag: list.tagName,
    start: list.getAttribute("start"),
    items: within(list)
      .getAllByRole("listitem")
      .map((item) => item.textContent),
  }));
}

it("joins blank-line-separated items into one numbered list", () => {
  const result = lists(
    [
      "Your four hypotheses",
      "",
      "1. **Sleep debt** - short nights",
      "",
      "2. **Load spike** - volume jumped",
      "",
      "3. **Fueling** - low intake",
      "",
      "",
      "4. **Stress** - work travel",
    ].join("\n"),
  );
  expect(result).toHaveLength(1);
  expect(result[0].tag).toBe("OL");
  expect(result[0].start).toBeNull();
  expect(result[0].items).toHaveLength(4);
});

it("keeps tight lists as one list", () => {
  expect(lists("- a\n- b\n* c")).toEqual([
    { tag: "UL", start: null, items: ["a", "b", "c"] },
  ]);
});

it("numbers 1. 1. 1. sequentially without start", () => {
  const [list] = lists("1. a\n1. b\n1. c");
  expect(list.start).toBeNull();
  expect(list.items).toHaveLength(3);
});

it.each([
  ["3. a\n\n4. b", "3"],
  ["0. a\n1. b", "0"],
])("sets start from the first number: %j", (content, start) => {
  expect(lists(content)[0].start).toBe(start);
});

it("splits when the item type changes, with or without a blank line", () => {
  expect(lists("1. a\n\n- b").map((l) => l.tag)).toEqual(["OL", "UL"]);
  expect(lists("- a\n1. b").map((l) => l.tag)).toEqual(["UL", "OL"]);
});

it("does not absorb a paragraph between lists", () => {
  render(<AssistantContent content={"1. a\n\nbetween\n\n2. b"} />);
  const found = screen.getAllByRole("list");
  expect(found).toHaveLength(2);
  expect(found[1].getAttribute("start")).toBe("2");
  expect(screen.getByText("between").tagName).toBe("P");
});

it("ends a list at a heading, table or code fence", () => {
  const content = [
    "- a",
    "### Head",
    "- b",
    "",
    "| X | Y |",
    "| --- | --- |",
    "| 1 | 2 |",
    "- c",
    "```",
    "code",
    "```",
  ].join("\n");
  render(<AssistantContent content={content} />);
  expect(screen.getAllByRole("list")).toHaveLength(3);
  expect(screen.getByRole("table")).toBeTruthy();
  expect(screen.getByText("code").tagName).toBe("CODE");
});

it("keeps inline formatting in loose items", () => {
  render(
    <AssistantContent
      content={"1. **bold** and `code`\n\n2. [link](https://example.com)"}
    />,
  );
  expect(screen.getAllByRole("list")).toHaveLength(1);
  expect(screen.getByText("bold").tagName).toBe("STRONG");
  expect(screen.getByText("code").tagName).toBe("CODE");
  expect(screen.getByRole("link").getAttribute("href")).toBe(
    "https://example.com",
  );
});
