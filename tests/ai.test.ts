import { describe, expect, it } from "vitest";
import {
  buildTrainerContext,
  formatActiveChatTranscript,
  TRAINER_SYSTEM_PROMPT,
} from "../src/lib/ai/context";

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
    expect(context).toContain("at most 8 supplied rows");
    expect(context).toContain(
      "not complete history or current-turn verification",
    );
    expect(context).toContain(
      "not necessarily the target event's pre-event window",
    );
    expect(context).toContain("No recovery data in supplied preview");
  });

  it("bounds additive recovery text to ten days and preserves long normalized qualifiers and coverage", () => {
    const health = Array.from({ length: 11 }, (_, i) => ({
      date: `2026-09-${String(20 - i).padStart(2, "0")}`,
      sleepMinutes: null,
      sleepScore: null,
      sleepDeepMinutes: null,
      sleepLightMinutes: null,
      sleepRemMinutes: null,
      sleepAwakeMinutes: null,
      sleepNapMinutes: null,
      activeCalories: null,
      restingCalories: null,
      totalCalories: null,
      bodyBatteryMorning: null,
      bodyBatteryEvening: null,
      restingHeartRate: null,
      hrvMs: null,
      hrvStatus: null,
      stressAvg: null,
      steps: null,
      calories: null,
      intensityMinutes: null,
      bodyBatteryAvg: null,
      availability: "missing" as const,
      recovery: {
        sleepScore: 100,
        sleepQualifier: "A".repeat(64),
        weeklyHrvMs: 65.123456789,
        balancedLowMs: 50,
        balancedUpperMs: 80,
        batteryCharged: 0,
        batteryDrained: null,
        highStressSeconds: 0,
        coverage: {
          sleep: { status: "populated" as const, reason: null },
          hrv: { status: "failed" as const, reason: null },
          body_battery: { status: "empty" as const, reason: null },
          stress: { status: "unavailable" as const, reason: null },
        },
      },
    }));
    const context = buildTrainerContext({
      health,
      activities: [],
      profile: { goals: [], sports: [], preferences: {}, constraints: [] },
      recentMessages: [],
    });
    const recovery = context
      .split("Recovery (")[1]
      .split("Recent conversation:")[0];
    expect(recovery.length).toBeLessThan(8000);
    expect(recovery).toContain("A".repeat(64));
    expect(recovery).toContain("high stress 0 min");
    expect(recovery).toContain("body_battery=empty, stress=unavailable");
    expect(recovery).not.toContain("2026-09-10");
    expect(recovery.match(/sleep score/g)).toHaveLength(10);
  });

  it("adds explicit server current-date grounding without treating Garmin freshness as the clock", () => {
    const currentDate = new Date(2026, 7, 14, 9, 30, 0);
    const context = buildTrainerContext({
      activities: [
        {
          garminId: "latest-999",
          name: "Older imported run",
          sport: "running",
          startedAt: new Date("2026-08-10T07:00:00Z"),
          durationSec: 1800,
          distanceMeters: 5000,
          calories: null,
          avgHeartRate: 145,
          maxHeartRate: 170,
          steps: null,
          elevationGainMeters: null,
          elevationLossMeters: null,
          trainingEffect: null,
        },
      ],
      health: [],
      profile: { goals: [], sports: [], preferences: {}, constraints: [] },
      currentDate,
      recentMessages: [],
    });

    expect(context).toContain("Server current date basis: 2026-08-14");
    expect(context).toContain("Use this server-owned date");
    expect(context).toContain('derive "yesterday"');
    expect(context).toContain("Garmin import freshness");
    expect(context).toContain("2026-08-10 Older imported run");
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

  it("adds Garmin body metrics to context without merging them into Profile", () => {
    const context = buildTrainerContext({
      activities: [],
      health: [],
      profile: { goals: [], sports: [], preferences: {}, constraints: [] },
      bodyMetrics: {
        availability: "complete",
        source: "garmin_mcp",
        fetchedAt: "2026-08-12T08:00:00.000Z",
        lastAttemptAt: "2026-08-12T08:00:00.000Z",
        preservedPrevious: false,
        values: { weightKg: 70.2, heightCm: 181 },
        currentWeightSource: "weigh_in",
        weighInAvailability: "available",
        history: {
          availability: "available",
          source: "weigh_in",
          rangeStart: "2026-08-10",
          rangeEnd: "2026-08-11",
          count: 2,
        },
      },
      recentMessages: [],
    });

    expect(context).toContain("Garmin body metrics");
    expect(context).toContain("current weight 70.2 kg");
    expect(context).toContain("from the latest Garmin weigh-in");
    expect(context).toContain(
      "weight history 2 rows from 2026-08-10 to 2026-08-11 (source: Garmin weigh-ins)",
    );
    expect(context).toContain("do not ask for imported weight");
    expect(context).toContain("separate from editable Profile");
  });

  it("discloses weigh-in refresh failure without obscuring preserved body metrics", () => {
    const context = buildTrainerContext({
      activities: [],
      health: [],
      profile: { goals: [], sports: [], preferences: {}, constraints: [] },
      bodyMetrics: {
        availability: "partial",
        source: "garmin_mcp",
        fetchedAt: "2026-08-12T08:00:00.000Z",
        lastAttemptAt: "2026-08-12T08:00:00.000Z",
        preservedPrevious: true,
        values: { weightKg: 70.2, heightCm: 181 },
        currentWeightSource: "profile",
        weighInAvailability: "failed",
        history: {
          availability: "failed",
          source: null,
          rangeStart: null,
          rangeEnd: null,
          count: 0,
        },
      },
      recentMessages: [],
    });

    expect(context).toContain("The Garmin weigh-in refresh failed");
    expect(context).toContain(
      "previous normalized Garmin body metrics were preserved",
    );
    expect(context).toContain("current weight 70.2 kg");
    expect(context).not.toContain("start a weekly weigh-in");
  });

  it("keeps bounded recent chat history with concise tool evidence", () => {
    const history = formatActiveChatTranscript([
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
    ]);

    expect(history).toHaveLength(2);
    expect(history.join("\n")).not.toContain("old turn");
    expect(history[0]).toMatch(/^user:/);
    expect(history[1]).toContain(
      "tool evidence: runMathAnalysis activity 123456",
    );
    expect(history[1]).toContain("Vrh Zakotja");
    expect(history[1]).toContain("Latest hike answer");
    expect(history[1]).toContain("unverified continuity");
  });

  it("retains ungrounded assistant prose as unverified continuity, not fresh facts", () => {
    const history = formatActiveChatTranscript([
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

    expect(history[0]).toContain(
      "unverified continuity, not evidence or permission",
    );
    expect(history[0]).toContain("invented activity");
    expect(history[1]).toContain("2025-10-18 | Snežnik");
  });

  it("uses the evidence-based coaching contract without an app-authored medical response restriction", () => {
    expect(TRAINER_SYSTEM_PROMPT).toMatch(/evidence-based fitness coach/);
    expect(TRAINER_SYSTEM_PROMPT).toMatch(/Hiking specialization/);
    expect(TRAINER_SYSTEM_PROMPT).toContain(
      "Medical responses follow provider behavior, without app response restrictions",
    );
    expect(TRAINER_SYSTEM_PROMPT).not.toMatch(
      /non-medical training guidance|Do not diagnose|seek qualified care/i,
    );
  });
});
