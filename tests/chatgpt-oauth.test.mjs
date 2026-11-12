import { test } from "vitest";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { EventEmitter } from "node:events";
import {
  authorization,
  callbackResult,
  validateIdentity,
  failureResult,
  refresh,
  models,
  revoke,
  signIn,
  openSystemBrowser,
  ISSUER,
  RESOURCE,
} from "../scripts/desktop/chatgpt-oauth.mjs";

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const jwk = {
  ...publicKey.export({ format: "jwk" }),
  kid: "authored",
  alg: "RS256",
  use: "sig",
};
const now = Math.floor(Date.now() / 1000);
function jwt(claims = {}, header = {}) {
  const parts = [
    { alg: "RS256", kid: "authored", ...header },
    {
      iss: ISSUER,
      sub: "authored-subject",
      aud: "oaiapp_authored",
      exp: now + 3600,
      nonce: "authored-nonce",
      email: "synthetic@example.invalid",
      ...claims,
    },
  ].map((v) => Buffer.from(JSON.stringify(v)).toString("base64url"));
  return `${parts.join(".")}.${sign("RSA-SHA256", Buffer.from(parts.join(".")), privateKey).toString("base64url")}`;
}
const config = {
  issuer: ISSUER,
  authorization_endpoint: `${ISSUER}/api/accounts/authorize`,
  token_endpoint: `${ISSUER}/api/accounts/oauth/token`,
  jwks_uri: `${ISSUER}/.well-known/jwks.json`,
  revocation_endpoint: `${ISSUER}/api/accounts/oauth/revoke`,
};
const json = (value, status = 200) => Response.json(value, { status });
function transport(token = {}, record = []) {
  return async (url, init) => {
    assert.equal(init.redirect, "error");
    record.push({ url: String(url), init });
    if (String(url).endsWith("openid-configuration")) return json(config);
    if (String(url).endsWith("jwks.json")) return json({ keys: [jwk] });
    if (String(url).endsWith("oauth/token"))
      return json({
        access_token: "authored-access",
        refresh_token: "authored-rotation",
        token_type: "Bearer",
        id_token: jwt(),
        expires_in: 3600,
        scope:
          "openid offline_access resource.invoke chatgpt.tokens.use.direct",
        ...token,
      });
    throw new Error("Unexpected network");
  };
}
const registration = {
  clientId: "oaiapp_authored",
  issuer: ISSUER,
  subject: "authored-subject",
  email: "synthetic@example.invalid",
  idToken: jwt(),
  refreshToken: "authored-refresh",
  accessToken: "authored-access",
  scopes: ["resource.invoke", "chatgpt.tokens.use.direct"],
};

test("official initial/returning authorization binds host, callback, PKCE and explicit consent", () => {
  const input = {
    hostId: "urn:uuid:11111111-1111-4111-8111-111111111111",
    redirectUri: "http://127.0.0.1:12345/auth/callback",
    state: "state",
    nonce: "nonce",
    verifier: "verifier",
  };
  const initial = authorization(input);
  assert.equal(
    initial.origin + initial.pathname,
    `${ISSUER}/api/accounts/authorize`,
  );
  assert.equal(initial.searchParams.get("agent_name_hint"), "Garmin Trainer");
  assert.equal(initial.searchParams.get("client_id"), "dynamic_agent_client");
  assert.equal(initial.searchParams.get("code_challenge_method"), "S256");
  assert.equal(initial.searchParams.get("resource"), RESOURCE);
  assert.equal(initial.searchParams.has("prompt"), false);
  const returning = authorization({ ...input, registration, consent: true });
  assert.equal(returning.searchParams.get("client_id"), registration.clientId);
  assert.equal(
    returning.searchParams.get("id_token_hint"),
    registration.idToken,
  );
  assert.equal(returning.searchParams.has("agent_name_hint"), false);
  assert.equal(returning.searchParams.get("prompt"), "consent");
  assert.equal(returning.searchParams.has("force_reconsent"), false);
  for (const redirectUri of [
    "http://localhost:12345/auth/callback",
    "https://127.0.0.1:12345/auth/callback",
    "http://127.0.0.1:12345/callback",
    "http://127.0.0.1:12345/auth/callback?x=1",
  ])
    assert.throws(() => authorization({ ...input, redirectUri }), /callback/);
});

