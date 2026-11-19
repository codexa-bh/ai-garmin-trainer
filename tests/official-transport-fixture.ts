/** Authored in-memory Personal API: routes by method+path, records every request. */
export type Recorded = {
  method: string;
  path: string;
  query: Record<string, string>;
  authorization: string | null;
};
type Responder = (request: Recorded) => Response | Promise<Response>;

const TOKEN_HEADER = Buffer.from('{"alg":"none"}').toString("base64url");

/** Synthetic compact bearer with an `exp` claim, never a real credential. */
export function syntheticBearer(expiresAtMs: number, tag = "a"): string {
  const payload = Buffer.from(
    JSON.stringify({ exp: Math.floor(expiresAtMs / 1000), t: tag }),
  ).toString("base64url");
  return `${TOKEN_HEADER}.${payload}.signature${tag}`;
}

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
export const text = (body: string, status = 200) =>
  new Response(body, { status, headers: { "content-type": "text/plain" } });
export const empty = (status = 204) => new Response(null, { status });
export const binary = (bytes: Uint8Array, status = 200) =>
  new Response(Buffer.from(bytes), { status });

export function fakeApi(routes: Record<string, Responder>) {
  const requests: Recorded[] = [];
  const impl = async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const headers = new Headers(init?.headers);
    const request: Recorded = {
      method: init?.method ?? "GET",
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      authorization: headers.get("authorization"),
    };
    if (url.origin !== "https://personal.connectapi.garmin.com")
      throw new Error(`unexpected origin ${url.origin}`);
    if (init?.signal?.aborted) throw new DOMException("aborted", "AbortError");
    requests.push(request);
    const route =
      routes[`${request.method} ${request.path}`] ??
      Object.entries(routes).find(([key]) => {
        const [method, pattern] = key.split(" ");
        return (
          method === request.method &&
          pattern.endsWith("*") &&
          request.path.startsWith(pattern.slice(0, -1))
        );
      })?.[1];
    if (!route) return json({ error: "NOT_FOUND", status: 404 }, 404);
    return route(request);
  };
  return {
    fetch: impl as typeof fetch,
    requests,
    count: (path: string) =>
      requests.filter((request) => request.path === path).length,
  };
}
