import { NextResponse } from "next/server";
import { requireSessionEmail } from "@/lib/auth/session";
import { verifyConnectorToken } from "@/lib/garmin/client";
import { runGarminSync } from "@/lib/garmin/importer";

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
  const result = await runGarminSync();
  return NextResponse.json(result, {
    status: result.status === "completed" ? 200 : 502,
  });
}
