// Pure selected-activity transformations over already selected, ordered normalized rows.
// No storage, input normalization, or side effects belong in this owner.

type ActivityDashboardChartPoint = {
  elapsedSec: number;
  heartRate: number | null;
  altitudeMeters: number | null;
  speedKmh: number | null;
  gradePct: number | null;
};

type ActivityDashboardSpeedStatus =
  "available" | "missing_speed" | "insufficient_speed";

type ActivityDashboardSpeedChart = {
  status: ActivityDashboardSpeedStatus;
  sourcePointCount: number;
  pointCount: number;
  message: string;
};

type ActivityDashboardChartTimeScaleStatus =
  "elapsed" | "timestamp_derived" | "sample_index_limited";

export type ActivityDashboardRoutePoint = {
  elapsedSec: number;
  lat: number;
  lon: number;
  altitudeMeters: number | null;
  gradePct: number | null;
};

type ActivityDashboardRouteBounds = {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
  minAltitudeMeters: number | null;
  maxAltitudeMeters: number | null;
};

export type ActivityDashboardRoute = {
  status: "available" | "missing_gps" | "insufficient_points";
  sourcePointCount: number;
  pointCount: number;
  maxPoints: number;
  simplified: boolean;
  bounds: ActivityDashboardRouteBounds | null;
  points: ActivityDashboardRoutePoint[];
  message: string;
};

export type ActivityDashboardCharts = {
  downsampled: boolean;
  sourcePointCount: number;
  pointCount: number;
  maxPoints: number;
  domainStartSec: number;
  domainEndSec: number | null;
  timeScaleStatus: ActivityDashboardChartTimeScaleStatus;
  timeScaleMessage: string | null;
  speed: ActivityDashboardSpeedChart;
  points: ActivityDashboardChartPoint[];
};

type ActivityDashboardChartSourcePoint = {
  elapsedSec: number;
  distanceMeters: number | null;
  heartRate: number | null;
  altitudeMeters: number | null;
  gradePct: number | null;
};

export type ActivityDashboardChartRow = ActivityDashboardChartSourcePoint & {
  timestamp: string | null;
};

type ActivityDashboardChartTiming = {
  domainStartSec: number;
  domainEndSec: number | null;
  timeScaleStatus: ActivityDashboardChartTimeScaleStatus;
  timeScaleMessage: string | null;
  points: ActivityDashboardChartSourcePoint[];
};

function timestampMillis(value: string | null): number | null {
  if (value === null) return null;
  const millis = Date.parse(value);
  return Number.isFinite(millis) ? millis : null;
}

function deriveChartElapsedFromTimestamps(
  rows: ActivityDashboardChartRow[],
): ActivityDashboardChartSourcePoint[] | null {
  if (rows.length < 2) return null;
  const firstTimestamp = timestampMillis(rows[0]?.timestamp ?? null);
  if (firstTimestamp === null) return null;

  const elapsedSeconds: number[] = [];
  let previousElapsed = -1;
  for (const row of rows) {
    const currentTimestamp = timestampMillis(row.timestamp);
    if (currentTimestamp === null) return null;
    const elapsedSec = Math.round((currentTimestamp - firstTimestamp) / 1000);
    if (elapsedSec < 0 || elapsedSec < previousElapsed) return null;
    elapsedSeconds.push(elapsedSec);
    previousElapsed = elapsedSec;
  }

  return rows.map((row, index) => ({
    elapsedSec: elapsedSeconds[index],
    distanceMeters: row.distanceMeters,
    heartRate: row.heartRate,
    altitudeMeters: row.altitudeMeters,
    gradePct: row.gradePct,
  }));
}

function maxElapsedSec(points: Array<{ elapsedSec: number }>): number {
  return points.reduce(
    (maximum, point) => Math.max(maximum, point.elapsedSec),
    0,
  );
}

function isLikelySampleIndexTimeline(
  rows: ActivityDashboardChartRow[],
  activityDurationSec: number | null,
): boolean {
  if (
    rows.length < 2 ||
    activityDurationSec === null ||
    activityDurationSec <= 0
  )
    return false;
  const maximumElapsed = maxElapsedSec(rows);
  if (maximumElapsed <= 0 || maximumElapsed >= activityDurationSec * 0.5)
    return false;
  return rows.length >= maximumElapsed * 0.8;
}

