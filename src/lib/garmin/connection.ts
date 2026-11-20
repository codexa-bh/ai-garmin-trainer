import { GarminSafeFailure } from "./failure";

/**
 * Process-owned Garmin connection capability, installed once from the native
 * private activation frame. The key never enters `process.env`, argv, child
 * environments, logs, HTTP responses or the trainer/model: only the official
 * reader asks for it, once per token exchange.
 *
 * The launcher and compiled Next routes are separate bundles in ONE Node
 * process, so (like the live configuration cell) the capability lives on a
 * narrowly named, non-enumerable process slot rather than a module singleton.
 * Garmin changes are startup-only: a later Save never replaces this value.
 */
type GarminConnection = {
  /** The user's official Personal API key, when configured. */
  key?: string;
  /**
   * Isolated synthetic runs only: an owned loopback stand-in for the fixed
   * official origin, admitted by native isolated-run ownership. Ordinary
   * configuration can never select it.
   */
  fixture?: { origin: string; capability: string };
};

const SLOT = "__trainerGarminConnectionV1";
type Holder = { installed?: Readonly<GarminConnection> };
type Owner = typeof process & { [SLOT]?: Holder };

/** One non-enumerable process slot; its connection is set once per process. */
function holder(): Holder {
  const owner = process as Owner;
  if (!Object.hasOwn(owner, SLOT))
    Object.defineProperty(owner, SLOT, {
      value: {},
      enumerable: false,
      writable: false,
      configurable: false,
    });
  return owner[SLOT]!;
}

export function installGarminConnection(connection: GarminConnection): void {
  const slot = holder();
  if (slot.installed) throw new Error("Garmin connection already installed.");
  slot.installed = Object.freeze({ ...connection });
}

function current(): Readonly<GarminConnection> {
  return holder().installed ?? {};
}

export function garminKeyConfigured(): boolean {
  return Boolean(current().key);
}

/** Closed failure text the existing sync policy classifies as authentication. */
export const GARMIN_KEY_MISSING =
  "Garmin authentication is not configured: add your Personal API key in native Settings, Save, then quit and reopen Trainer.";

export function garminApiKey(): string {
  const key = current().key;
  if (!key) throw new GarminSafeFailure(GARMIN_KEY_MISSING);
  return key;
}

const OFFICIAL_ORIGIN = "https://personal.connectapi.garmin.com";

/**
 * The transport for official reads: global `fetch`, or for an admitted
 * isolated synthetic run only, the same request rewritten to its owned
 * loopback fixture with a run capability header.
 */
export function garminTransport(): typeof fetch {
  const fixture = current().fixture;
  if (!fixture) return fetch;
  return ((input: URL | RequestInfo, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin !== OFFICIAL_ORIGIN)
      throw new Error("Garmin fixture refused a non-official origin.");
    const headers = new Headers(init?.headers);
    headers.set("x-trainer-fixture", fixture.capability);
    return fetch(new URL(url.pathname + url.search, fixture.origin), {
      ...init,
      headers,
    });
  }) as typeof fetch;
}
