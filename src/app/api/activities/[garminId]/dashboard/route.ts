import { NextResponse } from "next/server";
import { getActivityDashboardDetail } from "@/lib/local-data/composition";
import {
  dashboardActivity,
  dashboardLap,
} from "@/lib/local-data/dashboard-projection";

type RouteContext = {
  params: Promise<{ garminId: string }> | { garminId: string };
};

async function paramsFrom(context: RouteContext) {
  return await context.params;
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { garminId: rawGarminId } = await paramsFrom(context);
    const garminId = String(rawGarminId ?? "").trim();
    if (!garminId) {
      return NextResponse.json(
        { error: "garminId is required" },
        { status: 400 },
      );
    }
    const dashboard = getActivityDashboardDetail(garminId);
    if (!dashboard) {
      return NextResponse.json(
        { error: `No imported activity with Garmin ID ${garminId}` },
        { status: 404 },
      );
    }
    return NextResponse.json({
      activity: dashboardActivity(dashboard.activity),
      terrainSections: dashboard.terrainSections,
      detail: dashboard.detail,
      charts: dashboard.charts,
      route: dashboard.route,
      heartRateZones: dashboard.heartRateZones,
      laps: dashboard.laps.map(dashboardLap),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "activity dashboard failed",
      },
      { status: 500 },
    );
  }
}