function chartTimingForRows(
  rows: ActivityDashboardChartRow[],
  activityDurationSec: number | null,
): ActivityDashboardChartTiming {
  const rawPoints = rows.map(({ timestamp: _timestamp, ...point }) => point);
  const rawMaximumElapsed = maxElapsedSec(rawPoints);
  const timestampPoints = deriveChartElapsedFromTimestamps(rows);
  if (timestampPoints) {
    const timestampMaximumElapsed = maxElapsedSec(timestampPoints);
    if (timestampMaximumElapsed > rawMaximumElapsed + 60) {
      return {
        domainStartSec: 0,
        domainEndSec:
          activityDurationSec !== null &&
          activityDurationSec >= timestampMaximumElapsed
            ? Math.round(activityDurationSec)
            : timestampMaximumElapsed,
        timeScaleStatus: "timestamp_derived",
        timeScaleMessage:
          "Chart timing is derived from record timestamps because stored elapsed samples were index-like.",
        points: timestampPoints,
      };
    }
  }

  const sampleIndexLimited = isLikelySampleIndexTimeline(
    rows,
    activityDurationSec,
  );
  return {
    domainStartSec: 0,
    domainEndSec: sampleIndexLimited
      ? rawMaximumElapsed
      : activityDurationSec !== null && activityDurationSec >= rawMaximumElapsed
        ? Math.round(activityDurationSec)
        : rawMaximumElapsed,
    timeScaleStatus: sampleIndexLimited ? "sample_index_limited" : "elapsed",
    timeScaleMessage: sampleIndexLimited
      ? "Chart timing is limited to the available sample-index stream because no safe elapsed or timestamp evidence is available."
      : null,
    points: rawPoints,
  };
}

type ActivityDashboardSpeedSeries = {
  metadata: ActivityDashboardSpeedChart;
  values: Array<number | null>;
};

function finiteNumber(value: number | null): value is number {
  return value !== null && Number.isFinite(value);
}

export const ACTIVITY_DASHBOARD_GRADE_READOUT_WINDOW_SEC = 180;

function smoothedActivityDashboardGradeReadoutPct(
  points: ActivityDashboardChartSourcePoint[],
  index: number,
): number | null {
  const currentPoint = points[index];
  if (
    !currentPoint ||
    !finiteNumber(currentPoint.elapsedSec) ||
    !finiteNumber(currentPoint.altitudeMeters) ||
    points.length < 2
  ) {
    return null;
  }

  const firstPoint = points[0];
  const lastPoint = points[points.length - 1];
  if (
    !finiteNumber(firstPoint?.elapsedSec ?? null) ||
    !finiteNumber(lastPoint?.elapsedSec ?? null)
  ) {
    return null;
  }

  const halfWindowSec = ACTIVITY_DASHBOARD_GRADE_READOUT_WINDOW_SEC / 2;
  let windowStartSec = currentPoint.elapsedSec - halfWindowSec;
  let windowEndSec = currentPoint.elapsedSec + halfWindowSec;
  if (windowStartSec < firstPoint.elapsedSec) {
    windowEndSec += firstPoint.elapsedSec - windowStartSec;
    windowStartSec = firstPoint.elapsedSec;
  }
  if (windowEndSec > lastPoint.elapsedSec) {
    windowStartSec -= windowEndSec - lastPoint.elapsedSec;
    windowEndSec = lastPoint.elapsedSec;
  }
  windowStartSec = Math.max(windowStartSec, firstPoint.elapsedSec);

  let startIndex = 0;
  for (let pointIndex = 0; pointIndex < points.length; pointIndex += 1) {
    const point = points[pointIndex];
    if (!finiteNumber(point.elapsedSec)) return null;
    if (point.elapsedSec <= windowStartSec) startIndex = pointIndex;
  }

  let endIndex = points.length - 1;
  for (
    let pointIndex = startIndex + 1;
    pointIndex < points.length;
    pointIndex += 1
  ) {
    const point = points[pointIndex];
    if (!finiteNumber(point.elapsedSec)) return null;
    if (point.elapsedSec >= windowEndSec) {
      endIndex = pointIndex;
      break;
    }
  }
  if (endIndex <= startIndex) return null;

  let previousElapsedSec: number | null = null;
  let previousDistanceMeters: number | null = null;
  for (let pointIndex = startIndex; pointIndex <= endIndex; pointIndex += 1) {
    const point = points[pointIndex];
    if (
      !finiteNumber(point.elapsedSec) ||
      !finiteNumber(point.distanceMeters) ||
      !finiteNumber(point.altitudeMeters)
    ) {
      return null;
    }
    if (
      previousElapsedSec !== null &&
      (point.elapsedSec <= previousElapsedSec ||
        point.distanceMeters < (previousDistanceMeters ?? point.distanceMeters))
    ) {
      return null;
    }
    previousElapsedSec = point.elapsedSec;
    previousDistanceMeters = point.distanceMeters;
  }

  const startPoint = points[startIndex];
  const endPoint = points[endIndex];
  const startDistanceMeters = startPoint.distanceMeters;
  const endDistanceMeters = endPoint.distanceMeters;
  const startAltitudeMeters = startPoint.altitudeMeters;
  const endAltitudeMeters = endPoint.altitudeMeters;
  if (
    !finiteNumber(startDistanceMeters) ||
    !finiteNumber(endDistanceMeters) ||
    !finiteNumber(startAltitudeMeters) ||
    !finiteNumber(endAltitudeMeters)
  ) {
    return null;
  }
  const elapsedDeltaSec = endPoint.elapsedSec - startPoint.elapsedSec;
  const distanceDeltaMeters = endDistanceMeters - startDistanceMeters;
  if (
    elapsedDeltaSec < ACTIVITY_DASHBOARD_GRADE_READOUT_WINDOW_SEC ||
    distanceDeltaMeters <= 0
  ) {
    return null;
  }
  return (
    ((endAltitudeMeters - startAltitudeMeters) / distanceDeltaMeters) * 100
  );
}

