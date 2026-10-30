/** Mechanical elevation-profile evidence, never a terrain/difficulty judgment. */
export const TERRAIN_PARAMETERS = {
  maxPoints: 100000,
  maxRows: 100,
  anchorMeters: 25,
  gradeWindowMeters: 100,
  rollingWindowMeters: 300,
  minimumSectionMeters: 300,
  transitionVerticalMeters: 6,
  rollingVerticalMeters: 10,
  boundarySearchMeters: 100,
  maxDistanceGapMeters: 100,
  maxTimeGapSec: 30,
  maxRecordedDistanceMeters: 1000000000,
  maxAbsoluteAltitudeMeters: 100000,
  maxStoredElapsed: 1000000000,
  enterGradePct: 3,
  stayGradePct: 2,
  steepGradePct: 10,
  stationarySpeedMps: 0.3,
  stationaryMinimumSec: 30,
} as const;

export type TerrainPoint = Readonly<{
  timestamp: string | null;
  elapsedSec: number;
  distanceMeters: number | null;
  altitudeMeters: number | null;
  heartRate: number | null;
}>;
export type TerrainSection = {
  id: string;
  kind: "climb" | "descent" | "flat" | "rolling";
  startDistanceMeters: number;
  endDistanceMeters: number;
  startTimeSec: number | null;
  endTimeSec: number | null;
  startStoredElapsedSec: number;
  endStoredElapsedSec: number;
  distanceMeters: number;
  ascentMeters: number;
  descentMeters: number;
  meanGradePct: number;
  steepUpMeters: number;
  steepDownMeters: number;
  elapsedSec: number | null;
  estimatedMovingSec: number | null;
  estimatedStationarySec: number | null;
  timeSupportSec: number;
  timeCoverage: number;
  hrSupportSec: number;
  averageHeartRate: number | null;
  elapsedPaceSecPerKm: number | null;
  quality: string;
};
export type TerrainAnalysis = {
  activityId: string;
  status: "available" | "partial" | "unavailable";
  reason: string | null;
  method: "terrain-v2";
  parameters: typeof TERRAIN_PARAMETERS;
  inputPoints: number;
  usableEdges: number;
  totalEdges: number;
  supportedDistanceMeters: number;
  recordedDistanceSpanMeters: number | null;
  recordedPositiveDistanceMeters: number;
  ascentMeters: number;
  descentMeters: number;
  timeSupportSec: number;
  sectionCount: number;
  returnedSections: number;
  truncated: boolean;
  quality: string[];
  sections: TerrainSection[];
};

type Sample = {
  d: number;
  z: number;
  t: number | null;
  elapsed: number;
  hr: number | null;
};
type Edge = { a: Sample; b: Sample; dt: number | null; stationary: boolean };
type Anchor = { d: number; z: number; t: number | null; elapsed: number };
type Run = { samples: Sample[]; edges: Edge[] };
const finite = (n: number | null): n is number =>
  n !== null && Number.isFinite(n);
const validHr = (n: number | null) =>
  finite(n) && n > 0 && n <= 300 ? n : null;
const validDistance = (n: number | null): n is number =>
  finite(n) && n >= 0 && n <= TERRAIN_PARAMETERS.maxRecordedDistanceMeters;

