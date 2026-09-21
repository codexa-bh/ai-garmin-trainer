export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function eachDate(startDate: string, endDate: string): string[] {
  const days: string[] = [];
  const cursor = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  while (cursor <= end) {
    days.push(isoDate(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

function maxIsoDate(first: string, second: string): string {
  return first > second ? first : second;
}

function dateRange(startDate: string, endDate: string): string[] {
  return startDate <= endDate ? eachDate(startDate, endDate) : [];
}

function boundedUniqueDates(
  dates: string[],
  historyStartDate: string,
  endDate: string,
): string[] {
  return Array.from(
    new Set(
      dates.filter((date) => date >= historyStartDate && date <= endDate),
    ),
  ).sort();
}

export function dailyHealthImportPlan(input: {
  historyStartDate: string;
  resumeDate: string;
  endDate: string;
  latestCandidateDates?: string[];
  repairDates?: string[];
  trailingDates?: string[];
}): {
  dates: string[];
  checkpointDates: string[];
  latestDates: string[];
  repairDates: string[];
  trailingDates: string[];
} {
  const checkpointDates = dateRange(
    maxIsoDate(input.historyStartDate, input.resumeDate),
    input.endDate,
  );
  const latestDates = boundedUniqueDates(
    input.latestCandidateDates ?? [],
    input.historyStartDate,
    input.endDate,
  );
  const repairDates = boundedUniqueDates(
    input.repairDates ?? [],
    input.historyStartDate,
    input.endDate,
  );
  const trailingDates = boundedUniqueDates(
    input.trailingDates ?? [],
    input.historyStartDate,
    input.endDate,
  );
  return {
    dates: Array.from(
      new Set([
        ...checkpointDates,
        ...latestDates,
        ...repairDates,
        ...trailingDates,
      ]),
    ).sort(),
    checkpointDates,
    latestDates,
    repairDates,
    trailingDates,
  };
}

export function compactError(error: unknown): string {
  return (
    error instanceof Error ? error.message : "Garmin connector fetch failed"
  ).slice(0, 500);
}

export function classifyDetailError(error: unknown): {
  errorClass: string;
  message: string;
  retryable: boolean;
} {
  const message =
    error instanceof Error ? error.message : "detail backfill failed";
  const normalized = message.toLowerCase();
  const stableUnsupported = /not found|unsupported|no fit|unavailable/.test(
    normalized,
  );
  const auth = /auth|token|login|credential/.test(normalized);
  const timeout = /timeout|timed out|rate|429/.test(normalized);
  return {
    errorClass: auth
      ? "auth"
      : timeout
        ? "timeout"
        : stableUnsupported
          ? "unsupported"
          : "connector",
    message: message.slice(0, 1000),
    retryable: !stableUnsupported,
  };
}
