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

vi.mock("@/lib/auth/session", () => ({
  requireSessionEmail: vi.fn(async () => "local@example.invalid"),
}));

vi.mock("@/lib/ai/providers", () => ({
  selectedModel: () => ({ model: "mock-model" }),
}));

vi.mock("@/lib/garmin/importer", () => ({
  runGarminSync,
  backfillActivityDetail,
}));

vi.mock("@/lib/analytics/activity", () => ({
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
  listRecentChatMessages: vi.fn(() => messages),
  clearConversationHistory: vi.fn(() => {
    messages = [];
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
  listRecentActivities: () => [],
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
  });

  it("returns local sync status without a provider tool loop", async () => {
    const payload = await postChat(
      "What is my sync status and detail coverage?",
    );

    expect(payload.toolEvidence?.tool).toBe("syncStatus");
    expect(payload.assistant.content).toContain("detail coverage 1/3 terminal");
    expect(generateText).not.toHaveBeenCalled();
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
});
