import { NextResponse } from "next/server";
import { healthDashboard } from "@/lib/local-data/composition";
export { HEALTH_DASHBOARD_DAY_LIMIT } from "@/lib/local-data/application";

/**
 * Bounded read-only daily-health dashboard payload.
 *
 * Rows are returned newest-first from the existing normalized `daily_health`
 * table. The window is intentionally bounded: enough days for day browsing
 * and weekly/monthly rollup context, without unbounded dumps.
 */
export async function GET() {
  return NextResponse.json(healthDashboard());
}
