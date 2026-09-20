"use client";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { type ActivityDashboardPayload } from "./contracts";
import { finiteNumberLabel } from "./formatting";

export function primaryBenefitLabel(value: string | null | undefined): string {
  const words = (value ?? "").split(/[_\s]+/).filter(Boolean);
  return words.length
    ? words
        .map((word) => word[0].toUpperCase() + word.slice(1).toLowerCase())
        .join(" ")
    : "Unavailable";
}

export function finiteNumberUnitLabel(
  value: number | null | undefined,
  unit: string,
  fractionDigits = 0,
): string {
  const label = finiteNumberLabel(value, fractionDigits);
  return label === "Unavailable" ? label : `${label} ${unit}`;
}

export function weightedIntensityMinutes(
  moderate: number | null | undefined,
  vigorous: number | null | undefined,
): number | null {
  if (
    typeof moderate !== "number" ||
    !Number.isFinite(moderate) ||
    typeof vigorous !== "number" ||
    !Number.isFinite(vigorous)
  ) {
    return null;
  }
  return moderate + 2 * vigorous;
}

export function durationLabel(seconds: number | null): string {
  if (seconds === null) return "Unavailable";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes.toString().padStart(2, "0")}m`;
  return `${minutes}m`;
}

function durationDetailLabel(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = Math.round(seconds % 60);
  if (hours > 0) return `${hours}h ${minutes.toString().padStart(2, "0")}m`;
  if (minutes > 0)
    return `${minutes}m ${remainingSeconds.toString().padStart(2, "0")}s`;
  return `${remainingSeconds}s`;
}

export function distanceLabel(meters: number | null): string {
  if (meters === null) return "Unavailable";
  return `${(meters / 1000).toLocaleString(undefined, {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  })} km`;
}

export function metersLabel(meters: number | null): string {
  if (meters === null) return "Unavailable";
  return `${Math.round(meters).toLocaleString()} m`;
}

function paceSecondsLabel(secondsPerKm: number | null) {
  if (
    secondsPerKm === null ||
    !Number.isFinite(secondsPerKm) ||
    secondsPerKm <= 0
  )
    return "Unavailable";
  const roundedSeconds = Math.max(1, Math.round(secondsPerKm));
  const minutes = Math.floor(roundedSeconds / 60);
  const seconds = roundedSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}/km`;
}

export function paceLabel(
  durationSec: number | null,
  distanceMeters: number | null,
) {
  if (durationSec === null || distanceMeters === null || distanceMeters <= 0)
    return "Unavailable";
  return paceSecondsLabel(durationSec / (distanceMeters / 1000));
}

export function speedKmhLabel(speedKmh: number) {
  return `${speedKmh.toLocaleString(undefined, {
    maximumFractionDigits: 1,
  })} km/h`;
}

export function averageSpeedLabel(avgSpeedMps: number | null | undefined) {
  if (
    avgSpeedMps === null ||
    avgSpeedMps === undefined ||
    !Number.isFinite(avgSpeedMps) ||
    avgSpeedMps < 0
  ) {
    return "Unavailable";
  }
  return speedKmhLabel(avgSpeedMps * 3.6);
}

type ChartSeriesPoint = {
  elapsedSec: number;
  value: number;
  readoutDetail: string | null;
  x: number;
  y: number;
};

type ChartPlotModel = {
  width: number;
  height: number;
  plotLeft: number;
  plotRight: number;
  plotTop: number;
  plotBottom: number;
  domainStartSec: number;
  domainEndSec: number;
};

type PreparedChart = {
  chartPoints: ChartSeriesPoint[];
  isXSorted: boolean;
  maxY: number;
  minY: number;
  model: ChartPlotModel;
  polyline: string;
};

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function chartPlotModel({
  width,
  height,
  domainStartSec,
  domainEndSec,
}: {
  width: number;
  height: number;
  domainStartSec: number;
  domainEndSec: number;
}): ChartPlotModel {
  return {
    width,
    height,
    plotLeft: 8,
    plotRight: width - 6,
    plotTop: 8,
    plotBottom: height - 16,
    domainStartSec,
    domainEndSec: Math.max(domainStartSec + 1, domainEndSec),
  };
}

