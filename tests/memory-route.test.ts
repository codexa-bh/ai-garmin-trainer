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
});

async function route() {
  return import("../src/app/api/memory/route");
}

function jsonRequest(body: unknown) {
  return new Request("http://localhost/api/memory", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("memory API route", () => {
  it("creates pending proposals and approves/rejects/forgets through explicit actions", async () => {
    const { GET, POST, PATCH } = await route();

    const createdResponse = await POST(
      jsonRequest({ value: "I prefer morning hikes" }),
    );
    const created = (await createdResponse.json()) as {
      memory: { id: string; status: string; value: string };
      pending: Array<{ id: string }>;
      confirmed: Array<{ id: string }>;
    };
    expect(created.memory).toMatchObject({
      status: "pending_confirmation",
      value: "I prefer morning hikes",
    });
    expect(created.pending).toHaveLength(1);
    expect(created.confirmed).toHaveLength(0);

    const approvedResponse = await PATCH(
      jsonRequest({ id: created.memory.id, action: "approve" }),
    );
    const approved = (await approvedResponse.json()) as {
      confirmed: Array<{ id: string }>;
    };
    expect(approved.confirmed.map((item) => item.id)).toEqual([
      created.memory.id,
    ]);

    const forgottenResponse = await PATCH(
      jsonRequest({ id: created.memory.id, action: "forget" }),
    );
    const forgotten = (await forgottenResponse.json()) as {
      memories: Array<{ id: string }>;
    };
    expect(forgotten.memories).toEqual([]);

    const rejectedCreate = (await (
      await POST(jsonRequest({ value: "Wrong preference" }))
    ).json()) as { memory: { id: string } };
    const rejectedResponse = await PATCH(
      jsonRequest({ id: rejectedCreate.memory.id, action: "reject" }),
    );
    expect(rejectedResponse.status).toBe(200);

    const list = (await (await GET()).json()) as { memories: unknown[] };
    expect(list.memories).toEqual([]);
  });

  it("rejects empty, overlong, and credential-like memory proposals", async () => {
    const { POST } = await route();

    expect((await POST(jsonRequest({ value: "" }))).status).toBe(400);
    expect((await POST(jsonRequest({ value: "x".repeat(501) }))).status).toBe(
      400,
    );
    expect(
      (await POST(jsonRequest({ value: "my Garmin password is secret" })))
        .status,
    ).toBe(400);
  });
});
