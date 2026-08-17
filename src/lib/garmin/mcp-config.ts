export const GARMIN_MCP_COMMIT = "3610be6feed93088d85b0f35aba9d7d07c2505a7";
export const GARMIN_MCP_EXECUTABLE = "garmin-mcp";
export const GARMIN_MCP_PACKAGE_URL = `git+https://github.com/Taxuspt/garmin_mcp.git@${GARMIN_MCP_COMMIT}`;
export const GARMIN_MCP_SDK_VERSION = "1.28.1";
export const GARMIN_MCP_SDK_REQUIREMENT = `mcp==${GARMIN_MCP_SDK_VERSION}`;
export const GARMIN_MCP_DEFAULT_ARGS = [
  "--from",
  GARMIN_MCP_PACKAGE_URL,
  "--with",
  GARMIN_MCP_SDK_REQUIREMENT,
  GARMIN_MCP_EXECUTABLE,
] as const;
export const GARMIN_MCP_DEFAULT_ARGS_STRING = GARMIN_MCP_DEFAULT_ARGS.join(" ");

const MCP_REQUIREMENT_PATTERN = /^mcp(?:===|==|~=|!=|<=|>=|<|>).+/;

export type GarminMcpSdkConstraintStatus = "exact" | "missing" | "incompatible";

function tokenize(rawArgs: string): string[] {
  return rawArgs.split(" ").filter(Boolean);
}

function legacyPackageToSource(arg: string): string {
  return arg.replace("garmin-mcp@git+", "git+");
}

function normalizeLegacyPackageArgs(args: string[]): string[] {
  const legacyPackage = args.find((arg) => arg.startsWith("garmin-mcp@git+"));
  if (!legacyPackage) return args;
  return [
    "--from",
    legacyPackageToSource(legacyPackage),
    GARMIN_MCP_EXECUTABLE,
  ];
}

function includesReviewedConnector(args: string[]): boolean {
  return args.some(
    (arg) =>
      arg.includes(GARMIN_MCP_COMMIT) ||
      arg === GARMIN_MCP_PACKAGE_URL ||
      arg.startsWith("garmin-mcp@git+"),
  );
}

function mcpRequirements(args: string[]): string[] {
  return args.filter((arg) => MCP_REQUIREMENT_PATTERN.test(arg));
}

function insertSdkRequirement(args: string[]): string[] {
  const commandIndex = args.indexOf(GARMIN_MCP_EXECUTABLE);
  if (commandIndex < 0) return args;
  return [
    ...args.slice(0, commandIndex),
    "--with",
    GARMIN_MCP_SDK_REQUIREMENT,
    ...args.slice(commandIndex),
  ];
}

export function garminMcpSdkConstraintStatus(
  rawArgs: string | string[],
): GarminMcpSdkConstraintStatus {
  const args = Array.isArray(rawArgs) ? rawArgs : tokenize(rawArgs);
  const requirements = mcpRequirements(args);
  if (requirements.length === 0) return "missing";
  return requirements.every((item) => item === GARMIN_MCP_SDK_REQUIREMENT)
    ? "exact"
    : "incompatible";
}

export function garminMcpArgs(rawArgs: string): string[] {
  const normalized = normalizeLegacyPackageArgs(tokenize(rawArgs));
  if (!includesReviewedConnector(normalized)) return normalized;
  const status = garminMcpSdkConstraintStatus(normalized);
  if (status === "missing") return insertSdkRequirement(normalized);
  return normalized;
}
