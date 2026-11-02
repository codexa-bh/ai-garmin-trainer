import { afterEach, describe, expect, it, vi } from "vitest";
const execute = vi.hoisted(() =>
  vi.fn(async (..._args: unknown[]) => ({ stdout: "{}", stderr: "" })),
);
vi.mock("node:child_process", () => ({
  execFile: Object.assign(
    () => {
      throw new Error("Expected promisified execution");
    },
    { [Symbol.for("nodejs.util.promisify.custom")]: execute },
  ),
}));
vi.mock("../src/lib/garmin/token-location", () => ({
  garminTokenEnvironment: () => ({}),
}));
import { fetchFitBaselineWithLocalWrapper } from "../src/lib/garmin/fit-baseline";
import { fetchFitAltitudeWithLocalWrapper } from "../src/lib/garmin/fit-altitude";
import { fetchFitDistanceWithLocalWrapper } from "../src/lib/garmin/fit-distance";
import { fetchFitSpeedWithLocalWrapper } from "../src/lib/garmin/fit-speed";
afterEach(() => vi.clearAllMocks());
describe("owned FIT-wrapper cancellation contract", () => {
  it.each(["baseline", "altitude", "distance", "speed"])(
    "passes abort/deadline and forwarded TERM to %s, without real connector access",
    async (kind) => {
      const abort = new AbortController();
      const options = { signal: abort.signal, timeout: 37 };
      if (kind === "baseline")
        await fetchFitBaselineWithLocalWrapper(["fixture"], options);
      if (kind === "altitude")
        await fetchFitAltitudeWithLocalWrapper("fixture", options);
      if (kind === "distance")
        await fetchFitDistanceWithLocalWrapper("fixture", options);
      if (kind === "speed")
        await fetchFitSpeedWithLocalWrapper("fixture", options);
      expect(execute).toHaveBeenCalledOnce();
      expect(execute.mock.calls[0][2]).toMatchObject({
        signal: abort.signal,
        timeout: 37,
        killSignal: "SIGTERM",
      });
    },
  );
});
