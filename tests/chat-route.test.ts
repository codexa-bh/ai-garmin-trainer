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

const rankingEvidence = {
  tool: "activityRanking" as const,
  privacy: "Computed from local normalized SQLite activity summaries only.",
  metrics: ["elevationGainMeters", "distanceMeters"] as const,
  rankings: {
    elevationGainMeters: [
      {
        garminId: "rank-1",
        label: "Source climb — Špik",
        labelSource: "garmin" as const,
        date: "2026-07-03",
        sport: "hiking",
        value: 1200,
        unit: "m",
        distanceMeters: 14000,
        durationSec: 7200,
        elevationGainMeters: 1200,
        avgHeartRate: 150,
      },
    ],
    distanceMeters: [
      {
        garminId: "rank-2",
        label: "Imported running on 2026-07-02 (Garmin ID rank-2)",
        labelSource: "fallback" as const,
        date: "2026-07-02",
        sport: "running",
        value: 21000,
        unit: "m",
        distanceMeters: 21000,
        durationSec: 3600,
        elevationGainMeters: 40,
        avgHeartRate: 165,
      },
    ],
    durationSec: [],
    avgHeartRate: [],
  },
  limitations: [],
  window: null,
};
const rankActivities = vi.fn(() => rankingEvidence);
const summarizeActivityRankings = vi.fn(() => rankingEvidence);

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

const generateText = vi.fn(
  async (options: { prompt: string; system: string; toolChoice?: string }) => {
    if (options.toolChoice === "none") {
      return {
        text: "After checking the disputed reference and the ordered ranking evidence, the demanding-activity answer should stay grounded in imported local data only.",
      };
    }
    if (
      options.system.includes("Evidence step 1:") &&
      options.prompt.includes("never did")
    ) {
      return {
        text: "",
        toolCalls: [
          {
            toolName: "rankActivities",
            input: { metrics: ["elevationGainMeters", "distanceMeters"] },
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
    if (options.system.includes("Evidence step 1: analyzeActivity")) {
      if (options.system.includes("latest-999")) {
        return {
          text: "The latest imported local activity is latest-999, based on normalized analytics evidence.",
        };
      }
      return {
        text: "The selected local activities 111111, 222222, and 333333 are ready for comparison from normalized analytics evidence.",
      };
    }
    if (options.system.includes("Evidence step 1: rankActivities")) {
      return {
        text: "Source climb — Špik stands out as the most demanding imported activity in the local ranking evidence.",
      };
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
            toolName: "analyzeActivity",
            input: {
              selectors: [
                { garminId: "111111" },
                { garminId: "222222" },
                { garminId: "333333" },
              ],
            },
          },
        ],
      };
    }
    if (prompt.includes("most demanding") || prompt.includes("last 365 days")) {
      return {
        toolCalls: [
          {
            toolName: "rankActivities",
            input: {
              metrics: ["elevationGainMeters", "distanceMeters"],
              windowDays: prompt.includes("365") ? 365 : undefined,
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
            toolName: "analyzeActivity",
            input: { selectors: [{ latest: true }] },
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

vi.mock("@/lib/garmin/importer", () => ({
  runGarminSync,
  backfillActivityDetail,
}));

vi.mock("@/lib/analytics/activity", () => ({
  summarizeActivityRankings,
  rankActivities,
  analyzeStoredActivity: (garminId: string) => ({
    tool: "analyzeStoredActivity",
    privacy: "local normalized SQLite only",
    activity: {
      garminId,
      name: `Activity ${garminId}`,
      sport: "hiking",
      date: "2026-07-01",
      distanceKm: 10,
      durationMin: 100,
      paceMinPerKm: 10,
      avgHeartRate: 140,
      maxHeartRate: 170,
      elevationGainMeters: 500,
    },
    availability: null,
    streamSummary: {
      records: 0,
      avgHeartRate: null,
      avgSpeedMps: null,
      avgGradePct: null,
      minAltitudeMeters: null,
      maxAltitudeMeters: null,
    },
    heartRateZones: [],
    climbs: [],
    laps: [],
    connectorDerived: null,
    similarEfforts: [],
    recoveryAfterActivity: [],
    limitations: [
      "No detailed FIT/stream backfill has been run for this activity yet.",
    ],
  }),
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
    rankActivities.mockClear();
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

  it("grounds every explicit activity ID through analyzeActivity", async () => {
    const payload = await postChat("Compare 111111 222222 333333");

    expect(payload.toolEvidence?.tool).toBe("analyzeActivity");
    expect(payload.assistant.content).toContain("111111");
    expect(payload.assistant.content).toContain("222222");
    expect(payload.assistant.content).toContain("333333");
  });

  it("routes demanding activity rankings through typed deterministic local rows", async () => {
    const payload = await postChat(
      "Which are my most demanding activities by elevation and distance?",
    );

    expect(rankActivities).toHaveBeenCalledWith({
      metrics: ["elevationGainMeters", "distanceMeters"],
      windowDays: undefined,
    });
    expect(payload.assistant.content).toContain("Source climb — Špik");
    expect(payload.assistant.content).not.toContain("Provider invented");
    expect(payload.toolEvidence?.tool).toBe("rankActivities");
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

  it("supports latest analysis only when the planner explicitly selects it", async () => {
    const latest = await postChat("Tell me about my latest activity");
    expect(latest.toolEvidence?.tool).toBe("analyzeActivity");
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
    expect(rankActivities).toHaveBeenCalledOnce();
    expect(payload.toolSteps?.map((step) => step.tool)).toEqual([
      "verifyActivityReference",
      "rankActivities",
    ]);
    const secondCall = generateText.mock.calls[1][0] as { system: string };
    expect(secondCall.system).toContain("server-authored prior tool evidence");
    expect(secondCall.system).toContain(
      "Evidence step 1: verifyActivityReference succeeded",
    );
    expect(secondCall.system).not.toContain("provider final");
  });
});