test("callback rejects replay context, duplicate values, denial and changed/missing client", () => {
  const url = (query) =>
    new URL(`http://127.0.0.1:12345/auth/callback?${query}`);
  assert.deepEqual(
    callbackResult(url("code=c&state=s&client_id=oaiapp_new"), "s"),
    { code: "c", clientId: "oaiapp_new" },
  );
  assert.deepEqual(callbackResult(url("code=c&state=s"), "s", registration), {
    code: "c",
    clientId: registration.clientId,
  });
  for (const query of [
    "code=c&state=wrong&client_id=oaiapp_new",
    "code=c&state=s&state=s&client_id=oaiapp_new",
    "code=c&state=s",
    "code=c&state=s&client_id=dynamic_agent_client",
  ])
    assert.throws(() => callbackResult(url(query), "s"), /callback/);
  assert.throws(
    () =>
      callbackResult(
        url("code=c&state=s&client_id=oaiapp_other"),
        "s",
        registration,
      ),
    /callback/,
  );
  assert.throws(
    () => callbackResult(url("error=access_denied&state=s"), "s"),
    /denied/,
  );
});

test("signed ID tokens require trusted key, algorithm, issuer, audience, expiry, nonce and verified identity", async () => {
  assert.equal(
    (
      await validateIdentity(
        jwt(),
        registration.clientId,
        "authored-nonce",
        transport(),
      )
    ).subject,
    registration.subject,
  );
  for (const claims of [
    { iss: "https://foreign.invalid" },
    { aud: "foreign" },
    { exp: now - 1 },
    { nonce: "wrong" },
    { sub: "" },
    { nbf: now + 600 },
    { aud: [registration.clientId, "foreign"] },
  ])
    await assert.rejects(
      validateIdentity(
        jwt(claims),
        registration.clientId,
        "authored-nonce",
        transport(),
      ),
      /identity/,
    );
  for (const header of [
    { alg: "none" },
    { alg: "HS256" },
    { kid: "foreign" },
    { jku: "https://foreign.invalid/keys" },
  ])
    await assert.rejects(
      validateIdentity(
        jwt({}, header),
        registration.clientId,
        "authored-nonce",
        transport(),
      ),
      /identity/,
    );
  const token = jwt();
  await assert.rejects(
    validateIdentity(
      token.slice(0, -8) + "AAAAAAAA",
      registration.clientId,
      "authored-nonce",
      transport(),
    ),
    /identity/,
  );
  await assert.rejects(
    validateIdentity(
      jwt(),
      registration.clientId,
      "authored-nonce",
      async (url) =>
        String(url).endsWith("openid-configuration")
          ? json({ ...config, jwks_uri: "https://foreign.invalid/keys" })
          : json({ keys: [jwk] }),
    ),
    /discovery/,
  );
});

test("a single issued-client audience is equivalent in string and array form; authorized-party binding remains strict", async () => {
  for (const aud of [registration.clientId, [registration.clientId]]) {
    for (const azp of [undefined, registration.clientId]) {
      const identity = await validateIdentity(
        jwt({ aud, azp }),
        registration.clientId,
        "authored-nonce",
        transport(),
      );
      assert.equal(identity.subject, registration.subject);
    }
    for (const azp of ["foreign-client", "", null, [registration.clientId]])
      await assert.rejects(
        validateIdentity(
          jwt({ aud, azp }),
          registration.clientId,
          "authored-nonce",
          transport(),
        ),
        (error) => error.message === "identity" && error.reason === "audience",
      );
  }
  for (const aud of [
    undefined,
    null,
    [],
    ["foreign-client"],
    [registration.clientId, 1],
    [registration.clientId, ""],
    { client: registration.clientId },
  ])
    await assert.rejects(
      validateIdentity(
        jwt({ aud, azp: registration.clientId }),
        registration.clientId,
        "authored-nonce",
        transport(),
      ),
      (error) => error.message === "identity" && error.reason === "audience",
    );
});

