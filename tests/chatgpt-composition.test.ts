import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { migrateDatabase } from "../src/lib/db/migrations";
import {
  initializeLiveConfiguration,
  applyChatgptConnections,
  getOptionalEnv,
} from "../src/lib/env";
import {
  initializeChatgptOwner,
  nativeChatgptCredential,
} from "../src/lib/ai/chatgpt-connection";
import { encodeSummarySelection } from "../src/lib/model-settings/summary-selection";
import { modelSettings } from "../src/lib/model-settings/composition";
import {
  prepareChatTurn,
  generateChatTurn,
  completeChatTurn,
  completeConversationTitle,
} from "../src/lib/chat/composition";
import { summaryStorage } from "../src/lib/db/summary-storage";
import { conversationHistory } from "../src/lib/db/conversation-history";
import {
  tickCrossChatSummary,
  executeSummaryCommand,
} from "../src/lib/memory/summary-composition";
import { stopSummaryLifetime } from "../src/lib/memory/summary-lifetime";
import { summaryImportInspection } from "../src/lib/db/summary-import";
import type { SummaryRebuildInspection } from "../src/lib/memory/summary-controls";
let db: Database.Database;
vi.mock("../src/lib/db/connection", () => ({ getDatabase: () => db }));
const owner = process as typeof process & {
  __trainerLiveConfigurationV1?: unknown;
  __trainerSummaryLifetimeV1?: unknown;
  __trainerChatgptOwnerV1?: unknown;
};
const registrationId = "registration_11111111-1111-4111-8111-111111111111";
const entry = {
  id: "entry_plan",
  provider: "chatgpt" as const,
  registrationId,
  modelId: "gpt-6.1-sol",
};
const connections = [
  {
    id: registrationId,
    epoch: 1,
    label: "synthetic@example.invalid · 1",
    state: "connected",
    planEnabled: true,
    disclosed: true,
    models: [{ slug: entry.modelId, displayName: "Authored account model" }],
  },
];
const capability =
  "11111111-1111-4111-8111-11111111111122222222-2222-4222-8222-222222222222";
let requests: Record<string, unknown>[];
let boot: string;
function response(text: string, tool = false): Response {
  const item = tool
    ? {
        type: "function_call",
        id: "fc_1",
        call_id: "call_1",
        name: "getSyncStatus",
        namespace: "trainer",
        arguments: "{}",
        status: "completed",
      }
    : {
        type: "message",
        id: "msg_1",
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text, annotations: [] }],
      };
  const events = [
    {
      type: "response.created",
      response: { id: "resp_1", created_at: 1, model: entry.modelId },
    },
    {
      type: "response.output_item.added",
      output_index: 0,
      item: tool
        ? { ...item, arguments: "", status: "in_progress" }
        : { type: "message", id: "msg_1" },
    },
    ...(tool
      ? [
          {
            type: "response.function_call_arguments.delta",
            item_id: "fc_1",
            delta: "{}",
            output_index: 0,
          },
        ]
      : [
          { type: "response.output_text.delta", item_id: "msg_1", delta: text },
        ]),
    { type: "response.output_item.done", output_index: 0, item },
    {
      type: "response.completed",
      response: {
        status: "completed",
        output: [item],
        usage: { input_tokens: 200, output_tokens: 30 },
      },
    },
  ];
  return new Response(
    events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
    { headers: { "content-type": "text/event-stream" } },
  );
}
beforeEach(() => {
  delete owner.__trainerLiveConfigurationV1;
  delete owner.__trainerSummaryLifetimeV1;
  delete owner.__trainerChatgptOwnerV1;
  db = new Database(":memory:");
  migrateDatabase(db);
  requests = [];
  boot = randomUUID();
  for (const key of [
    "OPENAI_API_KEY",
    "DEEPSEEK_API_KEY",
    "OPENROUTER_API_KEY",
  ])
    vi.stubEnv(key, "");
  vi.stubEnv("AI_PROVIDER", "auto");
  vi.stubEnv(
    "CHAT_MODEL_CATALOG",
    JSON.stringify({ version: 1, entries: [entry], defaultEntryId: null }),
  );
  vi.stubEnv("CHATGPT_CONNECTIONS", JSON.stringify(connections));
  vi.stubEnv("SUMMARY_MODEL", encodeSummarySelection(entry));
  vi.stubEnv("SUMMARY_ENABLED", "false");
  vi.stubEnv("MEMORY_ENABLED", "false");
  initializeChatgptOwner({ version: 1, port: 17777, capability, connections });
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (url, init) => {
      if (String(url) === "http://127.0.0.1:17777/credential") {
        expect(new Headers(init?.headers).get("x-chatgpt-owner")).toBe(
          capability,
        );
        const value = JSON.parse(String(init?.body));
        expect(value.registrationId).toBe(registrationId);
        expect(value.epoch).toBe(1);
        return Response.json(
          value.operation === "credential"
            ? { accessToken: "authored-native-token", epoch: 1 }
            : { current: true },
        );
      }
      expect(String(url)).toBe("https://api.openai.com/v1/responses");
      expect(new Headers(init?.headers).get("Authorization")).toBe(
        "Bearer authored-native-token",
      );
      const body = JSON.parse(String(init?.body));
      requests.push(body);
      const name = body.text?.format?.name;
      if (name === "chat_title")
        return response('{"title":"Recovery preference"}');
      if (name === "summary_maintenance")
        return response(
          '{"summary":"Prefers short weekday recovery sessions.","exclude":[]}',
        );
      if (name === "summary_text")
        return response('{"summary":"Short weekday sessions."}');
      return response(
        "Sync status was checked locally; no remote login was attempted.",
        Boolean(
          body.tools &&
          !body.input.some(
            (item: { type?: string }) => item.type === "function_call_output",
          ),
        ),
      );
    }),
  );
});
afterEach(() => {
  stopSummaryLifetime();
  db.close();
  delete owner.__trainerLiveConfigurationV1;
  delete owner.__trainerSummaryLifetimeV1;
  delete owner.__trainerChatgptOwnerV1;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});
