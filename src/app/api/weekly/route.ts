import { NextResponse } from "next/server";
import { kpiMeasurements, weekly } from "@/lib/weekly/composition";
import {
  PROGRESS_MAX_WEEKS,
  validTimeZone,
  weeklyCalendar,
  weekInterval,
} from "@/lib/weekly/calendar";

export function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  const timeZone =
    query.get("timeZone") ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (!validTimeZone(timeZone))
    return NextResponse.json({ error: "Invalid timezone" }, { status: 400 });
  try {
    const calendar = weeklyCalendar(new Date(), timeZone);
    if (query.get("view") === "progress")
      return NextResponse.json(
        weekly.progress(
          query.get("from") ?? calendar.weekStart,
          query.get("through") ?? calendar.weekStart,
          PROGRESS_MAX_WEEKS,
        ),
      );
    const before = query.get("before");
    if (before) return NextResponse.json(weekly.history(before));
    const weekStart = query.get("weekStart") ?? calendar.weekStart;
    const detail = weekly.read(weekStart);
    return NextResponse.json({
      ...detail,
      kpis: weekly.readKpis(weekStart, query.get("setId") ?? undefined),
      calendar,
      interval: weekInterval(weekStart, detail.record?.timeZone ?? timeZone),
    });
  } catch {
    return NextResponse.json(
      { error: "Weekly document unavailable; check the date and retry." },
      { status: 400 },
    );
  }
}

/** Explicit recomputation of current-week measured actuals only; GET stays a
 * saved read. Points and assessments are never changed. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    action?: unknown;
    timeZone?: unknown;
  } | null;
  if (body?.action !== "refresh-current-week" || !validTimeZone(body.timeZone))
    return NextResponse.json({ error: "Invalid refresh" }, { status: 400 });
  try {
    const result = await kpiMeasurements.refresh(body.timeZone);
    return NextResponse.json({
      weekStart: result.weekStart,
      status: result.status,
      failed: result.failed.length,
    });
  } catch {
    return NextResponse.json(
      { error: "Measurements could not be refreshed; saved values are kept." },
      { status: 503 },
    );
  }
}