test("identity failures expose only allowlisted categories, never token, claim, key or exception contents", async () => {
  const secret = "authored-private-do-not-echo";
  const refused = async (token, reason, network = transport()) => {
    await assert.rejects(
      validateIdentity(token, registration.clientId, "authored-nonce", network),
      (error) => {
        assert.equal(error.message, "identity");
        assert.deepEqual(failureResult(error), {
          ok: false,
          code: "identity",
          reason,
        });
        assert.equal(
          JSON.stringify(failureResult(error)).includes(secret),
          false,
        );
        return true;
      },
    );
  };
  for (const token of [
    secret,
    "a.b.c",
    `${Buffer.from("null").toString("base64url")}.e30.c2ln`,
    `e30.${Buffer.from("null").toString("base64url")}.c2ln`,
    `e30.${Buffer.from("[]").toString("base64url")}.c2ln`,
  ])
    await refused(token, "format");
  for (const header of [
    { alg: secret },
    { kid: "" },
    { jku: secret },
    { jwk: { secret } },
    { x5u: secret },
    { crit: [secret] },
  ])
    await refused(jwt({}, header), "header");
  for (const [claims, reason] of [
    [{ iss: secret }, "issuer"],
    [{ sub: "" }, "subject"],
    [{ aud: secret }, "audience"],
    [{ aud: [registration.clientId, secret], azp: secret }, "audience"],
    [{ exp: now - 1 }, "expiry"],
    [{ exp: secret }, "expiry"],
    [{ nbf: now + 600 }, "expiry"],
    [{ nonce: secret }, "nonce"],
    [{ nonce: undefined }, "nonce"],
  ])
    await refused(jwt(claims), reason);
  for (const keys of [[], [jwk, jwk], [{ ...jwk, kid: secret }]])
    await refused(jwt(), "key", async (url) =>
      String(url).endsWith("openid-configuration")
        ? json(config)
        : json({ keys }),
    );
  const token = jwt();
  await refused(token.slice(0, -8) + "AAAAAAAA", "signature");
  const multiAudience = await validateIdentity(
    jwt({ aud: [registration.clientId, "other"], azp: registration.clientId }),
    registration.clientId,
    "authored-nonce",
    transport(),
  );
  assert.equal(multiAudience.subject, registration.subject);
  for (const error of [
    null,
    new Error(secret),
    { message: "identity", reason: secret, token, claims: secret },
    { message: "identity", reason: { secret }, stack: secret },
    { message: "network", reason: "nonce", body: secret },
  ]) {
    const result = failureResult(error);
    assert.equal(JSON.stringify(result).includes(secret), false);
    assert.deepEqual(Object.keys(result), ["ok", "code"]);
  }
  await assert.rejects(
    validateIdentity(
      jwt(),
      registration.clientId,
      "authored-nonce",
      async () => {
        throw new Error(secret);
      },
    ),
    (error) => {
      assert.deepEqual(failureResult(error), { ok: false, code: "network" });
      return true;
    },
  );
  await assert.rejects(
    refresh(registration, transport({ id_token: jwt({ sub: secret }) })),
    (error) => {
      assert.deepEqual(failureResult(error), {
        ok: false,
        code: "identity",
        reason: "registration",
      });
      return true;
    },
  );
});

