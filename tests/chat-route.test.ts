import { beforeEach, describe, expect, it, vi } from "vitest";

const runGarminSync = vi.fn(async () => ({
  status: "completed",
  activitiesImported: 1,
  healthDaysImported: 2,
  detailsProcessed: 0,
  coverageStart: "2026-07-15",
  coverageEnd: "2026-07-17",
  detailCoverage: {
    total: 1,
    pending: 0,
    available: 1,
    partial: 0,
    unsupported: 0,
    retryableFailures: 0,
    preservedFailures: 0,
    inProgress: 0,
    terminal: 1,
  },
  detail: "sync complete",
}));
const backfillActivityDetail = vi.fn(async () => ({
  status: "failed",
  garminId: "123456",
  detailStatus: "failed",
  recordCount: 99,
  lapCount: 3,
  preservedPrevious: true,
  retryable: true,
  detail:
    "temporary connector error. Previous usable normalized detail was preserved.",
}));

const verifyActivityReference = vi.fn(
  (reference: {
    garminId?: string | null;
    suppliedName?: string | null;
    date?: string | null;
  }) => {
    const suppliedName = reference.suppliedName ?? "Snežnik";
    const base = {
      tool: "activityVerification" as const,
      reference: {
        garminId: reference.garminId ?? null,
        suppliedName,
        date: reference.date ?? null,
      },
      importedCoverage: {
        activityCount: 301,
        earliestDate: "2020-01-01",
        latestDate: "2026-07-20",
      },
      privacy:
        "Verified against local normalized SQLite activity summaries only.",
    };
    if (suppliedName === "Selo - Rašica") {
      return {
        ...base,
        outcome: "found" as const,
        matches: [
          {
            garminId: "23667792496",
            label: "Selo - Rašica",
            labelSource: "garmin" as const,
            date: "2026-07-20",
            sport: "hiking",
            distanceMeters: 12340,
            durationSec: 4567,
            elevationGainMeters: 890,
            avgHeartRate: 141,
          },
        ],
      };
    }
    if (suppliedName === "Duplicate") {
      return {
        ...base,
        outcome: "ambiguous" as const,
        matches: [
          {
            garminId: "dup-1",
            label: "Duplicate",
            labelSource: "garmin" as const,
            date: "2026-07-19",
            sport: "hiking",
            distanceMeters: null,
            durationSec: null,
            elevationGainMeters: null,
            avgHeartRate: null,
          },
          {
            garminId: "dup-2",
            label: "Duplicate",
            labelSource: "garmin" as const,
            date: "2026-07-18",
            sport: "hiking",
            distanceMeters: null,
            durationSec: null,
            elevationGainMeters: null,
            avgHeartRate: null,
          },
        ],
      };
    }
    return { ...base, outcome: "not_found" as const, matches: [] };
  },
);

const describeGarminDatabase = vi.fn(() => ({
  tool: "describeGarminDatabase",
  status: "succeeded",
  tables: [{ name: "activity", rowCount: 301, columns: [] }],
  forbiddenDataClasses: ["auth/session/account/verification rows"],
  examples: [],
  limits: {},
  privacy: "schema privacy",
}));
const runReadOnlySql = vi.fn((input: { resultName?: string }) => ({
  status: "succeeded",
  resultName: input.resultName ?? "sql_rows",
  columns: [{ name: "garmin_id" }, { name: "name" }],
  rows: [
    { garmin_id: "latest-999", name: "Newest unrelated", duration_sec: 1800 },
    {
      garmin_id: "source-1",
      name: "Source climb — Špik",
      duration_sec: 7200,
      elevation_gain_meters: 1300,
    },
  ],
  rowCount: 2,
  returnedRows: 2,
  truncated: false,
  privacy: "sql privacy",
}));
const runMathAnalysis = vi.fn(
  (input: { inputResult: string; operation?: string }) => ({
    status: "succeeded",
    resultName: "demand_scores",
    inputResult: input.inputResult,
    operation: input.operation ?? "score",
    rows: [
      {
        garmin_id: "source-1",
        name: "Source climb — Špik",
        sport: "hiking",
        sport_normalized_demand_score: 100,
        available_metric_count: 6,
      },
    ],
    rowCount: 1,
    returnedRows: 1,
    truncated: false,
    privacy: "math privacy",
  }),
);

