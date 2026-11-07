/** SDK calls with no tools are the genuinely action-disabled synthesis path. */
export function isFinalSynthesis(options: {
  tools?: Record<string, unknown>;
}): boolean {
  return options.tools === undefined;
}
