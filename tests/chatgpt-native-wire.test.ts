import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, expect, it, vi } from "vitest";
import { chatgptModel } from "../src/lib/ai/chatgpt-transport";
import { createTrainerGeneration } from "../src/lib/ai/provider-generation";
import {
  initializeChatgptOwner,
  nativeChatgptCredential,
} from "../src/lib/ai/chatgpt-connection";

const registrationId = "registration_11111111-1111-4111-8111-111111111111";
const capability = "a".repeat(72);
const owner = process as typeof process & { __trainerChatgptOwnerV1?: unknown };
let server: Server | undefined;
let url: string;
let accepted = 0;
async function broker(
  responseBody?: string | ((operation: string) => string),
  drops: { operation: string; count: number } = { operation: "", count: 0 },
  status = 200,
  onCurrent?: () => void,
) {
  let dropped = 0;
  delete owner.__trainerChatgptOwnerV1;
  accepted = 0;
  server = createServer((request, response) => {
    // Same browser/capability refusal as the native owner. Real fetch injects
    // sec-fetch-mode; a mock transport cannot expose that wire incompatibility.
    if (
      request.headers["x-chatgpt-owner"] !== capability ||
      request.headers.origin !== undefined ||
      Object.keys(request.headers).some((name) => name.startsWith("sec-fetch-"))
    ) {
      request.resume();
      response.writeHead(403, { "content-length": 0, connection: "close" });
      response.end();
      return;
    }
    let body = "";
    request.on("data", (chunk: Buffer) => {
      body += chunk.toString();
    });
    request.on("end", () => {
      const value = JSON.parse(body);
      expect(request.url).toBe("/credential");
      expect(request.method).toBe("POST");
      expect(request.headers["content-length"]).toBe(
        String(Buffer.byteLength(body)),
      );
      expect(Object.keys(value).sort()).toEqual([
        "epoch",
        "operation",
        "registrationId",
      ]);
      expect(value.registrationId).toBe(registrationId);
      expect(value.epoch).toBe(1);
      accepted += 1;
      if (value.operation === drops.operation && dropped < drops.count) {
        dropped += 1;
        request.socket.destroy();
        return;
      }
      const output =
        (typeof responseBody === "function"
          ? responseBody(value.operation)
          : responseBody) ??
        JSON.stringify(
          value.operation === "current"
            ? { current: true }
            : { accessToken: "authored-native-token", epoch: 1 },
        );
      response.writeHead(status, {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(output),
        connection: "close",
      });
      response.end(output);
      if (value.operation === "current") onCurrent?.();
    });
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  url = `http://127.0.0.1:${port}/credential`;
  initializeChatgptOwner({ version: 1, port, capability, connections: [] });
}
afterEach(async () => {
  delete owner.__trainerChatgptOwnerV1;
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
  }
});
it("actual private Node wire succeeds without weakening native browser-header refusal", async () => {
  await broker();
  const headers = {
    "x-chatgpt-owner": capability,
    "content-type": "application/json",
  };
  const body = JSON.stringify({
    operation: "current",
    registrationId,
    epoch: 1,
  });
  const browserStyle = await fetch(url, { method: "POST", headers, body });
  expect(browserStyle.status).toBe(403);
  expect(accepted).toBe(0);
  const signal = AbortSignal.timeout(2000);
  await expect(
    nativeChatgptCredential("current", registrationId, 1, signal),
  ).resolves.toEqual({});
  await expect(
    nativeChatgptCredential("credential", registrationId, 1, signal),
  ).resolves.toEqual({ accessToken: "authored-native-token" });
  expect(accepted).toBe(2);
});
it("the actual private wire retains response bounds and cancellation before admission", async () => {
  // Valid JSON/closed shape after legal whitespace: removing the byte bound
  // would incorrectly succeed, rather than fail later on malformed JSON.
  await broker(" ".repeat(128 * 1024) + JSON.stringify({ current: true }));
  await expect(
    nativeChatgptCredential(
      "current",
      registrationId,
      1,
      AbortSignal.timeout(2000),
    ),
  ).rejects.toThrow("chatgpt_connection_unavailable");
  expect(accepted).toBe(1);
  const cancelled = new AbortController();
  cancelled.abort();
  await expect(
    nativeChatgptCredential("credential", registrationId, 1, cancelled.signal),
  ).rejects.toThrow("chatgpt_connection_unavailable");
  expect(accepted).toBe(1);
});
it("recovers a transient currentness wire disconnect without replaying generation", async () => {
  await broker(undefined, { operation: "current", count: 1 });
  const item = {
    type: "message",
    id: "msg_1",
    role: "assistant",
    status: "completed",
    content: [
      { type: "output_text", text: "Original answer", annotations: [] },
    ],
  };
  const events = [
    {
      type: "response.created",
      response: { id: "resp_1", created_at: 1, model: "gpt-6.1-sol" },
    },
    {
      type: "response.output_item.added",
      output_index: 0,
      item: { type: "message", id: "msg_1" },
    },
    {
      type: "response.output_text.delta",
      item_id: "msg_1",
      delta: "Original answer",
    },
    { type: "response.output_item.done", output_index: 0, item },
    {
      type: "response.completed",
      response: {
        status: "completed",
        output: [item],
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    },
  ];
  const network = vi.fn(
    async () =>
      new Response(
        events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
        { headers: { "content-type": "text/event-stream" } },
      ),
  );
  const result = await createTrainerGeneration(
    chatgptModel(
      { registrationId, epoch: 1, model: "gpt-6.1-sol" },
      undefined,
      network,
    ),
  )({ purpose: "planner", system: "Policy", prompt: "Question" });
  expect(result.text).toBe("Original answer");
  expect(network).toHaveBeenCalledTimes(1);
  expect(accepted).toBe(3);
});
it("recovers a dropped poll while the upstream is idle, then verifies final currentness", async () => {
  let dropped!: () => void;
  const observed = new Promise<void>((resolve) => {
    dropped = resolve;
  });
  await broker(undefined, { operation: "current", count: 1 }, 200, dropped);
  const network = vi.fn(async () => {
    await observed;
    return new Response(
      'data: {"type":"response.created","response":{"id":"resp_1","created_at":1,"model":"gpt-6.1-sol"}}\n\ndata: {"type":"response.completed","response":{"status":"completed","output":[],"usage":{"input_tokens":1,"output_tokens":0}}}\n\n',
      { headers: { "content-type": "text/event-stream" } },
    );
  });
  await createTrainerGeneration(
    chatgptModel(
      { registrationId, epoch: 1, model: "gpt-6.1-sol" },
      undefined,
      network,
    ),
  )({ purpose: "planner", system: "Policy", prompt: "Question" });
  expect(network).toHaveBeenCalledTimes(1);
  expect(accepted).toBe(4);
});
it("keeps concurrent current checks independently bound when one wire drops", async () => {
  await broker(undefined, { operation: "current", count: 1 });
  const checks = Array.from({ length: 4 }, () =>
    nativeChatgptCredential(
      "current",
      registrationId,
      1,
      AbortSignal.timeout(2000),
    ),
  );
  await expect(Promise.all(checks)).resolves.toEqual([{}, {}, {}, {}]);
  expect(accepted).toBe(5);
});
it("does not turn an authoritative refusal after a dropped current check into success", async () => {
  await broker(
    JSON.stringify({ code: "chatgpt_connection_unavailable", connections: [] }),
    { operation: "current", count: 1 },
    409,
  );
  await expect(
    nativeChatgptCredential(
      "current",
      registrationId,
      1,
      AbortSignal.timeout(2000),
    ),
  ).rejects.toThrow("chatgpt_connection_unavailable");
  expect(accepted).toBe(2);
});
it.each([
  { operation: "credential" as const, count: 1, expected: 1 },
  { operation: "current" as const, count: 2, expected: 2 },
])(
  "bounds wire recovery for $operation",
  async ({ operation, count, expected }) => {
    await broker(undefined, { operation, count });
    await expect(
      nativeChatgptCredential(
        operation,
        registrationId,
        1,
        AbortSignal.timeout(2000),
      ),
    ).rejects.toThrow("chatgpt_connection_unavailable");
    expect(accepted).toBe(expected);
  },
);
it.each(["credential", "current"])(
  "actual native wire %s refusal survives locked SDK without raw detail or replay",
  async (failedOperation) => {
    await broker((operation) =>
      JSON.stringify(
        operation === failedOperation
          ? { private: "private-native-token-path" }
          : { accessToken: "authored-native-token", epoch: 1 },
      ),
    );
    const network = vi.fn(
      async () =>
        new Response(
          'data: {"type":"response.created","response":{"id":"resp_1","created_at":1,"model":"gpt-6.1-sol"}}\n\ndata: {"type":"response.completed","response":{"status":"completed","output":[],"usage":{"input_tokens":1,"output_tokens":0}}}\n\n',
          { headers: { "content-type": "text/event-stream" } },
        ),
    );
    const error = await createTrainerGeneration(
      chatgptModel(
        { registrationId, epoch: 1, model: "gpt-6.1-sol" },
        undefined,
        network,
      ),
    )({ purpose: "planner", system: "Policy", prompt: "Question" }).catch(
      (e: unknown) => e,
    );
    expect(error).toMatchObject({
      failure: {
        stage:
          failedOperation === "credential"
            ? "native_credential"
            : "native_final_current",
      },
    });
    expect(network).toHaveBeenCalledTimes(
      failedOperation === "credential" ? 0 : 1,
    );
    expect(accepted).toBe(failedOperation === "credential" ? 1 : 2);
    expect(JSON.stringify(error)).not.toContain("private-native-token-path");
  },
);
