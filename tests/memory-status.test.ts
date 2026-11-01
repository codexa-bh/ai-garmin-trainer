import { describe, expect, it } from "vitest";
import { memoryStatusProjection } from "../src/lib/memory/status";

const input = {
  configuredEnabled: true,
  userDisabled: false,
  embeddingProvider: "ollama" as const,
  extractionMode: "llm" as const,
  extractionProvider: "deepseek" as const,
  observation: null,
  now: 100000,
};
describe("closed memory status projection", () => {
  it("separates local embeddings from remote extraction without declaring readiness", () => {
    expect(memoryStatusProjection(input)).toEqual({
      configuredEnabled: true,
      userDisabled: false,
      effectiveEnabled: true,
      embeddingProvider: "ollama",
      extractionMode: "llm",
      extractionProvider: "deepseek",
      health: "not-checked",
      ageMs: null,
    });
  });
  it("scopes fresh successful observations and expires stale/future ones", () => {
    const observed = { ...input, observation: { ready: true, at: 99900 } };
    expect(memoryStatusProjection(observed)).toMatchObject({
      health: "local-observed",
      ageMs: 100,
    });
    expect(
      memoryStatusProjection({ ...observed, embeddingProvider: "openai" })
        .health,
    ).toBe("not-checked");
    expect(
      memoryStatusProjection({
        ...observed,
        embeddingProvider: "deterministic",
      }).health,
    ).toBe("test-only");
    for (const at of [40000, 100001])
      expect(
        memoryStatusProjection({ ...input, observation: { ready: true, at } }),
      ).toMatchObject({ health: "not-checked", ageMs: null });
    expect(
      memoryStatusProjection({
        ...input,
        observation: { ready: false, at: 99900 },
      }).health,
    ).toBe("attention");
  });
  it("keeps configured Off, user-disabled and extraction intent independent", () => {
    expect(
      memoryStatusProjection({ ...input, userDisabled: true }),
    ).toMatchObject({
      configuredEnabled: true,
      effectiveEnabled: false,
      health: "disabled",
    });
    expect(
      memoryStatusProjection({ ...input, configuredEnabled: false }),
    ).toMatchObject({
      userDisabled: false,
      effectiveEnabled: false,
      health: "disabled",
    });
    for (const mode of ["off", "deterministic"] as const)
      expect(
        memoryStatusProjection({ ...input, extractionMode: mode })
          .extractionProvider,
      ).toBe(mode);
    expect(
      memoryStatusProjection({ ...input, extractionProvider: null })
        .extractionProvider,
    ).toBe("deterministic");
  });
  it("never reflects incidental private fields or upstream error content", () => {
    const output = memoryStatusProjection({
      ...input,
      observation: {
        ready: false,
        at: 99000,
        detail: "private-error-sentinel",
        model: "private-model-sentinel",
      },
      url: "private-url-sentinel",
      secret: "private-key-sentinel",
    } as Parameters<typeof memoryStatusProjection>[0]);
    expect(JSON.stringify(output)).not.toContain("sentinel");
    expect(Object.keys(output)).toHaveLength(8);
  });
});
