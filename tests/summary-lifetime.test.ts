import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  createSummarySchedule,
  notifySummaryActivity,
  stopSummaryLifetime,
} from "@/lib/memory/summary-lifetime";
const owner = process as typeof process & {
  __trainerSummaryLifetimeV1?: unknown;
};
beforeEach(() => {
  delete owner.__trainerSummaryLifetimeV1;
  vi.useFakeTimers();
});
afterEach(() => {
  stopSummaryLifetime();
  vi.clearAllTimers();
  vi.useRealTimers();
  delete owner.__trainerSummaryLifetimeV1;
});

it("wakes one small activity in two seconds without starvation from subsequent arrivals", async () => {
  const tick = vi.fn(async () => false);
  const schedule = createSummarySchedule(tick);
  await schedule.run();
  notifySummaryActivity();
  await vi.advanceTimersByTimeAsync(1000);
  notifySummaryActivity();
  await vi.advanceTimersByTimeAsync(1000);
  expect(tick).toHaveBeenCalledTimes(2);
  schedule.stop();
  notifySummaryActivity();
  await vi.advanceTimersByTimeAsync(60000);
  expect(tick).toHaveBeenCalledTimes(2);
});

it("coalesces arrivals during a running job without overlap or an extra discovery cycle", async () => {
  let release!: (value: boolean) => void;
  const tick = vi
    .fn<() => Promise<boolean>>()
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    )
    .mockResolvedValue(false);
  const schedule = createSummarySchedule(tick);
  const active = schedule.run();
  for (let i = 0; i < 10; i++) notifySummaryActivity();
  await schedule.run();
  expect(tick).toHaveBeenCalledTimes(1);
  release(false);
  await active;
  await vi.advanceTimersByTimeAsync(2000);
  expect(tick).toHaveBeenCalledTimes(2);
  schedule.stop();
});

it("automatically drains finite actionable backlog and returns to the ordinary recovery cadence", async () => {
  const tick = vi
    .fn<() => Promise<boolean>>()
    .mockResolvedValueOnce(true)
    .mockResolvedValueOnce(true)
    .mockResolvedValue(false);
  const schedule = createSummarySchedule(tick);
  await schedule.run();
  await vi.advanceTimersByTimeAsync(4000);
  expect(tick).toHaveBeenCalledTimes(3);
  await vi.advanceTimersByTimeAsync(29999);
  expect(tick).toHaveBeenCalledTimes(3);
  await vi.advanceTimersByTimeAsync(1);
  expect(tick).toHaveBeenCalledTimes(4);
  schedule.stop();
});

it("uses recovery discovery, not a hot retry loop, on failed/unavailable or nonactionable ticks", async () => {
  const tick = vi.fn(async () => {
    throw new Error("bounded synthetic transport failure");
  });
  const schedule = createSummarySchedule(tick);
  await schedule.run();
  await vi.advanceTimersByTimeAsync(29999);
  expect(tick).toHaveBeenCalledTimes(1);
  schedule.stop();
  await vi.advanceTimersByTimeAsync(60000);
  expect(tick).toHaveBeenCalledTimes(1);
});
