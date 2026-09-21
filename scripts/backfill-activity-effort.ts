import { loadEnvConfig } from "@next/env";
import { backfillActivityEffortFields } from "../src/lib/garmin/composition";
import { activityEffortCoverage } from "../src/lib/db/repository";

loadEnvConfig(process.cwd());

function limitFromArgs(): number {
  const index = process.argv.indexOf("--limit");
  const raw = index >= 0 ? process.argv[index + 1] : undefined;
  const parsed = Number(raw ?? 100);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 100;
}

async function main(): Promise<void> {
  const before = activityEffortCoverage();
  const result = await backfillActivityEffortFields({ limit: limitFromArgs() });
  const after = activityEffortCoverage();

  console.log(
    JSON.stringify(
      {
        status: result.status,
        attempted: result.attempted,
        updated: result.updated,
        remainingAtLeastOne: result.remaining > 0,
        coverageBefore: before,
        coverageAfter: after,
        detail: result.detail,
        redaction:
          "No Garmin IDs, raw values, raw payloads, secrets, token paths, env values, FIT bytes, streams, or coordinates are printed.",
      },
      null,
      2,
    ),
  );

  if (result.status !== "completed") process.exit(1);
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      status: "failed",
      error: error instanceof Error ? error.name : "Error",
    }),
  );
  process.exit(1);
});
