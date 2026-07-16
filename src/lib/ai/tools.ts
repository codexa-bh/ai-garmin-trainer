import { tool } from "ai";
import { z } from "zod";
import { analyzeStoredActivity } from "@/lib/analytics/activity";
import {
  getActivityDetailForAnalytics,
  listActivityDetailAvailability,
} from "@/lib/db/repository";

const garminIdSchema = z
  .string()
  .min(1)
  .max(64)
  .describe("Garmin activity ID already imported into the local SQLite store.");

export const trainerTools = {
  getActivityDetailAvailability: tool({
    description:
      "Return bounded local detail coverage for recently backfilled activities. Use before claiming stream/FIT availability.",
    inputSchema: z.object({
      limit: z.number().int().min(1).max(25).default(10),
    }),
    execute: async ({ limit }) => ({
      tool: "getActivityDetailAvailability",
      privacy:
        "Local SQLite availability metadata only; no Garmin credentials, raw FIT, or full stream data included.",
      availability: listActivityDetailAvailability(limit),
    }),
  }),
  analyzeActivity: tool({
    description:
      "Compute deterministic local analytics for one imported Garmin activity, including pace/speed, HR zones, climbs, laps, similar efforts, and recovery correlation when locally available.",
    inputSchema: z.object({ garminId: garminIdSchema }),
    execute: async ({ garminId }) => analyzeStoredActivity(garminId),
  }),
  getActivityDetailSlice: tool({
    description:
      "Return a bounded local slice of normalized stream points/laps for a single activity. Never returns more than the requested cap.",
    inputSchema: z.object({
      garminId: garminIdSchema,
      pointOffset: z.number().int().min(0).default(0),
      pointLimit: z.number().int().min(1).max(120).default(60),
    }),
    execute: async ({ garminId, pointOffset, pointLimit }) => {
      const detail = getActivityDetailForAnalytics(garminId);
      return {
        tool: "getActivityDetailSlice",
        privacy:
          "Bounded normalized local stream slice; no credentials, raw FIT bytes, or unrestricted history included.",
        garminId,
        availability: detail.availability,
        laps: detail.laps.slice(0, 20),
        points: detail.stream.slice(pointOffset, pointOffset + pointLimit),
        totalPoints: detail.stream.length,
        nextPointOffset:
          pointOffset + pointLimit < detail.stream.length
            ? pointOffset + pointLimit
            : null,
      };
    },
  }),
};
