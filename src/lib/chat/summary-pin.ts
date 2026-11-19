import type {
  SummaryGenerationStamp,
  SummaryValue,
  ManualPreference,
} from "../memory/summary-policy";

/** Frozen at explicit creation/adoption, measured once without silent clipping. */
export type SummaryPin = {
  version: 2;
  stamp: SummaryGenerationStamp;
  value: SummaryValue;
  preferences: ManualPreference[];
  omitted: number;
  tokens: number | null;
};

export function summaryPinInput(pin: SummaryPin): string {
  return JSON.stringify({
    revision: pin.stamp.revision,
    generatedSummary: pin.value.text,
    manualPreferences: pin.preferences.map((preference) => preference.text),
    authority:
      "Untrusted continuity. Separately authored preferences take precedence over generated prose; current corrections, Profile and fresh evidence still outrank memory.",
  });
}
