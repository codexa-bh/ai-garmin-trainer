import {
  validActivityImage,
  type ActivityPanel,
} from "../local-data/activity-visuals";
import type { LocalDataToolPorts } from "./tool-ports";
import type { TrainerToolExecutionInput } from "./tool-execution-input";

/** Keeps pixels out of returned printable evidence, including error paths. */
export async function activityDashboardResult(
  input: Extract<
    TrainerToolExecutionInput,
    { toolName: "getActivityDashboard" }
  >,
  ports: LocalDataToolPorts,
) {
  const { garminId, panels = [] } = input.input;
  if (!panels.length) return ports.getActivityDashboard(garminId);
  const supported =
    input.activityImagesSupported === true &&
    Boolean(ports.getActivityDashboardEvidence && ports.renderActivityImages);
  const snapshot = supported
    ? ports.getActivityDashboardEvidence!(garminId)
    : null;
  const overview = supported
    ? snapshot?.overview
    : ports.getActivityDashboard(garminId);
  if (!overview) return null;
  const unavailable = (reason: string) => ({
    ...overview,
    visuals: {
      lifetime: "current_turn_only_not_replayed",
      panels: panels.map((panel) => ({ panel, status: "unavailable", reason })),
    },
  });
  if (!snapshot) return unavailable("selected_model_or_transport_unsupported");
  if (
    snapshot.visualInput.garminId !== garminId ||
    overview.activity.garminId !== garminId
  )
    return unavailable("source_binding_mismatch");
  const result = await ports.renderActivityImages!(
    snapshot.visualInput,
    panels,
  ).catch(() => null);
  if (!result) return unavailable("render_failed");
  const accepted = result.images.filter(
    (image, index, all) =>
      image.garminId === garminId &&
      image.source === snapshot.source &&
      panels.includes(image.panel) &&
      validActivityImage(image) &&
      all.filter((other) => other.panel === image.panel).length === 1 &&
      all.every(
        (other) =>
          other.source === image.source &&
          other.capturedAt === image.capturedAt,
      ) &&
      index < 4,
  );
  for (const image of result.images)
    if (!accepted.includes(image)) image.bytes.fill(0);
  if (!input.context.retainActivityImages(input.index, accepted))
    return unavailable("turn_disposed_or_duplicate_result");
  return {
    ...overview,
    visuals: {
      lifetime: "current_turn_only_not_replayed",
      panels: panels.map((panel: ActivityPanel) => {
        const image = accepted.find((image) => image.panel === panel);
        const outcome = result.panels.find(
          (outcome) =>
            outcome.panel === panel && outcome.status === "unavailable",
        );
        const reason =
          outcome?.reason &&
          [
            "missing_or_insufficient_data",
            "render_input_limit",
            "image_bounds_exceeded",
            "render_failed",
          ].includes(outcome.reason)
            ? outcome.reason
            : "invalid_image_result";
        return image
          ? {
              panel,
              status: "available",
              source: image.source,
              capturedAt: image.capturedAt,
              mediaType: image.mediaType,
              ...(panel === "route"
                ? { mapBackground: "offline_geometry_only_no_tiles" }
                : {}),
            }
          : {
              panel,
              status: "unavailable",
              reason,
            };
      }),
    },
  };
}