function clock(value: string | null): { ms: number; mode: string } | null {
  if (
    !value ||
    !/^\d{4}-\d\d-\d\d[T ]\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)?$/.test(
      value,
    )
  )
    return null;
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  const calendar = new Date(Date.UTC(year, month - 1, day));
  if (
    calendar.getUTCFullYear() !== year ||
    calendar.getUTCMonth() !== month - 1 ||
    calendar.getUTCDate() !== day
  )
    return null;
  const relative = !/(Z|[+-]\d\d:\d\d)$/.test(value);
  const normalized = value.replace(" ", "T");
  const ms = Date.parse(relative ? `${normalized}Z` : normalized);
  return Number.isFinite(ms)
    ? { ms, mode: relative ? "relative" : "absolute" }
    : null;
}
function interpolate(a: Sample, b: Sample, d: number): Anchor {
  const f = b.d === a.d ? 0 : (d - a.d) / (b.d - a.d);
  return {
    d,
    z: a.z + f * (b.z - a.z),
    t: a.t !== null && b.t !== null ? a.t + f * (b.t - a.t) : null,
    elapsed: a.elapsed + f * (b.elapsed - a.elapsed),
  };
}
function anchorsFor(run: Run): Anchor[] {
  const samples = run.samples.map((sample, i) => {
    const before = run.samples[i - 1],
      after = run.samples[i + 1];
    // Reject an isolated >10m excursion bracketed by agreeing (<2m) neighbors.
    return before &&
      after &&
      Math.abs(before.z - after.z) < 2 &&
      Math.abs(sample.z - before.z) > 10 &&
      Math.abs(sample.z - after.z) > 10
      ? { ...sample, z: (before.z + after.z) / 2 }
      : sample;
  });
  const first = samples[0],
    last = samples.at(-1)!;
  const anchors: Anchor[] = [{ ...first }];
  let index = 1;
  for (
    let d = first.d + TERRAIN_PARAMETERS.anchorMeters;
    d < last.d;
    d += TERRAIN_PARAMETERS.anchorMeters
  ) {
    while (index < samples.length - 1 && samples[index].d < d) index++;
    anchors.push(interpolate(samples[index - 1], samples[index], d));
  }
  anchors.push({ ...last });
  return anchors.map((a, i) => ({
    ...a,
    z:
      i === 0 || i === anchors.length - 1
        ? a.z
        : (anchors[i - 1].z + 2 * a.z + anchors[i + 1].z) / 4,
  }));
}
function stationaryEdges(edges: Edge[]) {
  let start = 0;
  while (start < edges.length) {
    const eligible = (e: Edge) =>
      e.dt !== null &&
      (e.b.d - e.a.d) / e.dt <= TERRAIN_PARAMETERS.stationarySpeedMps;
    if (!eligible(edges[start])) {
      start++;
      continue;
    }
    let end = start,
      seconds = 0;
    while (end < edges.length && eligible(edges[end])) {
      seconds += edges[end].dt!;
      end++;
    }
    if (seconds >= TERRAIN_PARAMETERS.stationaryMinimumSec)
      for (let i = start; i < end; i++) edges[i].stationary = true;
    start = end;
  }
}
function kindFor(
  distance: number,
  up: number,
  down: number,
  range: number,
  previous?: TerrainSection["kind"],
  allowRolling = true,
): TerrainSection["kind"] {
  const grade = (100 * (up - down)) / distance;
  if (
    allowRolling &&
    up >= TERRAIN_PARAMETERS.rollingVerticalMeters &&
    down >= TERRAIN_PARAMETERS.rollingVerticalMeters &&
    range >= TERRAIN_PARAMETERS.rollingVerticalMeters &&
    Math.abs(up - down) / (up + down) < 0.6
  )
    return "rolling";
  if (
    grade >= TERRAIN_PARAMETERS.enterGradePct ||
    (previous === "climb" && grade >= TERRAIN_PARAMETERS.stayGradePct)
  )
    return "climb";
  if (
    grade <= -TERRAIN_PARAMETERS.enterGradePct ||
    (previous === "descent" && grade <= -TERRAIN_PARAMETERS.stayGradePct)
  )
    return "descent";
  return "flat";
}
// Windows slide at every anchor; they are evidence for a change, never output tiles.
function trendAt(
  anchors: Anchor[],
  index: number,
  previous?: TerrainSection["kind"],
): TerrainSection["kind"] {
  const half = TERRAIN_PARAMETERS.rollingWindowMeters / 2;
  let left = index,
    right = index;
  while (left > 0 && anchors[index].d - anchors[left - 1].d <= half) left--;
  while (
    right < anchors.length - 1 &&
    anchors[right + 1].d - anchors[index].d <= half
  )
    right++;
  let up = 0,
    down = 0,
    min = anchors[left].z,
    max = min;
  for (let i = left + 1; i <= right; i++) {
    const dz = anchors[i].z - anchors[i - 1].z;
    up += Math.max(0, dz);
    down += Math.max(0, -dz);
    min = Math.min(min, anchors[i].z);
    max = Math.max(max, anchors[i].z);
  }
  if (
    kindFor(anchors[right].d - anchors[left].d, up, down, max - min) ===
    "rolling"
  )
    return "rolling";
  const gradeHalf = TERRAIN_PARAMETERS.gradeWindowMeters / 2;
  left = index;
  right = index;
  while (left > 0 && anchors[index].d - anchors[left - 1].d <= gradeHalf)
    left--;
  while (
    right < anchors.length - 1 &&
    anchors[right + 1].d - anchors[index].d <= gradeHalf
  )
    right++;
  const dz = anchors[right].z - anchors[left].z;
  return kindFor(
    anchors[right].d - anchors[left].d,
    Math.max(0, dz),
    Math.max(0, -dz),
    Math.abs(dz),
    previous,
  );
}

