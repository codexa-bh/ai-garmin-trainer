import path from "node:path";

function runtimeImport(node) {
  if (node.importKind === "type" || node.exportKind === "type") return false;
  return !(
    node.specifiers?.length &&
    node.specifiers.every(
      (item) => item.importKind === "type" || item.exportKind === "type",
    )
  );
}

// Direct dependency boundaries, not a transitive security/sandbox proof.
const architecture = {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      boundary: "{{reason}} Keep this dependency in its server-side owner.",
      dynamic:
        "Use a literal module path so the architecture boundary can be checked.",
    },
  },
  create(context) {
    const filename = context.filename.replaceAll("\\", "/");
    const srcIndex = filename.lastIndexOf("/src/");
    if (srcIndex === -1) return {};
    const sourceRoot = filename.slice(0, srcIndex + 5);
    const localFile = filename.slice(srcIndex + 5);
    const storage = localFile.startsWith("lib/db/");
    const math = localFile === "lib/ai/math-analysis.ts";
    let client = false;

    function check(node, source) {
      if (!runtimeImport(node) || !(client || storage || math)) return;
      if (typeof source?.value !== "string") {
        context.report({ node, messageId: "dynamic" });
        return;
      }
      const value = source.value;
      const target = value.startsWith("@/")
        ? path.posix.normalize(value.slice(2))
        : value.startsWith(".")
          ? path.posix.relative(
              sourceRoot,
              path.posix.resolve(path.posix.dirname(filename), value),
            )
          : value;
      const server =
        /^(lib\/db(?:\/|$)|lib\/garmin\/(?:client|importer|mcp-config)(?:\.|\/|$)|lib\/env(?:\.|$)|lib\/ai\/providers(?:\.|$))/;
      const ai = /^(?:lib\/ai(?:\/|$)|@ai-sdk\/|ai$)/;
      const reason = math
        ? "Bounded math must not acquire runtime imports or external capabilities."
        : client && server.test(target)
          ? "Client modules must not import database, connector, environment or provider implementations."
          : storage && ai.test(target)
            ? "Storage must not own AI prompting or provider calls; type-only contracts are allowed."
            : null;
      if (reason)
        context.report({ node, messageId: "boundary", data: { reason } });
    }

    return {
      Program(node) {
        client = node.body.some(
          (statement) => statement.directive === "use client",
        );
      },
      ImportDeclaration(node) {
        check(node, node.source);
      },
      ExportNamedDeclaration(node) {
        if (node.source) check(node, node.source);
      },
      ExportAllDeclaration(node) {
        check(node, node.source);
      },
      ImportExpression(node) {
        check(node, node.source);
      },
      CallExpression(node) {
        if (node.callee.type !== "Identifier" || node.callee.name !== "require")
          return;
        let scope = context.sourceCode.getScope(node);
        while (scope) {
          const variable = scope.set.get("require");
          if (variable?.defs.length) return;
          scope = scope.upper;
        }
        check(node, node.arguments[0]);
      },
      TSImportEqualsDeclaration(node) {
        if (node.moduleReference.type === "TSExternalModuleReference") {
          check(node, node.moduleReference.expression);
        }
      },
    };
  },
};

export default architecture;
