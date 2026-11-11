// Public-client network/crypto adapter. Native owns lifetime, storage and commit.
// This module never reads settings, writes credentials or prints network errors.
import { createHash, createPublicKey, randomBytes, verify } from "node:crypto";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

export const ISSUER = "https://auth.openai.com";
export const RESOURCE = "https://api.openai.com/v1";
const AUTHORIZE = `${ISSUER}/api/accounts/authorize`;
const TOKEN = `${ISSUER}/api/accounts/oauth/token`;
const SCOPES =
  "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
const TERMINAL = new Set([
  "invalid_grant",
  "invalid_refresh_token",
  "token_expired",
  "refresh_token_expired",
  "refresh_token_invalidated",
  "refresh_token_reused",
]);
const opaque = (value, max = 16384) =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= max &&
  ![...value].some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || (code >= 127 && code <= 159);
  });
const fail = (code) => {
  throw new Error(code);
};
const random = () => randomBytes(32).toString("base64url");

async function boundedJson(response, limit = 128 * 1024) {
  const reader = response.body?.getReader();
  if (!reader) return fail("protocol");
  let size = 0;
  const chunks = [];
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) return fail("protocol");
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
async function request(url, init, transport) {
  try {
    return await transport(url, {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    return fail("network");
  }
}
async function discovery(transport = fetch) {
  const response = await request(
    `${ISSUER}/.well-known/openid-configuration`,
    {},
    transport,
  );
  if (!response.ok) return fail("network");
  const value = await boundedJson(response);
  if (
    value.issuer !== ISSUER ||
    value.authorization_endpoint !== AUTHORIZE ||
    value.token_endpoint !== TOKEN ||
    value.jwks_uri !== `${ISSUER}/.well-known/jwks.json` ||
    value.revocation_endpoint !== `${ISSUER}/api/accounts/oauth/revoke`
  )
    return fail("discovery");
  return value;
}
export async function validateIdentity(
  token,
  clientId,
  nonce,
  transport = fetch,
  now = Date.now() / 1000,
) {
  if (!opaque(token) || !opaque(clientId, 256)) return fail("identity");
  const parts = token.split(".");
  if (
    parts.length !== 3 ||
    parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part))
  )
    return fail("identity");
  let header, claims;
  try {
    header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    return fail("identity");
  }
  if (
    header.alg !== "RS256" ||
    !opaque(header.kid, 256) ||
    header.jku ||
    header.jwk ||
    header.x5u ||
    header.crit ||
    claims.iss !== ISSUER ||
    !opaque(claims.sub, 256) ||
    !(
      claims.aud === clientId ||
      (Array.isArray(claims.aud) &&
        claims.aud.includes(clientId) &&
        claims.azp === clientId)
    ) ||
    !Number.isFinite(claims.exp) ||
    claims.exp <= now ||
    (claims.nbf !== undefined &&
      (!Number.isFinite(claims.nbf) || claims.nbf > now + 30)) ||
    (nonce !== undefined && claims.nonce !== nonce)
  )
    return fail("identity");
  const config = await discovery(transport);
  const response = await request(config.jwks_uri, {}, transport);
  if (!response.ok) return fail("network");
  const jwks = await boundedJson(response);
  const keys = Array.isArray(jwks.keys)
    ? jwks.keys.filter(
        (key) =>
          key.kid === header.kid &&
          key.kty === "RSA" &&
          (!key.alg || key.alg === "RS256") &&
          (!key.use || key.use === "sig") &&
          (!key.key_ops || key.key_ops.includes("verify")),
      )
    : [];
  if (keys.length !== 1) return fail("identity");
  try {
    const key = createPublicKey({ key: keys[0], format: "jwk" });
    if (
      !verify(
        "RSA-SHA256",
        Buffer.from(`${parts[0]}.${parts[1]}`),
        key,
        Buffer.from(parts[2], "base64url"),
      )
    )
      return fail("identity");
  } catch {
    return fail("identity");
  }
  return {
    issuer: ISSUER,
    subject: claims.sub,
    email: opaque(claims.email, 254) ? claims.email : "ChatGPT account",
  };
}
export function authorization({
  hostId,
  registration,
  pendingClientId,
  redirectUri,
  state,
  nonce,
  verifier,
  consent = false,
}) {
  if (!/^urn:uuid:[a-f0-9-]{36}$/.test(hostId)) return fail("host");
  const callback = new URL(redirectUri);
  if (
    callback.protocol !== "http:" ||
    callback.hostname !== "127.0.0.1" ||
    !callback.port ||
    callback.pathname !== "/auth/callback" ||
    callback.search ||
    callback.hash ||
    callback.username ||
    callback.password
  )
    return fail("callback");
  if (
    pendingClientId !== undefined &&
    pendingClientId !== null &&
    (!opaque(pendingClientId, 256) ||
      pendingClientId === "dynamic_agent_client")
  )
    return fail("identity");
  const url = new URL(AUTHORIZE);
  const parameters = {
    client_id:
      registration?.clientId ?? pendingClientId ?? "dynamic_agent_client",
    ext_agent_host_id: hostId,
    response_type: "code",
    redirect_uri: redirectUri,
    scope: SCOPES,
    resource: RESOURCE,
    state,
    nonce,
    code_challenge_method: "S256",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    ...(!registration && !pendingClientId
      ? { agent_name_hint: "Garmin Trainer" }
      : {}),
    ...(registration?.idToken ? { id_token_hint: registration.idToken } : {}),
    ...(consent ? { prompt: "consent" } : {}),
  };
  for (const [key, value] of Object.entries(parameters))
    url.searchParams.set(key, value);
  return url;
}
export function callbackResult(url, state, registration) {
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    !url.port ||
    url.username ||
    url.password ||
    url.pathname !== "/auth/callback" ||
    [...new Set(url.searchParams.keys())].some(
      (key) => url.searchParams.getAll(key).length !== 1,
    ) ||
    url.searchParams.get("state") !== state
  )
    return fail("callback");
  if (url.searchParams.has("error"))
    return fail(
      url.searchParams.get("error") === "access_denied" ? "denied" : "callback",
    );
  const clientId = url.searchParams.get("client_id") ?? registration?.clientId;
  const code = url.searchParams.get("code");
  if (
    !opaque(clientId, 256) ||
    clientId === "dynamic_agent_client" ||
    !opaque(code, 4096) ||
    (registration && clientId !== registration.clientId)
  )
    return fail("callback");
  return { clientId, code };
}
async function tokens(parameters, registration, nonce, transport) {
  const response = await request(
    TOKEN,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(parameters),
    },
    transport,
  );
  const body = await boundedJson(response);
  if (!response.ok)
    return fail(
      TERMINAL.has(body.error)
        ? "reconnect-required"
        : body.error === "invalid_client"
          ? "invalid-client"
          : "network",
    );
  // OAuth refresh may omit an unchanged scope; only that omission retains the
  // previously verified grant. An explicit malformed/narrowed scope never does.
  const scope =
    body.scope === undefined && nonce === undefined && registration
      ? registration.scopes.join(" ")
      : body.scope;
  const scopes = opaque(scope, 2048) ? [...new Set(scope.split(/\s+/))] : [];
  const refreshOptional =
    body.refresh_token == null && !scopes.includes("offline_access");
  if (
    body.token_type?.toLowerCase() !== "bearer" ||
    !opaque(body.access_token) ||
    (!opaque(body.refresh_token) && !refreshOptional) ||
    !Number.isSafeInteger(body.expires_in) ||
    body.expires_in < 1 ||
    body.expires_in > 86400 ||
    !opaque(scope, 2048)
  )
    return fail("protocol");
  const idToken =
    body.id_token ?? (nonce === undefined ? registration?.idToken : undefined);
  const identity = body.id_token
    ? await validateIdentity(
        body.id_token,
        parameters.client_id,
        nonce,
        transport,
      )
    : nonce === undefined && registration
      ? {
          issuer: registration.issuer,
          subject: registration.subject,
          email: registration.email,
        }
      : fail("identity");
  if (
    registration &&
    (identity.issuer !== registration.issuer ||
      identity.subject !== registration.subject ||
      parameters.client_id !== registration.clientId)
  )
    return fail("identity");
  const now = Math.floor(Date.now() / 1000);
  const earliest = body.earliest_refresh_at;
  if (
    earliest !== undefined &&
    (!Number.isSafeInteger(earliest) ||
      earliest > now + body.expires_in ||
      earliest < 0)
  )
    return fail("protocol");
  return {
    ...identity,
    clientId: parameters.client_id,
    accessToken: body.access_token,
    refreshToken: body.refresh_token ?? null,
    idToken,
    scopes,
    expiresAt: now + body.expires_in,
    earliestRefreshAt: earliest ?? now,
    models: [],
  };
}
export async function refresh(registration, transport = fetch) {
  return tokens(
    {
      grant_type: "refresh_token",
      client_id: registration.clientId,
      refresh_token: registration.refreshToken,
      resource: RESOURCE,
    },
    registration,
    undefined,
    transport,
  );
}
export async function revoke(registration, transport = fetch) {
  const config = await discovery(transport);
  const response = await request(
    config.revocation_endpoint,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        token: registration.refreshToken,
        token_type_hint: "refresh_token",
        client_id: registration.clientId,
      }),
    },
    transport,
  );
  return { confirmed: response.status === 200 };
}
export async function models(registration, transport = fetch) {
  if (
    !registration.scopes.includes("chatgpt.tokens.use.direct") ||
    !registration.scopes.includes("resource.invoke")
  )
    return fail("consent-required");
  const response = await request(
    `${RESOURCE}/models`,
    { headers: { Authorization: `Bearer ${registration.accessToken}` } },
    transport,
  );
  if (!response.ok)
    return fail(
      response.status === 401
        ? "reconnect-required"
        : response.status === 403
          ? "ineligible"
          : "network",
    );
  const body = await boundedJson(response);
  if (!Array.isArray(body.models) || body.models.length > 256)
    return fail("protocol");
  const seen = new Set();
  return body.models
    .filter((model) => model.visibility === "list")
    .map((model) => {
      if (
        !opaque(model.slug, 256) ||
        !opaque(model.display_name, 256) ||
        seen.has(model.slug)
      )
        return fail("protocol");
      seen.add(model.slug);
      return { slug: model.slug, displayName: model.display_name };
    });
}
export function openSystemBrowser(url, launch = spawn) {
  if (
    !(url instanceof URL) ||
    url.origin !== ISSUER ||
    url.pathname !== "/api/accounts/authorize" ||
    url.username ||
    url.password ||
    url.hash
  )
    return Promise.reject(new Error("browser"));
  return new Promise((resolve, reject) => {
    // NSWorkspace is the native URL-opening API. Use the OS Objective-C bridge,
    // not AppleEvents/UI automation, and send its fixed program over stdin: an
    // ID-token hint must never appear in process arguments or diagnostic output.
    const child = launch("/usr/bin/osascript", ["-l", "JavaScript"], {
      stdio: ["pipe", "ignore", "ignore"],
      env: { PATH: "/usr/bin:/bin" },
    });
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (ok) resolve();
      else reject(new Error("browser"));
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(false);
    }, 5000);
    child.once("error", () => finish(false));
    child.once("exit", (code) => finish(code === 0));
    child.stdin.once("error", () => finish(false));
    child.stdin.end(
      `ObjC.import('AppKit'); if (!$.NSWorkspace.sharedWorkspace.openURL($.NSURL.URLWithString(${JSON.stringify(url.href)}))) throw new Error('Browser unavailable');`,
    );
  });
}
export async function signIn(
  input,
  transport = fetch,
  openBrowser = openSystemBrowser,
) {
  const state = random(),
    nonce = random(),
    verifier = random();
  let settle;
  const result = new Promise((resolve, reject) => {
    settle = { resolve, reject };
  });
  // A denial/timeout may arrive while the browser launcher is still settling.
  result.catch(() => {});
  const lifetime = new AbortController();
  const authTransport = (url, init) =>
    transport(url, {
      ...init,
      signal: AbortSignal.any([init.signal, lifetime.signal]),
    });
  let issuedClientId;
  let accepted = false;
  const server = createServer({ maxHeaderSize: 8192 }, (request, response) => {
    if (
      request.method !== "GET" ||
      request.headers.origin ||
      request.headers.host !== `127.0.0.1:${server.address().port}` ||
      accepted ||
      (request.url?.length ?? 0) > 8192
    ) {
      response.writeHead(400).end();
      return;
    }
    try {
      const target = new URL(request.url, `http://${request.headers.host}`);
      if (target.origin !== `http://${request.headers.host}`)
        return fail("callback");
      const value = callbackResult(
        target,
        state,
        input.registration ??
          (input.pendingClientId
            ? { clientId: input.pendingClientId }
            : undefined),
      );
      accepted = true;
      response
        .writeHead(200, {
          "content-type": "text/plain",
          "cache-control": "no-store",
          "content-security-policy": "default-src 'none'",
          "referrer-policy": "no-referrer",
        })
        .end("Return to Garmin Trainer to check the connection.");
      settle.resolve(value);
    } catch (error) {
      response
        .writeHead(400)
        .end("Sign-in callback refused. Return to Garmin Trainer.");
      // Wrong-state traffic cannot cancel or consume the genuine pending attempt.
      if (error.message === "denied") {
        accepted = true;
        settle.reject(error);
      }
    }
  });
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  const timer = setTimeout(() => {
    lifetime.abort();
    settle.reject(new Error("timeout"));
  }, 180000);
  try {
    await new Promise((resolve, reject) => {
      server.once("error", () => reject(new Error("listener")));
      server.listen(0, "127.0.0.1", resolve);
    });
    const redirectUri = `http://127.0.0.1:${server.address().port}/auth/callback`;
    await openBrowser(
      authorization({ ...input, redirectUri, state, nonce, verifier }),
    );
    const callback = await result;
    issuedClientId = callback.clientId;
    return await tokens(
      {
        grant_type: "authorization_code",
        client_id: callback.clientId,
        code: callback.code,
        code_verifier: verifier,
        redirect_uri: redirectUri,
        resource: RESOURCE,
      },
      input.registration,
      nonce,
      authTransport,
    );
  } catch (error) {
    if (lifetime.signal.aborted) return fail("timeout");
    if (
      error.message === "reconnect-required" &&
      !input.registration &&
      issuedClientId
    )
      error.pendingClientId = issuedClientId;
    throw error;
  } finally {
    clearTimeout(timer);
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

async function main() {
  let input = Buffer.alloc(0);
  for await (const chunk of process.stdin) {
    input = Buffer.concat([input, chunk]);
    if (input.length > 128 * 1024) return fail("protocol");
  }
  try {
    const value = JSON.parse(input.toString("utf8"));
    if (!["sign-in", "refresh", "revoke", "models"].includes(value.operation))
      return fail("protocol");
    const result =
      value.operation === "sign-in"
        ? await signIn(value)
        : value.operation === "refresh"
          ? await refresh(value.registration)
          : value.operation === "revoke"
            ? await revoke(value.registration)
            : await models(value.registration);
    process.stdout.write(JSON.stringify({ ok: true, result }));
  } finally {
    input.fill(0);
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  // Only closed diagnostics ever leave this private protocol; no error body/URL.
  main().catch((error) => {
    const code = [
      "protocol",
      "network",
      "identity",
      "discovery",
      "host",
      "callback",
      "denied",
      "reconnect-required",
      "invalid-client",
      "consent-required",
      "ineligible",
      "browser",
      "timeout",
      "listener",
    ].includes(error.message)
      ? error.message
      : "protocol";
    process.stdout.write(
      JSON.stringify({
        ok: false,
        code,
        ...(code === "reconnect-required" && opaque(error.pendingClientId, 256)
          ? { pendingClientId: error.pendingClientId }
          : {}),
      }),
    );
    process.exitCode = 1;
  });
}