function chartYCoordinate(
  value: number,
  minY: number,
  maxY: number,
  model: ChartPlotModel,
) {
  const yRange = Math.max(1, maxY - minY);
  const plotHeight = Math.max(1, model.plotBottom - model.plotTop);
  const boundedValue = clamp(value, minY, maxY);
  return model.plotBottom - ((boundedValue - minY) / yRange) * plotHeight;
}

function chartSeriesCoordinates(
  points: Array<{
    elapsedSec: number;
    value: number;
    readoutDetail: string | null;
  }>,
  model: ChartPlotModel,
  minY: number,
  maxY: number,
): ChartSeriesPoint[] {
  const xRange = Math.max(1, model.domainEndSec - model.domainStartSec);
  const plotWidth = Math.max(1, model.plotRight - model.plotLeft);
  return points.map((point) => ({
    ...point,
    x:
      model.plotLeft +
      ((clamp(point.elapsedSec, model.domainStartSec, model.domainEndSec) -
        model.domainStartSec) /
        xRange) *
        plotWidth,
    y: chartYCoordinate(point.value, minY, maxY, model),
  }));
}

function chartPolyline(points: ChartSeriesPoint[]) {
  return points
    .map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`)
    .join(" ");
}

function chartPointsAreSortedByX(points: ChartSeriesPoint[]) {
  return points.every(
    (point, index) => index === 0 || point.x >= points[index - 1]!.x,
  );
}

function closestChartPointIndex(
  points: ChartSeriesPoint[],
  x: number,
  isXSorted = chartPointsAreSortedByX(points),
) {
  if (points.length === 0) return -1;
  if (!isXSorted) {
    return points.reduce(
      (closestIndex, point, index) =>
        Math.abs(point.x - x) < Math.abs(points[closestIndex]!.x - x)
          ? index
          : closestIndex,
      0,
    );
  }

  let low = 0;
  let high = points.length - 1;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (points[mid]!.x < x) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  const rightIndex = low;
  const leftIndex = Math.max(0, rightIndex - 1);
  const leftDistance = Math.abs(points[leftIndex]!.x - x);
  const rightDistance = Math.abs(points[rightIndex]!.x - x);
  return rightDistance < leftDistance ? rightIndex : leftIndex;
}

function prepareChart({
  points,
  valueKey,
  domainStartSec,
  domainEndSec,
  readoutDetail,
}: {
  points: ActivityDashboardPayload["charts"]["points"];
  valueKey: "heartRate" | "altitudeMeters" | "speedKmh";
  domainStartSec: number;
  domainEndSec: number | null;
  readoutDetail?: (
    point: ActivityDashboardPayload["charts"]["points"][number],
  ) => string | null;
}): PreparedChart {
  const width = 320;
  const height = 120;
  const series = points
    .filter(
      (point) =>
        typeof point[valueKey] === "number" && Number.isFinite(point[valueKey]),
    )
    .map((point) => ({
      elapsedSec: point.elapsedSec,
      value: point[valueKey]!,
      readoutDetail: readoutDetail?.(point) ?? null,
    }));
  const values = series.map((point) => point.value);
  const minY = values.length ? Math.min(...values) : 0;
  const maxY = values.length ? Math.max(...values) : 0;
  const maxElapsed = series.length
    ? Math.max(...series.map((point) => point.elapsedSec))
    : domainStartSec;
  const model = chartPlotModel({
    width,
    height,
    domainStartSec,
    domainEndSec: Math.max(domainEndSec ?? maxElapsed, maxElapsed),
  });
  const chartPoints = chartSeriesCoordinates(series, model, minY, maxY);
  return {
    chartPoints,
    isXSorted: chartPointsAreSortedByX(chartPoints),
    maxY,
    minY,
    model,
    polyline: chartPolyline(chartPoints),
  };
}

function chartNumberLabel(value: number, unit: string) {
  return `${Math.round(value).toLocaleString()} ${unit}`;
}

function chartValueLabel(
  point: Pick<ChartSeriesPoint, "elapsedSec" | "value">,
  formatValue: (value: number) => string,
  suffix?: string | null,
) {
  const selectedValue = `${durationLabel(point.elapsedSec)} elapsed · ${formatValue(point.value)}`;
  return suffix ? `${selectedValue} · ${suffix}` : selectedValue;
}

export function gradeReadoutLabel(gradePct: number | null | undefined) {
  if (typeof gradePct !== "number" || !Number.isFinite(gradePct)) {
    return "Grade unavailable";
  }
  const rounded = Math.round(gradePct * 10) / 10;
  const sign = rounded > 0 ? "+" : "";
  return `Grade ${sign}${rounded.toFixed(1)}%`;
}

export function finiteChartAverage(values: Array<number | null | undefined>) {
  const finiteValues = values.filter(
    (value): value is number =>
      typeof value === "number" && Number.isFinite(value),
  );
  if (finiteValues.length < 2) return null;
  return (
    finiteValues.reduce((total, value) => total + value, 0) /
    finiteValues.length
  );
}

export function finiteHeartRateAverage(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

export function MiniLineChart({
  title,
  unit,
  points,
  valueKey,
  domainStartSec,
  domainEndSec,
  formatValue,
  averageValue,
  averageLabel,
  readoutDetail,
  note,
}: {
  title: string;
  unit: string;
  points: ActivityDashboardPayload["charts"]["points"];
  valueKey: "heartRate" | "altitudeMeters" | "speedKmh";
  domainStartSec: number;
  domainEndSec: number | null;
  formatValue?: (value: number) => string;
  averageValue?: number | null;
  averageLabel?: (value: number) => string;
  readoutDetail?: (
    point: ActivityDashboardPayload["charts"]["points"][number],
  ) => string | null;
  note?: string;
}) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const formatChartValue = useMemo(
    () => formatValue ?? ((value: number) => chartNumberLabel(value, unit)),
    [formatValue, unit],
  );
  const preparedChart = useMemo(
    () =>
      prepareChart({
        points,
        valueKey,
        domainStartSec,
        domainEndSec,
        readoutDetail,
      }),
    [domainEndSec, domainStartSec, points, readoutDetail, valueKey],
  );
  const averageLine = useMemo(() => {
    if (typeof averageValue !== "number" || !Number.isFinite(averageValue)) {
      return null;
    }
    return {
      y: chartYCoordinate(
        averageValue,
        preparedChart.minY,
        preparedChart.maxY,
        preparedChart.model,
      ),
      label: averageLabel
        ? averageLabel(averageValue)
        : `Avg ${formatChartValue(averageValue)}`,
    };
  }, [averageLabel, averageValue, formatChartValue, preparedChart]);

  const boundedActiveIndex =
    activeIndex === null || preparedChart.chartPoints.length === 0
      ? null
      : Math.min(activeIndex, preparedChart.chartPoints.length - 1);
  if (activeIndex !== boundedActiveIndex) setActiveIndex(boundedActiveIndex);

  if (preparedChart.chartPoints.length < 2) {
    return (
      <div className="activity-chart empty-state">
        <strong>{title}</strong>
        <span>Not enough chartable data.</span>
      </div>
    );
  }

  const { chartPoints, isXSorted, model, polyline } = preparedChart;
  const selectedPoint = chartPoints[activeIndex ?? 0] ?? chartPoints[0]!;
  const readoutSuffix = [selectedPoint.readoutDetail, averageLine?.label]
    .filter((part): part is string => Boolean(part))
    .join(" · ");
  function setNearestPoint(x: number) {
    const boundedX = clamp(x, model.plotLeft, model.plotRight);
    const nearestIndex = closestChartPointIndex(
      chartPoints,
      boundedX,
      isXSorted,
    );
    if (nearestIndex < 0) return;
    setActiveIndex((currentIndex) =>
      currentIndex === nearestIndex ? currentIndex : nearestIndex,
    );
  }
  function handlePointer(event: ReactPointerEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    if (!Number.isFinite(rect.width) || rect.width <= 0) return;
    const relativeX = ((event.clientX - rect.left) / rect.width) * model.width;
    setNearestPoint(relativeX);
  }
  function handleKeyDown(event: ReactKeyboardEvent<SVGSVGElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const currentIndex = activeIndex ?? 0;
    setActiveIndex(
      clamp(
        currentIndex + (event.key === "ArrowRight" ? 1 : -1),
        0,
        chartPoints.length - 1,
      ),
    );
  }

  return (
    <figure className="activity-chart" aria-label={`${title} chart`}>
      <figcaption>
        <strong>{title}</strong>
        <span>
          {formatChartValue(preparedChart.minY)}–
          {formatChartValue(preparedChart.maxY)}
        </span>
      </figcaption>
      <svg
        viewBox={`0 0 ${model.width} ${model.height}`}
        preserveAspectRatio="none"
        role="img"
        tabIndex={0}
        aria-label={`${title} over elapsed time`}
        onPointerEnter={handlePointer}
        onPointerMove={handlePointer}
        onPointerLeave={() => setActiveIndex(null)}
        onFocus={() => setActiveIndex(0)}
        onBlur={() => setActiveIndex(null)}
        onKeyDown={handleKeyDown}
      >
        {averageLine ? (
          <g className="activity-chart-average" aria-hidden="true">
            <line
              className="activity-chart-average-line"
              x1={model.plotLeft}
              x2={model.plotRight}
              y1={averageLine.y}
              y2={averageLine.y}
            />
          </g>
        ) : null}
        <polyline points={polyline} vectorEffect="non-scaling-stroke" />
        {activeIndex !== null ? (
          <g className="activity-chart-cursor">
            <line
              x1={selectedPoint.x}
              x2={selectedPoint.x}
              y1={model.plotTop}
              y2={model.plotBottom}
              vectorEffect="non-scaling-stroke"
            />
            <ellipse
              cx={selectedPoint.x}
              cy={selectedPoint.y}
              rx={4}
              ry={4}
              vectorEffect="non-scaling-stroke"
            />
          </g>
        ) : null}
      </svg>
      <p className="activity-chart-readout" aria-live="polite">
        {chartValueLabel(
          selectedPoint,
          formatChartValue,
          readoutSuffix || null,
        )}
      </p>
      {note ? <p className="activity-chart-note">{note}</p> : null}
    </figure>
  );
}

type RouteMapPoint = ActivityDashboardPayload["route"]["points"][number];

type RouteMapSvgPoint = RouteMapPoint & {
  x: number;
  y: number;
};

type RouteMapTile = {
  key: string;
  href: string;
  x: number;
  y: number;
};

type ExternalRouteMapView = {
  points: RouteMapSvgPoint[];
  tiles: RouteMapTile[];
};

type RouteMapPanOffset = {
  x: number;
  y: number;
};

type RouteMapDragState = {
  pointerId: number;
  lastClientX: number;
  lastClientY: number;
};

const ROUTE_MAP_WIDTH = 420;

const ROUTE_MAP_HEIGHT = 220;

const ROUTE_MAP_PADDING = 14;

const ROUTE_MAP_TILE_SIZE = 256;

const ROUTE_MAP_MIN_ZOOM = 2;

const ROUTE_MAP_MAX_ZOOM = 17;

const ROUTE_MAP_MIN_ZOOM_OFFSET = -1;

const ROUTE_MAP_MAX_ZOOM_OFFSET = 2;

const ROUTE_MAP_ZERO_PAN: RouteMapPanOffset = { x: 0, y: 0 };

const OPEN_TOPO_MAP_TILE_HOSTS = ["a", "b", "c"] as const;

function routeMapPanIsCentered(panOffset: RouteMapPanOffset) {
  return Math.round(panOffset.x) === 0 && Math.round(panOffset.y) === 0;
}

function routeMapCoordinates(
  route: ActivityDashboardPayload["route"],
  width: number,
  height: number,
  zoomOffset: number,
  panOffset: RouteMapPanOffset,
): RouteMapSvgPoint[] {
  if (!route.bounds) return [];
  const lonSpan = route.bounds.maxLon - route.bounds.minLon || 0.000001;
  const latSpan = route.bounds.maxLat - route.bounds.minLat || 0.000001;
  const usableWidth = width - ROUTE_MAP_PADDING * 2;
  const usableHeight = height - ROUTE_MAP_PADDING * 2;
  const scale = 2 ** zoomOffset;
  const centerX = width / 2;
  const centerY = height / 2;
  return route.points.map((point) => {
    const fittedX =
      ROUTE_MAP_PADDING +
      ((point.lon - route.bounds!.minLon) / lonSpan) * usableWidth;
    const fittedY =
      ROUTE_MAP_PADDING +
      (1 - (point.lat - route.bounds!.minLat) / latSpan) * usableHeight;
    return {
      ...point,
      x: centerX + (fittedX - centerX) * scale + panOffset.x,
      y: centerY + (fittedY - centerY) * scale + panOffset.y,
    };
  });
}

function clampLatitude(lat: number) {
  return Math.max(-85.05112878, Math.min(85.05112878, lat));
}

function lonLatToWorldPixel(lon: number, lat: number, zoom: number) {
  const scale = ROUTE_MAP_TILE_SIZE * 2 ** zoom;
  const sinLat = Math.sin((clampLatitude(lat) * Math.PI) / 180);
  return {
    x: ((lon + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale,
  };
}

function routeMapPixelBounds(
  route: ActivityDashboardPayload["route"],
  zoom: number,
) {
  if (!route.bounds) return null;
  const corners = [
    lonLatToWorldPixel(route.bounds.minLon, route.bounds.minLat, zoom),
    lonLatToWorldPixel(route.bounds.minLon, route.bounds.maxLat, zoom),
    lonLatToWorldPixel(route.bounds.maxLon, route.bounds.minLat, zoom),
    lonLatToWorldPixel(route.bounds.maxLon, route.bounds.maxLat, zoom),
  ];
  return {
    minX: Math.min(...corners.map((corner) => corner.x)),
    maxX: Math.max(...corners.map((corner) => corner.x)),
    minY: Math.min(...corners.map((corner) => corner.y)),
    maxY: Math.max(...corners.map((corner) => corner.y)),
  };
}

function routeMapZoom(
  route: ActivityDashboardPayload["route"],
  width: number,
  height: number,
) {
  const usableWidth = width - ROUTE_MAP_PADDING * 3;
  const usableHeight = height - ROUTE_MAP_PADDING * 3;
  let selectedZoom = ROUTE_MAP_MIN_ZOOM;
  for (let zoom = ROUTE_MAP_MIN_ZOOM; zoom <= ROUTE_MAP_MAX_ZOOM; zoom += 1) {
    const bounds = routeMapPixelBounds(route, zoom);
    if (!bounds) return selectedZoom;
    if (
      bounds.maxX - bounds.minX <= usableWidth &&
      bounds.maxY - bounds.minY <= usableHeight
    ) {
      selectedZoom = zoom;
    } else {
      break;
    }
  }
  return selectedZoom;
}

function externalRouteMapView(
  route: ActivityDashboardPayload["route"],
  width: number,
  height: number,
  zoomOffset: number,
  panOffset: RouteMapPanOffset,
): ExternalRouteMapView | null {
  if (!route.bounds) return null;
  const zoom = Math.max(
    ROUTE_MAP_MIN_ZOOM,
    Math.min(
      ROUTE_MAP_MAX_ZOOM,
      routeMapZoom(route, width, height) + zoomOffset,
    ),
  );
  const bounds = routeMapPixelBounds(route, zoom);
  if (!bounds) return null;

  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  const originX = centerX - width / 2 - panOffset.x;
  const originY = centerY - height / 2 - panOffset.y;
  const tileStartX = Math.floor(originX / ROUTE_MAP_TILE_SIZE);
  const tileEndX = Math.floor((originX + width) / ROUTE_MAP_TILE_SIZE);
  const tileStartY = Math.floor(originY / ROUTE_MAP_TILE_SIZE);
  const tileEndY = Math.floor((originY + height) / ROUTE_MAP_TILE_SIZE);
  const tileWrap = 2 ** zoom;

  const tiles: RouteMapTile[] = [];
  for (let tileX = tileStartX; tileX <= tileEndX; tileX += 1) {
    const wrappedTileX = ((tileX % tileWrap) + tileWrap) % tileWrap;
    for (let tileY = tileStartY; tileY <= tileEndY; tileY += 1) {
      if (tileY < 0 || tileY >= tileWrap) continue;
      const host =
        OPEN_TOPO_MAP_TILE_HOSTS[
          (zoom + wrappedTileX + tileY) % OPEN_TOPO_MAP_TILE_HOSTS.length
        ];
      tiles.push({
        key: `${zoom}-${wrappedTileX}-${tileY}`,
        href: `https://${host}.tile.opentopomap.org/${zoom}/${wrappedTileX}/${tileY}.png`,
        x: tileX * ROUTE_MAP_TILE_SIZE - originX,
        y: tileY * ROUTE_MAP_TILE_SIZE - originY,
      });
    }
  }

  return {
    tiles,
    points: route.points.map((point) => {
      const worldPoint = lonLatToWorldPixel(point.lon, point.lat, zoom);
      return {
        ...point,
        x: worldPoint.x - originX,
        y: worldPoint.y - originY,
      };
    }),
  };
}

