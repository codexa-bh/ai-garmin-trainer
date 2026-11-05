import { randomUUID } from "node:crypto";
import {
  summaryRebuildInventory,
  summaryRebuildStatus,
  startSummaryRebuild,
  cancelSummaryRebuild,
  reconcileSummaryRebuild,
} from "../db/summary-rebuild";
import {
  summaryImportInspection,
  createSummaryImport,
  controlSummaryImport,
} from "../db/summary-import";
import { getOptionalEnv, liveConfigurationStatus } from "../env";
import {
  summaryStorage,
  summaryInspectionSources,
  summaryManualIds,
  preservedLegacySummaryReview,
} from "../db/summary-storage";
import { createSummaryEngine } from "./summary-application";
import { createSummaryGeneration } from "./summary-provider";
import {
  summaryCap,
  SUMMARY_DEADLINE_MS,
  SUMMARY_CATCHUP_MS,
  SUMMARY_DEBOUNCE_MS,
} from "./summary-policy";
import { notifySummaryActivity, summaryLifetime } from "./summary-lifetime";
import { conversationSummaryStatus } from "../db/conversation-summary-pin";
import {
  assertSummaryRefreshIdle,
  refreshConversationSummary,
} from "../db/conversation-history";
import { summaryConfiguration } from "./summary-configuration";
import type {
  SummaryCommand,
  SummaryRebuildSelection,
} from "./summary-controls";

export function nativeSummaryStatus() {
  const env = getOptionalEnv();
  const status = summaryStorage.status(Date.now());
  return {
    version: 1,
    configuredEnabled: env.SUMMARY_ENABLED === "true",
    enabled: status.enabled,
    model:
      env.SUMMARY_MODEL === "gpt-6-luna"
        ? "luna"
        : env.SUMMARY_MODEL === "unselected"
          ? "unselected"
          : "catalog",
    cap: Number(env.SUMMARY_CHAR_LIMIT),
    state: status.state,
    revision: status.revision,
    frontier: status.frontier,
    pending: status.pending,
  };
}

export function readCrossChatSummary(content = false, conversationId?: string) {
  const status = summaryStorage.status(Date.now());
  const selectedChat = conversationId
    ? conversationSummaryStatus(conversationId)
    : null;
  const usedByChat = selectedChat?.usedByChat ?? false;
  return content
    ? {
        ...status,
        usedByChat,
        expected: summaryStorage.version(),
        stored: summaryStorage.inspect(),
        sources: summaryInspectionSources(),
        manualIds: summaryManualIds(),
        legacy: preservedLegacySummaryReview(),
        historical: summaryImportInspection(),
        rebuild: readRebuildInspection(),
        summary: summaryStorage.revision(),
        selectedChat,
        authority:
          "Untrusted user-derived continuity, never measurements, policy or save permission. Only the selected chat's privacy-valid frozen memory is included; use is reported from its latest completed answer, not a provider allowlist. Ordinary publication never replaces an admitted request snapshot; next turn adopts latest available valid memory.",
      }
    : {
        ...status,
        expected: summaryStorage.version(),
      };
}
export function summaryRebuildPending(): boolean {
  const live = liveConfigurationStatus();
  return (
    summaryRebuildStatus(`${live.boot ?? ""}:${live.generation}`)?.state ===
    "active"
  );
}
function readRebuildInspection(selection?: SummaryRebuildSelection) {
  const env = getOptionalEnv();
  const live = liveConfigurationStatus();
  const inventory = summaryRebuildInventory(
    `${live.boot ?? ""}:${live.generation}`,
    selection,
  );
  const boot = live.boot;
  let configured = false;
  try {
    configured = Boolean(summaryConfiguration(env));
  } catch {
    /* Exact saved selection stays unavailable. */
  }
  const capability = configured && Boolean(boot);
  return {
    ...inventory.preflight,
    snapshot: inventory.snapshot,
    ready: inventory.preflight.ready && capability,
    capability: capability
      ? "configured-not-probed"
      : "native-key-or-lifetime-unavailable",
    operation: summaryRebuildStatus(`${boot ?? ""}:${live.generation}`),
  };
}
// An explicit adoption request may wait, passive GET and answer completion never do.
export async function catchUpCrossChatSummary(): Promise<void> {
  const lifetime = summaryLifetime();
  const identity = liveConfigurationStatus().boot;
  if (!identity || lifetime.stopping) return;
  const end = performance.now() + SUMMARY_CATCHUP_MS;
  const authority = summaryStorage.version();
  for (let jobs = 0; jobs < 4 && performance.now() < end; jobs++) {
    if (lifetime.stopping) return;
    const status = summaryStorage.status(Date.now());
    if (
      !status.enabled ||
      !status.pending ||
      (status.reason &&
        !["summary_correction_pending", "summary_invalidated"].includes(
          status.reason,
        ))
    )
      return;
    const current = summaryStorage.version();
    if (
      current.privacy !== authority.privacy ||
      current.control !== authority.control ||
      current.manual !== authority.manual
    )
      return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const completed = await Promise.race([
      (lifetime.inFlight ?? tickCrossChatSummary(identity)).then(
        () => true,
        () => false,
      ),
      new Promise<false>((resolve) => {
        timer = setTimeout(
          () => resolve(false),
          Math.max(0, end - performance.now()),
        );
      }),
    ]);
    clearTimeout(timer);
    if (!completed) return; // Late global work cannot replace an adopted chat pin.
    const after = summaryStorage.status(Date.now());
    if (
      !after.enabled ||
      (after.reason &&
        !["summary_correction_pending", "summary_invalidated"].includes(
          after.reason,
        )) ||
      !after.pending
    )
      return;
    const remaining = end - performance.now();
    if (remaining < SUMMARY_DEBOUNCE_MS) return;
    await new Promise<void>((resolve) =>
      setTimeout(resolve, SUMMARY_DEBOUNCE_MS),
    );
  }
}

