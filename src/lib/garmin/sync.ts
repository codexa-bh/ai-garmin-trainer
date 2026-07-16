import type { NormalizedActivity, NormalizedDailyHealth } from "./types";

export type FitnessStore = {
  upsertActivities(activities: NormalizedActivity[]): Promise<number>;
  upsertDailyHealth(days: NormalizedDailyHealth[]): Promise<number>;
  saveCheckpoint(key: string, value: string): Promise<void>;
  getCheckpoint(key: string): Promise<string | null>;
};

export async function syncActivitiesToExhaustion(
  store: FitnessStore,
  fetchPage: (offset: number) => Promise<NormalizedActivity[]>,
): Promise<number> {
  let offset = Number((await store.getCheckpoint("activity_offset")) ?? 0);
  let total = 0;
  while (true) {
    const page = await fetchPage(offset);
    if (page.length === 0) break;
    total += await store.upsertActivities(page);
    offset += page.length;
    await store.saveCheckpoint("activity_offset", String(offset));
  }
  return total;
}

export async function syncDailyHealthRange(
  store: FitnessStore,
  startDate: string,
  endDate: string,
  fetchDay: (date: string) => Promise<NormalizedDailyHealth>,
): Promise<number> {
  const start = new Date(
    `${(await store.getCheckpoint("health_date")) ?? startDate}T00:00:00Z`,
  );
  const end = new Date(`${endDate}T00:00:00Z`);
  let written = 0;
  for (
    let cursor = start;
    cursor <= end;
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  ) {
    const date = cursor.toISOString().slice(0, 10);
    written += await store.upsertDailyHealth([await fetchDay(date)]);
    await store.saveCheckpoint("health_date", date);
  }
  return written;
}
