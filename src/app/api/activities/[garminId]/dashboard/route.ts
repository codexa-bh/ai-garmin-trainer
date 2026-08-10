import { NextResponse } from "next/server";
import { getActivityDashboardDetail } from "@/lib/db/repository";

type RouteContext = {
  params: Promise<{ garminId: string }> | { garminId: string };
};

async function paramsFrom(context: RouteContext) {
  return await context.params;
}

function activityLabel(activity: {
  name: string | null;
  sport: string;
  startedAt: Date;
}) {
  const date = activity.startedAt.toISOString().slice(0, 10);
  return activity.name?.trim() || `${activity.sport} on ${date}`;
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const { garminId: rawGarminId } = await paramsFrom(context);
    const garminId = String(rawGarminId ?? "").trim();
    if (!garminId) {
      return NextResponse.json(
        { error: "garminId is required" },
        { status: 400 },
      );
    }
    const url = new URL(request.url);
    const dashboard = getActivityDashboardDetail(
      garminId,
      Number(url.searchParams.get("maxPoints") ?? 240),
    );
    if (!dashboard) {
      return NextResponse.json(
        { error: `No imported activity with Garmin ID ${garminId}` },
        { status: 404 },
      );
    }
    return NextResponse.json({
      activity: {
        garminId: dashboard.activity.garminId,
        name: dashboard.activity.name,
        label: activityLabel(dashboard.activity),
        sport: dashboard.activity.sport,
        startedAt: dashboard.activity.startedAt.toISOString(),
        date: dashboard.activity.startedAt.toISOString().slice(0, 10),
        durationSec: dashboard.activity.durationSec,
        distanceMeters: dashboard.activity.distanceMeters,
        calories: dashboard.activity.calories,
        avgHeartRate: dashboard.activity.avgHeartRate,
        maxHeartRate: dashboard.activity.maxHeartRate,
        steps: dashboard.activity.steps,
        elevationGainMeters: dashboard.activity.elevationGainMeters,
        elevationLossMeters: dashboard.activity.elevationLossMeters,
        trainingEffect: dashboard.activity.trainingEffect,
      },
      detail: dashboard.detail,
      charts: dashboard.charts,
      laps: dashboard.laps.map((lap) => ({
        lapNumber: lap.lapNumber,
        durationSec: lap.durationSec,
        distanceMeters: lap.distanceMeters,
        avgHeartRate: lap.avgHeartRate,
        maxHeartRate: lap.maxHeartRate,
        elevationGainMeters: lap.elevationGainMeters,
        elevationLossMeters: lap.elevationLossMeters,
        avgPowerWatts: lap.avgPowerWatts,
        normalizedPowerWatts: lap.normalizedPowerWatts,
      })),
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
