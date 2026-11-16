import type { GarminReader, BaselineStore } from "./import-ports";
import type { GarminAthleteBaselineDto, GarminBodyMetricsDto } from "./types";
import {
  hasUsableGarminAthleteBaseline,
  mergeGarminAthleteBaseline,
  normalizeGarminAthleteBaseline,
} from "./athlete-normalize";
import {
  hasUsableGarminBodyMetrics,
  normalizeGarminBodyMetrics,
} from "./body-metrics-normalize";
import { compactError } from "./import-policy";

export function createBaselineImports(store: BaselineStore, clock: () => Date) {
  const {
    getGarminAthleteBaseline,
    getGarminBodyMetrics,
    recordGarminAthleteBaselineFailure,
    recordGarminBodyMetricsFailure,
    writeGarminAthleteBaselineRefresh,
    writeGarminBodyMetricsRefresh,
  } = store;
  async function fetchAndStoreAthleteBaseline(
    client: GarminReader,
    fitPayload?: unknown,
    refresh = { profile: true, ftp: true },
  ): Promise<GarminAthleteBaselineDto> {
    if (!refresh.profile && !refresh.ftp && !fitPayload)
      return getGarminAthleteBaseline();
    const attemptedAt = clock();
    const previous = getGarminAthleteBaseline();
    let profilePayload: unknown;
    let ftpPayload: unknown;
    const errors: string[] = [];
    try {
      if (refresh.profile) profilePayload = await client.profile();
    } catch (error) {
      errors.push(`profile: ${compactError(error)}`);
    }
    try {
      if (refresh.ftp) ftpPayload = await client.cyclingFtp();
    } catch (error) {
      errors.push(`cycling FTP: ${compactError(error)}`);
    }
    if (!profilePayload && !ftpPayload) {
      const preservedPrevious = Boolean(previous.fetchedAt);
      recordGarminAthleteBaselineFailure({
        attemptedAt,
        errorMessage:
          errors.join("; ") || "Garmin athlete baseline fetch failed",
        preservedPrevious,
      });
      return getGarminAthleteBaseline();
    }
    const snapshot = normalizeGarminAthleteBaseline({
      profilePayload,
      ftpPayload,
      fitPayload,
      fetchedAt: clock(),
    });
    const merged = mergeGarminAthleteBaseline(previous.values, snapshot);
    const hasUsableSnapshot = hasUsableGarminAthleteBaseline(merged);
    writeGarminAthleteBaselineRefresh({
      snapshot: hasUsableSnapshot ? merged : null,
      status: snapshot.availability,
      attemptedAt,
      errorMessage: errors.length ? errors.join("; ") : null,
      preservedPrevious: Boolean(previous.fetchedAt),
    });
    return getGarminAthleteBaseline();
  }

  function storeFitBaseline(fitPayload: unknown): boolean {
    const snapshot = normalizeGarminAthleteBaseline({
      fitPayload,
      fetchedAt: clock(),
    });
    if (!hasUsableGarminAthleteBaseline(snapshot)) return false;
    const previous = getGarminAthleteBaseline();
    const merged = mergeGarminAthleteBaseline(previous.values, snapshot);
    writeGarminAthleteBaselineRefresh({
      preserveAttempt: true,
      snapshot: merged,
      status: merged.availability,
      attemptedAt: clock(),
      errorMessage: null,
      preservedPrevious: Boolean(previous.fetchedAt),
    });
    return true;
  }

  async function fetchAndStoreBodyMetrics(
    client: GarminReader,
    startDate: string,
    endDate: string,
    strict = false,
    refreshProfile = true,
  ): Promise<
    GarminBodyMetricsDto & {
      fetchedHistory?: { count: number; oldest: string | null };
    }
  > {
    const attemptedAt = clock();
    const previous = getGarminBodyMetrics();
    let profilePayload: unknown;
    let historyPayload: unknown;
    let weighInPayload: unknown;
    let historyFailed = false;
    let weighInFailed = false;
    const errors: string[] = [];
    if (!strict && refreshProfile) {
      try {
        profilePayload = await client.profile();
      } catch (error) {
        errors.push(`profile: ${compactError(error)}`);
      }
    }
    try {
      historyPayload = await client.bodyComposition(startDate, endDate);
    } catch (error) {
      historyFailed = true;
      errors.push(`body composition history: ${compactError(error)}`);
    }
    try {
      weighInPayload = await client.weighIns(startDate, endDate);
    } catch (error) {
      weighInFailed = true;
      errors.push(`weigh-ins: ${compactError(error)}`);
    }
    if (!profilePayload && !historyPayload && !weighInPayload) {
      const preservedPrevious = Boolean(previous.fetchedAt);
      recordGarminBodyMetricsFailure({
        attemptedAt,
        errorMessage: errors.join("; ") || "Garmin body metrics fetch failed",
        preservedPrevious,
      });
      if (strict)
        throw new Error(
          "Garmin body history read failed; range cursor preserved.",
        );
      return getGarminBodyMetrics();
    }
    if (strict && (historyFailed || weighInFailed))
      throw new Error(
        "Garmin body history read failed; range cursor preserved.",
      );
    const snapshot = normalizeGarminBodyMetrics({
      profilePayload,
      historyPayload,
      weighInPayload,
      historyFailed,
      weighInFailed,
      fetchedAt: clock(),
    });
    const hasUsableSnapshot = hasUsableGarminBodyMetrics(snapshot);
    writeGarminBodyMetricsRefresh({
      historyOnly: strict,
      snapshot: hasUsableSnapshot ? snapshot : null,
      status: snapshot.availability,
      attemptedAt,
      errorMessage: errors.length ? errors.join("; ") : null,
      preservedPrevious: Boolean(previous.fetchedAt),
    });
    return {
      ...getGarminBodyMetrics(),
      fetchedHistory: {
        count: snapshot.historyRows.length,
        oldest: snapshot.historyRows.map((row) => row.date).sort()[0] ?? null,
      },
    };
  }

  return {
    fetchAndStoreAthleteBaseline,
    fetchAndStoreBodyMetrics,
    storeFitBaseline,
  };
}