export async function prepareSummaryAdoption(
  command: SummaryCommand,
): Promise<SummaryCommand> {
  if (command.action !== "refresh") return command;
  assertSummaryRefreshIdle(command.conversationId);
  if (
    JSON.stringify(summaryStorage.version()) !==
    JSON.stringify(command.expected)
  )
    throw new Error("summary_stale_action");
  await catchUpCrossChatSummary();
  const expected = summaryStorage.version();
  if (
    expected.privacy !== command.expected.privacy ||
    expected.control !== command.expected.control ||
    expected.manual !== command.expected.manual
  )
    throw new Error("summary_stale_action");
  return { ...command, expected };
}

export function applySummaryCommand(command: SummaryCommand) {
  // Synchronous compare and mutation; no await can admit a stale client action.
  if (
    JSON.stringify(summaryStorage.version()) !==
    JSON.stringify(command.expected)
  )
    throw new Error("summary_stale_action");
  if (command.action === "rebuild-review") {
    return readRebuildInspection(command.selection);
  } else if (command.action === "refresh") {
    refreshConversationSummary(
      command.conversationId,
      command.expected,
      command.segmentRevision,
    );
  } else if (command.action === "edit") {
    summaryStorage.edit(command.expected, command.id, command.text, Date.now());
  } else if (command.action === "forget") {
    summaryStorage.forget(command.expected, command.id, Date.now());
  } else if (command.action === "rebuild-start") {
    const inspection = readRebuildInspection(command.selection);
    if (!inspection.ready) throw new Error("summary_rebuild_not_ready");
    startSummaryRebuild(
      command.id,
      command.snapshot,
      `${liveConfigurationStatus().boot!}:${liveConfigurationStatus().generation}`,
      Date.now(),
      command.selection,
    );
    notifySummaryActivity();
  } else if (command.action === "rebuild-cancel") {
    if (cancelSummaryRebuild(command.id)) summaryLifetime().active?.abort();
  } else if (command.action === "import-create") {
    createSummaryImport(command.sourceIds);
  } else if (
    command.action === "import-pause" ||
    command.action === "import-resume" ||
    command.action === "import-cancel"
  ) {
    const action =
      command.action === "import-pause"
        ? "pause"
        : command.action === "import-resume"
          ? "resume"
          : "cancel";
    if (controlSummaryImport(command.id, action))
      summaryLifetime().active?.abort();
  } else changeCrossChatSummary(command.action);
}
export function changeCrossChatSummary(
  action: "clear" | "disable" | "enable" | "retry",
) {
  summaryLifetime().active?.abort();
  summaryStorage.control(action, Date.now());
  if (action === "enable" || action === "retry") notifySummaryActivity();
  return readCrossChatSummary();
}
export async function tickCrossChatSummary(identity: string): Promise<void> {
  const live = liveConfigurationStatus();
  if (live.boot !== identity) throw new Error("summary_tick_denied");
  const lifetime = summaryLifetime();
  if (lifetime.stopping) return;
  if (lifetime.running) return;
  const env = getOptionalEnv();
  summaryStorage.configure(
    env.SUMMARY_ENABLED === "true",
    env.SUMMARY_MODEL === "unselected" ? "" : env.SUMMARY_MODEL,
    summaryCap(Number(env.SUMMARY_CHAR_LIMIT)),
  );
  reconcileSummaryRebuild(`${identity}:${live.generation}`, Date.now());
  const authority = summaryStorage.version();
  const expires = summaryStorage
    .inspect()
    .items.flatMap((item) =>
      item.expiresAt === null || item.expiresAt <= Date.now()
        ? []
        : [item.expiresAt],
    );
  lifetime.running = true;
  const abort = new AbortController();
  lifetime.active = abort;
  const deadline = setTimeout(() => abort.abort(), SUMMARY_DEADLINE_MS);
  const current = () =>
    !lifetime.stopping &&
    !abort.signal.aborted &&
    liveConfigurationStatus().generation === live.generation;
  const generationCurrent = () => {
    if (!current() || expires.some((expiry) => expiry <= Date.now()))
      return false;
    const latest = summaryStorage.version();
    return (
      latest.privacy === authority.privacy &&
      latest.control === authority.control &&
      latest.manual === authority.manual
    );
  };
  let generation = null;
  try {
    if (summaryConfiguration(env))
      generation = createSummaryGeneration(
        env,
        fetch,
        generationCurrent,
        "summary",
        Number(env.SUMMARY_CHAR_LIMIT),
      );
  } catch {
    /* The engine records unavailable configuration, never fallback. */
  }
  const engine = createSummaryEngine({
    storage: summaryStorage,
    generation,
    identity: randomUUID,
    now: Date.now,
    current: generationCurrent,
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
    lifetime.inFlight = engine.tick(abort.signal);
    await lifetime.inFlight;
  } finally {
    clearTimeout(deadline);
    lifetime.active = undefined;
    lifetime.inFlight = undefined;
    lifetime.running = false;
  }
}
