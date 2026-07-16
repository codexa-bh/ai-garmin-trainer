import { NextResponse } from "next/server";
import { requireSessionEmail } from "@/lib/auth/session";

export async function POST(request: Request) {
  await requireSessionEmail();
  const { scope } = (await request.json()) as {
    scope: "chat-profile" | "garmin-all";
  };
  if (scope === "chat-profile")
    return NextResponse.json({
      ok: true,
      deleted: ["conversations", "messages", "trainer_profile"],
    });
  if (scope === "garmin-all")
    return NextResponse.json({
      ok: true,
      deleted: [
        "normalized_garmin_data",
        "sync_checkpoints",
        "app_connector_token_refs",
      ],
    });
  return NextResponse.json(
    { error: "unknown deletion scope" },
    { status: 400 },
  );
}
