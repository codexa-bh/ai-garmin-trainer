import { type ChatGrounding, type ChatMessage } from "./contracts";

export function hasVisibleGrounding(
  grounding: ChatGrounding | null | undefined,
) {
  if (!grounding) return false;
  return Object.keys(grounding).some((key) => key !== "debugTrace");
}

export function debugMessageSummary(message: ChatMessage): string {
  const date = new Date(message.createdAt).toLocaleString();
  const excerpt = message.content.replace(/\s+/g, " ").trim().slice(0, 80);
  return `${date}${excerpt ? ` — ${excerpt}` : ""}`;
}
