import { NextResponse } from "next/server";
import { requireSessionEmail } from "@/lib/auth/session";
import {
  activityDetailCoverage,
  getActivityByGarminId,
  getActivityDetailAttempt,
  listActivityDetailAvailability,
  listRecentActivities,
} from "@/lib/db/repository";
import { backfillActivityDetail } from "@/lib/garmin/importer";

export async function GET() {
  try {
    await requireSessionEmail();
    return NextResponse.json({
      coverage: activityDetailCoverage(),
      availability: listActivityDetailAvailability(50),
      recentActivities: listRecentActivities(12).map((activity) => ({
        garminId: activity.garminId,
        name: activity.name,
        sport: activity.sport,
        date: activity.startedAt.toISOString().slice(0, 10),
      })),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "detail status failed",
      },
      { status: 401 },
    );
  }
}

export async function POST(request: Request) {
  try {
    await requireSessionEmail();
    const body = (await request.json()) as {
      garminId?: string;
      force?: boolean;
    };
    const garminId = String(body.garminId ?? "").trim();
    if (!garminId) {
      return NextResponse.json(
        { error: "garminId is required for targeted detailed backfill" },
        { status: 400 },
      );
    }
    const activity = getActivityByGarminId(garminId);
    if (!activity) {
      return NextResponse.json(
        { error: `No imported activity with Garmin ID ${garminId}` },
        { status: 404 },
      );
    }
    const result = await backfillActivityDetail(garminId, {
      force: Boolean(body.force),
    });
    return NextResponse.json(
      {
        ...result,
        attempt: getActivityDetailAttempt(garminId),
        coverage: activityDetailCoverage(),
      },
      {
        status: result.status === "failed" ? 502 : 200,
      },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "detail backfill failed",
      },
      { status: 401 },
    );
  }
}
