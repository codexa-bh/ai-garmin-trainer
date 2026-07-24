import { describe, expect, it } from "vitest";
import {
  buildTrainerContext,
  formatRecentChatHistory,
  TRAINER_SYSTEM_PROMPT,
} from "../src/lib/ai/context";
import { applyProfilePatch } from "../src/lib/ai/profile";

describe("trainer AI", () => {
  it("builds bounded grounded context", () => {
    const context = buildTrainerContext({
      activities: [
        {
          garminId: "1",
          name: "Morning run",
          sport: "running",
          startedAt: new Date("2026-07-01T07:00:00Z"),
          durationSec: 1800,
          distanceMeters: 5000,
          calories: null,
          avgHeartRate: 145,
          maxHeartRate: 170,
          steps: 6200,
          elevationGainMeters: 80,
          elevationLossMeters: 70,
          trainingEffect: null,
        },
        {
          garminId: "2",
          name: null,
          sport: "cycling",
          startedAt: new Date("2026-06-30T07:00:00Z"),
          durationSec: 3600,
          distanceMeters: 25000,
          calories: null,
          avgHeartRate: null,
          maxHeartRate: null,
          steps: null,
          elevationGainMeters: null,
          elevationLossMeters: null,
          trainingEffect: null,
        },
      ],
      health: [],
      profile: {
        goals: ["half marathon"],
        sports: ["running"],
        preferences: {},
        constraints: [],
      },
      recentMessages: ["How am I doing?"],
    });
    expect(context).toContain("2026-07-01 Morning run [Garmin name] running");
    expect(context).toContain(
      "2026-06-30 Imported cycling on 2026-06-30 (Garmin ID 2) [fallback label] cycling",
    );
    expect(context).toContain("half marathon");
  });

  it("labels Garmin athlete baselines separately and refuses unsupported max HR claims", () => {
    const context = buildTrainerContext({
      activities: [],
      health: [],
      profile: { goals: [], sports: [], preferences: {}, constraints: [] },
      athleteBaseline: {
        availability: "failed",
        source: "garmin_mcp",
        fetchedAt: "2026-07-20T08:00:00.000Z",
        lastAttemptAt: "2026-07-21T08:00:00.000Z",
        preservedPrevious: true,
        values: {
          configuredMaxHeartRateBpm: null,
          heartRateZones: {
            status: "unavailable",
            source: null,
            formula: null,
            boundaries: [],
          },
          cyclingFtpWatts: 250,
          cyclingFtpMeasuredOn: "2026-07-19",
          cyclingFtpSourceStale: false,
          availableTrainingDays: ["monday"],
          preferredLongTrainingDays: ["sunday"],
        },
        unsupported: {
          configuredMaxHeartRate: true,
          completeHeartRateZoneBoundaries: true,
          reason: "not_exposed_by_pinned_connector",
        },
      },
      recentMessages: [],
    });

    expect(context).toContain("Garmin athlete baselines");
    expect(context).not.toContain("lactate-threshold");
    expect(context).not.toContain("VO2 max");
    expect(context).toContain(
      "previous normalized Garmin athlete facts were preserved",
    );
    expect(context).toContain("Do not estimate configured max HR");
  });

  it("preserves source facts when applying profile corrections", () => {
    expect(
      applyProfilePatch(
        {
          goals: [],
          sports: [],
          preferences: { tone: "brief" },
          constraints: [],
        },
        { goals: ["base fitness"] },
      ).preferences.tone,
    ).toBe("brief");
  });

  it("keeps bounded recent chat history with concise tool evidence", () => {
    const history = formatRecentChatHistory(
      [
        { role: "user", content: "old turn that should fall out" },
        { role: "assistant", content: "older answer" },
        { role: "user", content: "Analyze my latest hike" },
        {
          role: "assistant",
          content: "Latest hike answer",
          grounding: {
            tool: "runMathAnalysis",
            activityId: "123456",
            activityName: "Vrh Zakotja",
            summary: "12 km hike with normalized local stream evidence",
          },
        },
      ],
      2,
    );

    expect(history).toHaveLength(2);
    expect(history.join("\n")).not.toContain("old turn");
    expect(history[0]).toMatch(/^user:/);
    expect(history[1]).toContain(
      "tool evidence: runMathAnalysis activity 123456",
    );
    expect(history[1]).toContain("Vrh Zakotja");
    expect(history[1]).not.toContain("Latest hike answer");
  });

  it("omits ungrounded assistant activity prose from hidden context", () => {
    const history = formatRecentChatHistory([
      {
        role: "assistant",
        content: "The invented activity was 2025-10-18 Snežnik.",
        grounding: null,
      },
      {
        role: "user",
        content: "2025-10-18 | Snežnik — I never did this activity",
      },
    ]);

    expect(history[0]).toContain("ungrounded prior assistant prose omitted");
    expect(history[0]).not.toContain("invented activity");
    expect(history[1]).toContain("2025-10-18 | Snežnik");
  });

  it("keeps a non-medical safety boundary", () => {
    expect(TRAINER_SYSTEM_PROMPT).toMatch(/non-medical/);
    expect(TRAINER_SYSTEM_PROMPT).toMatch(/Do not diagnose/);
  });
});
