import { NextResponse } from "next/server";
import { getActivityDashboardDetail } from "@/lib/local-data/composition";

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

function finiteNonNegative(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function lapAverageSpeedMps(lap: {
  avgSpeedMps: number | null;
  distanceMeters: number | null;
  durationSec: number | null;
}) {
  if (finiteNonNegative(lap.avgSpeedMps)) return lap.avgSpeedMps;
  if (!finiteNonNegative(lap.distanceMeters)) return null;
  if (
    typeof lap.durationSec !== "number" ||
    !Number.isFinite(lap.durationSec) ||
    lap.durationSec <= 0
  ) {
    return null;
  }
  return lap.distanceMeters / lap.durationSec;
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
        anaerobicTrainingEffect:
          dashboard.activity.anaerobicTrainingEffect ?? null,
        trainingEffectLabel: dashboard.activity.trainingEffectLabel ?? null,
        trainingLoad: dashboard.activity.trainingLoad ?? null,
        moderateIntensityMinutes:
          dashboard.activity.moderateIntensityMinutes ?? null,
        vigorousIntensityMinutes:
          dashboard.activity.vigorousIntensityMinutes ?? null,
        totalIntensityMinutes: dashboard.activity.totalIntensityMinutes ?? null,
        effortSource: "garmin_mcp_normalized",
      },
      terrainSections: dashboard.terrainSections,
      detail: dashboard.detail,
      charts: dashboard.charts,
      route: dashboard.route,
      heartRateZones: dashboard.heartRateZones,
      laps: dashboard.laps.map((lap) => ({
        lapNumber: lap.lapNumber,
        durationSec: lap.durationSec,
        distanceMeters: lap.distanceMeters,
        avgSpeedMps: lapAverageSpeedMps(lap),
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
