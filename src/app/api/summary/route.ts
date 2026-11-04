import { NextResponse } from "next/server";
import { importSummary } from "@/lib/local-data/composition";
import { isGarminSyncRunning, syncSummary } from "@/lib/garmin/composition";

export async function GET() {
  return NextResponse.json({
    ...importSummary(),
    ...syncSummary(),
    syncActive: isGarminSyncRunning(),
  });
}
