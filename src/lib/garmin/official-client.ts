import { OfficialApiError } from "./official-error";

/** Fixed documented origin. Never configurable: no override, no `.cn`, no redirects. */
const OFFICIAL_ORIGIN = "https://personal.connectapi.garmin.com";
const TOKEN_PATH =
  "/personalapitoken-service/personal-api/personal-api-key/token";

const OFFICIAL_LIMITS = {
  /** Raw-text bearer token; real tokens are far smaller. */
  tokenBytes: 8_192,
  jsonBytes: 16 * 1024 * 1024,
  /** Zipped original files measured at 17–112 KB. */
  binaryBytes: 4 * 1024 * 1024,
  /** Documented lifetime is 24 h; reacquire conservatively before that. */
  tokenFallbackMs: 3_600_000,
  tokenMaxMs: 23 * 3_600_000,
  tokenSkewMs: 300_000,
} as const;

/** The caller owns pacing, budget and cancellation; the client asks once per HTTP request. */
type OfficialRequestGate = {
  /** Admit exactly one actual request (token exchange included). */
  admit(): Promise<{ timeoutMs: number }>;
  /** Aborted when the owning reader closes or cancels. */
  signal: AbortSignal;
};

export type OfficialClientDeps = {
  /** Explicit key capability; never read from process state or logged. */
  apiKey: () => string | Promise<string>;
  /** `fetch`-compatible transport, injected so tests and callers choose it. */
  fetch: typeof fetch;
  gate: OfficialRequestGate;
  clock?: () => number;
};

/** Fixed vocabulary only: no URL, query, header, key, token or body ever appears. */
export type OfficialEndpoint =
  | "token"
  | "activity-list"
  | "activity-summary"
  | "activity-file"
  | "daily-summaries"
  | "sleep"
  | "hrv"
  | "body-battery"
  | "vo2-max"
  | "weigh-ins"
  | "body-history"
  | "profile-settings"
  | "heart-rate-zones";

export type OfficialRequestStats = {
  total: number;
  byEndpoint: Partial<Record<OfficialEndpoint, number>>;
};

type Query = Record<string, string | number | boolean>;
type ReadOptions = { endpoint: OfficialEndpoint; accept: "json" | "binary" };

function utf8(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

async function readBounded(
  response: Response,
  maxBytes: number,
): Promise<Uint8Array> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes)
    throw new OfficialApiError("too-large");
  if (!response.body) return new Uint8Array(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new OfficialApiError("too-large");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/** Bearer `exp` (seconds) when a plain three-part token carries one. */
function tokenExpiryMs(token: string): number | null {
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    );
    const exp =
      parsed && typeof parsed === "object"
        ? (parsed as { exp?: unknown }).exp
        : undefined;
    return typeof exp === "number" && Number.isFinite(exp) ? exp * 1000 : null;
  } catch {
    return null;
  }
}

