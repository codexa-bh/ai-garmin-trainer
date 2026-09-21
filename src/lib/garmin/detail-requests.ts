import type {
  ActivityDetailAttempt,
  ActivityDetailAvailability,
  ActivityDetailCoverage,
} from "./detail-types";
import type {
  DetailedBackfillResult,
  DetailRefreshOptions,
} from "./import-contracts";

type RecentActivity = {
  garminId: string;
  name: string | null;
  sport: string;
  startedAt: Date;
};

type DetailRequestPorts = {
  activityDetailCoverage(): ActivityDetailCoverage;
  listActivityDetailAvailability(limit: number): ActivityDetailAvailability[];
  listRecentActivities(limit: number): RecentActivity[];
  activityExists(garminId: string): boolean;
  getActivityDetailAttempt(garminId: string): ActivityDetailAttempt | null;
  backfillActivityDetail(
    garminId: string,
    options: DetailRefreshOptions,
  ): Promise<DetailedBackfillResult>;
};

export function createActivityDetailRequests(ports: DetailRequestPorts) {
  return {
    status() {
      return {
        coverage: ports.activityDetailCoverage(),
        availability: ports.listActivityDetailAvailability(50),
        recentActivities: ports.listRecentActivities(12),
      };
    },
    async refresh(garminId: string, options: DetailRefreshOptions) {
      if (!ports.activityExists(garminId)) return null;
      const result = await ports.backfillActivityDetail(garminId, options);
      return {
        ...result,
        attempt: ports.getActivityDetailAttempt(garminId),
        coverage: ports.activityDetailCoverage(),
      };
    },
  };
}
