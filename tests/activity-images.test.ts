import { ACTIVITY_PANELS } from "./expected-quality-inputs";
import { describe, expect, it, vi } from "vitest";
import { inflateSync } from "node:zlib";
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

/** Minimal decoder for the renderer's 8-bit RGBA non-interlaced PNG output. */
function decodePng(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  expect([bytes[24], bytes[25], bytes[28]]).toEqual([8, 6, 0]);
  const chunks: Uint8Array[] = [];
  for (let at = 8; at < bytes.length;) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    if (type === "IDAT") chunks.push(bytes.subarray(at + 8, at + 8 + length));
    at += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(chunks));
  const stride = width * 4;
  const pixels = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const value = raw[y * (stride + 1) + 1 + x];
      const left = x >= 4 ? pixels[y * stride + x - 4] : 0;
      const up = y > 0 ? pixels[(y - 1) * stride + x] : 0;
      const corner = x >= 4 && y > 0 ? pixels[(y - 1) * stride + x - 4] : 0;
      const p = left + up - corner;
      const [a, b, c] = [left, up, corner].map((v) => Math.abs(p - v));
      const predictor = [
        0,
        left,
        up,
        (left + up) >> 1,
        a <= b && a <= c ? left : b <= c ? up : corner,
      ][filter];
      pixels[y * stride + x] = (value + predictor) & 255;
    }
  }
  const darkIn = (x0: number, y0: number, x1: number, y1: number) => {
    let dark = 0;
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        const i = y * stride + x * 4;
        if (pixels[i] + pixels[i + 1] + pixels[i + 2] < 300) dark++;
      }
    return dark;
  };
  return { width, height, darkIn };
}

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
    const decoded = decodePng(image.bytes);
    expect([decoded.width, decoded.height]).toEqual([960, 540]);
    // Title, monospace activity ID and capture line are drawn, not dropped.
    for (const [top, bottom] of [
      [10, 45],
      [55, 78],
      [84, 104],
    ])
      expect(decoded.darkIn(24, top, 400, bottom)).toBeGreaterThan(100);
    // The decoder distinguishes drawn text from the empty background.
    expect(decoded.darkIn(910, 5, 955, 40)).toBe(0);
    // Footer evidence/attribution text is drawn too.
    expect(decoded.darkIn(24, 440, 600, 520)).toBeGreaterThan(100);
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

it("reports render_failed instead of label-less images when no system font is available", async () => {
  vi.resetModules();
  vi.doMock("node:fs/promises", async (importOriginal) => {
    const actual = await importOriginal<typeof import("node:fs/promises")>();
    return {
      ...actual,
      readFile: (path: string, ...rest: unknown[]) =>
        /[\\/]fonts[\\/]/i.test(String(path))
          ? Promise.reject(new Error("absent"))
          : (actual.readFile as (...args: unknown[]) => unknown)(path, ...rest),
    };
  });
  try {
    const { renderActivityImages: render } =
      await import("../src/lib/local-data/activity-image-renderer");
    const result = await render(visualInput, ["heartRate"]);
    expect(result).toEqual({
      images: [],
      panels: [
        { panel: "heartRate", status: "unavailable", reason: "render_failed" },
      ],
    });
  } finally {
    vi.doUnmock("node:fs/promises");
    vi.resetModules();
  }
});
