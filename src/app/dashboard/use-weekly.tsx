import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { WeeklyRecord, WeeklySummary } from "@/lib/weekly/contracts";
import {
  progressPeriodRange,
  weeklyCalendar,
  type ProgressPeriod,
} from "@/lib/weekly/calendar";
import type { KpiRead, KpiProgress } from "@/lib/weekly/kpi-contracts";
import { readJsonResponse } from "./transport";

type Mode = "current" | "upcoming" | "general" | "history" | "progress";
export function useWeeklyFeature() {
  const [mode, setMode] = useState<Mode>("current");
  const [record, setRecord] = useState<WeeklyRecord | null>(null);
  const [week, setWeek] = useState("");
  const [kpis, setKpis] = useState<KpiRead | null>(null);
  const [progress, setProgress] = useState<KpiProgress | null>(null);
  const [progressPeriod, setProgressPeriod] = useState<ProgressPeriod>("12w");
  const [progressRange, setProgressRange] = useState<{
    from: string;
    through: string;
  } | null>(null);
  const [basis, setBasis] = useState("");
  const [items, setItems] = useState<WeeklySummary[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "loaded" | "error">(
    "idle",
  );
  const generation = useRef(0);
  const calendarBasis = useRef("");
  async function load(
    selected = mode,
    selectedWeek?: string,
    cursor?: string,
    preserveRange = false,
    setId?: string,
    period = progressPeriod,
  ) {
    const request = ++generation.current;
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const calendar = weeklyCalendar(new Date(), timeZone);
    calendarBasis.current = `${calendar.weekStart}/${timeZone}`;
    setMode(selected);
    setBasis(timeZone);
    const target =
      selectedWeek ??
      (selected === "upcoming" ? calendar.upcoming : calendar.weekStart);
    setWeek(selected === "history" ? (selectedWeek ?? "") : target);
    if (selected === "general") {
      setState("idle");
      return;
    }
    setState("loading");
    setRecord(null);
    try {
      const query = new URLSearchParams({ timeZone });
      if (selected === "progress") {
        const dates = progressPeriodRange(period, calendar.weekStart);
        query.set("view", "progress");
        query.set("from", dates.from);
        query.set("through", dates.through);
        const data = await readJsonResponse<KpiProgress>(
          await fetch(`/api/weekly?${query}`),
        );
        if (request !== generation.current) return;
        setProgressRange(dates);
        setProgress(data);
      } else if (selected === "history" && !selectedWeek) {
        const oldest = preserveRange ? items.at(-1)?.weekStart : undefined;
        let before = cursor ?? calendar.weekStart;
        let pageNext: string | null;
        const refreshed: WeeklySummary[] = [];
        do {
          query.set("before", before);
          const page = await readJsonResponse<{
            items: WeeklySummary[];
            next: string | null;
          }>(await fetch(`/api/weekly?${query}`));
          if (request !== generation.current) return;
          refreshed.push(...page.items);
          pageNext = page.next;
          if (pageNext && pageNext >= before)
            throw new Error("Invalid history cursor");
          before = pageNext ?? before;
        } while (pageNext && oldest && pageNext > oldest);
        const merged = cursor ? [...items, ...refreshed] : refreshed;
        setItems([
          ...new Map(merged.map((item) => [item.weekStart, item])).values(),
        ]);
        setNext(pageNext);
      } else {
        query.set("weekStart", target);
        if (setId) query.set("setId", setId);
        let detail = await readJsonResponse<{
          record: WeeklyRecord | null;
          kpis?: KpiRead;
        }>(await fetch(`/api/weekly?${query}`));
        if (request !== generation.current) return;
        if (
          detail.kpis?.complete === false &&
          detail.kpis.latestPlanSetId &&
          !setId
        ) {
          query.set("setId", detail.kpis.latestPlanSetId);
          detail = await readJsonResponse<typeof detail>(
            await fetch(`/api/weekly?${query}`),
          );
          if (request !== generation.current) return;
        }
        setRecord(detail.record);
        setKpis(detail.kpis ?? null);
        setWeek(target);
      }
      setState("loaded");
    } catch {
      if (request === generation.current) setState("error");
    }
  }
  function refresh() {
    return load(
      mode,
      mode === "history" && week ? week : undefined,
      undefined,
      true,
    );
  }
  const rollover = useEffectEvent(() => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const calendar = weeklyCalendar(new Date(), zone);
    if (
      calendarBasis.current &&
      calendarBasis.current !== `${calendar.weekStart}/${zone}`
    ) {
      const work = mode === "upcoming" ? load("current") : refresh();
      work.catch(() => setState("error"));
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
  return {
    mode,
    record,
    week,
    basis,
    items,
    next,
    state,
    load,
    refresh,
    kpis,
    progress,
    progressRange,
    progressPeriod,
    loadSet: (setId: string) => load(mode, week, undefined, false, setId),
    loadProgress: (period: ProgressPeriod) => {
      setProgressPeriod(period);
      return load("progress", undefined, undefined, false, undefined, period);
    },
  };
}
