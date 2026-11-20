import type { OfficialReaderDeps } from "../src/lib/garmin/official-reader";
import { createGarminReader } from "./legacy-reader-double";

/**
 * Module replacement for `official-reader` in application-policy suites that
 * still author MCP-shaped payloads. Production composition, application
 * policy and SQLite stay real; only the reader behind the composition seam is
 * the test-only legacy double. Official-path behavior is proven separately by
 * the official-* and production-wiring suites.
 */
type Connector = Parameters<typeof createGarminReader>[0]["connector"];
const noop = async () => undefined;

export function legacyReaderModule(Connector: new () => Connector) {
  return {
    OFFICIAL_RANGE_LIMITS: {},
    createOfficialReader: (deps: OfficialReaderDeps) =>
      createGarminReader({
        control: deps.control,
        connector: new Connector(),
        lastUsedConnector: () => new Connector(),
        fit: { baseline: noop, altitude: noop, distance: noop, speed: noop },
        // Legacy rows carry MCP tool labels; the real repository archive accepts both.
        archive: deps.archive as unknown as Parameters<
          typeof createGarminReader
        >[0]["archive"],
      }),
  };
}

const SLOT = "__trainerGarminConnectionV1";
/** Install a synthetic key through the real process capability (test isolation resets it). */
export async function installSyntheticKey(): Promise<void> {
  const slot = (process as unknown as Record<string, { installed?: unknown }>)[
    SLOT
  ];
  if (slot) delete slot.installed;
  const { installGarminConnection } =
    await import("../src/lib/garmin/connection");
  installGarminConnection({ key: "synthetic-policy-key" });
}
