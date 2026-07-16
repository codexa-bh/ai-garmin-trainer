import { describe, expect, it } from "vitest";
import {
  buildTrainerContext,
  TRAINER_SYSTEM_PROMPT,
} from "../src/lib/ai/context";
import { applyProfilePatch } from "../src/lib/ai/profile";

describe("trainer AI", () => {
  it("builds bounded grounded context", () => {
    const context = buildTrainerContext({
      activities: [
        {
          garminId: "1",
          sport: "running",
          startedAt: new Date("2026-07-01T07:00:00Z"),
          durationSec: 1800,
          distanceMeters: 5000,
          calories: null,
          avgHeartRate: 145,
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
    expect(context).toContain("2026-07-01 running");
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

  it("keeps a non-medical safety boundary", () => {
    expect(TRAINER_SYSTEM_PROMPT).toMatch(/non-medical/);
    expect(TRAINER_SYSTEM_PROMPT).toMatch(/Do not diagnose/);
  });
});
