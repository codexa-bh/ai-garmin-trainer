import { describe, expect, it, vi } from "vitest";
import { createOfficialClient } from "../src/lib/garmin/official-client";
import { OfficialApiError } from "../src/lib/garmin/official-error";
import {
  binary,
  empty,
  fakeApi,
  json,
  syntheticBearer,
  text,
} from "./official-transport-fixture";

const TOKEN = "/personalapitoken-service/personal-api/personal-api-key/token";
const PROBE = "/userprofile-service/userprofile/settings";
const KEY = "synthetic-key-never-real";

function harness(
  routes: Parameters<typeof fakeApi>[0],
  options: { now?: () => number; signal?: AbortSignal } = {},
) {
  const api = fakeApi(routes);
  const admit = vi.fn(async () => ({ timeoutMs: 5_000 }));
  const client = createOfficialClient({
    apiKey: () => KEY,
    fetch: api.fetch,
    gate: { admit, signal: options.signal ?? new AbortController().signal },
    clock: options.now,
  });
  return { api, admit, client };
}
const failure = async (promise: Promise<unknown>) =>
  promise.then(
    () => null,
    (error: unknown) => error as OfficialApiError,
  );

describe("official transport", () => {
  it("exchanges the key once for raw-text bearer and reuses it", async () => {
    const now = Date.now();
    const bearer = syntheticBearer(now + 24 * 3_600_000);
    const { api, client, admit } = harness({
      [`POST ${TOKEN}`]: () => text(`${bearer}\n`),
      [`GET ${PROBE}`]: () => json({ displayName: "x" }),
    });
    await client.json(PROBE, undefined, "profile-settings");
    await client.json(PROBE, undefined, "profile-settings");
    expect(api.requests.map((r) => r.method)).toEqual(["POST", "GET", "GET"]);
    expect(api.requests[0].authorization).toBe(`ApiKey ${KEY}`);
    expect(api.requests[1].authorization).toBe(`Bearer ${bearer}`);
    // The exchange and every download consume admission: actual requests only.
    expect(admit).toHaveBeenCalledTimes(3);
    expect(client.stats()).toEqual({
      total: 3,
      byEndpoint: { token: 1, "profile-settings": 2 },
    });
  });

  it("reacquires conservatively before the documented lifetime elapses", async () => {
    let clock = 1_000_000;
    let issued = 0;
    const { api, client } = harness(
      {
        [`POST ${TOKEN}`]: () =>
          text(syntheticBearer(clock + 24 * 3_600_000, String(issued++))),
        [`GET ${PROBE}`]: () => json({}),
      },
      { now: () => clock },
    );
    await client.json(PROBE, undefined, "profile-settings");
    clock += 23 * 3_600_000;
    await client.json(PROBE, undefined, "profile-settings");
    expect(api.count(TOKEN)).toBe(2);
  });

  it("uses a short fallback lifetime when the bearer carries no expiry", async () => {
    let clock = 0;
    const { api, client } = harness(
      {
        [`POST ${TOKEN}`]: () => text("opaque-token-without-claims-1234"),
        [`GET ${PROBE}`]: () => json({}),
      },
      { now: () => clock },
    );
    await client.json(PROBE, undefined, "profile-settings");
    clock += 3_700_000;
    await client.json(PROBE, undefined, "profile-settings");
    expect(api.count(TOKEN)).toBe(2);
  });

  it("refuses a token reply that is JSON or not shaped like a token, without echoing it", async () => {
    const { client } = harness({
      [`POST ${TOKEN}`]: () =>
        json({ token: "should-not-be-trusted-aaaaaaaa" }),
    });
    const error = await failure(
      client.json(PROBE, undefined, "profile-settings"),
    );
    expect(error?.kind).toBe("protocol");
    expect(error?.message).not.toContain("should-not-be-trusted");
  });

  it("stops at a rejected key and never loops or retries it", async () => {
    const { api, client } = harness({
      [`POST ${TOKEN}`]: () => json({ error: "no" }, 401),
    });
    expect(
      (await failure(client.json(PROBE, undefined, "profile-settings")))?.kind,
    ).toBe("key-rejected");
    expect(
      (await failure(client.json(PROBE, undefined, "profile-settings")))?.kind,
    ).toBe("key-rejected");
    expect(api.count(TOKEN)).toBe(1);
  });

  it("reacquires once after a cached bearer is revoked server-side", async () => {
    let tokens = 0;
    let revoked = false;
    const { api, client } = harness({
      [`POST ${TOKEN}`]: () =>
        text(syntheticBearer(Date.now() + 86_400_000, String(tokens++))),
      [`GET ${PROBE}`]: (request) =>
        revoked && request.authorization?.endsWith("signature0")
          ? json({}, 401)
          : json({ ok: true }),
    });
    await client.json(PROBE, undefined, "profile-settings");
    revoked = true;
    expect(await client.json(PROBE, undefined, "profile-settings")).toEqual({
      ok: true,
    });
    expect(api.count(TOKEN)).toBe(2);
  });

  it("does not disguise repeated bearer rejection as success", async () => {
    const { api, client } = harness({
      [`POST ${TOKEN}`]: () => text(syntheticBearer(Date.now() + 86_400_000)),
      [`GET ${PROBE}`]: () => json({}, 401),
    });
    expect(
      (await failure(client.json(PROBE, undefined, "profile-settings")))?.kind,
    ).toBe("token-rejected");
    expect(api.requests.length).toBeLessThanOrEqual(3);
  });

  it.each([
    [429, "rate-limited", /rate limit/],
    [500, "service", /service is unavailable/],
    [503, "service", /service is unavailable/],
    [404, "not-found", /not found/],
    [418, "protocol", /protocol/],
  ] as const)(
    "classifies HTTP %s without a retry",
    async (status, kind, message) => {
      const { api, client } = harness({
        [`POST ${TOKEN}`]: () => text(syntheticBearer(Date.now() + 86_400_000)),
        [`GET ${PROBE}`]: () => json({ error: "secret-body", status }, status),
      });
      const error = await failure(
        client.json(PROBE, undefined, "profile-settings"),
      );
      expect(error?.kind).toBe(kind);
      expect(error?.message).toMatch(message);
      expect(error?.message).not.toContain("secret-body");
      expect(api.count(PROBE)).toBe(1);
    },
  );

  it("treats 204, empty and null replies as source emptiness, distinct from malformed", async () => {
    const replies = [() => empty(), () => text("", 200), () => text("null")];
    for (const reply of replies) {
      const { client } = harness({
        [`POST ${TOKEN}`]: () => text(syntheticBearer(Date.now() + 86_400_000)),
        [`GET ${PROBE}`]: reply,
      });
      expect(
        await client.json(PROBE, undefined, "profile-settings"),
      ).toBeNull();
    }
    const { client } = harness({
      [`POST ${TOKEN}`]: () => text(syntheticBearer(Date.now() + 86_400_000)),
      [`GET ${PROBE}`]: () => text("{not json"),
    });
    expect(
      (await failure(client.json(PROBE, undefined, "profile-settings")))?.kind,
    ).toBe("protocol");
  });

  it("bounds response sizes for text, JSON and binary", async () => {
    const big = new Uint8Array(5 * 1024 * 1024);
    const { client } = harness({
      [`POST ${TOKEN}`]: () => text(syntheticBearer(Date.now() + 86_400_000)),
      "GET /download-service/files/activity/1": () => binary(big),
    });
    expect(
      (
        await failure(
          client.binary("/download-service/files/activity/1", "activity-file"),
        )
      )?.kind,
    ).toBe("too-large");
    const huge = harness({ [`POST ${TOKEN}`]: () => text("a".repeat(20_000)) });
    expect(
      (await failure(huge.client.json(PROBE, undefined, "profile-settings")))
        ?.kind,
    ).toBe("too-large");
  });

  it("never follows redirects or leaves the fixed origin", async () => {
    const { api, client } = harness({
      [`POST ${TOKEN}`]: () => text(syntheticBearer(Date.now() + 86_400_000)),
      [`GET ${PROBE}`]: () =>
        new Response(null, {
          status: 302,
          headers: { location: "https://evil.example/steal" },
        }),
    });
    expect(
      (await failure(client.json(PROBE, undefined, "profile-settings")))?.kind,
    ).toBe("protocol");
    expect(api.requests.every((request) => request.path.startsWith("/"))).toBe(
      true,
    );
  });

  it("maps cancellation and transport faults to fixed-vocabulary errors", async () => {
    const controller = new AbortController();
    const api = fakeApi({
      [`POST ${TOKEN}`]: () => text(syntheticBearer(Date.now() + 86_400_000)),
    });
    const client = createOfficialClient({
      apiKey: () => KEY,
      fetch: (async () => {
        controller.abort();
        throw new TypeError("connect ECONNRESET https://secret.example?k=1");
      }) as typeof fetch,
      gate: {
        admit: async () => ({ timeoutMs: 100 }),
        signal: controller.signal,
      },
    });
    const error = await failure(
      client.json(PROBE, undefined, "profile-settings"),
    );
    expect(error?.kind).toBe("network");
    expect(error?.message).not.toContain("secret.example");
    void api;
  });

  it("refuses to send when admission refuses, so budget and cancellation precede I/O", async () => {
    const api = fakeApi({});
    const client = createOfficialClient({
      apiKey: () => KEY,
      fetch: api.fetch,
      gate: {
        admit: async () => {
          throw new Error("budget");
        },
        signal: new AbortController().signal,
      },
    });
    await expect(
      client.json(PROBE, undefined, "profile-settings"),
    ).rejects.toThrow("budget");
    expect(api.requests).toHaveLength(0);
  });
});