const generateText = vi.fn(
  async (options: { prompt: string; system: string; toolChoice?: string }) => {
    if (options.toolChoice === "none") {
      return {
        text: "After checking the disputed reference and the ordered ranking evidence, the demanding-activity answer should stay grounded in imported local data only.",
      };
    }
    if (
      options.system.includes("Evidence step 1:") &&
      !options.system.includes("runReadOnlySql") &&
      options.prompt.includes("never did")
    ) {
      return {
        text: "",
        toolCalls: [
          {
            toolName: "runReadOnlySql",
            input: {
              sql: "select garmin_id, name, duration_sec from activity order by duration_sec desc",
              resultName: "verified_activity_rows",
              maxRows: 5,
            },
          },
        ],
      };
    }
    if (options.system.includes("Evidence step 1: getSyncStatus")) {
      return {
        text: "Your local Garmin import is available with detail coverage 1/3 terminal.",
      };
    }
    if (options.system.includes("Evidence step 1: runGarminSync")) {
      return {
        text: "Garmin sync complete; the local normalized store was updated.",
      };
    }
    if (
      options.system.includes("Evidence step 1: runMathAnalysis") ||
      options.system.includes("Evidence step 2: runMathAnalysis") ||
      options.system.includes("Evidence step 3: runMathAnalysis")
    ) {
      if (options.prompt.toLowerCase().includes("snowboard")) {
        return {
          text: "Under sport-normalized generic criteria, I checked whether snowboardings qualified without dumping raw tool steps.",
        };
      }
      return {
        text: "Source climb — Špik stands out in the bounded SQL/math evidence.",
      };
    }
    if (options.system.includes("Evidence step 1: runReadOnlySql")) {
      if (options.prompt.includes("latest activity")) {
        return {
          text: "The latest imported local activity is latest-999, based on read-only SQL evidence.",
        };
      }
      if (
        options.prompt.includes("most demanding") ||
        options.prompt.toLowerCase().includes("snowboard")
      ) {
        return {
          toolCalls: [
            {
              toolName: "runMathAnalysis",
              input: {
                inputResult: "demand_rows",
                operation: "sportNormalizedDemand",
                orderBy: [
                  {
                    field: "sport_normalized_demand_score",
                    direction: "desc",
                  },
                ],
                limit: 10,
              },
            },
          ],
        };
      }
      return { text: "provider final" };
    }
    if (options.system.includes("Evidence step 1: verifyActivityReference")) {
      if (options.system.includes("No matching normalized local activity")) {
        return {
          text: "No matching normalized local activity was found in the imported corpus, so I would not use an arbitrary latest fallback.",
        };
      }
      if (options.system.includes("Garmin ID 23667792496")) {
        return {
          text: "I found Selo - Rašica as Garmin ID 23667792496 with distance 12340 m in local imported data.",
        };
      }
      if (
        options.system.includes("dup-1") &&
        options.system.includes("dup-2")
      ) {
        return {
          text: "The Duplicate reference is ambiguous between dup-1 and dup-2 in local imported data.",
        };
      }
    }
    if (options.system.includes("Evidence step 1:"))
      return { text: "provider final" };
    const prompt = options.prompt;
    if (prompt.includes("sync status")) {
      return { toolCalls: [{ toolName: "getSyncStatus", input: {} }] };
    }
    if (prompt === "sync Garmin now") {
      return { toolCalls: [{ toolName: "runGarminSync", input: {} }] };
    }
    if (prompt.includes("Force refresh")) {
      return {
        toolCalls: [
          {
            toolName: "forceRefreshActivityDetail",
            input: { garminId: "123456" },
          },
        ],
      };
    }
    if (prompt.includes("Compare 111111")) {
      return {
        toolCalls: [
          {
            toolName: "runReadOnlySql",
            input: {
              sql: "select garmin_id, name, duration_sec from activity where garmin_id in ('111111','222222','333333')",
              resultName: "comparison_rows",
              maxRows: 3,
            },
          },
        ],
      };
    }
    if (
      prompt.includes("most demanding") ||
      prompt.includes("last 365 days") ||
      prompt.toLowerCase().includes("snowboard")
    ) {
      return {
        toolCalls: [
          {
            toolName: "runReadOnlySql",
            input: {
              sql: "select garmin_id, name, duration_sec, elevation_gain_meters from activity order by started_at desc",
              resultName: "demand_rows",
              maxRows: 50,
            },
          },
        ],
      };
    }
    if (prompt.includes("Triglav summit hike")) {
      return {
        toolCalls: [
          {
            toolName: "verifyActivityReference",
            input: { suppliedName: "Triglav summit hike" },
          },
        ],
      };
    }
    if (prompt.includes("Selo - Rašica")) {
      return {
        toolCalls: [
          {
            toolName: "verifyActivityReference",
            input: { suppliedName: "Selo - Rašica" },
          },
        ],
      };
    }
    if (prompt.includes("Duplicate")) {
      return {
        toolCalls: [
          {
            toolName: "verifyActivityReference",
            input: { suppliedName: "Duplicate" },
          },
        ],
      };
    }
    if (prompt.includes("latest activity")) {
      return {
        toolCalls: [
          {
            toolName: "runReadOnlySql",
            input: {
              sql: "select garmin_id, name, started_at from activity order by started_at desc",
              resultName: "latest_activity",
              maxRows: 1,
            },
          },
        ],
      };
    }
    if (prompt.includes("never did") && prompt.includes("Snežnik")) {
      return {
        toolCalls: [
          {
            toolName: "verifyActivityReference",
            input: { suppliedName: "Snežnik", date: "2025-10-18" },
          },
        ],
      };
    }
    return { text: "model response" };
  },
);

