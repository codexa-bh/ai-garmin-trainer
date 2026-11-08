import type { ActivityDashboardDetail } from "./contracts";
import type { projectDashboardOverview } from "./dashboard-overview";
type DashboardOverview = ReturnType<typeof projectDashboardOverview>;

export const ACTIVITY_PANELS = [
  "heartRate",
  "elevation",
  "speed",
  "route",
] as const;
export type ActivityPanel = (typeof ACTIVITY_PANELS)[number];

/** Captured synchronously with the numerical projection. Never printable evidence. */
export type ActivityVisualInput = Pick<
  ActivityDashboardDetail,
  "charts" | "route"
> & {
  garminId: string;
};
export type ActivityDashboardEvidence = {
  overview: DashboardOverview;
  visualInput: ActivityVisualInput;
  source: string;
};
export type ActivityPanelImage = {
  garminId: string;
  panel: ActivityPanel;
  source: string;
  capturedAt: string;
  mediaType: "image/png";
  bytes: Uint8Array;
};
type ActivityPanelOutcome = {
  panel: ActivityPanel;
  status: "available" | "unavailable";
  reason?: string;
};
export type ActivityVisualResult = {
  images: ActivityPanelImage[];
  panels: ActivityPanelOutcome[];
};

const ACTIVITY_IMAGE_MAX_BYTES = 1024 * 1024;

/** Closed, local PNG contract; no URLs, paths, SVG, arbitrary dimensions or bytes. */
export function validActivityImage(image: ActivityPanelImage): boolean {
  const bytes = image.bytes;
  if (
    image.mediaType !== "image/png" ||
    !(bytes instanceof Uint8Array) ||
    bytes.length < 33 ||
    bytes.length > ACTIVITY_IMAGE_MAX_BYTES ||
    !ACTIVITY_PANELS.includes(image.panel) ||
    !/^[a-f0-9]{64}$/.test(image.source) ||
    !Number.isFinite(Date.parse(image.capturedAt))
  )
    return false;
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return (
    signature.every((value, index) => bytes[index] === value) &&
    view.getUint32(8) === 13 &&
    view.getUint32(12) === 0x49484452 &&
    view.getUint32(16) === 960 &&
    view.getUint32(20) === 540
  );
}
