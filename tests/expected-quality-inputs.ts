// Authored test inputs and expected policy values, not product exports.
import type { ActivityPanel } from "../src/lib/local-data/activity-visuals";
export const ACTIVITY_PANELS: readonly ActivityPanel[] = [
  "heartRate",
  "elevation",
  "speed",
  "route",
];
export const ACTIVITY_DASHBOARD_GRADE_READOUT_WINDOW_SEC = 180;
export const ACTIVITY_DASHBOARD_SPEED_AVERAGE_WINDOW_SEC = 60;
export const CONVERSATION_INPUT_LIMIT = 27033;
export const CONVERSATION_OUTPUT_LIMIT = 4096;
export const SUMMARY_MODEL_OUTPUT = 128_000;
