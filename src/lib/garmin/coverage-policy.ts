/**
 * Official daily-health coverage evidence: pure judgement of whether a source
 * read covered an entire local day. This is coverage evidence, never proof of a
 * watch upload; unknown or ambiguous interpretation is never guessed as full.
 */

/** Wire-neutral chronology a reader extracted from one validated daily summary. */
export type DayCoverageEvidence =
  | {
      kind: "chronology";
      startGmt: string;
      endGmt: string;
      startLocal: string;
      endLocal: string;
      durationMs: number;
    }
  | { kind: "none"; reason: "empty" | "not-returned" | "malformed" };

export type DayCoverage =
  | { kind: "full"; endedAt: string; durationMs: number }
  | { kind: "partial" | "unknown"; reason: string };

const DAY_MS = 86_400_000;
const QUARTER_HOUR_MS = 900_000;
const WALL_CLOCK =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?Z?$/;

/** Wall-clock text as epoch milliseconds of the same digits read as UTC. */
function wallClockMs(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = WALL_CLOCK.exec(value);
  if (!match) return null;
  const [year, month, day, hour, minute, second] = match
    .slice(1, 7)
    .map(Number);
  const millis = Number((match[7] ?? "0").slice(0, 3).padEnd(3, "0"));
  const parsed = Date.UTC(year, month - 1, day, hour, minute, second, millis);
  const check = new Date(parsed);
  return check.getUTCFullYear() === year &&
    check.getUTCMonth() === month - 1 &&
    check.getUTCDate() === day &&
    check.getUTCHours() === hour
    ? parsed
    : null;
}

/**
 * `date` is the requested calendar day. Local timestamps give the day boundaries
 * in the account's own clock; GMT timestamps give the real instants, so a
 * 23- or 25-hour DST day is validated from the offset difference rather than by
 * trusting an 86,400,000 ms duration.
 */
export function dayCoverage(
  date: string,
  evidence: DayCoverageEvidence,
  observedAt: Date,
): DayCoverage {
  if (evidence.kind === "none")
    return {
      kind: evidence.reason === "malformed" ? "unknown" : "partial",
      reason: evidence.reason,
    };
  const startLocal = wallClockMs(evidence.startLocal);
  const endLocal = wallClockMs(evidence.endLocal);
  const startGmt = wallClockMs(evidence.startGmt);
  const endGmt = wallClockMs(evidence.endGmt);
  if (
    startLocal === null ||
    endLocal === null ||
    startGmt === null ||
    endGmt === null ||
    !Number.isSafeInteger(evidence.durationMs) ||
    evidence.durationMs <= 0
  )
    return { kind: "unknown", reason: "malformed-chronology" };
  const midnight = wallClockMs(`${date}T00:00:00.0`);
  if (
    midnight === null ||
    Math.floor(startLocal / DAY_MS) * DAY_MS !== midnight
  )
    return { kind: "unknown", reason: "day-identity-mismatch" };
  if (endGmt <= startGmt || endLocal <= startLocal)
    return { kind: "unknown", reason: "inconsistent-chronology" };
  if (endGmt - startGmt !== evidence.durationMs)
    return { kind: "unknown", reason: "duration-mismatch" };
  const startOffset = startLocal - startGmt;
  const endOffset = endLocal - endGmt;
  if (
    [startOffset, endOffset].some(
      (offset) =>
        offset % QUARTER_HOUR_MS !== 0 || Math.abs(offset) > 14 * 3_600_000,
    ) ||
    Math.abs(startOffset - endOffset) > 3_600_000
  )
    return { kind: "unknown", reason: "offset-mismatch" };
  if (endLocal > midnight + DAY_MS)
    return { kind: "unknown", reason: "extends-past-day" };
  if (startLocal > midnight) return { kind: "partial", reason: "late-start" };
  if (endLocal < midnight + DAY_MS)
    return { kind: "partial", reason: "ends-before-midnight" };
  if (endGmt > observedAt.getTime())
    return { kind: "partial", reason: "day-not-ended" };
  return {
    kind: "full",
    endedAt: new Date(endGmt).toISOString(),
    durationMs: evidence.durationMs,
  };
}