const coverage = {
  total: 3,
  pending: 2,
  available: 1,
  partial: 0,
  unsupported: 0,
  retryableFailures: 0,
  preservedFailures: 0,
  inProgress: 0,
  terminal: 1,
};

let messages: Array<{
  id: string;
  conversationId: string;
  role: "user" | "assistant";
  content: string;
  grounding: Record<string, unknown> | null;
  createdAt: Date;
}> = [];
let memoryProposals: Array<{
  id: string;
  category: string;
  value: string;
  status: string;
  sourceType: string;
  sourceRef: string | null;
  provenanceText: string;
  createdAt: Date;
  updatedAt: Date;
}> = [];
let activeMemories: Array<{
  id: string;
  category: "learned_preference";
  value: string;
  provenanceText: string;
  expiresAt: null;
  reconfirmAfter: null;
}> = [];

vi.mock("ai", () => ({
  generateText,
  tool: (definition: unknown) => definition,
}));

vi.mock("@/lib/ai/providers", () => ({
  selectedModel: () => ({ model: "mock-model" }),
}));

vi.mock("@/lib/ai/sql-analysis", () => ({
  describeGarminDatabase,
  runReadOnlySql,
}));

vi.mock("@/lib/ai/math-analysis", () => ({
  runMathAnalysis,
}));

vi.mock("@/lib/garmin/importer", () => ({
  runGarminSync,
  backfillActivityDetail,
}));

const generatedDatasetEvidence = {
  tool: "generatedGarminAnalysis" as const,
  status: "succeeded" as const,
  requestedCount: 10,
  scriptHash: "abcdef1234567890",
  manifest: {
    generatedAt: "2026-07-21T12:00:00.000Z",
    request: "top 10 generated dataset rows",
    selectedDatasets: ["activities"],
    datasets: [{ name: "activities", rowCount: 10, description: "" }],
    tables: [{ name: "activities", rowCount: 10 }],
    rawPayloads: [],
    limits: {
      maxRowsPerTable: 1000,
      maxRawPayloads: 100,
      maxRawPayloadBytes: 200000,
      maxOutputBytes: 12000,
    },
    scriptContract: {
      resultVariable: "RESULT" as const,
      allowedImports: ["math"],
      forbiddenAccess: ["filesystem"],
    },
  },
  result: {
    kind: "ranking",
    title: "Generated dataset ranking",
    requestedCount: 10,
    returnedCount: 2,
    rows: [
      {
        rank: 1,
        garminId: "rank-1",
        label: "Source climb — Špik",
        value: 1200,
        units: "computed",
      },
      {
        rank: 2,
        garminId: "latest-999",
        label: "Latest activity latest-999",
        value: 900,
        units: "computed",
      },
    ],
    limitations: [],
  },
  warnings: [],
  privacy:
    "Generated Python ran locally against explicit read-only Garmin datasets.",
};
const runGeneratedGarminAnalysis = vi.fn(async () => generatedDatasetEvidence);

