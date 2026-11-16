import { shiftDate } from "./history-policy";
import type { PrimaryUpload } from "./primary-upload";

export const FRESHNESS_CHECKPOINT = "garmin_latest_freshness_v1";
type HealthDownload =
  | { final: true; source: "legacy" }
  | {
      final: boolean;
      source: "download";
      downloadedAt: string;
      dayEndedAt: string;
      primaryId: string | null;
      uploadedAt: string | null;
    };
export type LatestFreshness = {
  version: 1;
  startDate: string;
  days: Record<string, HealthDownload>;
  profileDay: string | null;
  ftpDay: string | null;
  fitActivity: string | null;
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
          (day.source === "download" &&
            instant(day.downloadedAt) &&
            instant(day.dayEndedAt) &&
            (day.primaryId === null || typeof day.primaryId === "string") &&
            (day.uploadedAt === null || instant(day.uploadedAt)) &&
            (!day.final ||
              (day.primaryId !== null &&
                day.uploadedAt !== null &&
                Date.parse(day.dayEndedAt) < Date.parse(day.uploadedAt) &&
                Date.parse(day.uploadedAt) < Date.parse(day.downloadedAt))))
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
 * cannot finalize an older download. Calendar construction handles DST. */
export function downloadedHealth(
  date: string,
  upload: PrimaryUpload,
  downloadedAt: Date,
): HealthDownload {
  const [year, month, day] = date.split("-").map(Number);
  const end = new Date(year, month - 1, day + 1).getTime();
  const known = upload.kind === "known";
  const uploaded = known ? Date.parse(upload.uploadedAt) : NaN;
  return {
    source: "download",
    final:
      known &&
      date < localDate(downloadedAt) &&
      uploaded > end &&
      downloadedAt.getTime() > uploaded,
    downloadedAt: downloadedAt.toISOString(),
    dayEndedAt: new Date(end).toISOString(),
    primaryId: known ? upload.primaryId : null,
    uploadedAt: known ? upload.uploadedAt : null,
  };
}