test("rotating refresh keeps exact client/resource and rejects cross-account or unusable tokens", async () => {
  const calls = [];
  const result = await refresh(registration, transport({}, calls));
  assert.equal(result.refreshToken, "authored-rotation");
  assert.ok(result.expiresAt > now);
  const form = calls[0].init.body;
  assert.equal(form.get("client_id"), registration.clientId);
  assert.equal(form.get("refresh_token"), registration.refreshToken);
  assert.equal(form.get("resource"), RESOURCE);
  assert.equal(form.has("scope"), false);
  assert.equal(form.has("client_secret"), false);
  await assert.rejects(
    refresh(
      registration,
      transport({ id_token: jwt({ sub: "other-person-same-email" }) }),
    ),
    /identity/,
  );
  for (const value of [
    { refresh_token: "" },
    { expires_in: -1 },
    { token_type: "Basic" },
    { scope: null },
    { scope: "" },
    { earliest_refresh_at: now + 999999 },
  ])
    await assert.rejects(refresh(registration, transport(value)), /protocol/);
  for (const error of [
    "invalid_grant",
    "refresh_token_reused",
    "refresh_token_expired",
  ])
    await assert.rejects(
      refresh(registration, async () => json({ error }, 400)),
      /reconnect-required/,
    );
  await assert.rejects(
    refresh(registration, async () => json({ error: "temporary" }, 503)),
    /network/,
  );
  const unchanged = await refresh(
    registration,
    transport({ scope: undefined }),
  );
  assert.deepEqual(unchanged.scopes, registration.scopes);
  assert.equal(unchanged.refreshToken, "authored-rotation");
  const identityOnly = await refresh(
    registration,
    transport({ scope: "openid profile" }),
  );
  assert.equal(
    identityOnly.scopes.includes("chatgpt.tokens.use.direct"),
    false,
  );
});

test("model discovery accepts a bounded rich catalog above the credential-response limit and projects only visible names/ids", async () => {
  const extra = "authored-nonpublic-metadata-".repeat(8000);
  const body = {
    models: [
      {
        slug: "second",
        display_name: "Second",
        visibility: "list",
        capabilities: extra,
      },
      { slug: "hidden", visibility: "hidden", capabilities: extra },
      { slug: "first", display_name: "First", visibility: "list" },
    ],
  };
  assert.ok(Buffer.byteLength(JSON.stringify(body)) > 128 * 1024);
  const found = await models(registration, async () => json(body));
  assert.deepEqual(found, [
    { slug: "second", displayName: "Second" },
    { slug: "first", displayName: "First" },
  ]);
  assert.equal(JSON.stringify(found).includes("nonpublic-metadata"), false);
  await assert.rejects(refresh(registration, transport({ extra })), (error) => {
    assert.deepEqual(failureResult(error), { ok: false, code: "protocol" });
    return true;
  });
});

test("model discovery failures are closed, bounded and secret-free without claiming an empty catalog", async () => {
  const secret = "authored-private-model-response";
  for (const [network, code, reason] of [
    [
      async () => {
        throw new Error(secret);
      },
      "model-discovery",
      "network",
    ],
    [
      async () => new Response(secret, { status: 500 }),
      "model-discovery",
      "request",
    ],
    [
      async () => new Response(secret, { status: 429 }),
      "model-discovery",
      "rate-limit",
    ],
    [
      async () => new Response(secret, { status: 401 }),
      "reconnect-required",
      undefined,
    ],
    [
      async () => new Response(secret, { status: 403 }),
      "ineligible",
      undefined,
    ],
    [async () => new Response(secret), "model-discovery", "response"],
    [
      async () => new Response("x".repeat(2 * 1024 * 1024 + 1)),
      "model-discovery",
      "size",
    ],
    [async () => json(null), "model-discovery", "catalog"],
    [async () => json({ data: [secret] }), "model-discovery", "catalog"],
    [
      async () => json({ models: Array(257).fill({ visibility: "hidden" }) }),
      "model-discovery",
      "catalog",
    ],
    [async () => json({ models: [null] }), "model-discovery", "entry"],
    [
      async () => json({ models: [{ visibility: "list", slug: secret }] }),
      "model-discovery",
      "entry",
    ],
    [
      async () =>
        json({
          models: Array(2).fill({
            visibility: "list",
            slug: secret,
            display_name: secret,
          }),
        }),
      "model-discovery",
      "duplicate",
    ],
  ])
    await assert.rejects(models(registration, network), (error) => {
      assert.deepEqual(failureResult(error), {
        ok: false,
        code,
        ...(reason ? { reason } : {}),
      });
      assert.equal(
        JSON.stringify(failureResult(error)).includes(secret),
        false,
      );
      return true;
    });
  assert.deepEqual(
    failureResult({ message: "model-discovery", reason: secret, body: secret }),
    { ok: false, code: "model-discovery" },
  );
  assert.deepEqual(
    failureResult({ message: "model-discovery", reason: "nonce" }),
    { ok: false, code: "model-discovery" },
  );
  assert.deepEqual(failureResult({ message: "identity", reason: "catalog" }), {
    ok: false,
    code: "identity",
  });
  assert.deepEqual(
    await models(registration, async () => json({ models: [] })),
    [],
  );
});

