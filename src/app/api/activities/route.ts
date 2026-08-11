import { NextResponse } from "next/server";
import { listActivitiesForDashboard } from "@/lib/db/repository";

function activityLabel(activity: {
  name: string | null;
  sport: string;
  startedAt: Date;
}) {
  const date = activity.startedAt.toISOString().slice(0, 10);
  return activity.name?.trim() || `${activity.sport} on ${date}`;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const page = listActivitiesForDashboard({
      query: url.searchParams.get("q"),
      limit: Number(url.searchParams.get("limit") ?? 100),
      offset: Number(url.searchParams.get("offset") ?? 0),
    });
    return NextResponse.json({
      activities: page.activities.map((activity) => ({
        garminId: activity.garminId,
        name: activity.name,
        label: activityLabel(activity),
        sport: activity.sport,
        date: activity.startedAt.toISOString().slice(0, 10),
        startedAt: activity.startedAt.toISOString(),
        durationSec: activity.durationSec,
        distanceMeters: activity.distanceMeters,
        elevationGainMeters: activity.elevationGainMeters,
        avgHeartRate: activity.avgHeartRate,
        detailStatus: activity.detailStatus,
      })),
      nextOffset: page.nextOffset,
      totalApprox: page.totalApprox,
      limit: page.limit,
      offset: page.offset,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "activity search failed",
      },
      { status: 500 },
    );
  }
}
