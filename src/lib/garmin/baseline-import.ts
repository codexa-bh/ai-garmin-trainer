import type { GarminReader, BaselineStore } from "./import-ports";
import type { GarminAthleteBaselineDto, GarminBodyMetricsDto } from "./types";
import {
  hasUsableGarminAthleteBaseline,
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
  ): Promise<GarminAthleteBaselineDto> {
    const attemptedAt = clock();
    const previous = getGarminAthleteBaseline();
    let profilePayload: unknown;
    let ftpPayload: unknown;
    const errors: string[] = [];
    try {
      profilePayload = await client.profile();
    } catch (error) {
      errors.push(`profile: ${compactError(error)}`);
    }
    try {
      ftpPayload = await client.cyclingFtp();
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
    const hasUsableSnapshot = hasUsableGarminAthleteBaseline(snapshot);
    writeGarminAthleteBaselineRefresh({
      snapshot: hasUsableSnapshot ? snapshot : null,
      status: snapshot.availability,
      attemptedAt,
      errorMessage: errors.length ? errors.join("; ") : null,
      preservedPrevious: false,
    });
    return getGarminAthleteBaseline();
  }

  async function fetchAndStoreBodyMetrics(
    client: GarminReader,
    startDate: string,
    endDate: string,
  ): Promise<GarminBodyMetricsDto> {
    const attemptedAt = clock();
    const previous = getGarminBodyMetrics();
    let profilePayload: unknown;
    let historyPayload: unknown;
    let weighInPayload: unknown;
    let historyFailed = false;
    let weighInFailed = false;
    const errors: string[] = [];
    try {
      profilePayload = await client.profile();
    } catch (error) {
      errors.push(`profile: ${compactError(error)}`);
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
      return getGarminBodyMetrics();
    }
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
      snapshot: hasUsableSnapshot ? snapshot : null,
      status: snapshot.availability,
      attemptedAt,
      errorMessage: errors.length ? errors.join("; ") : null,
      preservedPrevious: false,
    });
    return getGarminBodyMetrics();
  }

  return { fetchAndStoreAthleteBaseline, fetchAndStoreBodyMetrics };
}
