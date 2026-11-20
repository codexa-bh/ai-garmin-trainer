import { OfficialApiError } from "./official-error";
import { garminKeyConfigured, GARMIN_KEY_MISSING } from "./connection";
import type { GarminReader } from "./import-ports";

export type GarminConnectionCheck = {
  ok: boolean;
  state:
    | "not-configured"
    | "verified"
    | "key-rejected"
    | "network"
    | "rate-limited"
    | "unavailable";
  detail: string;
};

/**
 * Explicit user-requested connection check through the official path only:
 * one profile read (token exchange plus settings). Never called by startup,
 * summary, Settings open or Save. The result is a point-in-time observation,
 * not a promise about future key validity.
 */
export function createConnectionCheck(
  createReader: () => Pick<GarminReader, "profile" | "close">,
) {
  return async function verifyGarminConnection(): Promise<GarminConnectionCheck> {
    if (!garminKeyConfigured())
      return { ok: false, state: "not-configured", detail: GARMIN_KEY_MISSING };
    const reader = createReader();
    try {
      await reader.profile();
      return {
        ok: true,
        state: "verified",
        detail: `Garmin accepted the Personal API key at ${new Date().toISOString()}. This does not guarantee future validity.`,
      };
    } catch (error) {
      const kind = error instanceof OfficialApiError ? error.kind : undefined;
      if (kind === "key-rejected" || kind === "token-rejected")
        return {
          ok: false,
          state: "key-rejected",
          detail:
            "Garmin rejected the Personal API key; it may be mistyped, expired or revoked. Create a new key, replace it privately in native Settings, Save, then quit and reopen. Saved data remains available.",
        };
      if (kind === "rate-limited")
        return {
          ok: false,
          state: "rate-limited",
          detail:
            "Garmin rate-limited the request. Retry later; this does not show the key is invalid.",
        };
      if (kind === "network" || kind === "service" || kind === "timeout")
        return {
          ok: false,
          state: "network",
          detail:
            "Garmin connection or service is unavailable; key validity is inconclusive. Retry later.",
        };
      return {
        ok: false,
        state: "unavailable",
        detail:
          "Garmin connection check did not complete; its cause is not established. Saved data remains available.",
      };
    } finally {
      reader.close();
    }
  };
}
