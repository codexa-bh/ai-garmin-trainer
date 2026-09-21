// Shared direct/transitive ownership and scope-aware capability policy.
export const serverOwner =
  /^(lib\/db(?:\/|$)|lib\/garmin\/(?:client|importer|mcp-config)(?:\.|\/|$)|lib\/env(?:\.|$)|lib\/ai\/providers(?:\.|$))/;
export const aiOwner = /^(?:lib\/ai(?:\/|$)|@ai-sdk\/|ai$)/;
export const mathRoot = "lib/ai/math-analysis.ts";
export const ambientCapabilities = [
  "process",
  "fetch",
  "globalThis",
  "global",
  "window",
  "document",
  "XMLHttpRequest",
  "WebSocket",
  "require",
  "eval",
  "Function",
];

function runtimeImport(node) {
  if (node.importKind === "type" || node.exportKind === "type") return false;
  return !(
    node.specifiers?.length &&
    node.specifiers.every(
      (item) => item.importKind === "type" || item.exportKind === "type",
    )
  );
}

// Keep loader recognition identical in the direct rule and graph collector.
export function moduleVisitors(context, check, { includeTypes = false } = {}) {
  const dependency = (node, source) => {
    const runtime = runtimeImport(node);
    if (runtime || includeTypes) check(node, source, runtime);
  };
  return {
    ImportDeclaration(node) {
      dependency(node, node.source);
    },
    ExportNamedDeclaration(node) {
      if (node.source) dependency(node, node.source);
    },
    ExportAllDeclaration(node) {
      dependency(node, node.source);
    },
    ImportExpression(node) {
      dependency(node, node.source);
    },
    CallExpression(node) {
      if (node.callee.type !== "Identifier" || node.callee.name !== "require")
        return;
      let scope = context.sourceCode.getScope(node);
      while (scope) {
        if (scope.set.get("require")?.defs.length) return;
        scope = scope.upper;
      }
      dependency(node, node.arguments[0]);
    },
    ...(includeTypes
      ? {
          TSImportType(node) {
            check(
              node,
              node.argument.type === "TSLiteralType"
                ? node.argument.literal
                : node.argument,
              false,
            );
          },
        }
      : {}),
    TSImportEqualsDeclaration(node) {
      if (node.moduleReference.type === "TSExternalModuleReference") {
        dependency(node, node.moduleReference.expression);
      }
    },
  };
}