export const ACTIVITY_DASHBOARD_SPEED_AVERAGE_WINDOW_SEC = 60;

function distanceWindowAverageActivityDashboardSpeedKmh(
  points: ActivityDashboardChartSourcePoint[],
  index: number,
): number | null {
  const endPoint = points[index];
  const endDistanceMeters = endPoint?.distanceMeters ?? null;
  if (
    !endPoint ||
    !finiteNumber(endPoint.elapsedSec) ||
    !finiteNumber(endDistanceMeters)
  )
    return null;

  let startIndex = index;
  while (
    startIndex > 0 &&
    endPoint.elapsedSec - points[startIndex - 1].elapsedSec <=
      ACTIVITY_DASHBOARD_SPEED_AVERAGE_WINDOW_SEC
  ) {
    startIndex -= 1;
  }
  if (startIndex === index) return null;

  let previousElapsedSec: number | null = null;
  let previousDistanceMeters: number | null = null;
  for (let pointIndex = startIndex; pointIndex <= index; pointIndex += 1) {
    const point = points[pointIndex];
    const distanceMeters = point.distanceMeters;
    if (!finiteNumber(point.elapsedSec) || !finiteNumber(distanceMeters)) {
      return null;
    }
    if (
      previousElapsedSec !== null &&
      (point.elapsedSec <= previousElapsedSec ||
        distanceMeters < (previousDistanceMeters ?? distanceMeters))
    ) {
      return null;
    }
    previousElapsedSec = point.elapsedSec;
    previousDistanceMeters = distanceMeters;
  }

  const startPoint = points[startIndex];
  const startDistanceMeters = startPoint.distanceMeters;
  if (!finiteNumber(startDistanceMeters)) return null;
  const elapsedDeltaSec = endPoint.elapsedSec - startPoint.elapsedSec;
  const distanceDeltaMeters = endDistanceMeters - startDistanceMeters;
  if (elapsedDeltaSec <= 0 || distanceDeltaMeters < 0) return null;

  return (distanceDeltaMeters / elapsedDeltaSec) * 3.6;
}

function activityDashboardSpeedSeries(
  points: ActivityDashboardChartSourcePoint[],
): ActivityDashboardSpeedSeries {
  const sourcePointCount = points.filter((point) =>
    finiteNumber(point.distanceMeters),
  ).length;
  const values = points.map((_, index) =>
    distanceWindowAverageActivityDashboardSpeedKmh(points, index),
  );
  const pointCount = values.filter(finiteNumber).length;
  if (sourcePointCount === 0) {
    return {
      metadata: {
        status: "missing_speed",
        sourcePointCount: 0,
        pointCount: 0,
        message:
          "Speed unavailable because this activity has no normalized cumulative-distance stream samples.",
      },
      values,
    };
  }
  if (pointCount < 2) {
    return {
      metadata: {
        status: "insufficient_speed",
        sourcePointCount,
        pointCount,
        message:
          "Speed unavailable because at least two reliable elapsed-time distance windows are needed.",
      },
      values,
    };
  }
  return {
    metadata: {
      status: "available",
      sourcePointCount,
      pointCount,
      message:
        "Speed uses a 60-second moving average derived from normalized cumulative distance and elapsed time.",
    },
    values,
  };
}

