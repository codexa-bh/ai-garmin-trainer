import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { createOpenAI } from "@ai-sdk/openai";
import {
  buildActivityDashboardCharts,
  buildActivityDashboardRoute,
} from "../src/lib/analytics/activity-dashboard-calculations";
import {
  activityImageSource,
  renderActivityImages,
} from "../src/lib/local-data/activity-image-renderer";
import {
  ACTIVITY_PANELS,
  validActivityImage,
  type ActivityVisualInput,
  type ActivityPanelImage,
} from "../src/lib/local-data/activity-visuals";
import { trainerToolInputSchemas } from "../src/lib/ai/tool-contracts";
import { TrainerToolExecutionContext } from "../src/lib/ai/tool-execution-context";
import { activityDashboardResult } from "../src/lib/ai/tool-activity-images";
import {
  supportsActivityImages,
  activityExchangeMessages,
} from "../src/lib/ai/provider-activity-images";
import { createTrainerGeneration } from "../src/lib/ai/provider-generation";
import { orchestrateTrainerChat } from "../src/lib/ai/orchestrator";
import type { LocalDataToolPorts } from "../src/lib/ai/tool-ports";

const rows = Array.from({ length: 101 }, (_, i) => ({
  elapsedSec: i * 10,
  timestamp: new Date(Date.UTC(2026, 10, 1, 0, 0, i * 10)).toISOString(),
  distanceMeters: i * 10,
  heartRate: 100 + (i % 40),
  altitudeMeters: 100 + i,
  gradePct: 10,
}));
const visualInput: ActivityVisualInput = {
  garminId: "authored",
  charts: buildActivityDashboardCharts(rows, 1000),
  route: buildActivityDashboardRoute(
    rows.map((row, i) => ({
      elapsedSec: row.elapsedSec,
      lat: 45 + i / 10000,
      lon: 8 + Math.sin(i / 10) / 1000,
      altitudeMeters: row.altitudeMeters,
      gradePct: row.gradePct,
    })),
  ),
};
const overview = {
  activity: { garminId: "authored", durationSec: 1000 },
  heartRateZones: { status: "available" },
};
const ports = () =>
  ({
    getActivityDashboard: vi.fn(() => overview),
    getActivityDashboardEvidence: vi.fn(() => ({
      overview,
      visualInput,
      source: activityImageSource(visualInput),
    })),
    renderActivityImages: vi.fn(renderActivityImages),
  }) as unknown as LocalDataToolPorts;
const input = (
  context = new TrainerToolExecutionContext(),
  panels: (typeof ACTIVITY_PANELS)[number][] = [...ACTIVITY_PANELS],
) => ({
  toolName: "getActivityDashboard" as const,
  index: 1,
  context,
  input: { garminId: "authored", panels },
  activityImagesSupported: true,
});

it("admits only finite unique selected panels; default/empty are numerical-only", async () => {
  for (const args of [
    { garminId: "authored" },
    { garminId: "authored", panels: [] },
  ])
    expect(
      trainerToolInputSchemas.getActivityDashboard.safeParse(args).success,
    ).toBe(true);
  for (const args of [
    { panels: ["route", "route"] },
    { panels: ["settings"] },
    { panels: Array(5).fill("speed") },
    { panels: ["route"], url: "https://example.com" },
    { path: "/tmp/file" },
    { selector: "body" },
  ])
    expect(
      trainerToolInputSchemas.getActivityDashboard.safeParse({
        garminId: "authored",
        ...args,
      }).success,
    ).toBe(false);
  const p = ports();
  const result = await activityDashboardResult(input(undefined, []), p);
  expect(result).toBe(overview);
  expect(p.getActivityDashboardEvidence).not.toHaveBeenCalled();
  expect(p.renderActivityImages).not.toHaveBeenCalled();
});

