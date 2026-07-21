import { NextResponse } from "next/server";
import {
  clearChatAndProfile,
  clearGarminData,
  dataCounts,
} from "@/lib/db/repository";

export async function POST(request: Request) {
  const { scope } = (await request.json()) as {
    scope: "chat-profile" | "garmin-all";
  };
  if (scope === "chat-profile") {
    return NextResponse.json({
      ok: true,
      deleted: clearChatAndProfile(),
      counts: dataCounts(),
      detail:
        "Cleared local conversations, messages, and trainer profile memory. Normalized Garmin data was preserved.",
    });
  }
  if (scope === "garmin-all") {
    const deleted = clearGarminData();
    return NextResponse.json({
      ok: true,
      deleted,
      counts: dataCounts(),
      detail:
        "Deleted normalized Garmin data, sync runs, and checkpoints managed by the app. External garmin-mcp-auth tokens were not deleted because the app did not create or own them.",
    });
  }
  return NextResponse.json(
    { error: "unknown deletion scope" },
    { status: 400 },
  );
}
