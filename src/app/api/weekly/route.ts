import { NextResponse } from "next/server";
import { weekly } from "@/lib/weekly/composition";
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
