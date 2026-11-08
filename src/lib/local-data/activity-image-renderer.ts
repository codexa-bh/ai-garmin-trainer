import { createHash } from "node:crypto";
import sharp from "sharp";
import { offlineRouteCoordinates } from "../analytics/activity-route-layout";
import {
  validActivityImage,
  type ActivityPanel,
  type ActivityPanelImage,
  type ActivityVisualInput,
  type ActivityVisualResult,
} from "./activity-visuals";

const labels = {
  heartRate: ["Heart rate", "heartRate", "bpm"],
  elevation: ["Elevation profile", "altitudeMeters", "m"],
  speed: ["Speed", "speedKmh", "km/h"],
} as const;
const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[char]!,
  );
const text = (
  x: number,
  y: number,
  value: string,
  size = 18,
  monospace = false,
) =>
  `<text x="${x}" y="${y}" font-size="${size}"${monospace ? ' font-family="monospace"' : ""}>${escape(value)}</text>`;
const number = (value: number) => Number(value.toFixed(2)).toString();

function chart(
  input: ActivityVisualInput,
  panel: Exclude<ActivityPanel, "route">,
) {
  const [title, key, unit] = labels[panel];
  if (panel === "speed" && input.charts.speed.status !== "available")
    return null;
  const points = input.charts.points.filter(
    (point) =>
      Number.isFinite(point.elapsedSec) &&
      typeof point[key] === "number" &&
      Number.isFinite(point[key]),
  );
  if (points.length < 2) return null;
  const values = points.map((point) => point[key]!);
  const min = values.reduce((a, b) => Math.min(a, b));
  const max = values.reduce((a, b) => Math.max(a, b));
  const start = input.charts.domainStartSec;
  const end = Math.max(
    start + 1,
    input.charts.domainEndSec ?? points[points.length - 1].elapsedSec,
  );
  const polyline = points
    .map(
      (point) =>
        `${number(100 + Math.max(0, Math.min(1, (point.elapsedSec - start) / (end - start))) * 800)},${number(360 - ((point[key]! - min) / Math.max(1, max - min)) * 230)}`,
    )
    .join(" ");
  const time =
    input.charts.timeScaleStatus === "sample_index_limited"
      ? "Stored sample index (not seconds)"
      : input.charts.timeScaleStatus === "timestamp_derived"
        ? "Elapsed seconds from timestamps"
        : "Elapsed seconds";
  return {
    title,
    body:
      text(20, 137, `${number(max)} ${unit}`) +
      text(20, 360, `${number(min)} ${unit}`) +
      '<path d="M100 125 V360 H900" fill="none" stroke="#64748b"/>' +
      `<polyline points="${polyline}" fill="none" stroke="#007a78" stroke-width="3"/>` +
      text(100, 390, number(start)) +
      text(825, 390, number(end)) +
      text(260, 425, time) +
      text(
        24,
        465,
        `${points.length} plotted / ${input.charts.sourcePointCount} source samples; no hover selection.`,
      ) +
      text(
        24,
        495,
        panel === "speed"
          ? "Speed: existing 60-second distance window; no measured-speed substitution."
          : "Recorded samples joined; missing samples are not continuous measurement.",
      ),
  };
}

function route(input: ActivityVisualInput) {
  if (input.route.status !== "available") return null;
  // Deliberately use the existing offline fallback: never fetch tiles on behalf
  // of a model. This image is not a topographic map and says so visibly.
  const points = offlineRouteCoordinates(input.route, 800, 250, 0, {
    x: 0,
    y: 0,
  });
  if (points.length < 2) return null;
  let lines = "";
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i];
    const color =
      b.gradePct === null
        ? "#334155"
        : b.gradePct >= 3
          ? "#bd4b00"
          : b.gradePct <= -3
            ? "#225fce"
            : "#007a78";
    lines += `<line x1="${number(a.x + 80)}" y1="${number(a.y + 125)}" x2="${number(b.x + 80)}" y2="${number(b.y + 125)}" stroke="${color}" stroke-width="3"/>`;
  }
  const a = points[0],
    b = points[points.length - 1];
  return {
    title: "Route — offline geometry only",
    body:
      lines +
      `<circle cx="${number(a.x + 80)}" cy="${number(a.y + 125)}" r="6" fill="#007a78"/>` +
      `<circle cx="${number(b.x + 80)}" cy="${number(b.y + 125)}" r="7" fill="#7c3aed"/>` +
      text(
        24,
        410,
        "Start: teal · Finish: violet · Grade: up orange, down blue, rolling teal, unknown grey",
      ) +
      text(
        24,
        445,
        `${input.route.pointCount} / ${input.route.sourcePointCount} GPS samples; cap ${input.route.maxPoints}. Independent chart/map sampling.`,
      ) +
      text(
        24,
        480,
        "Offline route shown. No map tiles requested; terrain/background unavailable.",
      ) +
      text(
        24,
        510,
        "Dashboard online maps: © OpenStreetMap contributors; © OpenTopoMap (CC-BY-SA).",
        16,
      ),
  };
}

export function activityImageSource(input: ActivityVisualInput): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

/** Finite raster adapter over captured dashboard owners; no DOM, URL, file or service input. */
export async function renderActivityImages(
  input: ActivityVisualInput,
  panels: readonly ActivityPanel[],
): Promise<ActivityVisualResult> {
  const source = activityImageSource(input);
  const capturedAt = new Date().toISOString();
  const result: ActivityVisualResult = { images: [], panels: [] };
  for (const panel of panels) {
    try {
      if (panel !== "route" && input.charts.points.length > 100_000) {
        result.panels.push({
          panel,
          status: "unavailable",
          reason: "render_input_limit",
        });
        continue;
      }
      const view = panel === "route" ? route(input) : chart(input, panel);
      if (!view) {
        result.panels.push({
          panel,
          status: "unavailable",
          reason: "missing_or_insufficient_data",
        });
        continue;
      }
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540"><rect width="960" height="540" fill="#fff"/><g font-family="sans-serif" fill="#172b3a">${text(24, 38, view.title, 26)}${text(24, 72, `Activity ${input.garminId}`, 17, true)}${text(24, 100, `Captured ${capturedAt} · source ${source.slice(0, 16)} · current turn`, 16)}${view.body}</g></svg>`;
      const image: ActivityPanelImage = {
        garminId: input.garminId,
        panel,
        source,
        capturedAt,
        mediaType: "image/png",
        bytes: await sharp(Buffer.from(svg), { limitInputPixels: 960 * 540 })
          .png()
          .toBuffer(),
      };
      if (!validActivityImage(image)) {
        image.bytes.fill(0);
        result.panels.push({
          panel,
          status: "unavailable",
          reason: "image_bounds_exceeded",
        });
        continue;
      }
      result.images.push(image);
      result.panels.push({ panel, status: "available" });
    } catch {
      // Neither private SVG/data nor upstream diagnostic strings enter evidence.
      result.panels.push({
        panel,
        status: "unavailable",
        reason: "render_failed",
      });
    }
  }
  return result;
}
