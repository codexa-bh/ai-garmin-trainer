// Match every edit against the original document, never the preceding edit's output.
export function applyPlanEdits(
  original: string,
  requested: { oldText: string; newText: string }[],
): string | null {
  const edits = requested
    .map((edit) => ({ ...edit, start: original.indexOf(edit.oldText) }))
    .sort((a, b) => a.start - b.start);
  let end = 0;
  let contentMarkdown = "";
  for (const edit of edits) {
    if (
      edit.start < end ||
      edit.start < 0 ||
      original.indexOf(edit.oldText, edit.start + 1) !== -1
    )
      return null;
    contentMarkdown += original.slice(end, edit.start) + edit.newText;
    end = edit.start + edit.oldText.length;
  }
  return contentMarkdown + original.slice(end);
}
