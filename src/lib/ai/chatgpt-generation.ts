import { streamText, type LanguageModelUsage } from "ai";
import { trainerToolDefinitions } from "./provider-tool-definitions";
import { CHATGPT_NAMESPACE, ChatgptRequestError } from "./chatgpt-transport";
import type { TrainerGenerationRequest } from "./orchestration-ports";

/** The locked SDK supports namespaces, but only this route opts into them. */
const tools = Object.fromEntries(
  Object.entries(trainerToolDefinitions).map(([name, definition]) => [
    name,
    {
      ...definition,
      providerOptions: {
        openai: {
          namespace: {
            name: CHATGPT_NAMESPACE,
            description:
              "Local trainer tools; existing admission and side-effect rules apply.",
          },
        },
      },
    },
  ]),
);
export async function chatgptText(options: Record<string, unknown>): Promise<{
  text: string;
  toolCalls: unknown[];
  usage: LanguageModelUsage;
  finishReason: string;
}> {
  const result = streamText({
    ...options,
    maxRetries: 0,
    providerOptions: {
      openai: {
        store: false,
        forceReasoning: false,
        systemMessageMode: "developer",
        parallelToolCalls: false,
      },
    },
  } as unknown as Parameters<typeof streamText>[0]);
  // Explicit consumption surfaces stream errors, not just HTTP200/first text/EOF.
  for await (const event of result.fullStream) {
    if (event.type === "error")
      throw event.error instanceof ChatgptRequestError
        ? event.error
        : new ChatgptRequestError("generation_failed");
  }
  const calls = await result.toolCalls;
  const ids = new Set();
  for (const call of calls) {
    const metadata = call.providerMetadata?.openai as
      { namespace?: unknown } | undefined;
    if (
      metadata?.namespace !== CHATGPT_NAMESPACE ||
      !Object.hasOwn(trainerToolDefinitions, call.toolName) ||
      ids.has(call.toolCallId)
    )
      throw new ChatgptRequestError("unsupported_tool_call");
    ids.add(call.toolCallId);
  }
  return {
    text: await result.text,
    toolCalls: calls,
    usage: await result.usage,
    finishReason: await result.finishReason,
  };
}
export async function chatgptTrainerGeneration(
  model: unknown,
  request: TrainerGenerationRequest,
  signal: AbortSignal,
) {
  if (request.exchanges?.some((exchange) => exchange.images?.length))
    throw new Error("activity_image_transport_unsupported");
  const system =
    typeof request.system === "string" ? request.system : request.system.policy;
  const context =
    typeof request.system === "string" ? "" : request.system.context;
  const exchanges = (request.exchanges ?? []).flatMap((exchange) => [
    {
      role: "assistant",
      content: [
        {
          type: "tool-call",
          toolCallId: exchange.callId,
          toolName: exchange.toolName,
          input: exchange.input,
          providerOptions: { openai: { namespace: CHATGPT_NAMESPACE } },
        },
      ],
    },
    {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: exchange.callId,
          toolName: exchange.toolName,
          output: { type: "text", value: exchange.output },
        },
      ],
    },
  ]);
  return chatgptText({
    model,
    system,
    messages: [
      ...(request.conversation?.history ?? []),
      ...(context
        ? [
            {
              role: "user",
              content: `Fresh current-turn server grounding (historical prose never verifies this turn):\n${context}`,
            },
          ]
        : []),
      { role: "user", content: request.prompt },
      ...exchanges,
    ],
    ...(request.purpose === "planner" ? { tools, toolChoice: "auto" } : {}),
    abortSignal: signal,
  });
}
