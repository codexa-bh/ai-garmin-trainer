import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  process.env.DATABASE_PATH = join(
    mkdtempSync(join(tmpdir(), "trainer-memory-route-")),
    "test.sqlite",
  );
  process.env.MEMORY_ENABLED = "false";
});

async function route() {
  return import("../src/app/api/memory/route");
}

function jsonRequest(body: unknown) {
  return new Request("http://localhost/api/memory", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("semantic memory API route", () => {
  it("reports disabled semantic memory readiness without requiring vector/provider services", async () => {
    const { GET } = await route();

    const payload = (await (await GET()).json()) as {
      health: { status: string; provider: string; vectorProvider: string };
      memories: unknown[];
    };

    expect(payload.health).toMatchObject({
      status: "disabled",
      provider: "app-sqlite-vector",
      vectorProvider: "sqlite",
    });
    expect(payload.memories).toEqual([]);
  });

  it("persists the local enable/disable control separately from memory contents", async () => {
    const { PATCH } = await route();

    const disabled = (await (
      await PATCH(jsonRequest({ action: "set-enabled", enabled: false }))
    ).json()) as { health: { userDisabled: boolean; status: string } };
    expect(disabled.health.userDisabled).toBe(true);
    expect(disabled.health.status).toBe("disabled");

    const enabled = (await (
      await PATCH(jsonRequest({ action: "set-enabled", enabled: true }))
    ).json()) as { health: { userDisabled: boolean; status: string } };
    expect(enabled.health.userDisabled).toBe(false);
  });

  it("rejects unsupported management actions", async () => {
    const { PATCH } = await route();
    const response = await PATCH(
      jsonRequest({ action: "approve", id: "legacy" }),
    );
    expect(response.status).toBe(400);
  });
});
