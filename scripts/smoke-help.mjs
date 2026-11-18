#!/usr/bin/env node
import { readFileSync } from "node:fs";

const usage = `Read-only smoke command discovery. Never prepares, builds or runs a scenario.

Usage:
  npm run smoke:help -- list
  npm run smoke:help -- search <literal terms...>
  npm run smoke:help -- show <id>

Examples:
  npm run smoke:help -- search sync
  npm run smoke:help -- search settings keyless
  npm run smoke:help -- show synthetic-sync

Search matches all terms, case-insensitively; it does not select a runner or grant
permission. Read effects/authority before execution. Existing commands' --help
owns flag syntax. Catalog: docs/smoke-commands.md; playbook: docs/dev-bridge.md.
`;

function entriesFrom(markdown) {
  const headings = [...markdown.matchAll(/^## ([a-z0-9-]+) — (.+)$/gm)];
  const entries = headings.map((heading, index) => ({
    id: heading[1],
    title: heading[2],
    text: markdown
      .slice(heading.index, headings[index + 1]?.index ?? markdown.length)
      .trim(),
  }));
  if (
    !entries.length ||
    new Set(entries.map((entry) => entry.id)).size !== entries.length
  ) {
    throw new Error("Smoke catalog has missing or duplicate entry IDs.");
  }
  return entries;
}

function main(args) {
  if (
    !args.length ||
    (args.length === 1 && ["--help", "-h"].includes(args[0]))
  ) {
    process.stdout.write(usage);
    return 0;
  }
  const [action, ...values] = args;
  const valid =
    (action === "list" && !values.length) ||
    (action === "show" && values.length === 1) ||
    (action === "search" &&
      values.length &&
      values.every((value) => value.trim()));
  if (!valid) {
    process.stderr.write(`Invalid discovery command.\n${usage}`);
    return 2;
  }
  const catalog = new URL("../docs/smoke-commands.md", import.meta.url);
  const entries = entriesFrom(readFileSync(catalog, "utf8"));
  if (action === "show") {
    const entry = entries.find((candidate) => candidate.id === values[0]);
    if (!entry) {
      process.stderr.write(
        `Unknown smoke entry: ${values[0]}. Use list or search.\n`,
      );
      return 2;
    }
    process.stdout.write(
      `Shared setup/safety: docs/dev-bridge.md.\nFrom docs/smoke-commands.md (links relative to docs/):\n\n${entry.text}\n`,
    );
    return 0;
  }
  const terms = values.flatMap((value) =>
    value.toLowerCase().trim().split(/\s+/),
  );
  const matches =
    action === "list"
      ? entries
      : entries.filter((entry) =>
          terms.every((term) => entry.text.toLowerCase().includes(term)),
        );
  if (!matches.length) {
    process.stdout.write(
      "No matching smoke commands. Try fewer literal terms or list.\n",
    );
    return 1;
  }
  process.stdout.write(
    matches.map((entry) => `${entry.id} — ${entry.title}`).join("\n") + "\n",
  );
  return 0;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  process.stderr.write(
    `Smoke discovery unavailable: ${error instanceof Error ? error.message : "unknown error"}\n`,
  );
  process.exitCode = 2;
}
