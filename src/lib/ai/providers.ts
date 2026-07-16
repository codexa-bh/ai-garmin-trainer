import { createDeepSeek } from "@ai-sdk/deepseek";
import { createOpenAI } from "@ai-sdk/openai";
import { getOptionalEnv } from "../env";

export function selectedModel() {
  const env = getOptionalEnv();
  if (env.AI_PROVIDER === "deepseek") {
    const deepseek = createDeepSeek({
      apiKey: env.DEEPSEEK_API_KEY ?? "missing",
    });
    return {
      provider: "deepseek" as const,
      model: deepseek(env.DEEPSEEK_MODEL),
    };
  }
  const openai = createOpenAI({ apiKey: env.OPENAI_API_KEY ?? "missing" });
  return { provider: "openai" as const, model: openai(env.AI_MODEL) };
}
