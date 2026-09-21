import { NextResponse } from "next/server";
import { activityDetailRequests } from "@/lib/garmin/composition";

export async function GET() {
  try {
    const status = activityDetailRequests.status();
    return NextResponse.json({
      ...status,
      recentActivities: status.recentActivities.map((activity) => ({
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
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
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
    const result = await activityDetailRequests.refresh(garminId, {
      force: Boolean(body.force),
    });
    if (!result) {
      return NextResponse.json(
        { error: `No imported activity with Garmin ID ${garminId}` },
        { status: 404 },
      );
    }
    return NextResponse.json(result, {
      status: result.status === "failed" ? 502 : 200,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "detail backfill failed",
      },
      { status: 500 },
    );
  }
}
