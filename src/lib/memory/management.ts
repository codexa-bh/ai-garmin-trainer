import type { TrainerMemoryStore } from "./types";

function compactText(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

export function createMemoryManagement(ports: {
  store(): TrainerMemoryStore;
  setEnabled(enabled: boolean): void;
}) {
  async function read() {
    const store = ports.store();
    const health = await store.health();
    const page = health.ready
      ? await store.list(40)
      : { memories: [], nextCursor: null };
    return {
      health,
      enabled: health.enabled,
      ready: health.ready,
      memories: page.memories,
      nextCursor: page.nextCursor,
    };
  }
  return {
    read,
    async change(body: {
      id?: unknown;
      action?: unknown;
      text?: unknown;
      enabled?: unknown;
    }) {
      const action = compactText(body.action);
      const store = ports.store();
      if (action === "set-enabled") {
        ports.setEnabled(body.enabled !== false);
        return read();
      }
      if (action === "clear") {
        await store.clearAll();
        return read();
      }
      const id = compactText(body.id);
      if (!id) throw new Error("Memory id is required");
      if (action === "delete") {
        await store.delete(id);
        return read();
      }
      if (action === "update") {
        const text = compactText(body.text);
        if (!text) throw new Error("Memory text is required");
        if (text.length > 700)
          throw new Error("Memory text must be 700 characters or fewer");
        await store.update(id, text);
        return read();
      }
      throw new Error("Unsupported memory action");
    },
  };
}
