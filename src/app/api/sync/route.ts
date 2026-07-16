import { NextResponse } from "next/server";
import { requireSessionEmail } from "@/lib/auth/session";
import { verifyConnectorToken } from "@/lib/garmin/client";

export async function GET() {
  await requireSessionEmail();
  const verification = await verifyConnectorToken();
  return NextResponse.json(verification, {
    status: verification.ok ? 200 : 409,
  });
}

export async function POST() {
  await requireSessionEmail();
  const verification = await verifyConnectorToken();
  if (!verification.ok) {
    return NextResponse.json(
      {
        status: "blocked",
        detail: verification.detail,
      },
      { status: 409 },
    );
  }
  return NextResponse.json(
    {
      status: "not_implemented",
      detail:
        "Garmin auth state is present, but real MCP import is not wired yet. Next coding step is to call the pinned stdio connector, paginate activities, backfill daily health, and upsert normalized records.",
    },
    { status: 501 },
  );
}
