import type { SnowSplitEvidence, SnowSplit } from "./extra-types";

type Fields = Record<string, unknown>;
const MAX_SNOW_SPLITS = 2_000;

function metric(value: unknown, signed = false): number | null {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    (signed || value >= 0)
    ? value
    : null;
}
function instant(value: unknown): string | null {
  return value instanceof Date && Number.isFinite(value.getTime())
    ? value.toISOString()
    : null;
}
function position(lat: unknown, lon: unknown): [number | null, number | null] {
  return typeof lat === "number" &&
    Number.isFinite(lat) &&
    Math.abs(lat) <= 90 &&
    typeof lon === "number" &&
    Number.isFinite(lon) &&
    Math.abs(lon) <= 180
    ? [lat, lon]
    : [null, null];
}

/** Already-scaled parser values; no second unit/semicircle conversion. */
export function snowSplitEvidence(
  messages: Fields[],
  sessionCount: number,
): SnowSplitEvidence {
  const unavailable = (reason: string): SnowSplitEvidence => ({
    rows: [],
    status: "unavailable",
    reason,
  });
  if (messages.length > MAX_SNOW_SPLITS) return unavailable("split-limit");
  if (!messages.length)
    return { rows: [], status: "empty", reason: "no-split-messages" };
  // Message 312 has no session/lap reference. Never combine colliding sessions.
  if (sessionCount !== 1) return unavailable("ambiguous-sessions");
  const seen = new Set<number>();
  const rows: SnowSplit[] = [];
  for (const [sourceOrder, message] of messages.entries()) {
    const splitType =
      message.split_type === "ski_run_split"
        ? "run"
        : message.split_type === "ski_lift_split"
          ? "lift"
          : null;
    if (!splitType) return unavailable("unsupported-split-type");
    const raw = message.message_index;
    const index =
      typeof raw === "number"
        ? raw
        : raw && typeof raw === "object"
          ? (raw as Fields).value
          : undefined;
    if (
      typeof index !== "number" ||
      !Number.isInteger(index) ||
      index < 0 ||
      index > 4095 ||
      seen.has(index)
    )
      return unavailable("ambiguous-split-index");
    seen.add(index);
    const startTime = instant(message.start_time);
    const endTime = instant(message.end_time);
    if (startTime && endTime && endTime < startTime)
      return unavailable("invalid-split-interval");
    const [startLat, startLon] = position(
      message.start_position_lat,
      message.start_position_long,
    );
    const [endLat, endLon] = position(
      message.end_position_lat,
      message.end_position_long,
    );
    rows.push({
      splitKey: `index:${index}`,
      messageIndex: index,
      sourceOrder,
      splitType,
      startTime,
      endTime,
      elapsedSeconds: metric(message.total_elapsed_time),
      timerSeconds: metric(message.total_timer_time),
      movingSeconds: metric(message.total_moving_time),
      distanceMeters: metric(message.total_distance),
      avgSpeedMps: metric(message.avg_speed),
      maxSpeedMps: metric(message.max_speed),
      avgVerticalSpeedMps: metric(message.avg_vert_speed, true),
      ascentMeters: metric(message.total_ascent),
      descentMeters: metric(message.total_descent),
      startElevationMeters: metric(message.start_elevation, true),
      startLat,
      startLon,
      endLat,
      endLon,
    });
  }
  return { rows, status: "populated", reason: null };
}