function transitionBoundary(
  anchors: Anchor[],
  pending: number,
  start: number,
  from: TerrainSection["kind"],
  to: TerrainSection["kind"],
): number {
  let left = pending,
    right = pending;
  const radius = TERRAIN_PARAMETERS.boundarySearchMeters;
  while (left > start && anchors[pending].d - anchors[left - 1].d <= radius)
    left--;
  while (
    right < anchors.length - 1 &&
    anchors[right + 1].d - anchors[pending].d <= radius
  )
    right++;
  const maximum = from === "climb" || to === "descent";
  const lastTie = to !== "flat";
  let best = left;
  for (let i = left + 1; i <= right; i++) {
    const delta = anchors[i].z - anchors[best].z;
    if ((maximum ? delta > 0 : delta < 0) || (lastTie && delta === 0)) best = i;
  }
  return best;
}

type TrendBoundary = { index: number; trend: TerrainSection["kind"] };
function trendBoundaries(anchors: Anchor[]): TrendBoundary[] {
  let trend = trendAt(anchors, 0);
  const boundaries: TrendBoundary[] = [{ index: 0, trend }];
  let pendingKind: TerrainSection["kind"] | null = null;
  let pendingIndex = 0;
  for (let i = 1; i < anchors.length; i++) {
    const next = trendAt(anchors, i, trend);
    if (next === trend) {
      pendingKind = null;
      continue;
    }
    if (pendingKind !== next) {
      pendingKind = next;
      pendingIndex = i;
    }
    if (
      anchors[i].d - anchors[pendingIndex].d <
      TERRAIN_PARAMETERS.minimumSectionMeters
    )
      continue;
    const start = boundaries.at(-1)!.index;
    const boundary = transitionBoundary(
      anchors,
      pendingIndex,
      start,
      trend,
      next,
    );
    if (
      anchors[i].d - anchors[boundary].d <
      TERRAIN_PARAMETERS.minimumSectionMeters
    )
      continue;
    const change = anchors[i].z - anchors[boundary].z;
    if (
      (next === "climb" &&
        change < TERRAIN_PARAMETERS.transitionVerticalMeters) ||
      (next === "descent" &&
        -change < TERRAIN_PARAMETERS.transitionVerticalMeters)
    )
      continue;
    if (
      anchors[boundary].d - anchors[start].d >=
      TERRAIN_PARAMETERS.minimumSectionMeters
    )
      boundaries.push({ index: boundary, trend: next });
    else boundaries.at(-1)!.trend = next;
    // A short initial/transient piece is absorbed, never emitted or padded.
    trend = next;
    pendingKind = null;
  }
  const end = anchors.length - 1;
  if (
    boundaries.length > 1 &&
    anchors[end].d - anchors[boundaries.at(-1)!.index].d <
      TERRAIN_PARAMETERS.minimumSectionMeters
  )
    boundaries.pop();
  boundaries.push({ index: end, trend });
  return boundaries;
}

