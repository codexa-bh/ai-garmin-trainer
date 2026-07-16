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
    expect(context).toContain("2026-07-01 Morning run running");
    expect(context).toContain("half marathon");
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
            tool: "analyzeActivity",
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
      "tool evidence: analyzeActivity activity 123456",
    );
    expect(history[1]).toContain("Vrh Zakotja");
  });

  it("keeps a non-medical safety boundary", () => {
    expect(TRAINER_SYSTEM_PROMPT).toMatch(/non-medical/);
    expect(TRAINER_SYSTEM_PROMPT).toMatch(/Do not diagnose/);
  });
});
