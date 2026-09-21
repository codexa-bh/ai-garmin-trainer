import type { buildTrainerContext } from "@/lib/ai/context";
import type { RetrievedMemory } from "@/lib/memory/types";

type ContextInput = Parameters<typeof buildTrainerContext>[0];

export type ChatContextPorts = {
  dataCounts(): {
    activities: number;
    healthDays: number;
    detailCoverage: {
      terminal: number;
      total: number;
      available: number;
      partial: number;
      unsupported: number;
      pending: number;
      retryableFailures: number;
    };
  };
  listActivityDetailAvailability(limit: number): Array<{
    garminId: string;
    status: string;
    recordCount: number;
    lapCount: number;
    hasStreams: boolean;
    hasGps: boolean;
    hasHeartRate: boolean;
    hasElevation: boolean;
  }>;
  searchMemories(
    query: string,
    conversationId: string,
    limit: number,
  ): Promise<RetrievedMemory[]>;
  listRecentActivities(): ContextInput["activities"];
  listRecentDailyHealth(): ContextInput["health"];
  getTrainerProfile(): ContextInput["profile"];
  getGarminAthleteBaseline(): ContextInput["athleteBaseline"];
  getGarminBodyMetrics(): ContextInput["bodyMetrics"];
  trainingPlanStatus(): ContextInput["trainingPlan"];
  now(): Date;
};
