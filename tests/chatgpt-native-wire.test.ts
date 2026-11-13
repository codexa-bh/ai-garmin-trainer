import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, expect, it } from "vitest";
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
async function broker(responseBody?: string) {
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
      const output =
        responseBody ??
        JSON.stringify(
          value.operation === "current"
            ? { current: true }
            : { accessToken: "authored-native-token", epoch: 1 },
        );
      response.writeHead(200, {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(output),
        connection: "close",
      });
      response.end(output);
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
