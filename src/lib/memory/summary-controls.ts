import type { SummaryVersion } from "./summary-policy";
import { parseSummaryOverride } from "../model-settings/summary-selection";

export type DensifyModels = {
  default: { label: string; available: boolean };
  options: { value: string; label: string }[];
};

export type SummaryRebuildSelection = {
  version: 1;
  conversationIds: string[] | null;
  includeLegacy: boolean;
};
export const DEFAULT_REBUILD_SELECTION: SummaryRebuildSelection = {
  version: 1,
  conversationIds: null,
  includeLegacy: false,
};
export function parseRebuildSelection(
  value: unknown,
): SummaryRebuildSelection | null {
  if (
    !object(value) ||
    Object.keys(value).sort().join() !==
      "conversationIds,includeLegacy,version" ||
    value.version !== 1 ||
    typeof value.includeLegacy !== "boolean"
  )
    return null;
  const ids = value.conversationIds;
  if (
    ids !== null &&
    (!Array.isArray(ids) ||
      ids.length > 10000 ||
      new Set(ids).size !== ids.length ||
      ids.some(
        (id) => typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/.test(id),
      ))
  )
    return null;
  return {
    version: 1,
    conversationIds: ids === null ? null : [...(ids as string[])].sort(),
    includeLegacy: value.includeLegacy,
  };
}

export type SummaryCommand = {
  version: 2;
  expected: SummaryVersion;
} & (
  | { action: "clear" | "disable" | "enable" | "retry" }
  | { action: "densify-request"; id: string; model?: string }
  | {
      action: "densify-accept" | "densify-discard" | "densify-cancel";
      id: string;
    }
  | { action: "edit-summary"; text: string }
  | { action: "edit"; id: string | null; text: string }
  | { action: "forget"; id: string }
  | { action: "refresh"; conversationId: string; segmentRevision: number }
  | { action: "import-create"; sourceIds: string[] }
  | { action: "rebuild-review"; selection: SummaryRebuildSelection }
  | {
      action: "rebuild-start";
      id: string;
      snapshot: string;
      selection?: SummaryRebuildSelection;
    }
  | { action: "rebuild-cancel"; id: string }
  | { action: "import-pause" | "import-resume" | "import-cancel"; id: string }
);

export type SummaryRebuildInspection = {
  version: 1;
  snapshot: string;
  selection: SummaryRebuildSelection;
  conversations: { id: string; title: string }[];
  ready: boolean;
  complete: boolean;
  limitExceeded: boolean;
  configuredProvider: string;
  model: string;
  enabled: boolean;
  capability: string;
  counts: {
    chats: number;
    selectedChats: number;
    legacyUserMessages: number;
    messages: number;
    userMessages: number;
    assistantMessages: number;
    includedChats: number;
    excludedChats: number;
    excludedMessages: number;
    includedUserMessages: number;
    assistantContext: number;
    excludedUserMessages: number;
  };
  reasons: Record<string, number>;
  estimatedUsd: {
    low: number;
    conservativeMaximum: number | null;
    priceBasis: string;
    uncertainty: string;
  };
  semantics: string;
  operation: {
    id: string;
    state: string;
    reason: string | null;
    processed: number;
    total: number;
    dispositions: Record<string, number>;
    createdAt: number;
    deadline: number;
  } | null;
};

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
export function parseSummaryCommand(value: unknown): SummaryCommand | null {
  if (!object(value) || value.version !== 2 || !object(value.expected))
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
  } else if (value.action === "densify-request") {
    if (
      !id(value.id) ||
      (fields !== "action,expected,id,version" &&
        (fields !== "action,expected,id,model,version" ||
          !parseSummaryOverride(value.model)))
    )
      return null;
  } else if (
    ["densify-accept", "densify-discard", "densify-cancel"].includes(
      String(value.action),
    )
  ) {
    if (fields !== "action,expected,id,version" || !id(value.id)) return null;
  } else if (value.action === "edit-summary") {
    if (
      fields !== "action,expected,text,version" ||
      typeof value.text !== "string"
    )
      return null;
  } else if (value.action === "edit") {
    if (
      fields !== "action,expected,id,text,version" ||
      (value.id !== null && !id(value.id)) ||
      typeof value.text !== "string"
    )
      return null;
  } else if (value.action === "forget") {
    if (fields !== "action,expected,id,version" || !id(value.id)) return null;
  } else if (value.action === "rebuild-review") {
    if (
      fields !== "action,expected,selection,version" ||
      !parseRebuildSelection(value.selection)
    )
      return null;
  } else if (value.action === "rebuild-start") {
    if (
      (fields !== "action,expected,id,snapshot,version" &&
        fields !== "action,expected,id,selection,snapshot,version") ||
      (value.selection !== undefined &&
        !parseRebuildSelection(value.selection)) ||
      !id(value.id) ||
      typeof value.snapshot !== "string" ||
      !/^[a-f0-9]{64}$/.test(value.snapshot)
    )
      return null;
  } else if (value.action === "rebuild-cancel") {
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
