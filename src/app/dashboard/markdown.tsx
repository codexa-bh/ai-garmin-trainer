"use client";
import { type ReactNode } from "react";

function safeMarkdownHref(value: string): string | null {
  try {
    const url = new URL(value, "http://localhost");
    if (["http:", "https:", "mailto:"].includes(url.protocol)) return value;
  } catch {
    return null;
  }
  return null;
}

function renderInlineMarkdown(text: string, keyPrefix: string): ReactNode[] {
  const pattern = /(\[[^\]]+\]\([^\s)]+\)|`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g;
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
    const token = match[0];
    const key = `${keyPrefix}-${match.index}`;
    const link = token.match(/^\[([^\]]+)\]\(([^\s)]+)\)$/);
    if (link) {
      const href = safeMarkdownHref(link[2]);
      nodes.push(
        href ? (
          <a key={key} href={href} rel="noreferrer noopener">
            {link[1]}
          </a>
        ) : (
          <span key={key}>{link[1]}</span>
        ),
      );
    } else if (token.startsWith("`")) {
      nodes.push(<code key={key}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith("**")) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("*")) {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    }
    lastIndex = pattern.lastIndex;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

type MarkdownTableBlock = {
  headers: string[];
  rows: string[][];
};

function splitMarkdownTableRow(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.includes("|")) return null;
  const withoutOuterPipes = trimmed.replace(/^\|/, "").replace(/\|$/, "");
  const cells = withoutOuterPipes.split("|").map((cell) => cell.trim());
  return cells.length >= 2 ? cells : null;
}

function isMarkdownTableSeparator(line: string, columnCount: number): boolean {
  const cells = splitMarkdownTableRow(line);
  return (
    cells?.length === columnCount &&
    cells.every((cell) => /^:?-{3,}:?$/.test(cell))
  );
}

function parseMarkdownTableBlock(
  lines: string[],
  startIndex: number,
): { table: MarkdownTableBlock; nextIndex: number } | null {
  const headers = splitMarkdownTableRow(lines[startIndex]);
  if (!headers || headers.some((header) => !header)) return null;
  if (!isMarkdownTableSeparator(lines[startIndex + 1] ?? "", headers.length)) {
    return null;
  }

  const rows: string[][] = [];
  let nextIndex = startIndex + 2;
  while (nextIndex < lines.length) {
    const line = lines[nextIndex];
    if (!line.trim()) break;
    const cells = splitMarkdownTableRow(line);
    if (!cells || cells.length !== headers.length) break;
    rows.push(cells);
    nextIndex += 1;
  }

  if (!rows.length) return null;
  return { table: { headers, rows }, nextIndex };
}

function renderMarkdownTable(table: MarkdownTableBlock, keyPrefix: string) {
  return (
    <div className="assistant-table-wrapper" key={keyPrefix}>
      <table className="assistant-table">
        <thead>
          <tr>
            {table.headers.map((header, index) => (
              <th key={index} scope="col">
                {renderInlineMarkdown(header, `${keyPrefix}-h-${index}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => (
                <td key={cellIndex}>
                  {renderInlineMarkdown(
                    cell,
                    `${keyPrefix}-r-${rowIndex}-${cellIndex}`,
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AssistantContent({ content }: { content: string }) {
  const blocks: ReactNode[] = [];
  const lines = content.split(/\r?\n/);
  let paragraph: string[] = [];
  let list: Array<{ ordered: boolean; text: string }> = [];
  let codeLines: string[] | null = null;

  function flushParagraph() {
    if (!paragraph.length) return;
    const text = paragraph.join(" ");
    blocks.push(
      <p key={`p-${blocks.length}`}>
        {renderInlineMarkdown(text, `p-${blocks.length}`)}
      </p>,
    );
    paragraph = [];
  }

  function flushList() {
    if (!list.length) return;
    const ordered = list[0].ordered;
    const items = list;
    const ListTag = ordered ? "ol" : "ul";
    blocks.push(
      <ListTag key={`l-${blocks.length}`}>
        {items.map((item, index) => (
          <li key={index}>
            {renderInlineMarkdown(item.text, `li-${blocks.length}-${index}`)}
          </li>
        ))}
      </ListTag>,
    );
    list = [];
  }

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    if (codeLines) {
      if (line.trim().startsWith("```")) {
        blocks.push(
          <pre key={`code-${blocks.length}`}>
            <code>{codeLines.join("\n")}</code>
          </pre>,
        );
        codeLines = null;
      } else {
        codeLines.push(line);
      }
      continue;
    }
    if (line.trim().startsWith("```")) {
      flushParagraph();
      flushList();
      codeLines = [];
      continue;
    }
    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }
    const tableBlock = parseMarkdownTableBlock(lines, lineIndex);
    if (tableBlock) {
      flushParagraph();
      flushList();
      blocks.push(
        renderMarkdownTable(tableBlock.table, `table-${blocks.length}`),
      );
      lineIndex = tableBlock.nextIndex - 1;
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      const HeadingTag = `h${Math.min(heading[1].length + 2, 5)}` as
        "h3" | "h4" | "h5";
      blocks.push(
        <HeadingTag key={`h-${blocks.length}`}>
          {renderInlineMarkdown(heading[2], `h-${blocks.length}`)}
        </HeadingTag>,
      );
      continue;
    }
    const listItem = line.match(/^\s*(?:([-*])|(\d+)\.)\s+(.+)$/);
    if (listItem) {
      flushParagraph();
      list.push({ ordered: Boolean(listItem[2]), text: listItem[3] });
      continue;
    }
    flushList();
    paragraph.push(line.trim());
  }
  if (codeLines) {
    blocks.push(
      <pre key={`code-${blocks.length}`}>
        <code>{codeLines.join("\n")}</code>
      </pre>,
    );
  }
  flushParagraph();
  flushList();
  return (
    <div className="assistant-content">{blocks.length ? blocks : <p />}</div>
  );
}
