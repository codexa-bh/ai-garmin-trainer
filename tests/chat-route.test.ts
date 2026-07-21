import { beforeEach, describe, expect, it, vi } from "vitest";

const generateText = vi.fn(async () => ({ text: "model response" }));
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
  tool: "activityRanking",
  privacy: "Computed from local normalized SQLite activity summaries only.",
  metrics: ["elevationGainMeters", "distanceMeters"],
  rankings: {
    elevationGainMeters: [
      {
        garminId: "rank-1",
        label: "Source climb — Špik",
        labelSource: "garmin",
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
        labelSource: "fallback",
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
  window: undefined as
    { label: string; days: number; startedAfter: string } | undefined,
};
const summarizeActivityRankings = vi.fn(() => rankingEvidence);

const verifyActivityReference = vi.fn(
  (reference: {
    garminId?: string | null;
    suppliedName?: string | null;
    date?: string | null;
  }) => {
    const suppliedName = reference.suppliedName ?? "Snežnik";
    const base = {
      tool: "activityVerification",
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
        outcome: "found",
        matches: [
          {
            garminId: "23667792496",
            label: "Selo - Rašica",
            labelSource: "garmin",
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
        outcome: "ambiguous",
        matches: [
          {
            garminId: "dup-1",
            label: "Duplicate",
            labelSource: "garmin",
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
            labelSource: "garmin",
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
    return {
      ...base,
      outcome: "not_found",
      matches: [],
    };
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

vi.mock("ai", () => ({
  generateText,
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
  listRecentChatMessages: vi.fn(() => [...messages]),
  clearConversationHistory: vi.fn(() => {
    messages = [];
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
    garminId === "123456"
      ? {
          garminId,
          name: "Known activity",
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
  listActiveTrainerMemories: () => [],
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
}));

async function postChat(message: string) {
  vi.resetModules();
  const { POST } = await import("../src/app/api/chat/route");
  const response = await POST(
    new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message }),
    }),
  );
  return response.json() as Promise<{
    assistant: { content: string };
    toolEvidence?: { tool?: string; summary?: string };
  }>;
}

describe("chat route bounded actions", () => {
  beforeEach(() => {
    messages = [];
    generateText.mockClear();
    runGarminSync.mockClear();
    backfillActivityDetail.mockClear();
    summarizeActivityRankings.mockClear();
    verifyActivityReference.mockClear();
  });

  it("returns local sync status without a provider tool loop", async () => {
    const payload = await postChat(
      "What is my sync status and detail coverage?",
    );

    expect(payload.toolEvidence?.tool).toBe("syncStatus");
    expect(payload.assistant.content).toContain("detail coverage 1/3 terminal");
    expect(generateText).not.toHaveBeenCalled();
  });

  it("preserves explicit Garmin sync commands", async () => {
    const payload = await postChat("sync Garmin now");

    expect(runGarminSync).toHaveBeenCalledOnce();
    expect(summarizeActivityRankings).not.toHaveBeenCalled();
    expect(generateText).not.toHaveBeenCalled();
    expect(payload.toolEvidence?.tool).toBe("runGarminSync");
    expect(payload.assistant.content).toContain("Garmin sync completed");
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

  it("grounds every explicit activity ID and warns against summary-only detail claims", async () => {
    const payload = await postChat("Compare 111111 222222 333333");

    expect(generateText).toHaveBeenCalledOnce();
    const calls = generateText.mock.calls as unknown as Array<
      [{ system: string }]
    >;
    const call = calls[0][0];
    expect(call.system).toContain("111111");
    expect(call.system).toContain("222222");
    expect(call.system).toContain("333333");
    expect(call.system).toContain(
      "do not describe it as detailed FIT/stream analysis",
    );
    expect(payload.assistant.content).toContain(
      "Tool evidence: analyzeActivity",
    );
  });

  it("routes demanding activity rankings through deterministic local rows", async () => {
    generateText.mockResolvedValueOnce({
      text: "Provider invented Golovec trails should be ignored",
    });

    const payload = await postChat(
      "Which are my most demanding activities by elevation and distance?",
    );

    expect(summarizeActivityRankings).toHaveBeenCalledWith(
      "Which are my most demanding activities by elevation and distance?",
    );
    expect(generateText).not.toHaveBeenCalled();
    expect(payload.assistant.content).toContain("Source climb — Špik");
    expect(payload.assistant.content).toContain(
      "Imported running on 2026-07-02 (Garmin ID rank-2)",
    );
    expect(payload.assistant.content).not.toContain("Golovec trails");
    expect(payload.toolEvidence?.tool).toBe("activityRanking");
  });

  it("routes post-sync analytical ranking prompts away from rerunning sync", async () => {
    summarizeActivityRankings.mockReturnValueOnce({
      ...rankingEvidence,
      window: {
        label: "last 365 days",
        days: 365,
        startedAfter: "2025-07-21T12:00:00.000Z",
      },
    });
    const prompt =
      "ok good. Now We have full sync of all activites available. Therefore you can actually locate most demanding ones in last 365 days";

    const payload = await postChat(prompt);

    expect(runGarminSync).not.toHaveBeenCalled();
    expect(summarizeActivityRankings).toHaveBeenCalledWith(prompt);
    expect(generateText).not.toHaveBeenCalled();
    expect(payload.toolEvidence?.tool).toBe("activityRanking");
    expect(payload.assistant.content).toContain("Window: last 365 days");
    expect(payload.assistant.content).toContain(
      "Computed from local normalized SQLite activity summaries only",
    );
  });

  it("looks up a manufactured unquoted activity name across full history without latest analysis", async () => {
    const prompt =
      "Triglav summit hike.... give me activity id, give me all you know about it";

    const payload = await postChat(prompt);

    expect(verifyActivityReference).toHaveBeenCalledWith({
      garminId: null,
      suppliedName: "Triglav summit hike",
      date: null,
    });
    expect(payload.toolEvidence?.tool).toBe("activityVerification");
    expect(payload.assistant.content).toContain(
      "No matching normalized local activity was found",
    );
    expect(payload.assistant.content).toContain("301 activities");
    expect(payload.assistant.content).not.toContain("latest-999");
    expect(payload.assistant.content).not.toContain("Newest unrelated");
    expect(payload.assistant.content).not.toContain(
      "Tool evidence: analyzeActivity",
    );
    expect(generateText).not.toHaveBeenCalled();
  });

  it("returns a found named activity lookup with the correct Garmin ID and bounded summary fields", async () => {
    const payload = await postChat("what is the Garmin ID for Selo - Rašica?");

    expect(verifyActivityReference).toHaveBeenCalledWith({
      garminId: null,
      suppliedName: "Selo - Rašica",
      date: null,
    });
    expect(payload.toolEvidence?.tool).toBe("activityVerification");
    expect(payload.assistant.content).toContain("Garmin ID 23667792496");
    expect(payload.assistant.content).toContain("sport hiking");
    expect(payload.assistant.content).toContain("distance 12340 m");
    expect(payload.assistant.content).not.toContain("latest-999");
    expect(generateText).not.toHaveBeenCalled();
  });

  it("returns bounded ambiguous candidates for duplicate named activity lookups", async () => {
    const payload = await postChat("find activity named Duplicate");

    expect(verifyActivityReference).toHaveBeenCalledWith({
      garminId: null,
      suppliedName: "Duplicate",
      date: null,
    });
    expect(payload.toolEvidence?.tool).toBe("activityVerification");
    expect(payload.assistant.content).toContain("dup-1");
    expect(payload.assistant.content).toContain("dup-2");
    expect(payload.assistant.content).not.toContain(
      "Tool evidence: analyzeActivity",
    );
    expect(generateText).not.toHaveBeenCalled();
  });

  it("preserves explicit latest activity analysis when latest is requested", async () => {
    const payload = await postChat("Tell me about my latest activity");

    expect(verifyActivityReference).not.toHaveBeenCalled();
    expect(payload.assistant.content).toContain(
      "Tool evidence: analyzeActivity",
    );
    expect(payload.assistant.content).toContain("latest-999");
  });

  it("treats a reported name/date correction as verification, not latest activity analysis", async () => {
    messages = [
      {
        id: "assistant-previous",
        conversationId: "default",
        role: "assistant",
        content: "Your demanding hike was 2025-10-18 | Snežnik.",
        grounding: null,
        createdAt: new Date("2026-07-21T09:00:00Z"),
      },
    ];

    const payload = await postChat(
      "2025-10-18 | Snežnik — I never did this activity",
    );

    expect(verifyActivityReference).toHaveBeenCalledWith({
      garminId: null,
      suppliedName: "Snežnik",
      date: "2025-10-18",
    });
    expect(payload.toolEvidence?.tool).toBe("activityVerification");
    expect(payload.assistant.content).toContain(
      "No matching normalized local activity was found",
    );
    expect(payload.assistant.content).toContain("301 activities");
    expect(payload.assistant.content).not.toContain("latest-999");
    expect(generateText).not.toHaveBeenCalled();
  });

  it("recovers prior user ranking intent for a correction without trusting assistant prose", async () => {
    messages = [
      {
        id: "user-ranking",
        conversationId: "default",
        role: "user",
        content:
          "Which are my most demanding activities by elevation and distance?",
        grounding: null,
        createdAt: new Date("2026-07-21T08:59:00Z"),
      },
      {
        id: "assistant-previous",
        conversationId: "default",
        role: "assistant",
        content: "The answer is a fabricated 2025-10-18 Snežnik activity.",
        grounding: null,
        createdAt: new Date("2026-07-21T09:00:00Z"),
      },
    ];

    const payload = await postChat(
      "2025-10-18 | Snežnik — I never did this activity",
    );

    expect(payload.toolEvidence?.tool).toBe("activityVerification");
    expect(summarizeActivityRankings).toHaveBeenCalledWith(
      "Which are my most demanding activities by elevation and distance?",
    );
    expect(payload.assistant.content).toContain("Corrected ranking rebuilt");
    expect(payload.assistant.content).toContain("Source climb — Špik");
    expect(payload.assistant.content).not.toContain("fabricated 2025-10-18");
  });

  it("does not select latest activity for a generic activity noun", async () => {
    summarizeActivityRankings.mockReturnValueOnce(null as never);

    const payload = await postChat("I never did this activity");

    expect(payload.toolEvidence).toBeNull();
    expect(generateText).toHaveBeenCalledOnce();
  });
});
