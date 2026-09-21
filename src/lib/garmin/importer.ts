// Compatibility facade for existing sync callers; application modules never
// import production composition. Detail/effort callers use composition directly.
export { runGarminSync } from "./composition";
export { dailyHealthImportPlan } from "./import-policy";
