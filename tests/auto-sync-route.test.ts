import { afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ run: vi.fn(), status: vi.fn() }));
vi.mock("../src/lib/garmin/composition", async (original) => ({
  ...(await original<typeof import("../src/lib/garmin/composition")>()),
  runGarminAutoSync: mocks.run,
}));
vi.mock("../src/lib/env", async (original) => ({
  ...(await original<typeof import("../src/lib/env")>()),
  liveConfigurationStatus: mocks.status,
}));
import { POST } from "../src/app/api/sync/auto/route";
const boot = "c04a8952-aa56-485e-b590-c110315c904a";
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});
describe("private native auto-sync tick", () => {
  it("refuses non-desktop, missing/wrong boot, bodies and uninitialized lifetime before capabilities", async () => {
    mocks.status.mockReturnValue({ boot });
    const request = (identity?: string, body?: string) =>
      new Request("http://127.0.0.1/api/sync/auto", {
        method: "POST",
        headers: identity ? { "x-trainer-identity": identity } : {},
        body,
      });
    expect((await POST(request(boot))).status).toBe(404);
    vi.stubEnv("TRAINER_DESKTOP", "1");
    for (const value of [request(), request("stale"), request(boot, "{}")])
      expect((await POST(value)).status).toBe(404);
    mocks.status.mockImplementation(() => {
      throw new Error("not ready");
    });
    expect((await POST(request(boot))).status).toBe(404);
    expect(mocks.run).not.toHaveBeenCalled();
  });
  it("delegates one authenticated empty tick with cancellation and never exposes private failures", async () => {
    vi.stubEnv("TRAINER_DESKTOP", "1");
    mocks.status.mockReturnValue({ boot });
    mocks.run
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ status: "completed" })
      .mockRejectedValueOnce(new Error("private database path"));
    const tick = () =>
      POST(
        new Request("http://127.0.0.1/api/sync/auto", {
          method: "POST",
          headers: { "x-trainer-identity": boot },
        }),
      );
    // Next's HTTP adapter can supply an empty POST stream rather than null.
    const emptyStream = new Request("http://127.0.0.1/api/sync/auto", {
      method: "POST",
      headers: { "x-trainer-identity": boot, "content-length": "0" },
      body: "",
    });
    expect(emptyStream.body).not.toBeNull();
    expect(await (await POST(emptyStream)).json()).toEqual({ status: "idle" });
    expect(await (await tick()).json()).toEqual({ status: "completed" });
    const failure = await tick();
    expect(failure.status).toBe(409);
    expect(await failure.json()).toEqual({ status: "blocked" });
    expect(mocks.run.mock.calls[0][0]).toBeInstanceOf(AbortSignal);
  });
});
