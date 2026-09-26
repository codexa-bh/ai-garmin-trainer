import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { WeeklyRecord, WeeklySummary } from "@/lib/weekly/contracts";
import { weeklyCalendar } from "@/lib/weekly/calendar";
import { readJsonResponse } from "./transport";

type Mode = "current" | "upcoming" | "general" | "history";
export function useWeeklyFeature() {
  const [mode, setMode] = useState<Mode>("current");
  const [record, setRecord] = useState<WeeklyRecord | null>(null);
  const [week, setWeek] = useState("");
  const [basis, setBasis] = useState("");
  const [items, setItems] = useState<WeeklySummary[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "loaded" | "error">(
    "idle",
  );
  const generation = useRef(0);
  const calendarBasis = useRef("");
  async function load(selected = mode, selectedWeek?: string, cursor?: string) {
    const request = ++generation.current;
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const calendar = weeklyCalendar(new Date(), timeZone);
    calendarBasis.current = `${calendar.weekStart}/${timeZone}`;
    setMode(selected);
    setBasis(timeZone);
    if (selected === "general") {
      setState("idle");
      return;
    }
    setState("loading");
    setRecord(null);
    try {
      const query = new URLSearchParams({ timeZone });
      if (selected === "history" && !selectedWeek) {
        query.set("before", cursor ?? calendar.weekStart);
        const page = await readJsonResponse<{
          items: WeeklySummary[];
          next: string | null;
        }>(await fetch(`/api/weekly?${query}`));
        if (request !== generation.current) return;
        setItems(cursor ? [...items, ...page.items] : page.items);
        setNext(page.next);
        setWeek("");
      } else {
        const target =
          selectedWeek ??
          (selected === "upcoming" ? calendar.upcoming : calendar.weekStart);
        query.set("weekStart", target);
        const detail = await readJsonResponse<{ record: WeeklyRecord | null }>(
          await fetch(`/api/weekly?${query}`),
        );
        if (request !== generation.current) return;
        setRecord(detail.record);
        setWeek(target);
      }
      setState("loaded");
    } catch {
      if (request === generation.current) setState("error");
    }
  }
  const rollover = useEffectEvent(() => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const calendar = weeklyCalendar(new Date(), zone);
    if (
      calendarBasis.current &&
      calendarBasis.current !== `${calendar.weekStart}/${zone}`
    ) {
      load(mode === "upcoming" ? "current" : mode).catch(() =>
        setState("error"),
      );
    }
  });
  useEffect(() => {
    const check = () => rollover();
    window.addEventListener("focus", check);
    const timer = window.setInterval(check, 60000);
    return () => {
      window.removeEventListener("focus", check);
      window.clearInterval(timer);
    };
  }, []);
  return { mode, record, week, basis, items, next, state, load };
}
