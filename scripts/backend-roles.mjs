// Reviewed ownership, not a folder-based inference or a legacy-debt allowlist.
// Paths are relative to src. New backend modules require an explicit role.
const groups = [
  [
    "ai",
    "domain",
    "lib/ai",
    [
      "coaching-scenarios",
      "context",
      "debug-trace",
      "debug-types",
      "execution-budget",
      "math-analysis",
      "orchestration-ports",
      "profile",
      "provider-errors",
      "reliability-fixtures",
      "tool-contracts",
      "tool-evidence",
      "tool-execution-context",
      "tool-execution-input",
      "tool-selection",
      "tool-step-diagnostics",
      "tool-types",
      "trainer-instructions",
      "trainer-progress",
      "training-plan-evidence",
    ],
  ],
  [
    "ai",
    "application",
    "lib/ai",
    [
      "orchestrator",
      "tool-analytics",
      "tool-execution",
      "tool-local-data",
      "tool-ports",
      "tool-training-plan",
      "tool-weekly",
    ],
  ],
  [
    "ai",
    "adapter",
    "lib/ai",
    ["provider-generation", "provider-tool-definitions", "providers"],
  ],
  [
    "ai",
    "composition",
    "lib/ai",
    ["composition", "tool-composition", "sql-analysis"],
  ],
  [
    "analytics",
    "domain",
    "lib/ai/analytics",
    ["contracts", "policy", "schema"],
  ],
  ["analytics", "application", "lib/ai/analytics", ["application"]],
  ["analytics", "adapter", "lib/ai/analytics", ["sqlite-execution"]],
  [
    "local-data",
    "domain",
    "lib/analytics",
    ["activity-dashboard-calculations", "activity-label"],
  ],
  [
    "chat",
    "domain",
    "lib/chat",
    ["contracts", "context-ports", "conversation-policy", "ports"],
  ],
  ["chat", "application", "lib/chat", ["context", "conversations", "turn"]],
  [
    "chat",
    "composition",
    "lib/chat",
    ["composition", "conversation-composition"],
  ],
  [
    "storage",
    "adapter",
    "lib/db",
    [
      "connection",
      "conversation-lifecycle",
      "conversation-repository",
      "legacy-memory-repository",
      "local-data-lifecycle",
      "migrations",
      "profile-repository",
      "repository",
      "schema",
      "training-plan-repository",
      "weekly-repository",
    ],
  ],
  ["diagnostics", "domain", "lib/diagnostics", ["redaction"]],
  ["diagnostics", "adapter", "lib/diagnostics", ["doctor"]],
  [
    "garmin",
    "domain",
    "lib/garmin",
    [
      "activity-hr-zone-time",
      "athlete-normalize",
      "body-metrics-normalize",
      "detail-normalize",
      "detail-types",
      "import-contracts",
      "import-policy",
      "import-ports",
      "normalize",
      "sync",
      "types",
    ],
  ],
  [
    "garmin",
    "application",
    "lib/garmin",
    ["baseline-import", "detail-import", "detail-requests", "sync-import"],
  ],
  [
    "garmin",
    "adapter",
    "lib/garmin",
    [
      "auth-command",
      "client",
      "fit-altitude",
      "fit-baseline",
      "fit-distance",
      "fit-speed",
      "mcp-client",
      "mcp-config",
      "raw-payload",
      "reader-adapter",
      "token-location",
    ],
  ],
  ["garmin", "composition", "lib/garmin", ["composition", "importer"]],
  [
    "local-data",
    "domain",
    "lib/local-data",
    [
      "activity-policy",
      "contracts",
      "coverage-policy",
      "dashboard-policy",
      "health-policy",
      "heart-rate-policy",
    ],
  ],
  ["local-data", "application", "lib/local-data", ["application"]],
  ["local-data", "composition", "lib/local-data", ["composition"]],
  [
    "memory",
    "domain",
    "lib/memory",
    [
      "extraction-policy",
      "extractor",
      "filters",
      "legacy-contracts",
      "ports",
      "retrieval-policy",
      "types",
    ],
  ],
  [
    "memory",
    "application",
    "lib/memory",
    ["application", "legacy-application", "management"],
  ],
  [
    "memory",
    "adapter",
    "lib/memory",
    ["config", "embedding-adapter", "extraction-adapter", "sqlite-storage"],
  ],
  [
    "memory",
    "composition",
    "lib/memory",
    ["composition", "legacy-composition", "sqlite-adapter"],
  ],
  ["weekly", "domain", "lib/weekly", ["contracts", "calendar"]],
  ["weekly", "application", "lib/weekly", ["application"]],
  ["weekly", "composition", "lib/weekly", ["composition"]],
  ["profile", "domain", "lib/profile", ["contracts"]],
  ["profile", "application", "lib/profile", ["application"]],
  ["profile", "composition", "lib/profile", ["composition"]],
  [
    "training-plan",
    "domain",
    "lib/training-plan",
    ["contracts", "edits", "limits", "policy", "snapshot"],
  ],
  ["training-plan", "application", "lib/training-plan", ["application"]],
  ["training-plan", "composition", "lib/training-plan", ["composition"]],
  ["training-plan", "domain", "lib", ["training-plan-limits"]],
  ["configuration", "adapter", "lib", ["env"]],
  [
    "http",
    "delivery",
    "app/api",
    [
      "activities/route",
      "activities/[garminId]/dashboard/route",
      "activity-detail/route",
      "chat/route",
      "chat/delivery",
      "conversations/route",
      "conversations/[conversationId]/route",
      "delete/route",
      "health-dashboard/route",
      "memory/route",
      "profile/route",
      "summary/route",
      "sync/route",
      "training-plan/route",
      "weekly/route",
    ],
  ],
];

