import { ChildProcessWithoutNullStreams } from "node:child_process";
import { spawnGarminMcp } from "./client";

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
};

type ToolCallResult = {
  content?: Array<{ type: string; text?: string }>;
  isError?: boolean;
};

export class GarminMcpClient {
  private child: ChildProcessWithoutNullStreams | undefined;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private buffer = "";
  private stderr = "";

  async start(): Promise<void> {
    this.child = spawnGarminMcp();
    this.child.stdout.on("data", (chunk: string) => this.onStdout(chunk));
    this.child.stderr.on("data", (chunk: string) => {
      this.stderr = `${this.stderr}${chunk}`.slice(-4000);
    });
    this.child.on("exit", (code) => {
      const error = new Error(
        `Garmin MCP exited with code ${code}. ${this.stderr}`,
      );
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
    });

    await this.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "ai-garmin-connect-trainer", version: "0.1.0" },
    });
    this.notify("notifications/initialized", {});
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    const result = (await this.request("tools/call", {
      name,
      arguments: args,
    })) as ToolCallResult;
    const text = result.content
      ?.filter((part) => part.type === "text")
      .map((part) => part.text ?? "")
      .join("\n")
      .trim();
    if (result.isError)
      throw new Error(text || `Garmin MCP tool ${name} failed`);
    return text ?? "";
  }

  close(): void {
    if (!this.child) return;
    this.child.kill("SIGTERM");
    this.child = undefined;
  }

  private onStdout(chunk: string): void {
    this.buffer += chunk;
    while (true) {
      const newline = this.buffer.indexOf("\n");
      if (newline === -1) return;
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (!line) continue;
      let message: unknown;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      const maybe = message as {
        id?: number;
        result?: unknown;
        error?: { message?: string };
      };
      if (typeof maybe.id !== "number") continue;
      const pending = this.pending.get(maybe.id);
      if (!pending) continue;
      clearTimeout(pending.timeout);
      this.pending.delete(maybe.id);
      if (maybe.error)
        pending.reject(new Error(maybe.error.message ?? "MCP request failed"));
      else pending.resolve(maybe.result);
    }
  }

  private request(
    method: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    if (!this.child) throw new Error("Garmin MCP client is not started");
    const id = this.nextId++;
    const message = { jsonrpc: "2.0", id, method, params };
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new Error(`Garmin MCP request timed out: ${method}. ${this.stderr}`),
        );
      }, 120_000);
      this.pending.set(id, { resolve, reject, timeout });
      this.child?.stdin.write(`${JSON.stringify(message)}\n`);
    });
  }

  private notify(method: string, params: Record<string, unknown>): void {
    if (!this.child) throw new Error("Garmin MCP client is not started");
    this.child.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`,
    );
  }
}
