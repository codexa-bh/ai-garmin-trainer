import { NextResponse } from "next/server";
import { importSummary } from "@/lib/local-data/composition";
import { isGarminSyncRunning } from "@/lib/garmin/composition";

export async function GET() {
  return NextResponse.json({
    ...importSummary(),
    syncActive: isGarminSyncRunning(),
  });
}