it.each([false, true])(
  "production coaching/tool/history/title composition works with every API key absent, Summary On=%s",
  async (enabled) => {
    vi.stubEnv("SUMMARY_ENABLED", String(enabled));
    initializeLiveConfiguration(boot);
    modelSettings.save({ modelId: entry.id });
    const completeMemory =
      "Authored complete saved continuity: prefers short weekdays. " +
      "Stable continuity 模型🙂 ".repeat(2500);
    if (enabled) {
      summaryStorage.configure(true, encodeSummarySelection(entry), 6000);
      summaryStorage.editSummary(
        summaryStorage.version(),
        completeMemory,
        Date.now(),
      );
    }
    const turn = prepareChatTurn(
      "subscription-chat",
      "Check local sync status without contacting Garmin.",
    );
    const answer = await generateChatTurn(
      { ...turn },
      { debugTraceEnabled: true },
    );
    expect(answer.kind).toBe("generated");
    if (answer.kind !== "generated")
      throw new Error("Expected generated answer");
    expect(answer.toolSteps).toContainEqual(
      expect.objectContaining({ tool: "getSyncStatus", status: "succeeded" }),
    );
    expect(answer.conversationContext?.reason).toBe("subscription-replay");
    expect(answer.text).toContain("checked locally");
    await completeChatTurn(turn, answer);
    await completeConversationTitle(turn);
    expect(
      requests.some(
        (body) =>
          (body.text as { format?: { name?: string } })?.format?.name ===
          "chat_title",
      ),
    ).toBe(true);
    if (enabled)
      expect(JSON.stringify(requests[0].input)).toContain(completeMemory);
    const next = prepareChatTurn(
      "subscription-chat",
      "Continue from the prior answer.",
    );
    const continued = await generateChatTurn(next, {
      debugTraceEnabled: false,
    });
    expect(JSON.stringify(requests.at(-1)!.input)).toContain(answer.text);
    await completeChatTurn(next, continued);
    for (const body of requests) {
      expect(body.store).toBe(false);
      expect(body.stream).toBe(true);
      expect(body).not.toHaveProperty("temperature");
      expect(body).not.toHaveProperty("max_output_tokens");
    }
    expect(getOptionalEnv().OPENAI_API_KEY).toBe("");
    expect(JSON.stringify(requests)).not.toContain("authored-native-token");
    expect(
      Object.values(process.env).some((value) => value?.includes(capability)),
    ).toBe(false);
  },
);
it("production summary maintenance and optional Densify use the independent plan choice without a monetary API estimate", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-11T12:00:00Z"));
  vi.stubEnv("SUMMARY_ENABLED", "true");
  initializeLiveConfiguration(boot);
  await tickCrossChatSummary(boot);
  for (let index = 0; index < 4; index++) {
    const admitted = conversationHistory.admit(
      `source-${index}`,
      "I prefer short weekday recovery sessions.",
    );
    conversationHistory.complete(admitted.admission, {
      content: "User preference recorded in this synthetic conversation.",
      grounding: null,
    });
  }
  await tickCrossChatSummary(boot);
  vi.setSystemTime(Date.now() + 10001);
  await tickCrossChatSummary(boot);
  expect(summaryStorage.read().text).toBe(
    "Prefers short weekday recovery sessions.",
  );
  expect(summaryStorage.status(Date.now()).priceBasis).toBe(
    "chatgpt-plan-or-credits/observed-tokens-not-api-money",
  );
  const result = await executeSummaryCommand({
    action: "densify-request",
    version: 2,
    id: randomUUID(),
    expected: summaryStorage.version(),
  });
  expect(result).toHaveProperty("densify");
  expect(
    requests.some(
      (body) =>
        (body.text as { format?: { name?: string } })?.format?.name ===
        "summary_text",
    ),
  ).toBe(true);
});
it.each(["rebuild", "import"])(
  "production reviewed %s uses the independent plan factory with no API key or embedding/counting prerequisite",
  async (mode) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-11T12:00:00Z"));
    for (let index = 0; index < 2; index++) {
      const source = conversationHistory.admit(
        `off-source-${index}`,
        `Authored historical preference ${index}: short weekday recovery sessions.`,
      );
      conversationHistory.complete(source.admission, {
        content: "Historical preference acknowledged.",
        grounding: null,
      });
    }
    vi.stubEnv("SUMMARY_ENABLED", "true");
    initializeLiveConfiguration(boot);
    await tickCrossChatSummary(boot);
    if (mode === "import") {
      const ids = summaryImportInspection().candidates.map(
        (source) => source.id,
      );
      expect(ids).toHaveLength(2);
      await executeSummaryCommand({
        version: 2,
        action: "import-create",
        sourceIds: ids,
        expected: summaryStorage.version(),
      });
    } else {
      const selection = {
        version: 1 as const,
        conversationIds: null,
        includeLegacy: false,
      };
      const review = (await executeSummaryCommand({
        version: 2,
        action: "rebuild-review",
        selection,
        expected: summaryStorage.version(),
      })) as SummaryRebuildInspection;
      expect(review.ready).toBe(true);
      expect(review.counts.includedUserMessages).toBe(2);
      await executeSummaryCommand({
        version: 2,
        action: "rebuild-start",
        id: randomUUID(),
        snapshot: review.snapshot,
        selection,
        expected: summaryStorage.version(),
      });
    }
    vi.setSystemTime(Date.now() + 130000);
    await tickCrossChatSummary(boot);
    expect(summaryStorage.read().text).toBe(
      "Prefers short weekday recovery sessions.",
    );
    expect(requests).toHaveLength(1);
    expect(JSON.stringify(requests[0].input)).toContain(
      "Authored historical preference 0",
    );
    expect(JSON.stringify(requests[0].input)).toContain(
      "Authored historical preference 1",
    );
    expect(requests[0]).toMatchObject({ store: false, stream: true });
    if (mode === "import")
      expect(summaryImportInspection().manifests[0].state).toBe("complete");
    expect(getOptionalEnv().OPENAI_API_KEY).toBe("");
  },
);
it("authenticated native refusal updates availability without credential grant, inference replay or stale metadata resurrection", async () => {
  initializeLiveConfiguration(boot);
  modelSettings.save({ modelId: entry.id });
  vi.mocked(fetch).mockResolvedValueOnce(
    Response.json(
      {
        code: "chatgpt_connection_unavailable",
        connections: [
          {
            ...connections[0],
            epoch: 2,
            state: "reconnect-required",
            planEnabled: false,
          },
        ],
      },
      { status: 409 },
    ),
  );
  await expect(
    nativeChatgptCredential(
      "current",
      registrationId,
      1,
      new AbortController().signal,
    ),
  ).rejects.toThrow("chatgpt_connection_unavailable");
  expect(modelSettings.read().available).toBe(false);
  expect(() => applyChatgptConnections(connections)).toThrow(
    "chatgpt_stale_activation",
  );
  expect(modelSettings.read().available).toBe(false);
  expect(requests).toHaveLength(0);
  expect(getOptionalEnv().OPENAI_API_KEY).toBe("");
});
it("native disconnect invalidates captured generation before tools and copied-turn completion, not unrelated API-key state", async () => {
  initializeLiveConfiguration(boot);
  modelSettings.save({ modelId: entry.id });
  const turn = prepareChatTurn("disconnect-chat", "Check local status.");
  const answer = await generateChatTurn(
    { ...turn },
    { debugTraceEnabled: false },
  );
  applyChatgptConnections([
    {
      ...connections[0],
      epoch: 2,
      state: "disconnected",
      planEnabled: false,
      models: [],
    },
  ]);
  await expect(completeChatTurn(turn, answer)).rejects.toThrow(
    "conversation_context_invalidated",
  );
  expect(modelSettings.read().available).toBe(false);
  expect(getOptionalEnv().OPENAI_API_KEY).toBe("");
});
