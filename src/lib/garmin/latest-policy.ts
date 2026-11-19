import { shiftDate } from "./history-policy";
import type { DayCoverage } from "./coverage-policy";
import type { PrimaryUpload } from "./primary-upload";

export const FRESHNESS_CHECKPOINT = "garmin_latest_freshness_v1";
type HealthDownload =
  | { final: true; source: "legacy" }
  | {
      /** Official reader: final only after a validated whole-local-day read. */
      final: boolean;
      source: "coverage";
      downloadedAt: string;
      coverage: DayCoverage["kind"];
      /** Closed reason when the read did not prove whole-day coverage. */
      reason?: string;
    }
  | {
      final: boolean;
      source: "download";
      downloadedAt: string;
      dayEndedAt: string;
      primaryId: string | null;
      uploadedAt: string | null;
      /** Latest possible upload when the source had whole-second precision. */
      uploadedThrough?: string;
    };
export type LatestFreshness = {
  version: 1;
  startDate: string;
  days: Record<string, HealthDownload>;
  profileDay: string | null;
  ftpDay: string | null;
  fitActivity: string | null;
  /** Set once by the coverage-based reader's first run; absent for MCP state. */
  coverageTransition?: { version: 1; at: string; recheckedFrom: string };
};

/** Only latest health/cadence uses the desktop's local calendar. */
export function localDate(date: Date): string {
  return `${date.getFullYear().toString().padStart(4, "0")}-${(date.getMonth() + 1).toString().padStart(2, "0")}-${date.getDate().toString().padStart(2, "0")}`;
}
function validDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
  );
}
function instant(value: unknown): value is string {
  return (
    typeof value === "string" &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}
function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

/** Absence initializes once; unsupported/corrupt bytes are never rewritten. */
export function latestFreshness(
  raw: string | null,
  storedDates: string[],
  today: string,
  floor: string | null,
): LatestFreshness {
  if (raw !== null) {
    const state: unknown = JSON.parse(raw);
    if (
      !record(state) ||
      state.version !== 1 ||
      !validDate(state.startDate) ||
      !record(state.days) ||
      ![state.profileDay, state.ftpDay].every(
        (day) => day === null || validDate(day),
      ) ||
      !(
        state.fitActivity === null ||
        (typeof state.fitActivity === "string" && state.fitActivity.length > 0)
      ) ||
      !(
        state.coverageTransition === undefined ||
        (record(state.coverageTransition) &&
          state.coverageTransition.version === 1 &&
          instant(state.coverageTransition.at) &&
          validDate(state.coverageTransition.recheckedFrom))
      )
    )
      throw new Error("Unsupported latest freshness; saved state preserved.");
    for (const [date, day] of Object.entries(state.days)) {
      if (
        !validDate(date) ||
        !record(day) ||
        typeof day.final !== "boolean" ||
        !(
          (day.source === "legacy" && day.final === true) ||
          (day.source === "coverage" &&
            instant(day.downloadedAt) &&
            ["full", "partial", "unknown"].includes(day.coverage as string) &&
            day.final === (day.coverage === "full") &&
            (day.reason === undefined ||
              (typeof day.reason === "string" && day.reason.length <= 64))) ||
          (day.source === "download" &&
            instant(day.downloadedAt) &&
            instant(day.dayEndedAt) &&
            (day.primaryId === null || typeof day.primaryId === "string") &&
            (day.uploadedAt === null || instant(day.uploadedAt)) &&
            (day.uploadedThrough === undefined ||
              (instant(day.uploadedThrough) &&
                day.uploadedAt !== null &&
                Date.parse(day.uploadedAt) <=
                  Date.parse(day.uploadedThrough))) &&
            (!day.final ||
              (day.primaryId !== null &&
                day.uploadedAt !== null &&
                Date.parse(day.dayEndedAt) < Date.parse(day.uploadedAt) &&
                Date.parse(
                  (day.uploadedThrough as string | undefined) ?? day.uploadedAt,
                ) < Date.parse(day.downloadedAt))))
        )
      )
        throw new Error(
          "Invalid latest health evidence; saved state preserved.",
        );
    }
    return state as LatestFreshness;
  }
  const start = shiftDate(today, -13);
  return {
    version: 1,
    startDate: floor && floor > start ? floor : start,
    days: Object.fromEntries(
      storedDates
        .filter((date) => date < start)
        .map((date) => [date, { final: true, source: "legacy" }]),
    ),
    profileDay: null,
    ftpDay: null,
    fitActivity: null,
  };
}

/** Complete selection, without the old trailing/query cap. Oldest mutable work
 * follows today's foreground read, so a bounded interruption cannot starve it. */
export function latestHealthDates(
  state: LatestFreshness,
  storedDates: string[],
  today: string,
  floor: string | null,
): string[] {
  const stored = new Set(storedDates);
  const dates = new Set(
    [...storedDates, ...Object.keys(state.days)].filter(
      (date) => !state.days[date]?.final || !stored.has(date),
    ),
  );
  for (let date = state.startDate; date <= today; date = shiftDate(date, 1))
    if (!state.days[date]?.final || !stored.has(date)) dates.add(date);
  dates.add(today);
  return [...dates]
    .filter((date) => date <= today && (!floor || date >= floor))
    .sort();
}

/** Called only after a successful normalized write. A newly observed upload
 * cannot finalize an older download. Calendar construction handles DST. An
 * imprecise upload is an interval: its earliest instant must follow day end
 * and its latest instant must precede the download; uncertainty fails closed. */
export function downloadedHealth(
  date: string,
  upload: PrimaryUpload,
  downloadedAt: Date,
): HealthDownload {
  const [year, month, day] = date.split("-").map(Number);
  const end = new Date(year, month - 1, day + 1).getTime();
  const known = upload.kind === "known";
  const earliest = known ? Date.parse(upload.uploadedAt) : NaN;
  const latest = known
    ? Date.parse(upload.uploadedThrough ?? upload.uploadedAt)
    : NaN;
  return {
    source: "download",
    final:
      known &&
      date < localDate(downloadedAt) &&
      earliest > end &&
      latest >= earliest &&
      downloadedAt.getTime() > latest,
    downloadedAt: downloadedAt.toISOString(),
    dayEndedAt: new Date(end).toISOString(),
    primaryId: known ? upload.primaryId : null,
    uploadedAt: known ? upload.uploadedAt : null,
    ...(known && upload.uploadedThrough
      ? { uploadedThrough: upload.uploadedThrough }
      : {}),
  };
}

/** Coverage evidence for a successfully normalized read. Never proves an upload;
 * today and any day the source did not prove whole stay retryable. */
export function coveredHealth(
  date: string,
  coverage: DayCoverage,
  today: string,
  downloadedAt: Date,
): HealthDownload {
  const full = coverage.kind === "full" && date < today;
  return {
    source: "coverage",
    final: full,
    downloadedAt: downloadedAt.toISOString(),
    coverage: full
      ? "full"
      : coverage.kind === "full"
        ? "partial"
        : coverage.kind,
    ...(full
      ? {}
      : {
          reason:
            coverage.kind === "full"
              ? "day-not-ended"
              : coverage.reason.slice(0, 64),
        }),
  };
}

/**
 * First official run over MCP-era state: the recent 14 local dates lose any
 * upload-based finality so they are rechecked, older upload-based finals stay as
 * explicit legacy evidence, and non-final days remain non-final. A pure,
 * idempotent function of saved state, so an interrupted transition replays; the
 * caller persists the result before reading. Corrupt state never reaches here.
 */
export function transitionToCoverage(
  state: LatestFreshness,
  today: string,
  now: Date,
): LatestFreshness {
  if (state.coverageTransition) return state;
  const recentStart = shiftDate(today, -13);
  const days: LatestFreshness["days"] = {};
  for (const [date, day] of Object.entries(state.days)) {
    if (day.final && day.source === "download") {
      if (date >= recentStart) continue;
      days[date] = { final: true, source: "legacy" };
    } else days[date] = day;
  }
  return {
    ...state,
    startDate: state.startDate < recentStart ? state.startDate : recentStart,
    days,
    coverageTransition: {
      version: 1,
      at: now.toISOString(),
      recheckedFrom: recentStart,
    },
  };
}
