import { describe, expect, it, vi } from "vitest";
import { createOpenAI } from "@ai-sdk/openai";
import { getOptionalEnv } from "@/lib/env";
import { selectedModel } from "@/lib/ai/providers";
import { createTrainerGeneration } from "@/lib/ai/provider-generation";
import { orchestrateTrainerChat } from "@/lib/ai/orchestrator";
import { TRAINER_SYSTEM_PROMPT } from "@/lib/ai/trainer-instructions";
import type { TrainerToolStep } from "@/lib/ai/tool-types";

const document = (marker: string) =>
  `${"Authored untrusted plan.\n".repeat(1300).slice(0, 32000 - marker.length - 4)}${marker}週末🥾`;
const fixtures: {
  tool: string;
  input: unknown;
  result: unknown;
  status?: TrainerToolStep["status"];
  marker: string;
}[] = [
  ...["FIRST_PLAN_TAIL", "LATEST_PLAN_TAIL"].map((marker) => ({
    tool: "getTrainingPlan",
    input: {},
    marker,
    result: {
      plan: {
        title: "Authored plan",
        contentMarkdown: document(marker),
        revisedAt: "2026-11-01T00:00:00Z",
      },
      stale: false,
      staleAfterDays: 60,
    },
  })),
  ...["WEEK_ONE_TAIL", "WEEK_TWO_TAIL"].map((marker, i) => ({
    tool: "getWeeklyPlan",
    input: { weekStart: i ? "2026-11-09" : "2026-11-02" },
    marker,
    result: { document: document(marker) },
  })),
  {
    tool: "runReadOnlySql",
    input: { sql: "SELECT 1", resultName: "authored_rows" },
    marker: "DISTINCT_ROW_VALUE",
    result: {
      status: "succeeded",
      resultName: "authored_rows",
      rows: [
        {
          label: "DISTINCT_ROW_VALUE",
          optionalMetric: null,
          longCell: "x".repeat(600),
        },
      ],
      returnedRows: 1,
      rowCount: 30,
      truncated: true,
    },
  },
  {
    tool: "runReadOnlySql",
    input: { sql: "SELECT 2" },
    marker: "FAILED_DETAIL_SENTINEL",
    status: "failed",
    result: {
      status: "failed",
      message: "FAILED_DETAIL_SENTINEL: requested measurement unavailable",
      correctionAllowed: false,
    },
  },
];

function wireFixture(
  provider: "openai" | "deepseek" | "openrouter" | "ollama",
  replay: boolean,
) {
  const requests: Record<string, unknown>[] = [];
  const transport = vi.fn<typeof fetch>(async (_url, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    const position = requests.length;
    requests.push(body);
    const next = fixtures[position];
    const callId = `native-call-${position + 1}`;
    return new Response(
      JSON.stringify(
        provider === "openai"
          ? {
              id: `response-${position}`,
              object: "response",
              created_at: 0,
              status: "completed",
              model: "gpt-6-luna",
              output: next
                ? [
                    {
                      type: "function_call",
                      id: `fc-${position}`,
                      call_id: callId,
                      name: next.tool,
                      arguments: JSON.stringify(next.input),
                      status: "completed",
                    },
                  ]
                : [
                    {
                      type: "message",
                      id: "answer",
                      role: "assistant",
                      status: "completed",
                      content: [
                        {
                          type: "output_text",
                          text: "Supported partial answer; measurement unavailable.",
                          annotations: [],
                        },
                      ],
                    },
                  ],
            }
          : {
              id: `chat-${position}`,
              object: "chat.completion",
              created: 0,
              model: "authored-model",
              choices: [
                {
                  index: 0,
                  message: next
                    ? {
                        role: "assistant",
                        content: null,
                        tool_calls: [
                          {
                            id: callId,
                            type: "function",
                            function: {
                              name: next.tool,
                              arguments: JSON.stringify(next.input),
                            },
                          },
                        ],
                      }
                    : {
                        role: "assistant",
                        content:
                          "Supported partial answer; measurement unavailable.",
                      },
                  finish_reason: next ? "tool_calls" : "stop",
                },
              ],
            },
      ),
      { headers: { "content-type": "application/json" } },
    );
  });
  const model = replay
    ? createOpenAI({ apiKey: "synthetic", fetch: transport })("gpt-6-luna")
    : selectedModel(
        getOptionalEnv({
          AI_PROVIDER: provider,
          AI_MODEL: "authored-model",
          DEEPSEEK_MODEL: "authored-model",
          OPENROUTER_MODEL: "authored-model",
          OLLAMA_MODEL: "authored-model",
          OPENAI_API_KEY: "synthetic",
          DEEPSEEK_API_KEY: "synthetic",
          OPENROUTER_API_KEY: "synthetic",
        }),
        undefined,
        transport,
      ).model;
  return { requests, generate: createTrainerGeneration(model) };
}