function geometrySections(run: Run): TerrainSection[] {
  const anchors = anchorsFor(run),
    sections: TerrainSection[] = [];
  const boundaries = trendBoundaries(anchors);
  for (let part = 1; part < boundaries.length; part++) {
    const confirmedTrend = boundaries[part - 1].trend;
    const start = boundaries[part - 1].index,
      end = boundaries[part].index;
    let up = 0,
      down = 0,
      steepUp = 0,
      steepDown = 0,
      min = anchors[start].z,
      max = min;
    for (let i = start + 1; i <= end; i++) {
      const dz = anchors[i].z - anchors[i - 1].z,
        dd = anchors[i].d - anchors[i - 1].d;
      up += Math.max(0, dz);
      down += Math.max(0, -dz);
      min = Math.min(min, anchors[i].z);
      max = Math.max(max, anchors[i].z);
      if ((100 * dz) / dd >= TERRAIN_PARAMETERS.steepGradePct - 1e-9)
        steepUp += dd;
      if ((100 * dz) / dd <= -TERRAIN_PARAMETERS.steepGradePct + 1e-9)
        steepDown += dd;
    }
    const a = anchors[start],
      b = anchors[end],
      distance = b.d - a.d,
      previous = sections.at(-1);
    // Integrated gain/loss alone cannot turn one absorbed short hill into
    // a rolling section: rolling must also be the sustained detected trend.
    const kind = kindFor(
      distance,
      up,
      down,
      max - min,
      confirmedTrend,
      confirmedTrend === "rolling",
    );
    if (previous?.kind === kind) {
      previous.endDistanceMeters = b.d;
      previous.endTimeSec = b.t;
      previous.endStoredElapsedSec = b.elapsed;
      previous.distanceMeters += distance;
      previous.ascentMeters += up;
      previous.descentMeters += down;
      previous.steepUpMeters += steepUp;
      previous.steepDownMeters += steepDown;
      previous.meanGradePct =
        (100 * (previous.ascentMeters - previous.descentMeters)) /
        previous.distanceMeters;
    } else
      sections.push({
        id: "",
        kind,
        startDistanceMeters: a.d,
        endDistanceMeters: b.d,
        startTimeSec: a.t,
        endTimeSec: b.t,
        startStoredElapsedSec: a.elapsed,
        endStoredElapsedSec: b.elapsed,
        distanceMeters: distance,
        ascentMeters: up,
        descentMeters: down,
        meanGradePct: (100 * (up - down)) / distance,
        steepUpMeters: steepUp,
        steepDownMeters: steepDown,
        elapsedSec: null,
        estimatedMovingSec: null,
        estimatedStationarySec: null,
        timeSupportSec: 0,
        timeCoverage: 0,
        hrSupportSec: 0,
        averageHeartRate: null,
        elapsedPaceSecPerKm: null,
        quality: "estimated_elevation_profile",
      });
  }
  return sections;
}
function addTimeMetrics(sections: TerrainSection[], edges: Edge[]) {
  let cursor = 0;
  const sums = sections.map(() => ({
    expected: 0,
    supported: 0,
    seconds: 0,
    stationary: 0,
    hrSeconds: 0,
    hrIntegral: 0,
  }));
  for (const edge of edges) {
    while (
      cursor < sections.length - 1 &&
      edge.a.d >= sections[cursor].endDistanceMeters
    )
      cursor++;
    const dd = edge.b.d - edge.a.d;
    for (let i = cursor; i < sections.length; i++) {
      const section = sections[i];
      if (dd === 0 && i > cursor) break;
      if (dd > 0 && section.startDistanceMeters >= edge.b.d) break;
      const left = Math.max(edge.a.d, section.startDistanceMeters),
        right = Math.min(edge.b.d, section.endDistanceMeters);
      const weight =
        dd === 0 ? (i === cursor ? 1 : 0) : Math.max(0, right - left) / dd;
      if (weight <= 0) continue;
      const s = sums[i];
      s.expected += weight;
      if (edge.dt === null) continue;
      s.supported += weight;
      const dt = edge.dt * weight;
      s.seconds += dt;
      if (edge.stationary) s.stationary += dt;
      if (edge.a.hr !== null && edge.b.hr !== null) {
        const f1 = dd === 0 ? 0 : (left - edge.a.d) / dd,
          f2 = dd === 0 ? 1 : (right - edge.a.d) / dd;
        const h1 = edge.a.hr + f1 * (edge.b.hr - edge.a.hr),
          h2 = edge.a.hr + f2 * (edge.b.hr - edge.a.hr);
        s.hrSeconds += dt;
        s.hrIntegral += (dt * (h1 + h2)) / 2;
      }
    }
  }
  sections.forEach((section, i) => {
    const s = sums[i];
    section.timeSupportSec = s.seconds;
    section.timeCoverage = s.expected ? s.supported / s.expected : 0;
    section.hrSupportSec = s.hrSeconds;
    section.averageHeartRate =
      s.hrSeconds > 0 ? s.hrIntegral / s.hrSeconds : null;
    if (section.timeCoverage >= 1 - 1e-9) {
      section.elapsedSec = s.seconds;
      section.estimatedStationarySec = s.stationary;
      section.estimatedMovingSec = s.seconds - s.stationary;
      section.elapsedPaceSecPerKm = (1000 * s.seconds) / section.distanceMeters;
    } else section.quality += ";incomplete_time";
    if (s.hrSeconds < s.seconds - 1e-9 || !s.hrSeconds)
      section.quality += ";incomplete_hr";
  });
}

