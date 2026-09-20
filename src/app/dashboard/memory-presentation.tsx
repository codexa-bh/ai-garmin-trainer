import { type MemoryItem } from "./contracts";
import { dateLabel } from "./formatting";

export function memoryTimestamp(item: MemoryItem): number {
  const raw = item.updatedAt ?? item.createdAt ?? "";
  const timestamp = raw ? Date.parse(raw) : Number.NaN;
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

export function compareMemoryText(
  first: MemoryItem,
  second: MemoryItem,
): number {
  return first.text.localeCompare(second.text, undefined, {
    sensitivity: "base",
  });
}

export function memoryScopeLabel(item: MemoryItem): string {
  return item.conversationId
    ? `Conversation ${item.conversationId}`
    : "Cross-conversation";
}

export function memoryUpdatedLabel(item: MemoryItem): string {
  if (item.updatedAt) return `Updated ${dateLabel(item.updatedAt)}`;
  if (item.createdAt) return `Created ${dateLabel(item.createdAt)}`;
  return "No timestamp";
}
