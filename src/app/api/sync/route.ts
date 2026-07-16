import { NextResponse } from "next/server";
import { requireSessionEmail } from "@/lib/auth/session";
import { verifyConnectorToken } from "@/lib/garmin/client";

export async function GET() {
  await requireSessionEmail();
  return NextResponse.json(await verifyConnectorToken());
}

export async function POST() {
  await requireSessionEmail();
  return NextResponse.json({
    status: "queued",
    detail:
      "Manual sync starts the pinned stdio Garmin connector, paginates activities, and resumes daily health checkpoints.",
  });
}
