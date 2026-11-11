import type { IncomingMessage, ServerResponse } from "node:http";
import { applyChatgptConnections } from "../../src/lib/env";
import { chatgptOwnerInitialized } from "../../src/lib/ai/chatgpt-connection";

/** Fixed native-owned metadata projection, not renderer auth or a generic proxy. */
export async function serveChatgptConnections(
  request: IncomingMessage,
  response: ServerResponse,
  boot: string,
  ready: () => boolean,
): Promise<void> {
  if (
    !ready() ||
    request.method !== "POST" ||
    request.headers.origin !== undefined ||
    request.headers["sec-fetch-site"] !== undefined ||
    request.headers["x-trainer-identity"] !== boot ||
    request.headers["transfer-encoding"] !== undefined ||
    request.headers["content-type"] !== "application/json"
  ) {
    response.writeHead(403).end();
    return;
  }
  const length = request.headers["content-length"];
  if (
    typeof length !== "string" ||
    !/^[1-9][0-9]{0,5}$/.test(length) ||
    Number(length) > 128 * 1024
  ) {
    response.writeHead(409).end();
    return;
  }
  const timeout = setTimeout(() => request.destroy(), 2000);
  try {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of request) {
      const bytes = Buffer.from(chunk as Uint8Array);
      size += bytes.length;
      if (size > Number(length))
        throw new Error("Connection metadata exceeded bound");
      chunks.push(bytes);
    }
    if (size !== Number(length) || !ready())
      throw new Error("Connection metadata interrupted");
    if (!chatgptOwnerInitialized())
      throw new Error("Native credential capability requires reopen");
    applyChatgptConnections(
      JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown,
    );
    response
      .writeHead(200, {
        "x-trainer-identity": boot,
        "cache-control": "no-store",
        "content-type": "application/json",
      })
      .end('{"version":1,"applied":true}');
  } catch {
    if (!response.headersSent) response.writeHead(409);
    response.end();
  } finally {
    clearTimeout(timeout);
  }
}