it("rasterizes actual shared chart/route owners into bounded readable PNGs without network", async () => {
  const result = await renderActivityImages(visualInput, ACTIVITY_PANELS);
  expect(result.panels.map((panel) => panel.status)).toEqual(
    Array(4).fill("available"),
  );
  expect(new Set(result.images.map((image) => image.source)).size).toBe(1);
  for (const image of result.images) {
    expect(validActivityImage(image)).toBe(true);
    expect(await sharp(image.bytes).metadata()).toMatchObject({
      width: 960,
      height: 540,
      format: "png",
    });
  }
  const refreshed = await renderActivityImages(
    {
      ...visualInput,
      charts: {
        ...visualInput.charts,
        points: visualInput.charts.points.slice(2),
      },
    },
    ["heartRate"],
  );
  expect(refreshed.images[0].source).not.toBe(result.images[0].source);
});

it("handles maximum IDs without dropping identity and refuses excessive input without clipping samples", async () => {
  const longest = await renderActivityImages(
    { ...visualInput, garminId: "W".repeat(64) },
    ["heartRate"],
  );
  expect(longest.images[0].garminId).toBe("W".repeat(64));
  expect(validActivityImage(longest.images[0])).toBe(true);
  const bounded = await renderActivityImages(
    {
      ...visualInput,
      charts: {
        ...visualInput.charts,
        points: Array(100_001).fill(visualInput.charts.points[0]),
      },
    },
    ["heartRate", "route"],
  );
  expect(bounded.panels).toEqual([
    { panel: "heartRate", status: "unavailable", reason: "render_input_limit" },
    { panel: "route", status: "available" },
  ]);
  expect(bounded.images.map((image) => image.panel)).toEqual(["route"]);
});

it("keeps numerical evidence on unsupported, mixed/missing data and render errors; never leaks pixels", async () => {
  const p = ports();
  const unsupported = await activityDashboardResult(
    { ...input(), activityImagesSupported: false },
    p,
  );
  expect(unsupported).toMatchObject({
    ...overview,
    visuals: {
      panels: ACTIVITY_PANELS.map((panel) => ({
        panel,
        status: "unavailable",
        reason: "selected_model_or_transport_unsupported",
      })),
    },
  });
  expect(p.renderActivityImages).not.toHaveBeenCalled();
  const mixed = await renderActivityImages(
    {
      ...visualInput,
      charts: {
        ...visualInput.charts,
        points: visualInput.charts.points.map((point) => ({
          ...point,
          heartRate: null,
        })),
      },
    },
    ["heartRate", "elevation"],
  );
  expect(mixed.panels).toEqual([
    {
      panel: "heartRate",
      status: "unavailable",
      reason: "missing_or_insufficient_data",
    },
    { panel: "elevation", status: "available" },
  ]);
  const context = new TrainerToolExecutionContext();
  const result = await activityDashboardResult(input(context), p);
  expect(result).toMatchObject(overview);
  expect(JSON.stringify(result)).not.toMatch(
    /base64|bytes|data:image|"lat"|"lon"/,
  );
  const image = context.activityImages.get(1)![0];
  context.dispose();
  expect(image.bytes.every((value) => value === 0)).toBe(true);
  expect(context.activityImages.size).toBe(0);
  vi.mocked(p.renderActivityImages!).mockRejectedValueOnce(
    new Error("private pixels"),
  );
  expect(await activityDashboardResult(input(), p)).toMatchObject({
    ...overview,
    visuals: {
      panels: ACTIVITY_PANELS.map((panel) => ({
        panel,
        status: "unavailable",
        reason: "render_failed",
      })),
    },
  });
});

