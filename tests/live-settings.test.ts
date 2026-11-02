import { createServer, request as httpRequest } from "node:http";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  applyLiveConfiguration,
  getOptionalEnv,
  initializeLiveConfiguration,
  liveConfigurationStatus,
  withConfiguration,
} from "../src/lib/env";
import { memoryExtractionSelection } from "../src/lib/ai/providers";
import { serveLiveSettings } from "../scripts/desktop/live-settings";

const boot = "12345678-1234-1234-1234-123456789abc";
const catalog = {
  version: 1,
  entries: [{ id: "entry_new", provider: "openai", modelId: "New/Exact:tag" }],
  defaultEntryId: "entry_new",
};
const frame = (
  generation = 1,
  secrets: Record<string, string> = {
    OPENAI_API_KEY: "synthetic-rotated-openai",
  },
) => ({
  version: 1,
  boot,
  generation,
  revision: `${generation}-2-3`,
  chatCatalog: catalog,
  secrets,
});
function clearCell() {
  delete (
    process as typeof process & { __trainerLiveConfigurationV1?: unknown }
  ).__trainerLiveConfigurationV1;
}
beforeEach(() => {
  clearCell();
  vi.stubEnv("AI_PROVIDER", "auto");
  vi.stubEnv("OPENAI_API_KEY", "synthetic-old-openai");
  vi.stubEnv("DEEPSEEK_API_KEY", "synthetic-old-deepseek");
  vi.stubEnv("OPENROUTER_API_KEY", "synthetic-old-router");
  vi.stubEnv("MEMORY_ENABLED", "false");
  vi.stubEnv("MEMORY_EMBEDDING_MODEL", "startup-model");
  initializeLiveConfiguration(boot);
});
afterEach(() => {
  clearCell();
  vi.unstubAllEnvs();
});

