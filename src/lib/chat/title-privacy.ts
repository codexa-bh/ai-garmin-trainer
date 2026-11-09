/** Legacy title-only compatibility. This deliberately limited pre-call guard
 * must not decide admission or privacy for cross-chat memory. */
function titlePrivacyRestricted(text: string): boolean {
  const unquoted = text
    .replace(/"[^"]*"|“[^”]*”|‘[^’]*’|`[^`]*`|(?<!\w)'[^'\n]*'(?!\w)/g, " ")
    .replace(/’/g, "'");
  const clauses = unquoted.split(
    /[.!?;:\n]|\b(?:and|but)\s+(?=(?:please\s+)?(?:do not|don't|never)\b)/i,
  );
  for (const clause of clauses) {
    const command =
      /^\s*(?:please\s+)?(?:do not|don't|never)\s+(remember|save|store)\b(.*)$/i.exec(
        clause,
      );
    if (!command) continue;
    const [, verb, object] = command;
    if (verb.toLowerCase() === "remember") return true;
    if (/\b(?:in|to|into)\s+(?:my\s+)?memory\b/i.test(object)) return true;
    if (
      /^\s*(?:(?:the|a|an|my|our|your|this|that)\s+)?(?:(?!(?:about|of|in|to|into|from|with|and|but|because)\b)[\p{L}\p{N}'-]+\s+)*(?:plan|document|draft)\b/iu.test(
        object,
      )
    )
      continue;
    if (
      /^\s*(?:(?:this|that|my|anything)\b|(?:to|in|into)\s+(?:my\s+)?memory\b)/i.test(
        object,
      )
    )
      return true;
  }
  return false;
}
export function titleSource(text: string): string | null {
  if (/[\uD800-\uDFFF]/u.test(text)) throw new Error("summary_invalid_unicode");
  const normalized = text.replace(/\r\n/g, "\n").trim();
  return normalized && !titlePrivacyRestricted(normalized) ? normalized : null;
}
