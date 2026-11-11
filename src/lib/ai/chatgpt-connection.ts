// Private native-to-owned-backend capability. Never exported by a client DTO.
import { applyChatgptConnections } from "../env";
import { containsControlCharacters } from "../model-settings/catalog";
import {
  validateChatgptConnections,
  type ChatgptConnection,
} from "../model-settings/chatgpt-metadata";
type Descriptor = {
  version: 1;
  port: number;
  capability: string;
  connections: ChatgptConnection[];
};
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const bounded = (value: unknown, max: number): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= max &&
  !containsControlCharacters(value);
export function validateChatgptDescriptor(input: unknown): Descriptor {
  if (
    !object(input) ||
    Object.keys(input).sort().join() !==
      "capability,connections,port,version" ||
    input.version !== 1 ||
    !Number.isInteger(input.port) ||
    (input.port as number) < 1 ||
    (input.port as number) > 65535 ||
    typeof input.capability !== "string" ||
    !/^[a-f0-9-]{72}$/.test(input.capability)
  )
    throw new Error("chatgpt_owner_invalid");
  return {
    version: 1,
    port: input.port as number,
    capability: input.capability,
    connections: validateChatgptConnections(input.connections),
  };
}
function cell(): { descriptor?: Descriptor } {
  const owner = process as typeof process & {
    __trainerChatgptOwnerV1?: { descriptor?: Descriptor };
  };
  return (owner.__trainerChatgptOwnerV1 ??= {});
}
export function chatgptOwnerInitialized(): boolean {
  return Boolean(cell().descriptor);
}
export function initializeChatgptOwner(input: unknown): void {
  if (cell().descriptor) throw new Error("chatgpt_owner_already_initialized");
  cell().descriptor = validateChatgptDescriptor(input);
}
export function chatgptConnections(
  raw: string | undefined,
): ChatgptConnection[] {
  return raw === undefined
    ? []
    : validateChatgptConnections(JSON.parse(raw) as unknown);
}
export function chatgptConnection(
  raw: string | undefined,
  id: string | undefined,
  model: string,
): ChatgptConnection | undefined {
  return chatgptConnections(raw).find(
    (connection) =>
      connection.id === id &&
      connection.state === "connected" &&
      connection.planEnabled &&
      connection.models.some((m) => m.slug === model),
  );
}
export async function nativeChatgptCredential(
  operation: "credential" | "current",
  registrationId: string,
  epoch: number,
  signal: AbortSignal,
  transport: typeof fetch = fetch,
): Promise<{ accessToken?: string }> {
  const descriptor = cell().descriptor;
  if (!descriptor) throw new Error("chatgpt_connection_unavailable");
  const body = JSON.stringify({ operation, registrationId, epoch });
  let response: Response;
  try {
    response = await transport(
      `http://127.0.0.1:${descriptor.port}/credential`,
      {
        method: "POST",
        redirect: "error",
        headers: {
          "x-chatgpt-owner": descriptor.capability,
          "content-type": "application/json",
        },
        body,
        signal: AbortSignal.any([
          signal,
          AbortSignal.timeout(operation === "credential" ? 55000 : 5000),
        ]),
      },
    );
  } catch {
    throw new Error("chatgpt_connection_unavailable");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("chatgpt_connection_unavailable");
  let bytes = new Uint8Array();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (bytes.length + value.length > 128 * 1024)
        throw new Error("chatgpt_connection_unavailable");
      const next = new Uint8Array(bytes.length + value.length);
      next.set(bytes);
      next.set(value, bytes.length);
      bytes.fill(0);
      bytes = next;
    }
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!response.ok) {
      if (
        object(value) &&
        Object.keys(value).sort().join() === "code,connections" &&
        value.code === "chatgpt_connection_unavailable"
      ) {
        // An authenticated native refusal carries current secret-free truth,
        // not a new credential grant or a replay of the failed inference.
        applyChatgptConnections(value.connections);
      }
      throw new Error("chatgpt_connection_unavailable");
    }
    if (
      !object(value) ||
      (operation === "current"
        ? Object.keys(value).join() !== "current" || value.current !== true
        : Object.keys(value).sort().join() !== "accessToken,epoch" ||
          value.epoch !== epoch ||
          !bounded(value.accessToken, 16384))
    )
      throw new Error("chatgpt_connection_unavailable");
    return operation === "current"
      ? {}
      : { accessToken: value.accessToken as string };
  } catch {
    throw new Error("chatgpt_connection_unavailable");
  } finally {
    bytes.fill(0);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
