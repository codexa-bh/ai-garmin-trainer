import { readFileSync } from "node:fs";
import ts from "typescript";
import { afterEach, expect, it, vi } from "vitest";
import { backendRoles } from "../scripts/backend-roles.mjs";

const routes = {
  "activities/route": "local-data/composition",
  "activities/[garminId]/dashboard/route": "local-data/composition",
  "activity-detail/route": "garmin/composition",
  "chat/route": "chat/composition",
  "conversations/route": "chat/conversation-composition",
  "conversations/[conversationId]/route": "chat/conversation-composition",
  "delete/route": "local-data/composition",
  "health-dashboard/route": "local-data/composition",
  "memory/route": "memory/composition",
  "profile/route": "profile/composition",
  "summary/route": "local-data/composition",
  "sync/route": "garmin/composition",
  "training-plan/route": "training-plan/composition",
  "weekly/route": "weekly/composition",
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.resetModules();
});

it("maps every HTTP family to its delivered feature composition", () => {
  expect(
    Object.keys(backendRoles)
      .filter(
        (name) => name.startsWith("app/api/") && name.endsWith("/route.ts"),
      )
      .sort(),
  ).toEqual(
    Object.keys(routes)
      .map((name) => `app/api/${name}.ts`)
      .sort(),
  );
  for (const [route, composition] of Object.entries(routes)) {
    const file = `src/app/api/${route}.ts`;
    const source = ts.createSourceFile(
      file,
      readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    const imports = source.statements
      .filter(ts.isImportDeclaration)
      .filter((node) => !node.importClause?.isTypeOnly)
      .map((node) => node.moduleSpecifier.text);
    expect(imports, route).toContain(`@/lib/${composition}`);
  }
});

it("constructs every production route/factory without opening DB, reading env, selecting providers or starting a connector", async () => {
  vi.resetModules();
  const env = await import("../src/lib/env");
  const storage = await import("../src/lib/db/connection");
  const providers = await import("../src/lib/ai/providers");
  const connector = await import("../src/lib/garmin/client");
  const forbidden = () => {
    throw new Error("import-time resource access");
  };
  const probes = [
    vi.spyOn(env, "getOptionalEnv").mockImplementation(forbidden),
    vi.spyOn(env, "requireRuntimeEnv").mockImplementation(forbidden),
    vi.spyOn(env, "isLlmDebugTraceEnabled").mockImplementation(forbidden),
    vi.spyOn(storage, "getDatabase").mockImplementation(forbidden),
    vi.spyOn(providers, "selectedModel").mockImplementation(forbidden),
    vi
      .spyOn(providers, "selectedMemoryExtractionModel")
      .mockImplementation(forbidden),
    vi.spyOn(connector, "verifyConnectorToken").mockImplementation(forbidden),
    vi.spyOn(connector, "spawnGarminMcp").mockImplementation(forbidden),
  ];
  await Promise.all([
    import("../src/app/api/activities/route"),
    import("../src/app/api/activities/[garminId]/dashboard/route"),
    import("../src/app/api/activity-detail/route"),
    import("../src/app/api/chat/route"),
    import("../src/app/api/conversations/route"),
    import("../src/app/api/conversations/[conversationId]/route"),
    import("../src/app/api/delete/route"),
    import("../src/app/api/health-dashboard/route"),
    import("../src/app/api/memory/route"),
    import("../src/app/api/profile/route"),
    import("../src/app/api/summary/route"),
    import("../src/app/api/sync/route"),
    import("../src/app/api/training-plan/route"),
    import("../src/app/api/weekly/route"),
    import("../src/lib/memory/legacy-composition"),
    import("../src/lib/ai/sql-analysis"),
  ]);
  for (const probe of probes) expect(probe).not.toHaveBeenCalled();
});

it("keeps HTTP debug configuration request-time through the conversation application port", async () => {
  const env = await import("../src/lib/env");
  const debug = vi.spyOn(env, "isLlmDebugTraceEnabled").mockReturnValue(false);
  const { conversations } =
    await import("../src/lib/chat/conversation-composition");
  expect(debug).not.toHaveBeenCalled();
  expect(conversations.isDebugTraceEnabled()).toBe(false);
  debug.mockReturnValue(true);
  expect(conversations.isDebugTraceEnabled()).toBe(true);
  expect(debug).toHaveBeenCalledTimes(2);
});
