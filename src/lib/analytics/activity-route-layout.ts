import type { ActivityDashboardRoute } from "./activity-dashboard-calculations";

/** Existing offline map projection, shared by interactive and finite image views. */
export function offlineRouteCoordinates(
  route: ActivityDashboardRoute,
  width: number,
  height: number,
  zoomOffset: number,
  panOffset: { x: number; y: number },
) {
  if (!route.bounds) return [];
  const lonSpan = route.bounds.maxLon - route.bounds.minLon || 0.000001;
  const latSpan = route.bounds.maxLat - route.bounds.minLat || 0.000001;
  const scale = 2 ** zoomOffset;
  const centerX = width / 2;
  const centerY = height / 2;
  return route.points.map((point) => {
    const fittedX =
      14 + ((point.lon - route.bounds!.minLon) / lonSpan) * (width - 28);
    const fittedY =
      14 + (1 - (point.lat - route.bounds!.minLat) / latSpan) * (height - 28);
    return {
      ...point,
      x: centerX + (fittedX - centerX) * scale + panOffset.x,
      y: centerY + (fittedY - centerY) * scale + panOffset.y,
    };
  });
}