export function createOfficialClient(deps: OfficialClientDeps) {
  const now = deps.clock ?? (() => Date.now());
  let bearer: { value: string; expiresAt: number } | null = null;
  let keyRejected = false;
  const stats: OfficialRequestStats = { total: 0, byEndpoint: {} };

  async function send(
    method: "GET" | "POST",
    path: string,
    query: Query | undefined,
    headers: Record<string, string>,
    endpoint: OfficialEndpoint,
  ): Promise<Response> {
    const { timeoutMs } = await deps.gate.admit();
    const url = new URL(path, OFFICIAL_ORIGIN);
    for (const [name, value] of Object.entries(query ?? {}))
      url.searchParams.set(name, String(value));
    stats.total += 1;
    stats.byEndpoint[endpoint] = (stats.byEndpoint[endpoint] ?? 0) + 1;
    try {
      return await deps.fetch(url, {
        method,
        headers,
        redirect: "manual",
        signal: AbortSignal.any([
          deps.gate.signal,
          AbortSignal.timeout(timeoutMs),
        ]),
      });
    } catch {
      if (deps.gate.signal.aborted) throw new OfficialApiError("network");
      throw new OfficialApiError("timeout");
    }
  }

  function statusFailure(status: number, token: boolean): OfficialApiError {
    if (status === 401 || status === 403)
      return new OfficialApiError(
        token ? "key-rejected" : "token-rejected",
        status,
      );
    if (status === 404) return new OfficialApiError("not-found", status);
    if (status === 429) return new OfficialApiError("rate-limited", status);
    if (status >= 500) return new OfficialApiError("service", status);
    return new OfficialApiError("protocol", status);
  }

  async function acquire(): Promise<string> {
    if (keyRejected) throw new OfficialApiError("key-rejected");
    const key = await deps.apiKey();
    if (!key || /[\r\n]/.test(key)) throw new OfficialApiError("key-rejected");
    const response = await send(
      "POST",
      TOKEN_PATH,
      undefined,
      { Authorization: `ApiKey ${key}`, Accept: "text/plain" },
      "token",
    );
    if (response.status !== 200) {
      await response.body?.cancel().catch(() => undefined);
      const failure = statusFailure(response.status, true);
      // A rejected key stays rejected for this client; never loop on it.
      if (failure.kind === "key-rejected") keyRejected = true;
      throw failure;
    }
    let text: string;
    try {
      text = utf8(
        await readBounded(response, OFFICIAL_LIMITS.tokenBytes),
      ).trim();
    } catch (error) {
      if (error instanceof OfficialApiError) throw error;
      throw new OfficialApiError("protocol");
    }
    // Raw text, never JSON: refuse anything not shaped like a compact token.
    if (!/^[A-Za-z0-9._~+/=-]{16,}$/.test(text))
      throw new OfficialApiError("protocol");
    const issued = now();
    const expiry = tokenExpiryMs(text);
    const lifetime =
      expiry === null
        ? OFFICIAL_LIMITS.tokenFallbackMs
        : Math.min(
            expiry - issued - OFFICIAL_LIMITS.tokenSkewMs,
            OFFICIAL_LIMITS.tokenMaxMs,
          );
    if (lifetime <= 0) throw new OfficialApiError("key-rejected");
    bearer = { value: text, expiresAt: issued + lifetime };
    return text;
  }

  async function token(): Promise<string> {
    return bearer && bearer.expiresAt > now() ? bearer.value : acquire();
  }

  /** One GET; on a rejected bearer reacquire at most once, then stop. */
  async function get(
    path: string,
    query: Query | undefined,
    options: ReadOptions,
  ): Promise<Response> {
    for (let attempt = 0; ; attempt += 1) {
      const reusedToken = bearer !== null;
      const response = await send(
        "GET",
        path,
        query,
        {
          Authorization: `Bearer ${await token()}`,
          Accept: options.accept === "json" ? "application/json" : "*/*",
        },
        options.endpoint,
      );
      if (response.status === 401 && attempt === 0 && reusedToken) {
        await response.body?.cancel().catch(() => undefined);
        bearer = null;
        continue;
      }
      if (response.status === 200 || response.status === 204) return response;
      await response.body?.cancel().catch(() => undefined);
      throw statusFailure(response.status, false);
    }
  }

  return {
    /** JSON read. `null` means the source reported emptiness (204, empty or null body). */
    async json(
      path: string,
      query: Query | undefined,
      endpoint: OfficialEndpoint,
    ): Promise<unknown> {
      const response = await get(path, query, { endpoint, accept: "json" });
      if (response.status === 204) return null;
      const bytes = await readBounded(response, OFFICIAL_LIMITS.jsonBytes);
      if (bytes.byteLength === 0) return null;
      try {
        return JSON.parse(utf8(bytes)) as unknown;
      } catch {
        throw new OfficialApiError("protocol");
      }
    },
    /** Binary read (zipped original file); an empty reply is a protocol failure. */
    async binary(
      path: string,
      endpoint: OfficialEndpoint,
    ): Promise<Uint8Array> {
      const response = await get(path, undefined, {
        endpoint,
        accept: "binary",
      });
      const bytes = await readBounded(response, OFFICIAL_LIMITS.binaryBytes);
      if (response.status === 204 || bytes.byteLength === 0)
        throw new OfficialApiError("not-found");
      return bytes;
    },
    stats: (): OfficialRequestStats => ({
      total: stats.total,
      byEndpoint: { ...stats.byEndpoint },
    }),
  };
}
