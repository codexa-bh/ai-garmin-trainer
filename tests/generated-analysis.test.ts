import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  process.env.DATABASE_PATH = join(
    mkdtempSync(join(tmpdir(), "trainer-generated-analysis-")),
    "test.sqlite",
  );
});

describe("generated Garmin dataset scripts", () => {
  it("retains redacted raw payloads and clears them with Garmin data", async () => {
    const repository = await import("../src/lib/db/repository");
    const stored = repository.upsertGarminRawPayload({
      sourceTool: "get_activities_by_date",
      subjectType: "activity_page",
      subjectId: "2026-07-01:page:0",
      payload: {
        activities: [{ activityId: 1 }],
        accessToken: "super-secret-token",
        nested: { cookie: "garmin_cookie=abc" },
      },
    });

    expect(stored.redactedFieldCount).toBeGreaterThanOrEqual(2);
    const listed = repository.listGarminRawPayloadsForAnalysis();
    expect(listed).toHaveLength(1);
    expect(JSON.stringify(listed[0].payload)).toContain("[REDACTED]");
    expect(JSON.stringify(listed[0].payload)).not.toContain(
      "super-secret-token",
    );

    expect(repository.clearGarminData()).toContain("garmin_raw_payload");
    expect(repository.listGarminRawPayloadsForAnalysis()).toHaveLength(0);
  });

  it("runs an LLM-authored top-10 ranking over explicit datasets without fixed criteria", async () => {
    const repository = await import("../src/lib/db/repository");
    const { runGeneratedGarminAnalysis } =
      await import("../src/lib/ai/generated-analysis");
    repository.upsertActivities(
      Array.from({ length: 12 }, (_, index) => ({
        garminId: `activity-${index + 1}`,
        name: `Activity ${index + 1}`,
        sport: index % 2 === 0 ? "running" : "cycling",
        startedAt: new Date(
          `2026-07-${String(index + 1).padStart(2, "0")}T07:00:00Z`,
        ),
        durationSec: 1800 + index * 60,
        distanceMeters: 5000 + index * 1000,
        calories: null,
        avgHeartRate: 130 + index,
        maxHeartRate: 160 + index,
        steps: null,
        elevationGainMeters: 100 + index * 20,
        elevationLossMeters: null,
        trainingEffect: 2 + index / 10,
      })),
    );

    const evidence = await runGeneratedGarminAnalysis({
      request: "top 10 longest activities",
      datasets: ["activities"],
      requestedCount: 10,
      script: `
from statistics import mean
activities = bundle["datasets"]["activities"]
ranked = sorted(activities, key=lambda item: item.get("durationSec") or 0, reverse=True)[:requestedCount]
RESULT = {
    "kind": "ranking",
    "title": "Longest imported activities",
    "summary": "Average selected duration seconds: " + str(round(mean([row.get("durationSec") or 0 for row in ranked]), 1)),
    "rows": [
        {"rank": index + 1, "garminId": row["garminId"], "value": row.get("durationSec"), "units": "s"}
        for index, row in enumerate(ranked)
    ],
    "limitations": [],
}
`,
    });

    expect(evidence.status).toBe("succeeded");
    expect(evidence.result?.kind).toBe("ranking");
    expect(evidence.result?.rows).toHaveLength(10);
    expect(evidence.result?.rows?.[0].garminId).toBe("activity-12");
    expect(evidence.manifest.selectedDatasets).toEqual(["activities"]);
    expect(evidence.scriptHash).toHaveLength(64);
    expect(JSON.stringify(evidence)).not.toContain("demand_score");
  });

  it("applies generic activity selection before script execution", async () => {
    const repository = await import("../src/lib/db/repository");
    const { runGeneratedGarminAnalysis } =
      await import("../src/lib/ai/generated-analysis");
    repository.upsertActivities([
      {
        garminId: "hike-demanding",
        name: "Demanding alpine hike",
        sport: "hiking",
        startedAt: new Date("2026-03-01T09:00:00Z"),
        durationSec: 7200,
        distanceMeters: 14000,
        calories: 900,
        avgHeartRate: 138,
        maxHeartRate: 169,
        steps: null,
        elevationGainMeters: 1300,
        elevationLossMeters: 1300,
        trainingEffect: 3.2,
      },
      {
        garminId: "snowboard-excluded",
        name: "Excluded resort snowboarding",
        sport: "snowboarding",
        startedAt: new Date("2026-03-03T09:00:00Z"),
        durationSec: 5400,
        distanceMeters: 18000,
        calories: 850,
        avgHeartRate: 136,
        maxHeartRate: 171,
        steps: null,
        elevationGainMeters: 120,
        elevationLossMeters: 1700,
        trainingEffect: 2.7,
      },
    ]);

    const evidence = await runGeneratedGarminAnalysis({
      request: "count hiking activities only",
      datasets: ["activities"],
      requestedCount: 5,
      activitySelection: { includeText: ["hiking"] },
      script: `
activities = bundle["datasets"]["activities"]
RESULT = {
    "kind": "summary",
    "title": "Activity count",
    "summary": "matching activities: " + str(len(activities)),
    "rows": [{"rank": 1, "garminId": row["garminId"], "value": row["sport"]} for row in activities],
    "limitations": [],
}
`,
    });

    expect(evidence.status).toBe("succeeded");
    expect(evidence.manifest.activitySelection).toEqual({
      includeText: ["hiking"],
      excludeText: [],
    });
    expect(evidence.result?.rows?.map((row) => row.garminId)).toEqual([
      "hike-demanding",
    ]);
    expect(JSON.stringify(evidence.result)).not.toContain("snowboard-excluded");
  });

  it("rejects generated rows outside the provided dataset with correction guidance", async () => {
    const repository = await import("../src/lib/db/repository");
    const { runGeneratedGarminAnalysis } =
      await import("../src/lib/ai/generated-analysis");
    repository.upsertActivities([
      {
        garminId: "known-activity",
        name: "Known activity",
        sport: "running",
        startedAt: new Date("2026-04-01T09:00:00Z"),
        durationSec: 3600,
        distanceMeters: 8000,
        calories: 450,
        avgHeartRate: 122,
        maxHeartRate: 150,
        steps: null,
        elevationGainMeters: 500,
        elevationLossMeters: 500,
        trainingEffect: 1.8,
      },
    ]);

    const evidence = await runGeneratedGarminAnalysis({
      request: "rank activities",
      datasets: ["activities"],
      requestedCount: 1,
      script:
        "RESULT = {'kind': 'ranking', 'rows': [{'rank': 1, 'garminId': 'unknown-activity', 'value': 999}], 'limitations': []}",
    });

    expect(evidence.status).toBe("rejected");
    expect(evidence.reason).toBe("invalid_result_shape");
    expect(evidence.correctionAllowed).toBe(true);
    expect(evidence.correctionHint).toContain("provided activities dataset");
  });

  it("allows safe imports and rejects forbidden filesystem imports distinctly", async () => {
    const { runGeneratedPythonAnalysis } =
      await import("../src/lib/ai/python-sandbox");

    await expect(
      runGeneratedPythonAnalysis({
        script:
          "import math\nRESULT = {'kind': 'summary', 'summary': str(math.sqrt(81)), 'limitations': []}",
        bundle: {},
      }),
    ).resolves.toMatchObject({ status: "succeeded" });

    await expect(
      runGeneratedPythonAnalysis({
        script:
          "import os\nRESULT = {'kind': 'summary', 'summary': os.getcwd(), 'limitations': []}",
        bundle: {},
      }),
    ).resolves.toMatchObject({ status: "rejected", reason: "denied_import" });
  });

  it("classifies correction-offer failures separately from safety denials", async () => {
    const { canOfferGeneratedAnalysisCorrection, runGeneratedGarminAnalysis } =
      await import("../src/lib/ai/generated-analysis");

    expect(canOfferGeneratedAnalysisCorrection("runtime_error")).toBe(true);
    expect(canOfferGeneratedAnalysisCorrection("syntax_error")).toBe(true);
    expect(canOfferGeneratedAnalysisCorrection("unsupported_import")).toBe(
      true,
    );
    expect(canOfferGeneratedAnalysisCorrection("non_json_result")).toBe(true);
    expect(canOfferGeneratedAnalysisCorrection("invalid_result_shape")).toBe(
      true,
    );
    expect(canOfferGeneratedAnalysisCorrection("denied_import")).toBe(false);
    expect(canOfferGeneratedAnalysisCorrection("dunder_access")).toBe(false);
    expect(canOfferGeneratedAnalysisCorrection("python_unavailable")).toBe(
      false,
    );

    const runtime = await runGeneratedGarminAnalysis({
      request: "rank activities",
      datasets: ["activities"],
      script: "RESULT = 1 / 0",
    });
    expect(runtime).toMatchObject({
      status: "failed",
      reason: "runtime_error",
      correctionAllowed: true,
    });
    expect(runtime.message).toContain("division by zero");
    expect(runtime.correctionHint).toContain("fields present");

    const unsupported = await runGeneratedGarminAnalysis({
      request: "use pandas",
      datasets: ["activities"],
      script:
        "import pandas\nRESULT = {'kind': 'summary', 'summary': 'x', 'limitations': []}",
    });
    expect(unsupported).toMatchObject({
      status: "rejected",
      reason: "unsupported_import",
      correctionAllowed: true,
    });
    expect(unsupported.message).toContain("pandas");
    expect(unsupported.correctionHint).toContain("unsupported third-party");

    const denied = await runGeneratedGarminAnalysis({
      request: "read files",
      datasets: ["activities"],
      script:
        "import os\nRESULT = {'kind': 'summary', 'summary': os.getcwd(), 'limitations': []}",
    });
    expect(denied).toMatchObject({
      status: "rejected",
      reason: "denied_import",
      correctionAllowed: false,
    });
    expect(denied.correctionHint).toContain(
      "Correction feedback is not offered",
    );
  });
});