vi.mock("@/lib/ai/generated-analysis", () => ({
  runGeneratedGarminAnalysis,
}));

vi.mock("@/lib/db/repository", () => ({
  DEFAULT_CONVERSATION_ID: "default",
  activityDetailCoverage: () => coverage,
  dataCounts: () => ({
    activities: 3,
    healthDays: 10,
    detailedActivities: 1,
    detailCoverage: coverage,
  }),
  ensureConversation: vi.fn(),
  createTrainerMemoryProposal: vi.fn((input) => {
    const memory = {
      id: `memory-${memoryProposals.length + 1}`,
      category: input.category,
      value: input.value,
      status: "pending_confirmation",
      sourceType: input.sourceType,
      sourceRef: input.sourceRef ?? null,
      provenanceText: input.provenanceText,
      createdAt: new Date("2026-07-17T12:00:00Z"),
      updatedAt: new Date("2026-07-17T12:00:00Z"),
    };
    memoryProposals.push(memory);
    return memory;
  }),
  appendChatMessage: vi.fn((input) => {
    const message = {
      id: `${input.role}-${messages.length + 1}`,
      conversationId: input.conversationId ?? "default",
      role: input.role,
      content: input.content,
      grounding: input.grounding ?? null,
      createdAt: new Date("2026-07-17T12:00:00Z"),
    };
    messages.push(message);
    return message;
  }),
  listRecentChatMessages: vi.fn((conversationId = "default") =>
    messages.filter((message) => message.conversationId === conversationId),
  ),
  clearConversationHistory: vi.fn((conversationId = "default") => {
    messages = messages.filter(
      (message) => message.conversationId !== conversationId,
    );
  }),
  getGarminAthleteBaseline: () => ({
    availability: "partial",
    source: "garmin_mcp",
    fetchedAt: "2026-07-17T12:00:00.000Z",
    lastAttemptAt: "2026-07-17T12:00:00.000Z",
    preservedPrevious: false,
    values: {
      runningLactateThresholdHeartRateBpm: 168,
      cyclingLactateThresholdHeartRateBpm: null,
      rowingLactateThresholdHeartRateBpm: null,
      cyclingFtpWatts: null,
      cyclingFtpMeasuredOn: null,
      cyclingFtpSourceStale: null,
      vo2MaxRunning: null,
      vo2MaxCycling: null,
      availableTrainingDays: [],
      preferredLongTrainingDays: [],
    },
    unsupported: {
      configuredMaxHeartRate: true,
      completeHeartRateZoneBoundaries: true,
      reason: "not_exposed_by_pinned_connector",
    },
  }),
  getActivityByGarminId: vi.fn((garminId: string) =>
    ["123456", "111111", "222222", "333333", "latest-999"].includes(garminId)
      ? {
          garminId,
          name:
            garminId === "123456" ? "Known activity" : `Activity ${garminId}`,
          sport: "hiking",
          startedAt: new Date("2026-07-01T07:00:00Z"),
          durationSec: 3600,
          distanceMeters: 10000,
          calories: null,
          avgHeartRate: 140,
          maxHeartRate: 170,
          steps: null,
          elevationGainMeters: 500,
          elevationLossMeters: 500,
          trainingEffect: null,
        }
      : null,
  ),
  getTrainerProfile: () => ({
    goals: [],
    sports: [],
    preferences: {},
    constraints: [],
  }),
  listActiveTrainerMemories: () => activeMemories,
  listActivityDetailAvailability: () => [],
  listRecentActivities: () => [
    {
      garminId: "latest-999",
      name: "Newest unrelated",
      sport: "running",
      startedAt: new Date("2026-07-20T06:00:00Z"),
      durationSec: 1800,
      distanceMeters: 5000,
      calories: null,
      avgHeartRate: 140,
      maxHeartRate: 170,
      steps: null,
      elevationGainMeters: 50,
      elevationLossMeters: 50,
      trainingEffect: null,
    },
  ],
  verifyActivityReference,
  listRecentDailyHealth: () => [],
  getActivityDetailForAnalytics: () => ({
    availability: null,
    laps: [],
    stream: [],
  }),
}));