// This crosses orchestration AND the real locked SDK serializer. A builder-only
// assertion could miss the second detailed carrier in messages/input.
describe("one detailed executed-step carrier in actual requests", () => {
  it.each([
    ["openai", true],
    ["openai", false],
    ["deepseek", false],
    ["openrouter", false],
    ["ollama", false],
  ] as const)(
    "preserves native evidence on %s (full replay: %s)",
    async (provider, replay) => {
      const { requests, generate } = wireFixture(provider, replay);
      const result = await orchestrateTrainerChat(
        {
          system: {
            policy: TRAINER_SYSTEM_PROMPT,
            context: "Fresh authored context.",
          },
          userRequest: "Discuss evidence; do not save.",
          conversation: {
            history: [
              { role: "user", content: "Lower-authority authored continuity" },
            ],
            allowSoftLimit: false,
            ...(!replay ? { memoryOnly: true } : {}),
          },
        },
        {
          generate,
          executeTool: async ({ index, toolName }) => ({
            index,
            tool: toolName,
            status: fixtures[index - 1].status ?? "succeeded",
            result: fixtures[index - 1].result,
            summary: "Authored tool outcome",
            privacy: "No private input",
          }),
        },
      );
      expect(requests).toHaveLength(fixtures.length + 1);
      expect(result.providerCalls).toBe(7);
      expect(result.progressCounters).toEqual({
        modelCalls: 7,
        toolsSucceeded: 5,
        toolsUnsuccessful: 1,
      });
      expect(result.text).toContain("measurement unavailable");
      for (const [position, body] of requests.entries()) {
        const messages = (body.input ?? body.messages) as Record<
          string,
          unknown
        >[];
        const fresh = messages.find((m) =>
          JSON.stringify(m).includes("Fresh current-turn server grounding"),
        );
        for (const [i, fixture] of fixtures.slice(0, position).entries()) {
          const serialized = JSON.stringify(messages);
          expect(serialized.split(fixture.marker)).toHaveLength(2);
          expect(JSON.stringify(fresh)).not.toContain(fixture.marker);
          expect(serialized).toContain(`native-call-${i + 1}`);
          expect(JSON.stringify(fresh)).toContain(
            `Evidence step ${i + 1}: ${fixture.tool} ${fixture.status ?? "succeeded"}`,
          );
          if (provider === "openai") {
            expect(messages).toContainEqual(
              expect.objectContaining({
                type: "function_call",
                call_id: `native-call-${i + 1}`,
                name: fixture.tool,
              }),
            );
            const output = messages.find(
              (m) =>
                m.type === "function_call_output" &&
                m.call_id === `native-call-${i + 1}`,
            );
            expect(JSON.parse(output!.output as string)).toMatchObject({
              stepIndex: i + 1,
              status: fixture.status ?? "succeeded",
            });
          } else {
            const output = messages.find(
              (m) =>
                m.role === "tool" && m.tool_call_id === `native-call-${i + 1}`,
            );
            expect(JSON.parse(output!.content as string)).toMatchObject({
              stepIndex: i + 1,
              status: fixture.status ?? "succeeded",
            });
          }
        }
      }
      expect(JSON.stringify(requests)).not.toMatch(
        /analyticalSuccess|per-tool quota/,
      );
      const final = requests.at(-1)!;
      expect(final.tools ?? []).toHaveLength(0);
      const finalWire = JSON.stringify(final);
      expect(finalWire).toContain("authored_rows");
      expect(finalWire).toContain("with truncation");
      expect(finalWire).toContain("Row text truncated");
      expect(finalWire).toContain("週末🥾");
      expect(finalWire).toContain("Document data ends");
    },
  );

  it.each([false, true])(
    "keeps detailed legacy evidence (structured: %s)",
    async (structured) => {
      const calls: string[] = [];
      await orchestrateTrainerChat(
        {
          system: structured
            ? { policy: TRAINER_SYSTEM_PROMPT, context: "legacy" }
            : TRAINER_SYSTEM_PROMPT,
          userRequest: "Read plan",
        },
        {
          generate: async (request) => {
            calls.push(JSON.stringify(request.system));
            return calls.length === 1
              ? { toolCalls: [{ toolName: "getTrainingPlan", input: {} }] }
              : { text: "Read the full document" };
          },
          executeTool: async ({ index, toolName }) => ({
            index,
            tool: toolName,
            status: "succeeded",
            summary: "Read plan",
            privacy: "authored",
            result: fixtures[0].result,
          }),
        },
      );
      expect(calls[1]).toContain("FIRST_PLAN_TAIL");
      expect(calls[1]).toContain("Document data ends");
    },
  );

  it("keeps synthetic budget diagnostics outside native pairs and counts only actual attempts", async () => {
    const requests: Parameters<
      ReturnType<typeof createTrainerGeneration>
    >[0][] = [];
    const executeTool = vi.fn(
      async ({ index, toolName }): Promise<TrainerToolStep> => ({
        index,
        tool: toolName,
        status: "succeeded",
        summary: "authored status",
        privacy: "authored",
      }),
    );
    const result = await orchestrateTrainerChat(
      {
        system: { policy: TRAINER_SYSTEM_PROMPT, context: "authored" },
        userRequest: "Read status",
        conversation: { history: [], memoryOnly: true, allowSoftLimit: false },
      },
      {
        generate: async (request) => {
          requests.push(structuredClone(request));
          return request.purpose === "planner"
            ? {
                toolCalls: Array.from({ length: 40 }, (_, i) => ({
                  toolName: "getSyncStatus",
                  toolCallId: `status-${i}`,
                  input: {},
                })),
              }
            : { text: "Gathering stopped; supported partial status." };
        },
        executeTool,
      },
    );
    expect(executeTool).toHaveBeenCalledTimes(28);
    expect(result.providerCalls).toBe(2);
    expect(result.toolSteps).toHaveLength(29);
    expect(requests[1].exchanges).toHaveLength(28);
    expect(JSON.stringify(requests[1].system)).toContain(
      "12 selected tool calls skipped",
    );
    expect(JSON.stringify(requests[1].exchanges)).not.toContain(
      "tool_budget_exceeded",
    );
    expect(requests[1].purpose).toBe("final_synthesis");
  });
});