it("atomically replaces the complete live projection without merging absent keys or adopting other saved fields", () => {
  const old = getOptionalEnv();
  expect(applyLiveConfiguration(frame())).toEqual({
    version: 1,
    boot,
    generation: 1,
    revision: "1-2-3",
    state: "applied",
  });
  const next = getOptionalEnv();
  expect(next).not.toBe(old);
  expect(next.OPENAI_API_KEY).toBe("synthetic-rotated-openai");
  expect(next.DEEPSEEK_API_KEY).toBeUndefined();
  expect(next.OPENROUTER_API_KEY).toBeUndefined();
  expect(old.DEEPSEEK_API_KEY).toBe("synthetic-old-deepseek");
  expect(Object.isFrozen(next)).toBe(true);
  expect(next.MEMORY_EMBEDDING_MODEL).toBe("startup-model");
  expect(process.env.OPENAI_API_KEY).toBe("synthetic-old-openai");
  applyLiveConfiguration({
    ...frame(2, {}),
    chatCatalog: { version: 1, entries: [], defaultEntryId: null },
  });
  expect(getOptionalEnv().OPENAI_API_KEY).toBeUndefined();
  expect(JSON.parse(getOptionalEnv().CHAT_MODEL_CATALOG!)).toEqual({
    version: 1,
    entries: [],
    defaultEntryId: null,
  });
});
it("is idempotent only for the exact generation/revision/projection and never regresses", () => {
  applyLiveConfiguration(frame(2));
  const active = getOptionalEnv();
  applyLiveConfiguration(frame(2));
  expect(getOptionalEnv()).toBe(active);
  for (const invalid of [
    frame(1),
    { ...frame(2), revision: "9-9" },
    frame(2, {}),
    { ...frame(3), boot: "wrong" },
    { ...frame(3), fields: { MEMORY_ENABLED: "true" } },
  ]) {
    expect(() => applyLiveConfiguration(invalid)).toThrow();
    expect(getOptionalEnv()).toBe(active);
  }
});
it.each([
  { ...frame(), secrets: { OTHER_KEY: "private" } },
  { ...frame(), secrets: { OPENAI_API_KEY: "" } },
  { ...frame(), secrets: { OPENAI_API_KEY: "placeholder-key" } },
  { ...frame(), secrets: { OPENAI_API_KEY: "key\nprivate" } },
  { ...frame(), secrets: { OPENAI_API_KEY: "x".repeat(16385) } },
  { ...frame(), chatCatalog: { ...catalog, defaultEntryId: "entry_absent" } },
  { ...frame(), revision: "/private/path" },
  { ...frame(), generation: Number.MAX_SAFE_INTEGER + 1 },
  { ...frame(), version: 2 },
])("rejects invalid complete projections before mutation %#", (invalid) => {
  const old = getOptionalEnv();
  expect(() => applyLiveConfiguration(invalid)).toThrow();
  expect(getOptionalEnv()).toBe(old);
  expect(liveConfigurationStatus().generation).toBe(0);
});
it("retains captured credentials through awaits, nested work and delayed parent closures", async () => {
  const old = getOptionalEnv();
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  const parent = withConfiguration(old, async () => {
    await barrier;
    expect(getOptionalEnv()).toBe(old);
    return () => withConfiguration(old, () => getOptionalEnv());
  });
  applyLiveConfiguration(frame());
  expect(getOptionalEnv()).not.toBe(old);
  release();
  const delayed = await parent;
  applyLiveConfiguration(frame(2, {}));
  expect(delayed().DEEPSEEK_API_KEY).toBe("synthetic-old-deepseek");
  expect(getOptionalEnv().DEEPSEEK_API_KEY).toBeUndefined();
});
it("pins extraction/title provider topology across key rotation/clear without alternate-cloud substitution", () => {
  expect(memoryExtractionSelection().selected).toBe("deepseek");
  applyLiveConfiguration(frame());
  expect(memoryExtractionSelection().selected).toBeNull();
  applyLiveConfiguration(
    frame(2, {
      DEEPSEEK_API_KEY: "synthetic-next-deepseek",
      OPENAI_API_KEY: "synthetic-next-openai",
    }),
  );
  expect(memoryExtractionSelection().selected).toBe("deepseek");
  expect(memoryExtractionSelection().modelName).toBe("deepseek-flash");
});
it("uses the actual fixed authenticated HTTP boundary with closed safe ack/status and denied browser/wrong-boot inputs", async () => {
  const server = createServer((request, response) => {
    serveLiveSettings(request, response, boot, () => true).catch(() =>
      response.destroy(),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw Error("No port");
  const send = (body?: unknown, headers: Record<string, string> = {}) =>
    new Promise<{ status: number; body: string }>((resolve, reject) => {
      const bytes = body === undefined ? "" : JSON.stringify(body);
      const request = httpRequest(
        {
          host: "127.0.0.1",
          port: address.port,
          path: "/__desktop/live-settings",
          method: body === undefined ? "GET" : "POST",
          headers: {
            "x-trainer-identity": boot,
            "content-type": "application/json",
            "content-length": Buffer.byteLength(bytes),
            ...headers,
          },
        },
        (response) => {
          let data = "";
          response.on("data", (part) => {
            data += String(part);
          });
          response.on("end", () =>
            resolve({ status: response.statusCode!, body: data }),
          );
        },
      );
      request.on("error", reject);
      request.end(bytes);
    });
  try {
    for (const headers of [
      { origin: "http://127.0.0.1" },
      { "sec-fetch-site": "same-origin" },
      { "x-trainer-identity": "wrong" },
    ] as Record<string, string>[])
      expect((await send(frame(), headers)).status).toBe(403);
    expect(liveConfigurationStatus().generation).toBe(0);
    const applied = await send(frame());
    expect(applied.status).toBe(200);
    expect(JSON.parse(applied.body)).toEqual(liveConfigurationStatus());
    expect(applied.body).not.toMatch(/synthetic|API_KEY|chatCatalog|private/);
    expect((await send({ ...frame(2), extra: true })).status).toBe(409);
    expect((await send(frame())).status).toBe(200);
    expect((await send(frame(2, {}))).status).toBe(200);
    expect(JSON.parse((await send()).body).generation).toBe(2);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
