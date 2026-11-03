import { randomUUID } from "node:crypto";
import {
  configuredSecret,
  getOptionalEnv,
  liveConfigurationStatus,
} from "../env";
import { summaryStorage } from "../db/summary-storage";
import { createSummaryEngine } from "./summary-application";
import { createSummaryGeneration } from "./summary-provider";
import { summaryCap, SUMMARY_DEADLINE_MS } from "./summary-policy";
import { summaryLifetime } from "./summary-lifetime";

export function readCrossChatSummary(content = false) {
  const status = summaryStorage.status(Date.now());
  return content
    ? {
        ...status,
        summary: summaryStorage.revision(),
        authority: "untrusted user-derived continuity; not used by chat",
      }
    : status;
}
export function changeCrossChatSummary(
  action: "clear" | "disable" | "enable" | "retry",
) {
  summaryLifetime().active?.abort();
  summaryStorage.control(action, Date.now());
  return readCrossChatSummary();
}
export async function tickCrossChatSummary(identity: string): Promise<void> {
  const live = liveConfigurationStatus();
  if (live.boot !== identity) throw new Error("summary_tick_denied");
  const lifetime = summaryLifetime();
  if (lifetime.stopping || lifetime.running) return;
  const env = getOptionalEnv();
  summaryStorage.configure(
    env.SUMMARY_ENABLED === "true",
    env.SUMMARY_MODEL === "unselected" ? "" : env.SUMMARY_MODEL,
    summaryCap(Number(env.SUMMARY_CHAR_LIMIT)),
  );
  lifetime.running = true;
  const abort = new AbortController();
  lifetime.active = abort;
  const deadline = setTimeout(() => abort.abort(), SUMMARY_DEADLINE_MS);
  const current = () =>
    !lifetime.stopping &&
    !abort.signal.aborted &&
    liveConfigurationStatus().generation === live.generation;
  const key = configuredSecret(env.OPENAI_API_KEY);
  const engine = createSummaryEngine({
    storage: summaryStorage,
    generation: key ? createSummaryGeneration(key, fetch, current) : null,
    identity: randomUUID,
    now: Date.now,
    current,
    jitter: () => Math.floor(Math.random() * 15001),
    holdLease(job) {
      const heartbeat = setInterval(() => {
        if (!current() || !summaryStorage.heartbeat(job, Date.now()))
          abort.abort();
      }, 5000);
      return () => clearInterval(heartbeat);
    },
  });
  try {
    await engine.tick(abort.signal);
  } finally {
    clearTimeout(deadline);
    lifetime.active = undefined;
    lifetime.running = false;
  }
}
