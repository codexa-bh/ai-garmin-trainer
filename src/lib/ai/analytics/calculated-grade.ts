// Mechanical evidence, not a steepness classification or dashboard calculation.
const GRADE_METHOD = "altitude_distance_sections_v1";
const GRADE_TARGET_SECONDS = 180;
export const GRADE_MAX_POINTS = 100_000;
export const GRADE_MAX_ACTIVITIES = 32;

export type GradeSample = {
  timestamp: string | null;
  altitude_meters: number | null;
  distance_meters: number | null;
  grade_pct: number | null;
};

type TimedSample = GradeSample & {
  seconds: number | null;
  absoluteTime: boolean;
};

export type CalculatedGradeSection = {
  window_index: number;
  start_elapsed_sec: number | null;
  end_elapsed_sec: number | null;
  calculated_grade_pct: number | null;
  grade_method: string;
  target_window_sec: number;
  support_seconds: number | null;
  support_distance_meters: number | null;
  sample_count: number;
  usable_sample_count: number;
  source_grade_sample_count: number;
  quality_status: string;
};

function finite(value: number | null): value is number {
  return value !== null && Number.isFinite(value);
}

function timestampSeconds(timestamp: string | null): number | null {
  // Garmin also stores timezone-less calendar timestamps. Parse them as relative
  // clock coordinates, never using the host timezone or asserting an absolute UTC time.
  if (
    !timestamp ||
    !/^\d{4}-\d\d-\d\d[ T]\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)?$/i.test(
      timestamp,
    )
  )
    return null;
  const normalized = timestamp.replace(" ", "T");
  const calendar = normalized.replace(/(?:Z|[+-]\d\d:\d\d)$/i, "");
  const calendarMillis = Date.parse(`${calendar}Z`);
  if (
    !Number.isFinite(calendarMillis) ||
    new Date(calendarMillis).toISOString().slice(0, 19) !==
      calendar.slice(0, 19)
  )
    return null;
  const seconds =
    Date.parse(hasAbsoluteTime(timestamp) ? normalized : `${normalized}Z`) /
    1000;
  return Number.isFinite(seconds) ? seconds : null;
}

function hasAbsoluteTime(timestamp: string | null): boolean {
  return timestamp !== null && /(?:Z|[+-]\d\d:\d\d)$/i.test(timestamp);
}

function usable(point: TimedSample): boolean {
  return (
    finite(point.seconds) &&
    finite(point.altitude_meters) &&
    finite(point.distance_meters) &&
    point.distance_meters >= 0
  );
}

function continuityStatus(points: readonly TimedSample[]): string | null {
  for (let i = 1; i < points.length; i += 1) {
    const previous = points[i - 1];
    const current = points[i];
    // Missing values are handled before this pairwise check.
    if (current.absoluteTime !== previous.absoluteTime) return "invalid_timing";
    const gap = current.seconds! - previous.seconds!;
    if (gap <= 0) return "invalid_timing";
    if (gap > 30) return "sampling_gap";
    if (current.distance_meters! < previous.distance_meters!)
      return "distance_reset";
  }
  return null;
}

function section(
  points: readonly TimedSample[],
  index: number,
  origin: number | null,
  forcedStatus?: string,
): CalculatedGradeSection {
  const first = points[0];
  const last = points.at(-1);
  const elapsed = (point: TimedSample | undefined) =>
    finite(origin) && point && finite(point.seconds)
      ? point.seconds - origin
      : null;
  const duration =
    first && last && finite(first.seconds) && finite(last.seconds)
      ? last.seconds - first.seconds
      : null;
  const distance =
    first &&
    last &&
    finite(first.distance_meters) &&
    finite(last.distance_meters)
      ? last.distance_meters - first.distance_meters
      : null;
  const usableCount = points.filter(usable).length;
  let status = forcedStatus ?? (points.length === 0 ? "no_stream" : null);
  if (!status && points.some((point) => !finite(point.seconds)))
    status = "invalid_timing";
  if (!status && usableCount !== points.length) status = "missing_values";
  if (!status) status = continuityStatus(points);
  if (!status && (points.length < 3 || duration === null || duration < 60))
    status = "insufficient_time";
  if (!status && (distance === null || distance < 10))
    status = "insufficient_distance";
  const grade = !status
    ? (100 * (last!.altitude_meters! - first!.altitude_meters!)) / distance!
    : null;
  if (grade !== null && !Number.isFinite(grade)) status = "nonfinite_result";
  return {
    window_index: index,
    start_elapsed_sec: elapsed(first),
    end_elapsed_sec: elapsed(last),
    calculated_grade_pct: status ? null : grade,
    grade_method: GRADE_METHOD,
    target_window_sec: GRADE_TARGET_SECONDS,
    support_seconds: finite(duration) && duration >= 0 ? duration : null,
    support_distance_meters:
      finite(distance) && distance >= 0 ? distance : null,
    sample_count: points.length,
    usable_sample_count: usableCount,
    source_grade_sample_count: points.filter((point) => finite(point.grade_pct))
      .length,
    quality_status: status ?? "available",
  };
}

// Input is in stored elapsed order. Never sort timestamps to hide bad ordering.
// Sections share an endpoint; count valid sections / all sections for coverage,
// not summed samples (which are not a unique-stream coverage denominator).
export function calculateGradeSections(
  samples: readonly GradeSample[],
): CalculatedGradeSection[] {
  const points = samples.map((point) => ({
    ...point,
    seconds: timestampSeconds(point.timestamp),
    absoluteTime: hasAbsoluteTime(point.timestamp),
  }));
  const origin = points.find((point) => finite(point.seconds))?.seconds ?? null;
  if (points.length > GRADE_MAX_POINTS)
    return [section(points, 0, origin, "input_limit")];
  if (points.length < 2) return [section(points, 0, origin)];
  const sections: CalculatedGradeSection[] = [];
  let start = 0;
  for (let i = 1; i < points.length; i += 1) {
    const anchor = points[start].seconds;
    const end = points[i].seconds;
    if (
      finite(end) &&
      (!finite(anchor) || end - anchor >= GRADE_TARGET_SECONDS)
    ) {
      sections.push(
        section(points.slice(start, i + 1), sections.length, origin),
      );
      start = i;
    }
  }
  if (start < points.length - 1)
    sections.push(section(points.slice(start), sections.length, origin));
  return sections;
}