it("rejects wrong-source/panel, duplicate, malformed and oversize results without affecting another instance", async () => {
  const generated = (await renderActivityImages(visualInput, ["heartRate"]))
    .images[0];
  const variants = [
    { ...generated, garminId: "other", bytes: generated.bytes.slice() },
    { ...generated, panel: "route" as const, bytes: generated.bytes.slice() },
    { ...generated, source: "0".repeat(64), bytes: generated.bytes.slice() },
    { ...generated, bytes: new Uint8Array(1024 * 1024 + 1) },
    { ...generated, bytes: new Uint8Array(40) },
    { ...generated, mediaType: "image/jpeg", bytes: generated.bytes.slice() },
  ];
  for (const variant of variants) {
    const p = ports();
    vi.mocked(p.renderActivityImages!).mockResolvedValueOnce({
      images: [variant as ActivityPanelImage],
      panels: [],
    });
    const context = new TrainerToolExecutionContext();
    const result = await activityDashboardResult(
      input(context, ["heartRate"]),
      p,
    );
    expect(result).toMatchObject({
      visuals: { panels: [{ status: "unavailable" }] },
    });
    expect(context.activityImages.get(1)).toEqual([]);
  }
  const duplicatePorts = ports();
  const copy = () => ({ ...generated, bytes: generated.bytes.slice() });
  vi.mocked(duplicatePorts.renderActivityImages!).mockResolvedValueOnce({
    images: [copy(), copy()],
    panels: [],
  });
  const duplicateContext = new TrainerToolExecutionContext();
  expect(
    await activityDashboardResult(
      input(duplicateContext, ["heartRate"]),
      duplicatePorts,
    ),
  ).toMatchObject({
    visuals: {
      panels: [{ status: "unavailable", reason: "invalid_image_result" }],
    },
  });
  expect(duplicateContext.activityImages.get(1)).toEqual([]);
  const a = new TrainerToolExecutionContext(),
    b = new TrainerToolExecutionContext();
  await activityDashboardResult(input(a, ["elevation"]), ports());
  await activityDashboardResult(input(b, ["speed"]), ports());
  a.dispose();
  expect(validActivityImage(b.activityImages.get(1)![0])).toBe(true);
  b.dispose();
  const disposed = new TrainerToolExecutionContext();
  const p = ports();
  vi.mocked(p.renderActivityImages!).mockImplementationOnce(async (...args) => {
    disposed.dispose();
    return renderActivityImages(...args);
  });
  expect(await activityDashboardResult(input(disposed), p)).toMatchObject({
    visuals: {
      panels: ACTIVITY_PANELS.map((panel) => ({
        panel,
        status: "unavailable",
        reason: "turn_disposed_or_duplicate_result",
      })),
    },
  });
});

describe("locked SDK image serialization", () => {
  it.each([
    ["responses", true],
    ["responses", false],
    ["chat", true],
    ["chat", false],
  ] as const)(
    "sends actual multi-panel %s images (envelope=%s) and one paired numerical result, never a remote probe",
    async (route, envelope) => {
      const requests: Record<string, unknown>[] = [];
      const transport = vi.fn<typeof fetch>(async (_url, init) => {
        requests.push(JSON.parse(String(init?.body)));
        return Response.json(
          route === "responses"
            ? {
                id: "response",
                model: "gpt-4o",
                output: [
                  {
                    type: "message",
                    id: "message",
                    role: "assistant",
                    content: [
                      {
                        type: "output_text",
                        text: "Authored answer.",
                        annotations: [],
                      },
                    ],
                  },
                ],
              }
            : {
                id: "chat",
                object: "chat.completion",
                created: 1,
                model: "llava",
                choices: [
                  {
                    index: 0,
                    finish_reason: "stop",
                    message: { role: "assistant", content: "Authored answer." },
                  },
                ],
              },
        );
      });
      const provider = createOpenAI({
        apiKey: "authored",
        ...(route === "chat"
          ? { name: "ollama", baseURL: "http://127.0.0.1:1/v1" }
          : {}),
        fetch: transport,
      });
      const model =
        route === "responses" ? provider("gpt-4o") : provider.chat("llava");
      expect(supportsActivityImages(model)).toBe(true);
      const { images } = await renderActivityImages(visualInput, [
        "heartRate",
        "route",
      ]);
      const result = await createTrainerGeneration(model)({
        purpose: "planner",
        system: "Authored policy",
        prompt: "Authored input",
        ...(envelope
          ? {
              conversation: {
                history: [],
                memoryOnly: true,
                allowSoftLimit: false,
              },
            }
          : {}),
        exchanges: [
          {
            callId: "image-call",
            toolName: "getActivityDashboard",
            input: { garminId: "authored", panels: ["heartRate", "route"] },
            output: "NUMERICAL_ONCE",
            images,
          },
        ],
      });
      expect(result.text).toBe("Authored answer.");
      expect(requests).toHaveLength(1);
      const wire = JSON.stringify(requests[0]);
      expect(wire.match(/data:image\/png;base64,/g)).toHaveLength(2);
      expect(wire.match(/NUMERICAL_ONCE/g)).toHaveLength(1);
      expect(wire).toContain("image-call");
      expect(wire).toContain("Current-turn route image");
      expect(wire).not.toContain("input_tokens");
      if (route === "responses") expect(requests[0].store).toBe(false);
      const withoutImages = await createTrainerGeneration(model)({
        purpose: "final_synthesis",
        system: "policy",
        prompt: "Later turn",
        conversation: { history: [], memoryOnly: true, allowSoftLimit: false },
      });
      expect(withoutImages.text).toBe("Authored answer.");
      expect(JSON.stringify(requests[1])).not.toContain("data:image");
    },
  );
});