export const backendRoles = Object.fromEntries(
  groups.flatMap(([feature, layer, directory, names]) =>
    names.map((name) => [`${directory}/${name}.ts`, { feature, layer }]),
  ),
);

// Explicit non-backend ownership prevents a new src/server.ts (or an orphan
// helper outside lib) from silently escaping coverage. These are UI-only owners,
// never valid inward dependencies of a backend module.
export const presentationModules = new Set([
  "app/health-rollup-chart.tsx",
  "app/mobile-navigation-sheet.tsx",
  "app/trainer-dashboard.tsx",
  "app/layout.tsx",
  "app/page.tsx",
  "app/use-active-conversation.ts",
  ...[
    "formatting",
    "markdown",
    "chat-view",
    "sync-view",
    "settings-view",
    "use-memory",
    "health-metrics",
    "memory-content",
    "health-view",
    "use-profile",
    "profile-card",
    "use-data-controls",
    "use-training-plan",
    "use-weekly",
    "weekly-plan-view",
    "use-health",
    "use-sync",
    "transport",
    "memory-presentation",
    "activity-charts",
    "contracts",
    "profile-fields",
    "chat-presentation",
    "training-plan-view",
    "sync-presentation",
    "use-activity",
    "activity-view",
    "use-chat",
  ].map((name) => `app/dashboard/${name}.tsx`),
]);

export const allowedLayers = {
  domain: ["domain"],
  application: ["domain", "application"],
  adapter: ["domain", "application", "adapter"],
  composition: ["domain", "application", "adapter", "composition"],
  delivery: ["domain", "application", "composition", "delivery"],
};

// Existing schema-only use. This grants no package-wide or transitive purity.
export function allowedExternalDependency(source, layer, specifier, runtime) {
  // HTTP owns framework transport and its existing erased UI wire type only,
  // not direct SQL/provider/connector packages bypassing feature composition.
  if (layer === "delivery")
    return specifier === "next/server" || (!runtime && specifier === "ai");
  if (!["domain", "application"].includes(layer)) return true;
  return (
    specifier === "zod" &&
    [
      "lib/ai/profile.ts",
      "lib/ai/tool-contracts.ts",
      "lib/training-plan/snapshot.ts",
    ].includes(source)
  );
}

export function isBackendFile(name) {
  return name.startsWith("lib/") || name.startsWith("app/api/");
}
