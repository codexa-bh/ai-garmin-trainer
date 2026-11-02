import { EventEmitter } from "node:events";
import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("../src/lib/garmin/client", () => ({ spawnGarminMcp: mocks.spawn }));
import { GarminMcpClient } from "../src/lib/garmin/mcp-client";
import { GarminDependencyError } from "../src/lib/garmin/dependency-error";

afterEach(() => vi.clearAllMocks());
it.each(["launcher-unavailable", "startup-unknown"] as const)(
  "keeps %s within the unchanged discovery stop-reason bound",
  (reason) => {
    expect(
      new GarminDependencyError(reason).message.length,
    ).toBeLessThanOrEqual(256);
  },
);
function child() {
  return Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    stdin: { write: vi.fn() },
    kill: vi.fn(),
    exitCode: 0,
    signalCode: null,
  });
}
it.each(["ENOENT", "EACCES", "ENOEXEC", "EIO"])(
  "uses only actual spawn code %s, not incidental private text",
  async (code) => {
    const process = child();
    mocks.spawn.mockReturnValue(process);
    const client = new GarminMcpClient();
    const start = client.start();
    const result = expect(start).rejects.toMatchObject({
      reason: code === "EIO" ? "startup-unknown" : "launcher-unavailable",
    });
    process.emit(
      "error",
      Object.assign(new Error("private-path secret Python not found"), {
        code,
      }),
    );
    await result;
    client.close();
  },
);
it("keeps unknown Python/vendor startup failures unknown and sanitized", async () => {
  const process = child();
  mocks.spawn.mockReturnValue(process);
  const client = new GarminMcpClient();
  const result = expect(client.start()).rejects.toMatchObject({
    reason: "startup-unknown",
  });
  process.stderr.emit("data", "Python not found /private/canary secret-canary");
  process.emit("exit", 2);
  await result;
  const error = new GarminDependencyError("startup-unknown");
  expect(error.message).toContain("cause is unknown");
  expect(error.message).not.toContain("canary");
  client.close();
});
it.each([
  ["503 network", "connection or service"],
  ["429", "rate-limited"],
  ["401", "could not be verified"],
])("preserves %s instead of alleging missing Python", async (raw, expected) => {
  const process = child();
  mocks.spawn.mockReturnValue(process);
  const client = new GarminMcpClient();
  const result = expect(client.start()).rejects.toThrow(expected);
  process.stderr.emit("data", raw);
  process.emit("exit", 1);
  await result;
  client.close();
});
it("healthy initialization uses no second tool, interpreter probe or warning", async () => {
  const process = child();
  mocks.spawn.mockReturnValue(process);
  const client = new GarminMcpClient();
  const start = client.start();
  process.stdout.emit("data", '{"jsonrpc":"2.0","id":1,"result":{}}\n');
  await start;
  expect(mocks.spawn).toHaveBeenCalledTimes(1);
  client.close();
});
