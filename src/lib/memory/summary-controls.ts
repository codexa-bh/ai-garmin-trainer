import type { SummaryVersion } from "./summary-policy";

export type SummaryCommand = {
  version: 1;
  expected: SummaryVersion;
} & (
  | { action: "clear" | "disable" | "enable" | "retry" }
  | { action: "edit"; id: string | null; text: string }
  | { action: "forget"; id: string }
  | { action: "refresh"; conversationId: string; segmentRevision: number }
  | { action: "import-create"; sourceIds: string[] }
  | { action: "import-pause" | "import-resume" | "import-cancel"; id: string }
);

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
export function parseSummaryCommand(value: unknown): SummaryCommand | null {
  if (!object(value) || value.version !== 1 || !object(value.expected))
    return null;
  const expected = value.expected;
  if (
    Object.keys(expected).sort().join() !== "control,manual,privacy,revision" ||
    Object.values(expected).some(
      (n) => !Number.isSafeInteger(n) || Number(n) < 0,
    )
  )
    return null;
  const common = "action,expected,version";
  const fields = Object.keys(value).sort().join();
  const id = (input: unknown) =>
    typeof input === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(input);
  if (["clear", "disable", "enable", "retry"].includes(String(value.action))) {
    if (fields !== common) return null;
  } else if (value.action === "edit") {
    if (
      fields !== "action,expected,id,text,version" ||
      (value.id !== null && !id(value.id)) ||
      typeof value.text !== "string" ||
      value.text.length > 2400
    )
      return null;
  } else if (value.action === "forget") {
    if (fields !== "action,expected,id,version" || !id(value.id)) return null;
  } else if (value.action === "import-create") {
    if (
      fields !== "action,expected,sourceIds,version" ||
      !Array.isArray(value.sourceIds) ||
      !value.sourceIds.length ||
      value.sourceIds.length > 200 ||
      new Set(value.sourceIds).size !== value.sourceIds.length ||
      value.sourceIds.some(
        (sourceId) =>
          typeof sourceId !== "string" ||
          !/^[a-zA-Z0-9_-]{1,80}:[0-9]{1,16}$/.test(sourceId),
      )
    )
      return null;
  } else if (
    ["import-pause", "import-resume", "import-cancel"].includes(
      String(value.action),
    )
  ) {
    if (fields !== "action,expected,id,version" || !id(value.id)) return null;
  } else if (value.action === "refresh") {
    if (
      fields !== "action,conversationId,expected,segmentRevision,version" ||
      !id(value.conversationId) ||
      !Number.isSafeInteger(value.segmentRevision) ||
      Number(value.segmentRevision) < 0
    )
      return null;
  } else return null;
  return {
    ...value,
    expected: {
      revision: Number(expected.revision),
      privacy: Number(expected.privacy),
      control: Number(expected.control),
      manual: Number(expected.manual),
    },
  } as SummaryCommand;
}