it("sanitizes legacy image provider failures and disables SDK retries", async () => {
  const { images } = await renderActivityImages(visualInput, ["heartRate"]);
  const transport = vi.fn<typeof fetch>(async () =>
    Response.json(
      {
        error: {
          message: "private image echo iVBORw0KGgo",
          type: "server_error",
        },
      },
      { status: 500 },
    ),
  );
  const model = createOpenAI({ apiKey: "authored", fetch: transport })(
    "gpt-4o",
  );
  await expect(
    createTrainerGeneration(model)({
      purpose: "planner",
      system: "authored",
      prompt: "authored",
      exchanges: [
        {
          callId: "call",
          toolName: "getActivityDashboard",
          input: { garminId: "authored", panels: ["heartRate"] },
          output: "numeric",
          images,
        },
      ],
    }),
  ).rejects.toThrow(/^activity_image_provider_unavailable$/);
  expect(transport).toHaveBeenCalledTimes(1);
});

it("refuses unknown/text-only model images without provider fallback or probing", async () => {
  const { images } = await renderActivityImages(visualInput, ["heartRate"]);
  for (const model of [
    { provider: "openai.responses", modelId: "gpt-6-luna" },
    { provider: "deepseek.chat", modelId: "deepseek-flash" },
    { provider: "openrouter.chat", modelId: "gpt-4o" },
    { provider: "ollama.chat", modelId: "custom" },
  ]) {
    expect(supportsActivityImages(model)).toBe(false);
    expect(() =>
      activityExchangeMessages(model, {
        callId: "call",
        toolName: "getActivityDashboard",
        input: { garminId: "authored", panels: ["heartRate"] },
        output: "numeric",
        images,
      }),
    ).toThrow("activity_image_transport_unsupported");
  }
});

it.each([false, true])(
  "releases images on successful/invalidated orchestration (invalidated=%s); debug never contains pixels",
  async (invalidated) => {
    let context: TrainerToolExecutionContext | undefined;
    let bytes: Uint8Array | undefined;
    let calls = 0;
    const work = orchestrateTrainerChat(
      {
        system: "Authored",
        userRequest: "show chart",
        debug: { enabled: true },
        assertCurrent: () => {
          if (invalidated && bytes)
            throw new Error("conversation_context_invalidated");
        },
      },
      {
        activityImagesSupported: true,
        generate: async (request) => {
          calls++;
          if (calls === 1)
            return {
              toolCalls: [
                {
                  toolCallId: "visual-call",
                  toolName: "getActivityDashboard",
                  input: { garminId: "authored", panels: ["heartRate"] },
                },
              ],
            };
          expect(request.exchanges?.[0].images?.[0].panel).toBe("heartRate");
          return { text: "Authored answer." };
        },
        executeTool: async (execution) => {
          context = execution.context;
          if (execution.toolName !== "getActivityDashboard")
            throw new Error("unexpected");
          const result = await activityDashboardResult(execution, ports());
          bytes = context.activityImages.get(1)![0].bytes;
          return {
            index: 1,
            tool: "getActivityDashboard",
            status: "succeeded",
            summary: "Authored dashboard",
            privacy: "Authored local evidence only.",
            result,
          };
        },
      },
    );
    if (invalidated) await expect(work).rejects.toThrow();
    else
      expect(JSON.stringify(await work)).not.toMatch(
        /data:image|base64|"bytes"/,
      );
    expect(bytes!.every((value) => value === 0)).toBe(true);
    expect(context!.activityImages.size).toBe(0);
  },
);