const ACTIVITY_DASHBOARD_ROUTE_MAX_POINTS = 400;

function finiteRouteCoordinate(value: number | null): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function activityDashboardRouteBounds(
  points: ActivityDashboardRoutePoint[],
): ActivityDashboardRouteBounds {
  const altitudes = points
    .map((point) => point.altitudeMeters)
    .filter(finiteRouteCoordinate);
  return {
    minLat: Math.min(...points.map((point) => point.lat)),
    maxLat: Math.max(...points.map((point) => point.lat)),
    minLon: Math.min(...points.map((point) => point.lon)),
    maxLon: Math.max(...points.map((point) => point.lon)),
    minAltitudeMeters: altitudes.length ? Math.min(...altitudes) : null,
    maxAltitudeMeters: altitudes.length ? Math.max(...altitudes) : null,
  };
}

function simplifyActivityDashboardRoute(
  points: ActivityDashboardRoutePoint[],
  maxPoints: number,
): ActivityDashboardRoutePoint[] {
  if (points.length <= maxPoints) return points;
  if (maxPoints < 2) return points.slice(0, maxPoints);
  const lastIndex = points.length - 1;
  return Array.from({ length: maxPoints }, (_, index) => {
    const sourceIndex = Math.round((index / (maxPoints - 1)) * lastIndex);
    return points[sourceIndex];
  });
}

export function buildActivityDashboardRoute(
  rows: ActivityDashboardRoutePoint[],
): ActivityDashboardRoute {
  const points = rows.filter(
    (point) =>
      finiteRouteCoordinate(point.lat) && finiteRouteCoordinate(point.lon),
  );
  const maxPoints = ACTIVITY_DASHBOARD_ROUTE_MAX_POINTS;
  if (points.length === 0) {
    return {
      status: "missing_gps",
      sourcePointCount: 0,
      pointCount: 0,
      maxPoints,
      simplified: false,
      bounds: null,
      points: [],
      message:
        "Route unavailable because this activity has no normalized GPS stream points.",
    };
  }
  if (points.length < 2) {
    return {
      status: "insufficient_points",
      sourcePointCount: points.length,
      pointCount: points.length,
      maxPoints,
      simplified: false,
      bounds: activityDashboardRouteBounds(points),
      points,
      message:
        "Route unavailable because at least two normalized GPS points are needed to draw a route.",
    };
  }
  const simplifiedPoints = simplifyActivityDashboardRoute(points, maxPoints);
  return {
    status: "available",
    sourcePointCount: points.length,
    pointCount: simplifiedPoints.length,
    maxPoints,
    simplified: simplifiedPoints.length < points.length,
    bounds: activityDashboardRouteBounds(points),
    points: simplifiedPoints,
    message:
      simplifiedPoints.length < points.length
        ? `Showing ${simplifiedPoints.length.toLocaleString()} representative route points from ${points.length.toLocaleString()} normalized GPS stream points.`
        : `Showing ${points.length.toLocaleString()} normalized GPS stream points.`,
  };
}

export function buildActivityDashboardCharts(
  rows: ActivityDashboardChartRow[],
  activityDurationSec: number | null,
): ActivityDashboardCharts {
  const chartTiming = chartTimingForRows(rows, activityDurationSec);
  const speedSeries = activityDashboardSpeedSeries(chartTiming.points);
  const points = chartTiming.points.map(
    (
      { distanceMeters: _distanceMeters, gradePct: _gradePct, ...point },
      index,
    ) => ({
      ...point,
      speedKmh: speedSeries.values[index] ?? null,
      gradePct: smoothedActivityDashboardGradeReadoutPct(
        chartTiming.points,
        index,
      ),
    }),
  );
  const sourcePointCount = points.length;
  return {
    downsampled: false,
    sourcePointCount,
    pointCount: points.length,
    maxPoints: sourcePointCount,
    domainStartSec: chartTiming.domainStartSec,
    domainEndSec: chartTiming.domainEndSec,
    timeScaleStatus: chartTiming.timeScaleStatus,
    timeScaleMessage: chartTiming.timeScaleMessage,
    speed: speedSeries.metadata,
    points,
  };
}
