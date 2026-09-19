import { checkArchitecture } from "./architecture-graph.mjs";

try {
  const result = checkArchitecture(process.cwd());
  for (const diagnostic of result.diagnostics) console.error(diagnostic);
  console.log(
    `Architecture: ${result.files} modules, ${result.diagnostics.length} violations`,
  );
  process.exitCode = result.diagnostics.length ? 1 : 0;
} catch (error) {
  console.error(`Architecture analysis failed: ${error.message}`);
  process.exitCode = 1;
}
