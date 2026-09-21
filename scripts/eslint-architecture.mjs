import path from "node:path";
import {
  aiOwner,
  serverOwner,
  moduleVisitors,
} from "./architecture-policy.mjs";

import {
  backendRoles,
  allowedLayers,
  allowedExternalDependency,
  isBackendFile,
} from "./backend-roles.mjs";

// Fast direct feedback; architecture-check.mjs owns transitive enforcement.
const architecture = {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      boundary: "{{reason}} Keep this dependency in its server-side owner.",
      layer:
        "{{reason}} Declare ownership and depend on inward feature contracts/ports.",
      dynamic:
        "Use a literal module path so the architecture boundary can be checked.",
    },
  },
  create(context) {
    const filename = context.filename.replaceAll("\\", "/");
    const srcIndex = filename.lastIndexOf("/src/");
    if (srcIndex === -1) return {};
    const sourceRoot = filename.slice(0, srcIndex + 5);
    const sourceName = filename.slice(srcIndex + 5);
    const storage = sourceName.startsWith("lib/db/");
    const role = backendRoles[sourceName];
    let client = false;
    return {
      Program(node) {
        if (isBackendFile(sourceName) && !role)
          context.report({
            node,
            messageId: "layer",
            data: { reason: `Unclassified backend module ${sourceName}.` },
          });
        client = node.body.some(
          (statement) => statement.directive === "use client",
        );
      },
      ...moduleVisitors(
        context,
        (node, source, runtime) => {
          if (!(role || ((client || storage) && runtime))) return;
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
          const targetRole =
            backendRoles[target] ??
            backendRoles[`${target}.ts`] ??
            backendRoles[`${target}/index.ts`];
          const external =
            !value.startsWith(".") &&
            !value.startsWith("@/") &&
            !path.isAbsolute(value);
          if (
            role &&
            ((targetRole &&
              !allowedLayers[role.layer].includes(targetRole.layer)) ||
              (external &&
                !allowedExternalDependency(
                  sourceName,
                  role.layer,
                  value,
                  runtime,
                )))
          )
            context.report({
              node,
              messageId: "layer",
              data: {
                reason: `${role.feature}/${role.layer} cannot import ${targetRole ? `${targetRole.feature}/${targetRole.layer}` : value}${runtime ? "" : " (type-only)"}.`,
              },
            });
          if (!runtime) return;
          const reason =
            client && serverOwner.test(target)
              ? "Client modules must not import database, connector, environment or provider implementations."
              : storage && aiOwner.test(target)
                ? "Storage must not own AI prompting or provider calls; type-only contracts are allowed."
                : null;
          if (reason)
            context.report({ node, messageId: "boundary", data: { reason } });
        },
        { includeTypes: true },
      ),
    };
  },
};
export default architecture;
