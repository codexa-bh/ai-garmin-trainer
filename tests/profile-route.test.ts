import { beforeEach, describe, expect, it, vi } from "vitest";

const getTrainerProfile = vi.fn(() => ({
  goals: ["Build endurance"],
  sports: ["hiking"],
  preferences: { coachingStyle: "direct" },
  constraints: [],
}));
const saveTrainerProfile = vi.fn((profile) => profile);

vi.mock("@/lib/db/repository", () => ({
  getTrainerProfile,
  saveTrainerProfile,
}));

describe("profile route local no-auth behavior", () => {
  beforeEach(() => {
    getTrainerProfile.mockClear();
    saveTrainerProfile.mockClear();
    vi.resetModules();
  });

  it("loads the single local Profile without a session cookie", async () => {
    const { GET } = await import("../src/app/api/profile/route");

    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.goals).toEqual(["Build endurance"]);
    expect(getTrainerProfile).toHaveBeenCalledOnce();
  });

  it("saves the single local Profile without a session cookie", async () => {
    const { POST } = await import("../src/app/api/profile/route");

    const response = await POST(
      new Request("http://localhost/api/profile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          goals: "Summit endurance\nEasy recovery",
          sports: ["hiking", "cycling"],
          preferences: { coachingStyle: "concise" },
          constraints: "no running",
        }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(saveTrainerProfile).toHaveBeenCalledWith({
      goals: ["Summit endurance", "Easy recovery"],
      sports: ["hiking", "cycling"],
      preferences: { coachingStyle: "concise" },
      constraints: ["no running"],
    });
  });
});
