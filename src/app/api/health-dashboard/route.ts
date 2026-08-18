import { NextResponse } from "next/server";
import { listRecentDailyHealth } from "@/lib/db/repository";

/**
 * Bounded read-only daily-health dashboard payload.
 *
 * Rows are returned newest-first from the existing normalized `daily_health`
 * table. The window is intentionally bounded: enough days for day browsing
 * and weekly/monthly rollup context, without unbounded dumps.
 */
export const HEALTH_DASHBOARD_DAY_LIMIT = 366;

export async function GET() {
  const days = listRecentDailyHealth(HEALTH_DASHBOARD_DAY_LIMIT);
  return NextResponse.json({
    days,
    latestDate: days.length > 0 ? days[0].date : null,
  });
}