function routeSegmentClass(point: RouteMapSvgPoint) {
  if (point.gradePct === null) return "route-map-segment";
  if (point.gradePct >= 3) return "route-map-segment climbing";
  if (point.gradePct <= -3) return "route-map-segment descending";
  return "route-map-segment rolling";
}

export function RouteMap({
  route,
}: {
  route: ActivityDashboardPayload["route"];
}) {
  const [mapBackgroundFailed, setMapBackgroundFailed] = useState(false);
  const [zoomOffset, setZoomOffset] = useState(0);
  const [panOffset, setPanOffset] =
    useState<RouteMapPanOffset>(ROUTE_MAP_ZERO_PAN);
  const [isDragging, setIsDragging] = useState(false);
  const routeMapSvgRef = useRef<SVGSVGElement | null>(null);
  const dragStateRef = useRef<RouteMapDragState | null>(null);
  const externalMapView = useMemo(
    () =>
      externalRouteMapView(
        route,
        ROUTE_MAP_WIDTH,
        ROUTE_MAP_HEIGHT,
        zoomOffset,
        panOffset,
      ),
    [route, zoomOffset, panOffset],
  );
  const canLoadExternalMap = route.status === "available" && !!externalMapView;
  const externalMapActive = canLoadExternalMap && !mapBackgroundFailed;
  const localSvgPoints = routeMapCoordinates(
    route,
    ROUTE_MAP_WIDTH,
    ROUTE_MAP_HEIGHT,
    zoomOffset,
    panOffset,
  );
  const svgPoints = externalMapActive ? externalMapView.points : localSvgPoints;
  const first = svgPoints[0];
  const last = svgPoints[svgPoints.length - 1];
  const canPanRoute = route.status === "available" && svgPoints.length >= 2;
  const panIsCentered = routeMapPanIsCentered(panOffset);

  const [previousRoute, setPreviousRoute] = useState(route);
  if (previousRoute !== route) {
    setPreviousRoute(route);
    setIsDragging(false);
    setMapBackgroundFailed(false);
    setZoomOffset(0);
    setPanOffset(ROUTE_MAP_ZERO_PAN);
  }

  useEffect(() => {
    dragStateRef.current = null;
  }, [route]);

  useEffect(() => {
    const routeMapSvg = routeMapSvgRef.current;
    return () => {
      const dragState = dragStateRef.current;
      if (dragState && routeMapSvg?.hasPointerCapture?.(dragState.pointerId)) {
        routeMapSvg.releasePointerCapture(dragState.pointerId);
      }
      dragStateRef.current = null;
    };
  }, []);

  const resetRouteMapView = () => {
    dragStateRef.current = null;
    setIsDragging(false);
    setZoomOffset(0);
    setPanOffset(ROUTE_MAP_ZERO_PAN);
  };

  const endRouteMapDrag = (pointerId?: number) => {
    const dragState = dragStateRef.current;
    if (
      !dragState ||
      (pointerId !== undefined && dragState.pointerId !== pointerId)
    ) {
      return;
    }
    const routeMapSvg = routeMapSvgRef.current;
    if (routeMapSvg?.hasPointerCapture?.(dragState.pointerId)) {
      routeMapSvg.releasePointerCapture(dragState.pointerId);
    }
    dragStateRef.current = null;
    setIsDragging(false);
  };

  const handleRouteMapPointerDown = (
    event: ReactPointerEvent<SVGSVGElement>,
  ) => {
    if (!canPanRoute || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragStateRef.current = {
      pointerId: event.pointerId,
      lastClientX: event.clientX,
      lastClientY: event.clientY,
    };
    setIsDragging(true);
  };

  const handleRouteMapPointerMove = (
    event: ReactPointerEvent<SVGSVGElement>,
  ) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    event.preventDefault();
    const deltaX = event.clientX - dragState.lastClientX;
    const deltaY = event.clientY - dragState.lastClientY;
    if (deltaX === 0 && deltaY === 0) return;
    dragStateRef.current = {
      ...dragState,
      lastClientX: event.clientX,
      lastClientY: event.clientY,
    };
    setPanOffset((current) => ({
      x: current.x + deltaX,
      y: current.y + deltaY,
    }));
  };

  return (
    <section className="route-map-card" aria-label="Local GPS route map">
      <div className="route-map-card-header">
        <h2>Route map</h2>
        {route.status === "available" && svgPoints.length >= 2 ? (
          <div
            className="route-map-controls"
            aria-label="Route map zoom controls"
          >
            <button
              type="button"
              onClick={() =>
                setZoomOffset((current) =>
                  Math.max(ROUTE_MAP_MIN_ZOOM_OFFSET, current - 1),
                )
              }
              disabled={zoomOffset <= ROUTE_MAP_MIN_ZOOM_OFFSET}
              aria-label="Zoom out route map"
            >
              −
            </button>
            <button
              type="button"
              onClick={resetRouteMapView}
              disabled={zoomOffset === 0 && panIsCentered}
              aria-label="Reset route map view"
            >
              Fit
            </button>
            <button
              type="button"
              onClick={() =>
                setZoomOffset((current) =>
                  Math.min(ROUTE_MAP_MAX_ZOOM_OFFSET, current + 1),
                )
              }
              disabled={zoomOffset >= ROUTE_MAP_MAX_ZOOM_OFFSET}
              aria-label="Zoom in route map"
            >
              +
            </button>
          </div>
        ) : null}
      </div>
      {route.status === "available" && svgPoints.length >= 2 ? (
        <>
          <svg
            ref={routeMapSvgRef}
            className={[
              "route-map-svg",
              externalMapActive ? "external-map" : "",
              canPanRoute ? "is-pannable" : "",
              isDragging ? "is-dragging" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            viewBox={`0 0 ${ROUTE_MAP_WIDTH} ${ROUTE_MAP_HEIGHT}`}
            data-zoom-offset={zoomOffset}
            data-pan-x={Math.round(panOffset.x)}
            data-pan-y={Math.round(panOffset.y)}
            data-dragging={isDragging ? "true" : "false"}
            onPointerDown={handleRouteMapPointerDown}
            onPointerMove={handleRouteMapPointerMove}
            onPointerUp={(event) => endRouteMapDrag(event.pointerId)}
            onPointerCancel={(event) => endRouteMapDrag(event.pointerId)}
            onLostPointerCapture={(event) => endRouteMapDrag(event.pointerId)}
            role="img"
            aria-label="GPS route map with OpenTopoMap background and start and finish markers"
          >
            <defs>
              <linearGradient id="route-map-bg" x1="0" x2="1" y1="0" y2="1">
                <stop offset="0%" stopColor="rgba(73, 214, 200, 0.16)" />
                <stop offset="100%" stopColor="rgba(90, 180, 255, 0.08)" />
              </linearGradient>
              <filter
                id="route-map-shadow"
                x="-20%"
                y="-20%"
                width="140%"
                height="140%"
              >
                <feDropShadow
                  dx="0"
                  dy="5"
                  stdDeviation="4"
                  floodColor="rgba(0, 0, 0, 0.42)"
                />
              </filter>
            </defs>
            <rect
              className={
                externalMapActive
                  ? "route-map-ground external-map"
                  : "route-map-ground"
              }
              x="0"
              y="0"
              width={ROUTE_MAP_WIDTH}
              height={ROUTE_MAP_HEIGHT}
              rx="16"
            />
            {externalMapActive ? (
              <g className="route-map-tiles" aria-hidden="true">
                {externalMapView.tiles.map((tile) => (
                  <image
                    key={tile.key}
                    href={tile.href}
                    x={tile.x}
                    y={tile.y}
                    width={ROUTE_MAP_TILE_SIZE}
                    height={ROUTE_MAP_TILE_SIZE}
                    preserveAspectRatio="xMidYMid slice"
                    onError={() => setMapBackgroundFailed(true)}
                  >
                    <title>OpenTopoMap map tile unavailable</title>
                  </image>
                ))}
              </g>
            ) : null}
            <g className="route-map-route-halo" aria-hidden="true">
              {svgPoints.slice(1).map((point, index) => {
                const previous = svgPoints[index];
                return (
                  <line
                    className="route-map-segment-halo"
                    key={`halo-${point.elapsedSec}-${index}`}
                    x1={previous.x}
                    x2={point.x}
                    y1={previous.y}
                    y2={point.y}
                  />
                );
              })}
            </g>
            <g className="route-map-route-line">
              {svgPoints.slice(1).map((point, index) => {
                const previous = svgPoints[index];
                return (
                  <line
                    className={routeSegmentClass(point)}
                    key={`${point.elapsedSec}-${index}`}
                    x1={previous.x}
                    x2={point.x}
                    y1={previous.y}
                    y2={point.y}
                  />
                );
              })}
            </g>
            {first ? (
              <g className="route-map-marker start">
                <circle cx={first.x} cy={first.y} r="4.5" />
                <text x={first.x + 7} y={first.y - 7}>
                  Start
                </text>
              </g>
            ) : null}
            {last ? (
              <g className="route-map-marker finish">
                <circle cx={last.x} cy={last.y} r="5.5" />
                <text x={last.x + 7} y={last.y + 15}>
                  Finish
                </text>
              </g>
            ) : null}
          </svg>
          <p className="route-map-attribution">
            {externalMapActive
              ? "Map data © OpenStreetMap contributors; map style © OpenTopoMap (CC-BY-SA). Tiles may reveal route area and client IP to OpenTopoMap."
              : mapBackgroundFailed
                ? "OpenTopoMap tiles failed; offline route shown."
                : "Offline route shown."}
          </p>
        </>
      ) : (
        <div className="route-map-empty-state">
          <strong>Route map unavailable</strong>
          <span>{route.message}</span>
        </div>
      )}
      <p className="visually-hidden">
        Route status {route.status}; source points {route.sourcePointCount};
        plotted points {route.pointCount}; maximum plotted points{" "}
        {route.maxPoints}.
      </p>
    </section>
  );
}

export function HeartRateZoneTimeChart({
  summary,
}: {
  summary: ActivityDashboardPayload["heartRateZones"];
}) {
  const unavailableMessages = {
    missing_zones: "HR-zone boundaries unavailable.",
    missing_heart_rate: "No heart-rate data for this activity.",
    insufficient_stream:
      "Not enough heart-rate samples to show zone durations.",
    missing_activity_zone_times: "HR-zone durations unavailable.",
  };
  const denominator = Math.max(1, summary.classifiedSeconds);
  const orderedBuckets = [...summary.buckets].sort(
    (left, right) => right.zone - left.zone,
  );
  return (
    <section className="hr-zone-card" aria-label="Time in HR zones">
      <div className="hr-zone-card-header">
        <div>
          <h2>Time in HR zones</h2>
        </div>
      </div>
      {summary.status === "available" ? (
        <>
          <div className="hr-zone-bars">
            {orderedBuckets.map((bucket) => {
              const widthPercent = (bucket.seconds / denominator) * 100;
              return (
                <div className="hr-zone-row" key={bucket.zone}>
                  <div>
                    <strong>{bucket.label ?? `Zone ${bucket.zone}`}</strong>
                    <span>
                      {bucket.lowerBpm}–{bucket.upperBpm ?? "max"} bpm
                    </span>
                  </div>
                  <div
                    className={`hr-zone-bar hr-zone-bar-zone-${bucket.zone}`}
                    aria-hidden="true"
                  >
                    <span style={{ width: `${widthPercent}%` }} />
                  </div>
                  <p>
                    {durationDetailLabel(bucket.seconds)} · {bucket.percent}%
                  </p>
                </div>
              );
            })}
          </div>
          {summary.unclassifiedSeconds > 0 ? (
            <p className="activity-dashboard-status">
              Outside zone ranges:{" "}
              {durationDetailLabel(summary.unclassifiedSeconds)}.
            </p>
          ) : null}
          {summary.noHeartRateSeconds > 0 ? (
            <p className="activity-dashboard-status">
              Missing heart-rate data:{" "}
              {durationDetailLabel(summary.noHeartRateSeconds)}.
            </p>
          ) : null}
          {summary.sourceTotalSeconds !== null &&
          summary.activityDurationSec !== null &&
          summary.sourceTotalSeconds !== summary.activityDurationSec ? (
            <p className="activity-dashboard-status">
              Recorded HR time differs from activity duration (
              {durationDetailLabel(summary.sourceTotalSeconds)} vs{" "}
              {durationDetailLabel(summary.activityDurationSec)}).
            </p>
          ) : null}
        </>
      ) : (
        <div className="activity-chart empty-state">
          <strong>Time in HR zones unavailable</strong>
          <span>{unavailableMessages[summary.status]}</span>
        </div>
      )}
    </section>
  );
}
