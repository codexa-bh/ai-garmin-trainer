import type { IncomingMessage, ServerResponse } from "node:http";
import {
  applyLiveConfiguration,
  liveConfigurationStatus,
} from "../../src/lib/env";

// Only the native owner knows this boot identity. Browser requests (including
// same-origin trainer fetches) have no authority to read or replace live state.
export async function serveLiveSettings(
  request: IncomingMessage,
  response: ServerResponse,
  boot: string,
  ready: () => boolean,
): Promise<void> {
  if (
    !ready() ||
    request.headers.origin !== undefined ||
    request.headers["sec-fetch-site"] !== undefined ||
    request.headers["x-trainer-identity"] !== boot ||
    !["GET", "POST"].includes(request.method ?? "") ||
    request.headers["transfer-encoding"] !== undefined
  ) {
    response.writeHead(403).end();
    return;
  }
  try {
    let status: ReturnType<typeof liveConfigurationStatus>;
    if (request.method === "GET") {
      if (
        request.headers["content-length"] &&
        request.headers["content-length"] !== "0"
      )
        throw new Error("Status body refused");
      status = liveConfigurationStatus();
    } else {
      const length = request.headers["content-length"];
      if (
        typeof length !== "string" ||
        !/^[1-9][0-9]{0,5}$/.test(length) ||
        Number(length) > 96 * 1024 ||
        request.headers["content-type"] !== "application/json"
      )
        throw new Error("Live framing refused");
      const body = await new Promise<Buffer>((resolve, reject) => {
        let bytes = Buffer.alloc(0);
        const timer = setTimeout(
          () => finish(new Error("Live receive deadline")),
          2000,
        );
        function finish(error?: Error) {
          clearTimeout(timer);
          request.off("data", data);
          request.off("end", end);
          request.off("error", failed);
          request.off("aborted", failed);
          if (error) {
            bytes.fill(0);
            reject(error);
          } else resolve(bytes);
        }
        function data(chunk: Buffer) {
          const next = Buffer.concat([bytes, chunk]);
          bytes.fill(0);
          bytes = next;
          if (bytes.length > Number(length))
            finish(new Error("Live frame exceeded bound"));
        }
        function failed() {
          finish(new Error("Live frame interrupted"));
        }
        function end() {
          finish(
            bytes.length === Number(length)
              ? undefined
              : new Error("Live frame incomplete"),
          );
        }
        request.on("data", data);
        request.once("end", end);
        request.once("error", failed);
        request.once("aborted", failed);
      });
      try {
        if (!ready()) throw new Error("Owned backend stopping");
        status = applyLiveConfiguration(
          JSON.parse(body.toString("utf8")) as unknown,
        );
      } finally {
        body.fill(0);
      }
    }
    const body = JSON.stringify(status);
    response
      .writeHead(200, {
        "x-trainer-identity": boot,
        "cache-control": "no-store",
        "content-type": "application/json",
        "content-length": Buffer.byteLength(body),
      })
      .end(body);
  } catch {
    // Refusal never includes input, parser/provider errors, paths or credentials.
    if (!response.headersSent) response.writeHead(409);
    response.end();
  }
}