async function postChat(message: string, conversationId?: string) {
  vi.resetModules();
  const { POST } = await import("../src/app/api/chat/route");
  const response = await POST(
    new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message, conversationId }),
    }),
  );
  return response.json() as Promise<{
    assistant: { content: string };
    toolEvidence?: {
      tool?: string;
      summary?: string;
      toolSteps?: Array<{ tool: string }>;
    } | null;
    toolSteps?: Array<{ tool: string; status: string }>;
    memoryProposal?:
      | { status: "none" }
      | { status: "pending"; id: string; value: string }
      | { status: "skipped"; reason: string };
  }>;
}

describe("chat route LLM tool orchestration", () => {
  beforeEach(() => {
    messages = [];
    memoryProposals = [];
    activeMemories = [];
    generateText.mockClear();
    runGarminSync.mockClear();
    backfillActivityDetail.mockClear();
    runGeneratedGarminAnalysis.mockClear();
    describeGarminDatabase.mockClear();
    runReadOnlySql.mockClear();
    runMathAnalysis.mockClear();
    verifyActivityReference.mockClear();
  });

  it("lets the planner select local sync status and returns ordered grounding", async () => {
    const payload = await postChat(
      "What is my sync status and detail coverage?",
    );

    expect(payload.toolEvidence?.tool).toBe("getSyncStatus");
    expect(payload.toolSteps?.[0]).toMatchObject({
      tool: "getSyncStatus",
      status: "succeeded",
    });
    expect(payload.assistant.content).toContain("detail coverage 1/3 terminal");
    expect(generateText).toHaveBeenCalledTimes(2);
  });

  it("executes a selected Garmin sync once", async () => {
    const payload = await postChat("sync Garmin now");

    expect(runGarminSync).toHaveBeenCalledOnce();
    expect(payload.toolEvidence?.tool).toBe("runGarminSync");
    expect(payload.assistant.content).toContain("sync complete");
  });

  it("runs forced targeted refresh with preservation evidence", async () => {
    const payload = await postChat(
      "Force refresh Garmin activity 123456 detail now",
    );

    expect(backfillActivityDetail).toHaveBeenCalledWith("123456", {
      force: true,
    });
    expect(payload.toolEvidence?.tool).toBe("forceRefreshActivityDetail");
    expect(payload.assistant.content).toContain(
      "preserved previous usable detail yes",
    );
  });

  it("routes explicit activity ID comparisons through read-only SQL", async () => {
    const payload = await postChat("Compare 111111 222222 333333");

    expect(payload.toolEvidence?.tool).toBe("runReadOnlySql");
    expect(runReadOnlySql).toHaveBeenCalledWith(
      expect.objectContaining({
        resultName: "comparison_rows",
        maxRows: 3,
      }),
    );
    expect(runGeneratedGarminAnalysis).not.toHaveBeenCalled();
  });

  it("routes demanding activity rankings through read-only SQL and bounded math", async () => {
    const payload = await postChat(
      "Which are my most demanding activities by elevation and distance?",
    );

    expect(runReadOnlySql).toHaveBeenCalledWith(
      expect.objectContaining({ resultName: "demand_rows", maxRows: 50 }),
    );
    expect(runMathAnalysis).toHaveBeenCalledOnce();
    expect(runGeneratedGarminAnalysis).not.toHaveBeenCalled();
    expect(payload.assistant.content).toContain("Source climb — Špik");
    expect(payload.assistant.content).not.toContain("Provider invented");
    expect(runMathAnalysis).toHaveBeenCalledWith(
      expect.objectContaining({ operation: "sportNormalizedDemand" }),
    );
    expect(payload.toolEvidence?.tool).toBe("runMathAnalysis");
  });

  it("answers snowboarding demand follow-ups with sport-normalized criteria", async () => {
    const payload = await postChat(
      "This looks pretty good list for hiking. But no snowboardings qualified? Could we invent the more generic criteria?",
    );

    expect(runReadOnlySql).toHaveBeenCalledWith(
      expect.objectContaining({ resultName: "demand_rows", maxRows: 50 }),
    );
    expect(runMathAnalysis).toHaveBeenCalledWith(
      expect.objectContaining({ operation: "sportNormalizedDemand" }),
    );
    expect(payload.assistant.content).toContain("sport-normalized");
    expect(payload.assistant.content).toContain("snowboarding");
    expect(payload.assistant.content).not.toContain("Tool step");
    expect(payload.toolEvidence?.tool).toBe("runMathAnalysis");
  });

  it("performs named lookup without arbitrary latest fallback", async () => {
    const payload = await postChat(
      "Triglav summit hike.... give me activity id, give me all you know about it",
    );

    expect(verifyActivityReference).toHaveBeenCalledWith({
      suppliedName: "Triglav summit hike",
    });
    expect(payload.toolEvidence?.tool).toBe("verifyActivityReference");
    expect(payload.assistant.content).toContain(
      "No matching normalized local activity was found",
    );
    expect(payload.assistant.content).not.toContain("latest-999");
  });

  it("returns found and ambiguous lookup evidence", async () => {
    const found = await postChat("what is the Garmin ID for Selo - Rašica?");
    expect(found.assistant.content).toContain("Garmin ID 23667792496");
    expect(found.assistant.content).toContain("distance 12340 m");

    messages = [];
    const ambiguous = await postChat("find activity named Duplicate");
    expect(ambiguous.assistant.content).toContain("dup-1");
    expect(ambiguous.assistant.content).toContain("dup-2");
  });

  it("supports latest analysis only when the planner writes a bounded SQL query", async () => {
    const latest = await postChat("Tell me about my latest activity");
    expect(latest.toolEvidence?.tool).toBe("runReadOnlySql");
    expect(latest.assistant.content).toContain("latest-999");

    messages = [];
    const generic = await postChat("I never did this activity");
    expect(generic.toolEvidence).toBeNull();
    expect(generic.assistant.content).toBe("model response");
  });

  it("creates a pending learned-memory proposal from explicit remember intent", async () => {
    const payload = await postChat("remember that I prefer morning hikes");

    expect(payload.memoryProposal).toMatchObject({
      status: "pending",
      value: "I prefer morning hikes",
    });
    expect(memoryProposals).toHaveLength(1);
    expect(memoryProposals[0]).toMatchObject({
      status: "pending_confirmation",
      sourceType: "chat_explicit_intent",
      sourceRef: "user-1",
    });
    const firstCall = generateText.mock.calls[0][0] as { system: string };
    expect(firstCall.system).toContain(
      "Confirmed learned memories:\nNone confirmed",
    );
  });

  it("keeps manual new-chat context separate while retaining confirmed memories", async () => {
    await postChat("Old transcript phrase should stay in default only");
    activeMemories = [
      {
        id: "memory-active",
        category: "learned_preference",
        value: "Prefers morning hikes.",
        provenanceText: "User approved memory.",
        expiresAt: null,
        reconfirmAfter: null,
      },
    ];
    generateText.mockClear();

    await postChat("How should I train tomorrow?", "local-new-chat-test");

    const firstCall = generateText.mock.calls[0][0] as { system: string };
    expect(firstCall.system).not.toContain("Old transcript phrase");
    expect(firstCall.system).toContain("Prefers morning hikes");
  });

  it("uses a fresh second planner call with only server summaries", async () => {
    const payload = await postChat(
      "2025-10-18 | Snežnik — I never did this activity",
    );

    expect(verifyActivityReference).toHaveBeenCalledWith({
      suppliedName: "Snežnik",
      date: "2025-10-18",
    });
    expect(runReadOnlySql).not.toHaveBeenCalled();
    expect(runGeneratedGarminAnalysis).not.toHaveBeenCalled();
    expect(payload.toolSteps?.map((step) => step.tool)).toEqual([
      "verifyActivityReference",
    ]);
    const secondCall = generateText.mock.calls[1][0] as { system: string };
    expect(secondCall.system).toContain("server-authored prior tool evidence");
    expect(secondCall.system).toContain(
      "Evidence step 1: verifyActivityReference succeeded",
    );
    expect(secondCall.system).not.toContain("provider final");
  });
});