test("account catalog preserves list order and exact slugs, without fallback", async () => {
  const seen = [];
  const found = await models(registration, async (url, init) => {
    seen.push(url);
    assert.equal(init.headers.Authorization, "Bearer authored-access");
    return json({
      models: [
        { slug: "second", display_name: "Second", visibility: "list" },
        { slug: "hidden", display_name: "Hidden", visibility: "hidden" },
        { slug: "first", display_name: "First", visibility: "list" },
      ],
    });
  });
  assert.deepEqual(seen, [`${RESOURCE}/models`]);
  assert.deepEqual(
    found.map((m) => m.slug),
    ["second", "first"],
  );
  await assert.rejects(
    models({ ...registration, scopes: [] }, () =>
      assert.fail("no inference without consent"),
    ),
    /consent-required/,
  );
  await assert.rejects(
    models(registration, async () =>
      json({
        models: [
          { slug: "same", display_name: "One", visibility: "list" },
          { slug: "same", display_name: "Two", visibility: "list" },
        ],
      }),
    ),
    (error) =>
      error.message === "model-discovery" && error.reason === "duplicate",
  );
});

test("revocation uses trusted discovery and form credentials, empty 200 is confirmation", async () => {
  let called = false;
  const result = await revoke(registration, async (url, init) => {
    if (String(url).endsWith("openid-configuration")) return json(config);
    assert.equal(url, config.revocation_endpoint);
    assert.equal(init.body.get("token"), registration.refreshToken);
    assert.equal(init.body.get("client_id"), registration.clientId);
    assert.equal(init.body.get("token_type_hint"), "refresh_token");
    called = true;
    return new Response(null, { status: 200 });
  });
  assert.deepEqual(result, { confirmed: true });
  assert.equal(called, true);
});

test.each(["string", "single-array"])(
  "real loopback flow with %s audience starts listener before browser and exchanges exact redirect/client",
  async (audienceShape) => {
    let pending;
    const calls = [];
    const network = async (url, init) => {
      if (String(url).endsWith("oauth/token")) {
        assert.equal(
          init.body.get("redirect_uri"),
          pending.searchParams.get("redirect_uri"),
        );
        assert.equal(init.body.get("client_id"), "oaiapp_authored");
        return json({
          access_token: "authored-access",
          refresh_token: "authored-refresh",
          id_token: jwt({
            nonce: pending.searchParams.get("nonce"),
            aud:
              audienceShape === "single-array"
                ? [registration.clientId]
                : registration.clientId,
          }),
          token_type: "Bearer",
          expires_in: 3600,
          scope: "openid resource.invoke chatgpt.tokens.use.direct",
        });
      }
      return transport({}, calls)(url, init);
    };
    const result = await signIn(
      { hostId: "urn:uuid:11111111-1111-4111-8111-111111111111" },
      network,
      async (url) => {
        pending = url;
        const callback = new URL(url.searchParams.get("redirect_uri"));
        callback.search = new URLSearchParams({
          state: url.searchParams.get("state"),
          code: "authored-code",
          client_id: "oaiapp_authored",
        }).toString();
        const wrong = new URL(callback);
        wrong.searchParams.set("state", "wrong");
        assert.equal((await fetch(wrong)).status, 400);
        assert.equal((await fetch(callback)).status, 200);
        assert.equal((await fetch(callback)).status, 400);
      },
    );
    assert.equal(result.subject, registration.subject);
    assert.equal(result.clientId, registration.clientId);
  },
);

