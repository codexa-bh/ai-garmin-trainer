import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ spawn: vi.fn(), execFile: vi.fn() }));
vi.mock("node:child_process", () => ({
  spawn: mocks.spawn,
  execFile: mocks.execFile,
}));
import { spawnGarminMcp, verifyConnectorToken } from "../src/lib/garmin/client";
import { fetchFitSpeedWithLocalWrapper } from "../src/lib/garmin/fit-speed";
import { fetchFitDistanceWithLocalWrapper } from "../src/lib/garmin/fit-distance";
import { fetchFitAltitudeWithLocalWrapper } from "../src/lib/garmin/fit-altitude";
import { fetchFitBaselineWithLocalWrapper } from "../src/lib/garmin/fit-baseline";
import { garminTokenEnvironment } from "../src/lib/garmin/token-location";

let directory: string | undefined;
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  if (directory) rmSync(directory, { recursive: true, force: true });
});
it("MCP and all four FIT launchers receive the identical resolved private token environment", async () => {
  directory = mkdtempSync(join(tmpdir(), "spawn token path "));
  writeFileSync(join(directory, "garmin_tokens.json"), "fixture");
  vi.stubEnv("GARMIN_MCP_TOKEN_DIR", directory);
  vi.stubEnv("GARMINTOKENS", "alternate secret path");
  vi.stubEnv("GARMINTOKENS_BASE64", "alternate companion");
  vi.stubEnv("GARMIN_PASSWORD_FILE", "secret file");
  mocks.spawn.mockReturnValue({
    stderr: { setEncoding: vi.fn() },
    stdout: { setEncoding: vi.fn() },
  });
  mocks.execFile.mockImplementation((_command, _args, _options, callback) =>
    callback(null, '{"zones_target":{"max_heart_rate":180}}', ""),
  );
  expect((await verifyConnectorToken()).ok).toBe(true);
  spawnGarminMcp();
  expect(mocks.spawn.mock.calls[0][2].env).toMatchObject(
    garminTokenEnvironment(),
  );
  await fetchFitSpeedWithLocalWrapper("1");
  await fetchFitDistanceWithLocalWrapper("1");
  await fetchFitAltitudeWithLocalWrapper("1");
  await fetchFitBaselineWithLocalWrapper(["1"]);
  expect(mocks.execFile).toHaveBeenCalledTimes(4);
  for (const call of mocks.execFile.mock.calls)
    expect(call[2].env).toEqual(garminTokenEnvironment());
  vi.stubEnv("GARMIN_MCP_TOKEN_DIR", "");
  expect((await verifyConnectorToken()).ok).toBe(false);
  expect(() => spawnGarminMcp()).toThrow("no alternate");
  await fetchFitSpeedWithLocalWrapper("1");
  expect(mocks.execFile).toHaveBeenCalledTimes(4);
});
