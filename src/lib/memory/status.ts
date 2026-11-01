// Closed metadata projection: no settings/URLs/models/errors or memory records.
export function memoryStatusProjection(input: {
  configuredEnabled: boolean;
  userDisabled: boolean;
  embeddingProvider: "openai" | "ollama" | "deterministic";
  extractionMode: "llm" | "deterministic" | "off";
  extractionProvider: "deepseek" | "openai" | null;
  observation: { ready: boolean; at: number } | null;
  now: number;
}) {
  const effectiveEnabled = input.configuredEnabled && !input.userDisabled;
  const elapsed = input.observation ? input.now - input.observation.at : null;
  const ageMs =
    elapsed !== null && elapsed >= 0 && elapsed < 60000
      ? Math.trunc(elapsed)
      : null;
  const observed = ageMs !== null ? input.observation : null;
  const health = !effectiveEnabled
    ? "disabled"
    : observed && !observed.ready
      ? "attention"
      : observed && input.embeddingProvider === "ollama"
        ? "local-observed"
        : observed && input.embeddingProvider === "deterministic"
          ? "test-only"
          : "not-checked";
  return {
    configuredEnabled: input.configuredEnabled,
    userDisabled: input.userDisabled,
    effectiveEnabled,
    embeddingProvider: input.embeddingProvider,
    extractionMode: input.extractionMode,
    extractionProvider:
      input.extractionMode === "llm"
        ? (input.extractionProvider ?? "deterministic")
        : input.extractionMode,
    health,
    ageMs,
  };
}