export function analyzeTerrainSections(
  activityId: string,
  sport: string | null,
  points: readonly TerrainPoint[],
  rowLimit = 100,
): TerrainAnalysis {
  const result: TerrainAnalysis = {
    activityId,
    status: "unavailable",
    reason: null,
    method: "terrain-v2",
    parameters: TERRAIN_PARAMETERS,
    inputPoints: points.length,
    usableEdges: 0,
    totalEdges: Math.max(0, points.length - 1),
    supportedDistanceMeters: 0,
    recordedDistanceSpanMeters: null,
    recordedPositiveDistanceMeters: 0,
    ascentMeters: 0,
    descentMeters: 0,
    timeSupportSec: 0,
    sectionCount: 0,
    returnedSections: 0,
    truncated: false,
    quality: [],
    sections: [],
  };
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(activityId)) {
    result.reason = "invalid_activity_id";
    return result;
  }
  if (sport === null) {
    result.reason = "unknown_activity";
    return result;
  }
  if (!["hike", "hiking", "walk", "walking"].includes(sport.toLowerCase())) {
    result.reason = "unsupported_sport";
    return result;
  }
  if (points.length > TERRAIN_PARAMETERS.maxPoints) {
    result.reason = "point_limit_exceeded";
    return result;
  }
  if (points.length < 2) {
    result.reason = "missing_stream";
    return result;
  }
  const clocks = points.map((p) => clock(p.timestamp));
  const modes = new Set(clocks.filter((c) => c !== null).map((c) => c.mode));
  const origin = clocks.find((c) => c !== null)?.ms ?? null;
  if (modes.size > 1) result.quality.push("mixed_timestamp_clocks");
  const samples = points.map((p, i): Sample | null =>
    validDistance(p.distanceMeters) &&
    finite(p.altitudeMeters) &&
    Math.abs(p.altitudeMeters) <=
      TERRAIN_PARAMETERS.maxAbsoluteAltitudeMeters &&
    Number.isFinite(p.elapsedSec) &&
    p.elapsedSec >= 0 &&
    p.elapsedSec <= TERRAIN_PARAMETERS.maxStoredElapsed
      ? {
          d: p.distanceMeters,
          z: p.altitudeMeters,
          t:
            modes.size === 1 && origin !== null && clocks[i] !== null
              ? (clocks[i]!.ms - origin) / 1000
              : null,
          elapsed: p.elapsedSec,
          hr: validHr(p.heartRate),
        }
      : null,
  );
  const runs: Run[] = [];
  let run: Run | null = null;
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1],
      b = samples[i];
    const dt =
      a?.t !== null && a?.t !== undefined && b?.t !== null && b?.t !== undefined
        ? b.t - a.t
        : null;
    if (
      !a ||
      !b ||
      b.d < a.d ||
      b.d - a.d > TERRAIN_PARAMETERS.maxDistanceGapMeters ||
      (dt !== null && (dt <= 0 || dt > TERRAIN_PARAMETERS.maxTimeGapSec))
    ) {
      run = null;
      continue;
    }
    if (!run) {
      run = { samples: [a], edges: [] };
      runs.push(run);
    }
    run.samples.push(b);
    run.edges.push({ a, b, dt, stationary: false });
  }
  const distances = points.map((p) => p.distanceMeters).filter(validDistance);
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1].distanceMeters,
      b = points[i].distanceMeters;
    if (validDistance(a) && validDistance(b) && b >= a)
      result.recordedPositiveDistanceMeters += b - a;
  }
  if (distances.length)
    result.recordedDistanceSpanMeters =
      distances.reduce((n, d) => Math.max(n, d), -Infinity) -
      distances.reduce((n, d) => Math.min(n, d), Infinity);
  for (const r of runs) {
    if (
      r.samples.at(-1)!.d - r.samples[0].d <
      TERRAIN_PARAMETERS.minimumSectionMeters
    )
      continue;
    stationaryEdges(r.edges);
    const sections = geometrySections(r);
    addTimeMetrics(sections, r.edges);
    result.usableEdges += r.edges.length;
    for (const section of sections) result.sections.push(section);
  }
  for (const [i, s] of result.sections.entries()) {
    s.id = `section-${i + 1}`;
    result.supportedDistanceMeters += s.distanceMeters;
    result.ascentMeters += s.ascentMeters;
    result.descentMeters += s.descentMeters;
    result.timeSupportSec += s.timeSupportSec;
  }
  result.sectionCount = result.sections.length;
  if (result.usableEdges < result.totalEdges)
    result.quality.push("excluded_gaps_invalid_or_short_support");
  if (result.sections.some((s) => s.timeCoverage < 1 - 1e-9))
    result.quality.push("incomplete_time");
  if (!result.sectionCount) {
    result.reason = "insufficient_supported_elevation_distance";
    return result;
  }
  result.sections = result.sections.slice(
    0,
    Math.max(
      1,
      Math.min(
        TERRAIN_PARAMETERS.maxRows,
        Number.isFinite(rowLimit) ? Math.floor(rowLimit) : 100,
      ),
    ),
  );
  result.returnedSections = result.sections.length;
  result.truncated = result.returnedSections < result.sectionCount;
  if (result.truncated) result.quality.push("section_rows_truncated");
  result.status = result.quality.length ? "partial" : "available";
  return result;
}
