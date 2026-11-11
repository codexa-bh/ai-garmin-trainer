import { containsControlCharacters, entryLabel } from "./catalog";
import type { ChatEntry } from "./contracts";

export function subscriptionEntryLabel(
  entry: ChatEntry,
  connections: ChatgptConnection[],
): string {
  if (entry.provider !== "chatgpt") return entryLabel(entry);
  const index = connections.findIndex(
    (connection) => connection.id === entry.registrationId,
  );
  const connection = connections[index];
  const model = connection?.models.find(
    (model) => model.slug === entry.modelId,
  );
  const name =
    model &&
    connection.models.filter(
      (candidate) => candidate.displayName === model.displayName,
    ).length === 1
      ? model.displayName
      : entry.modelId;
  return `ChatGPT plan · ${index < 0 ? "unavailable account" : `account ${index + 1}`} / ${name}`;
}
/** Secret-free native projection; pure validation, no authentication capability. */
export type ChatgptConnection = {
  id: string;
  epoch: number;
  label: string;
  state:
    | "connected"
    | "identity-only"
    | "disconnected"
    | "reconnect-required"
    | "unavailable";
  planEnabled: boolean;
  disclosed: boolean;
  models: { slug: string; displayName: string }[];
};
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const bounded = (value: unknown, max: number): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= max &&
  !containsControlCharacters(value);
export function validateChatgptConnections(
  input: unknown,
): ChatgptConnection[] {
  if (!Array.isArray(input) || input.length > 16)
    throw new Error("chatgpt_metadata_invalid");
  const ids = new Set();
  return input.map((value: unknown) => {
    if (
      !object(value) ||
      Object.keys(value).sort().join() !==
        "disclosed,epoch,id,label,models,planEnabled,state" ||
      typeof value.id !== "string" ||
      !/^registration_[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
        value.id,
      ) ||
      ids.has(value.id) ||
      !Number.isSafeInteger(value.epoch) ||
      (value.epoch as number) < 1 ||
      !bounded(value.label, 300) ||
      ![
        "connected",
        "identity-only",
        "disconnected",
        "reconnect-required",
        "unavailable",
      ].includes(value.state as string) ||
      typeof value.planEnabled !== "boolean" ||
      typeof value.disclosed !== "boolean" ||
      !Array.isArray(value.models) ||
      value.models.length > 256
    )
      throw new Error("chatgpt_metadata_invalid");
    ids.add(value.id);
    const slugs = new Set();
    const models = value.models.map((model: unknown) => {
      if (
        !object(model) ||
        Object.keys(model).sort().join() !== "displayName,slug" ||
        !bounded(model.slug, 256) ||
        !bounded(model.displayName, 256) ||
        slugs.has(model.slug)
      )
        throw new Error("chatgpt_metadata_invalid");
      slugs.add(model.slug);
      return { slug: model.slug, displayName: model.displayName };
    });
    if (value.planEnabled && value.state !== "connected")
      throw new Error("chatgpt_metadata_invalid");
    return {
      id: value.id,
      epoch: value.epoch as number,
      label: value.label,
      state: value.state as ChatgptConnection["state"],
      planEnabled: value.planEnabled,
      disclosed: value.disclosed,
      models,
    };
  });
}
