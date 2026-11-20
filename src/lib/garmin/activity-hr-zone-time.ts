type ActivityHrZoneNumber = 1 | 2 | 3 | 4 | 5;

type NormalizedActivityHrZoneTimeBucket = {
  zone: ActivityHrZoneNumber;
  seconds: number;
  sourceLowerBpm: number | null;
};

export type NormalizedActivityHrZoneTime = {
  garminId: string;
  fetchedAt: Date;
  /** `garmin_mcp` rows stay readable history; official FIT/list rows are exact,
   * `garmin_official_estimate` is recomputed from sampled heart rate (approximate). */
  source:
    | "garmin_mcp"
    | "garmin_official_fit"
    | "garmin_official_activity"
    | "garmin_official_estimate";
  status: "available";
  sourceTotalSeconds: number;
  buckets: NormalizedActivityHrZoneTimeBucket[];
};
