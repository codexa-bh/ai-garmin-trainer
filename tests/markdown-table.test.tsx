/** @vitest-environment jsdom */
import { readFileSync } from "node:fs";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { AssistantContent } from "../src/app/dashboard/markdown";

afterEach(cleanup);

const prose =
  "Recorded evidence includes a long descriptive explanation that should wrap at word boundaries rather than compete with the compact score.";
const columns = ["KPI", "Target", "Unit", "Evidence", "Points", "Calculation"];
const values = ["**Easy work**", "150", "min", prose, "30 / 30", prose];

it.each([
  { order: [0, 1, 2, 3, 4, 5], scoreHeader: "Points" },
  { order: [4, 3, 5, 0, 2, 1], scoreHeader: "Crédit" },
])(
  "protects compact cells independent of position/header: $scoreHeader",
  ({ order, scoreHeader }) => {
    const headers = columns.map((value, index) =>
      index === 4 ? scoreHeader : value,
    );
    const rows = ["30 / 30", "25 / 25", "15 / 15", "0 / 10", "5 / 10"].map(
      (score) => values.map((value, index) => (index === 4 ? score : value)),
    );
    const content = [headers, headers.map(() => "---"), ...rows]
      .map((row) => `| ${order.map((index) => row[index]).join(" | ")} |`)
      .join("\n");
    render(<AssistantContent content={content} />);
    const table = screen.getByRole("table");
    const header = within(table).getByRole("columnheader", {
      name: scoreHeader,
    });
    expect(header.getAttribute("scope")).toBe("col");
    expect(header.classList.contains("assistant-table-compact")).toBe(true);
    for (const score of ["30 / 30", "25 / 25", "15 / 15", "0 / 10", "5 / 10"]) {
      expect(
        within(table)
          .getByRole("cell", { name: score })
          .classList.contains("assistant-table-compact"),
      ).toBe(true);
    }
    expect(within(table).getAllByText(prose)).toHaveLength(10);
    for (const cell of within(table).getAllByText(prose)) {
      expect(cell.classList.contains("assistant-table-compact")).toBe(false);
    }
    expect(within(table).getAllByText("Easy work")[0].tagName).toBe("STRONG");
    expect(table.parentElement?.className).toBe("assistant-table-wrapper");
  },
);

it("bounds the generic compact policy without rewriting long labels or tokens", () => {
  const short = "a".repeat(24);
  const long = "a".repeat(25);
  const token = `https://example.test/${"unbroken".repeat(50)}`;
  render(
    <AssistantContent
      content={`| Short label | Long descriptive heading that should wrap | Token |\n| --- | --- | --- |\n| ${short} | ${long} | ${token} |`}
    />,
  );
  expect(screen.getByRole("cell", { name: short }).className).toBe(
    "assistant-table-compact",
  );
  expect(screen.getByRole("cell", { name: long }).className).toBe("");
  expect(screen.getByRole("cell", { name: token }).textContent).toBe(token);
  expect(screen.getByRole("cell", { name: token }).className).toBe("");
  expect(
    screen.getByRole("columnheader", { name: /Long descriptive/ }).className,
  ).toBe("");
});

it("retains ordinary chat tables, inline safety and surrounding Markdown", () => {
  render(
    <AssistantContent
      content={[
        "## Summary",
        "- Keep *easy effort*",
        "",
        "| Metric | Average | Reference |",
        "| --- | ---: | :---: |",
        "| **Duration** | `42 min` | [safe](https://example.test/run) |",
        "| Distance | [bad](javascript:alert(1)) | <img src=x onerror=alert(1)> |",
        "",
        "After the table.",
        "```",
        "| literal | code |",
        "```",
      ].join("\n")}
    />,
  );
  expect(screen.getAllByRole("table")).toHaveLength(1);
  expect(screen.getByRole("heading", { name: "Summary" })).toBeTruthy();
  expect(screen.getByText("easy effort").tagName).toBe("EM");
  expect(screen.getByText("Duration").tagName).toBe("STRONG");
  expect(screen.getByText("42 min").tagName).toBe("CODE");
  expect(screen.getByRole("link", { name: "safe" }).getAttribute("href")).toBe(
    "https://example.test/run",
  );
  expect(screen.getByText("bad").closest("a")).toBeNull();
  expect(screen.queryByRole("img")).toBeNull();
  expect(screen.getByText("<img src=x onerror=alert(1)>")).toBeTruthy();
  expect(screen.getByText("After the table.")).toBeTruthy();
  expect(screen.getByText("| literal | code |").tagName).toBe("CODE");
});

it.each([
  "| A | B |\n| -- | --- |\n| x | y |",
  "| A | B |\n| --- | --- |\n| x | y | z |",
])("leaves malformed table text as safe prose: %s", (content) => {
  render(<AssistantContent content={content} />);
  expect(screen.queryByRole("table")).toBeNull();
  expect(screen.getByText(content.replaceAll("\n", " "))).toBeTruthy();
});

it("keeps the shared CSS compact/word wrapping and overflow policy explicit", () => {
  // JSDOM does not lay out tables: native/WebKit geometry is separate evidence.
  const css = readFileSync("src/app/style.css", "utf8");
  const cell = css.match(
    /\.assistant-table th,\s*\.assistant-table td\s*\{([^}]+)\}/,
  )?.[1];
  const compact = css.match(
    /\.assistant-table \.assistant-table-compact\s*\{([^}]+)\}/,
  )?.[1];
  const wrapper = css.match(/\.assistant-table-wrapper\s*\{([^}]+)\}/)?.[1];
  expect(cell).toMatch(/overflow-wrap:\s*break-word/);
  expect(cell).toMatch(/word-break:\s*normal/);
  expect(cell).toMatch(/max-width:\s*32rem/);
  expect(compact).toMatch(/white-space:\s*nowrap/);
  expect(wrapper).toMatch(/overflow-x:\s*auto/);
  expect(wrapper).not.toMatch(/overflow[^;]*:\s*hidden/);
});
