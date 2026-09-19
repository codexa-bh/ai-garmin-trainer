import fs from "node:fs";
import path from "node:path";
import { Linter } from "eslint";
import ts from "typescript";
import tseslint from "typescript-eslint";
import {
  aiOwner,
  serverOwner,
  mathRoot,
  ambientCapabilities,
  moduleVisitors,
} from "./architecture-policy.mjs";

const codeExtension = /\.(?:[cm]?[jt]sx?)$/;
const linter = new Linter();

function collect(text, filename) {
  const result = { client: false, imports: [], capabilities: [], errors: [] };
  const messages = linter.verify(
    text,
    [
      {
        files: ["**/*.{ts,tsx,js,jsx,mts,cts,mjs,cjs}"],
        languageOptions: {
          parser: tseslint.parser,
          parserOptions: { ecmaFeatures: { jsx: true } },
        },
        plugins: {
          graph: {
            rules: {
              collect: {
                meta: { schema: [] },
                create(context) {
                  return {
                    Program(node) {
                      result.client = node.body.some(
                        (item) => item.directive === "use client",
                      );
                    },
                    ...moduleVisitors(context, (node, source) => {
                      result.imports.push({
                        specifier:
                          typeof source?.value === "string"
                            ? source.value
                            : null,
                        line: node.loc.start.line,
                      });
                    }),
                  };
                },
              },
            },
          },
        },
        rules: {
          "graph/collect": "error",
          "no-restricted-globals": ["error", ...ambientCapabilities],
        },
      },
    ],
    { filename: path.basename(filename) },
  );
  for (const message of messages) {
    (message.ruleId === "no-restricted-globals"
      ? result.capabilities
      : result.errors
    ).push({ line: message.line ?? 1, message: message.message });
  }
  return result;
}

// No application code is imported/executed. Package internals are opaque leaves.
export function checkArchitecture(root) {
  root = fs.realpathSync(root);
  const src = path.join(root, "src");
  const configPath = path.join(root, "tsconfig.json");
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  if (config.error)
    throw new Error(
      ts.flattenDiagnosticMessageText(config.error.messageText, "\n"),
    );
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
  const configErrors = parsed.errors.filter((error) => error.code !== 18003);
  if (configErrors.length)
    throw new Error(
      configErrors
        .map((error) =>
          ts.flattenDiagnosticMessageText(error.messageText, "\n"),
        )
        .join("\n"),
    );
  const label = (file) => path.relative(src, file).split(path.sep).join("/");
  const files = ts.sys
    .readDirectory(src, [
      ".ts",
      ".tsx",
      ".js",
      ".jsx",
      ".mts",
      ".cts",
      ".mjs",
      ".cjs",
    ])
    .filter((file) => !/\.d\.[cm]?ts$/.test(file))
    .map((file) => fs.realpathSync(file))
    .sort();
  const graph = new Map();
  const diagnostics = new Set();
  const report = (category, witness, detail) =>
    diagnostics.add(`${category}: ${witness.join(" -> ")}: ${detail}`);
  for (const file of files) {
    const node = collect(fs.readFileSync(file, "utf8"), file);
    graph.set(file, node);
    for (const error of node.errors)
      report("analysis", [`${label(file)}:${error.line}`], error.message);
    node.edges = node.imports.map((edge) => {
      if (edge.specifier === null) return { ...edge, kind: "opaque" };
      const resolved = ts.resolveModuleName(
        edge.specifier,
        file,
        parsed.options,
        ts.sys,
      ).resolvedModule;
      if (resolved && !resolved.isExternalLibraryImport) {
        const target = fs.realpathSync(resolved.resolvedFileName);
        if (
          !target.startsWith(`${src}${path.sep}`) ||
          /\.d\.[cm]?ts$/.test(target)
        )
          return { ...edge, kind: "unverified", target };
        return {
          ...edge,
          kind: codeExtension.test(target) ? "local" : "asset",
          target,
        };
      }
      if (
        edge.specifier.startsWith(".") ||
        edge.specifier.startsWith("@/") ||
        path.isAbsolute(edge.specifier)
      ) {
        // Next supports side-effect CSS and static asset imports outside TS's resolver.
        const asset = path.resolve(path.dirname(file), edge.specifier);
        if (/\.(css|svg|png|jpg|webp)$/.test(asset) && fs.existsSync(asset))
          return { ...edge, kind: "asset", target: asset };
        report(
          "unresolved",
          [`${label(file)}:${edge.line}`, edge.specifier],
          "cannot resolve local runtime dependency",
        );
        return { ...edge, kind: "unresolved" };
      }
      return { ...edge, kind: "external" };
    });
  }

  // Each constrained root gets a deterministic witness, visiting each node once.
  for (const [rootFile, rootNode] of graph) {
    const name = label(rootFile);
    const math = name === mathRoot;
    const storage = name.startsWith("lib/db/");
    if (!(rootNode.client || storage || math)) continue;
    const visited = new Set();
    function walk(file, witness) {
      if (visited.has(file)) return;
      visited.add(file);
      const node = graph.get(file);
      if (!node) {
        report(
          "analysis",
          witness,
          "runtime module is outside the analyzed graph",
        );
        return;
      }
      if (math)
        for (const capability of node.capabilities)
          report(
            "math-capability",
            [...witness, `${label(file)}:${capability.line}`],
            capability.message,
          );
      for (const edge of node.edges) {
        const targetName = edge.target
          ? label(edge.target)
          : (edge.specifier ?? "<nonliteral loader>");
        const next = [
          ...witness.slice(0, -1),
          `${label(file)}:${edge.line}`,
          targetName,
        ];
        if (["opaque", "unverified", "unresolved"].includes(edge.kind)) {
          report(
            "opaque-dependency",
            next,
            "constrained closure requires statically resolved src runtime modules",
          );
          continue;
        }
        if (rootNode.client && serverOwner.test(targetName))
          report("client-server", next, "client reaches server owner");
        if (storage && aiOwner.test(targetName))
          report("storage-ai", next, "storage reaches AI owner");
        if (math && (edge.kind !== "local" || serverOwner.test(targetName)))
          report(
            "math-capability",
            next,
            "bounded math requires pure local helpers, not capability owners or opaque packages/assets",
          );
        if (edge.kind === "local") walk(edge.target, next);
      }
    }
    walk(rootFile, [name]);
  }

  const done = new Set();
  const active = new Set();
  function cycles(file, stack) {
    if (active.has(file)) {
      const start = stack.indexOf(file);
      report(
        "runtime-cycle",
        [...stack.slice(start), file].map(label),
        "runtime imports must be acyclic",
      );
      return;
    }
    if (done.has(file)) return;
    active.add(file);
    for (const edge of graph.get(file)?.edges ?? [])
      if (edge.kind === "local") cycles(edge.target, [...stack, file]);
    active.delete(file);
    done.add(file);
  }
  for (const file of graph.keys()) cycles(file, []);
  return { files: graph.size, diagnostics: [...diagnostics].sort() };
}
