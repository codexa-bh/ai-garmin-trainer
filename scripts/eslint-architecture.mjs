import path from "node:path";
import {
  aiOwner,
  serverOwner,
  moduleVisitors,
} from "./architecture-policy.mjs";

// Fast direct feedback; architecture-check.mjs owns transitive enforcement.
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
    const storage = filename.slice(srcIndex + 5).startsWith("lib/db/");
    let client = false;
    return {
      Program(node) {
        client = node.body.some(
          (statement) => statement.directive === "use client",
        );
      },
      ...moduleVisitors(context, (node, source) => {
        if (!(client || storage)) return;
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
        const reason =
          client && serverOwner.test(target)
            ? "Client modules must not import database, connector, environment or provider implementations."
            : storage && aiOwner.test(target)
              ? "Storage must not own AI prompting or provider calls; type-only contracts are allowed."
              : null;
        if (reason)
          context.report({ node, messageId: "boundary", data: { reason } });
      }),
    };
  },
};
export default architecture;
