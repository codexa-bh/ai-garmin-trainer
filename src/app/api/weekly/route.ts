import { NextResponse } from "next/server";
import { weekly } from "@/lib/weekly/composition";
import {
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
    const before = query.get("before");
    if (before) return NextResponse.json(weekly.history(before));
    const weekStart = query.get("weekStart") ?? calendar.weekStart;
    const detail = weekly.read(weekStart);
    return NextResponse.json({
      ...detail,
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