test("an expired initial code retains its issued client for a fresh explicit authorization, without automatic retry", async () => {
  let pending;
  const authorizations = [];
  let attempts = 0;
  const network = async (url, init) => {
    if (String(url).endsWith("oauth/token")) {
      attempts++;
      assert.equal(init.body.get("client_id"), registration.clientId);
      if (attempts === 1) return json({ error: "invalid_grant" }, 400);
      return json({
        access_token: "authored-access",
        refresh_token: "authored-refresh",
        token_type: "Bearer",
        id_token: jwt({ nonce: pending.searchParams.get("nonce") }),
        expires_in: 3600,
        scope:
          "openid offline_access resource.invoke chatgpt.tokens.use.direct",
      });
    }
    return transport()(url, init);
  };
  const browser = async (url) => {
    pending = url;
    authorizations.push(url);
    const callback = new URL(url.searchParams.get("redirect_uri"));
    callback.search = new URLSearchParams({
      state: url.searchParams.get("state"),
      code: "authored-code",
      ...(authorizations.length === 1
        ? { client_id: registration.clientId }
        : {}),
    }).toString();
    assert.equal((await fetch(callback)).status, 200);
  };
  const input = { hostId: "urn:uuid:11111111-1111-4111-8111-111111111111" };
  let issued;
  await assert.rejects(signIn(input, network, browser), (error) => {
    issued = error.pendingClientId;
    return (
      error.message === "reconnect-required" && issued === registration.clientId
    );
  });
  assert.equal(attempts, 1);
  const result = await signIn(
    { ...input, pendingClientId: issued },
    network,
    browser,
  );
  assert.equal(result.clientId, registration.clientId);
  assert.equal(
    authorizations[1].searchParams.get("client_id"),
    registration.clientId,
  );
  assert.equal(authorizations[1].searchParams.has("agent_name_hint"), false);
  for (const key of ["state", "nonce", "code_challenge"])
    assert.notEqual(
      authorizations[0].searchParams.get(key),
      authorizations[1].searchParams.get(key),
    );
});

test("native browser opening keeps retained token hints out of argv and uses no generic URL or UI-automation command", async () => {
  const calls = [];
  let program;
  const launch = (...args) => {
    calls.push(args);
    const child = new EventEmitter();
    child.stdin = new EventEmitter();
    child.stdin.end = (input) => {
      program = input;
      queueMicrotask(() => child.emit("exit", 0));
    };
    child.kill = () => child.emit("exit", 1);
    return child;
  };
  const url = new URL(
    `${ISSUER}/api/accounts/authorize?id_token_hint=authored-private-hint`,
  );
  await openSystemBrowser(url, launch);
  assert.deepEqual(calls[0].slice(0, 2), [
    "/usr/bin/osascript",
    ["-l", "JavaScript"],
  ]);
  assert.equal(JSON.stringify(calls).includes("authored-private-hint"), false);
  assert.equal(program.includes("NSWorkspace.sharedWorkspace.openURL"), true);
  assert.equal(program.includes("authored-private-hint"), true);
  assert.equal(program.includes("Application("), false);
  await assert.rejects(
    openSystemBrowser(new URL("https://foreign.invalid/authorize"), launch),
    /browser/,
  );
  assert.equal(calls.length, 1);
});

test("identity-only grant can remain connected without offline permission or a refresh token", async () => {
  const result = await refresh(
    registration,
    transport({ scope: "openid profile email", refresh_token: undefined }),
  );
  assert.equal(result.subject, registration.subject);
  assert.equal(result.refreshToken, null);
  assert.equal(result.scopes.includes("chatgpt.tokens.use.direct"), false);
  assert.throws(
    () =>
      callbackResult(
        new URL(
          "https://foreign.invalid/auth/callback?code=c&state=s&client_id=oaiapp_authored",
        ),
        "s",
      ),
    /callback/,
  );
});
