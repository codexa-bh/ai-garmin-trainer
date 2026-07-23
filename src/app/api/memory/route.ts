import { NextResponse } from "next/server";
import { setAppMetadata } from "@/lib/db/repository";
import { DISABLED_METADATA_KEY } from "@/lib/memory/config";
import {
  resetTrainerMemoryStore,
  trainerMemoryStore,
} from "@/lib/memory/sqlite-adapter";

const MAX_MEMORY_VALUE_LENGTH = 700;

function compactText(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

async function memoryPayload() {
  const store = trainerMemoryStore();
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

export async function GET() {
  try {
    return NextResponse.json(await memoryPayload());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "memory list failed" },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const body = (await request.json()) as {
      id?: unknown;
      action?: unknown;
      text?: unknown;
      enabled?: unknown;
    };
    const action = compactText(body.action);
    const store = trainerMemoryStore();

    if (action === "set-enabled") {
      setAppMetadata(
        DISABLED_METADATA_KEY,
        body.enabled === false ? "true" : "false",
      );
      resetTrainerMemoryStore();
      return NextResponse.json(await memoryPayload());
    }

    if (action === "clear") {
      await store.clearAll();
      return NextResponse.json(await memoryPayload());
    }

    const id = compactText(body.id);
    if (!id) {
      return NextResponse.json(
        { error: "Memory id is required" },
        { status: 400 },
      );
    }

    if (action === "delete") {
      await store.delete(id);
      return NextResponse.json(await memoryPayload());
    }

    if (action === "update") {
      const text = compactText(body.text);
      if (!text) {
        return NextResponse.json(
          { error: "Memory text is required" },
          { status: 400 },
        );
      }
      if (text.length > MAX_MEMORY_VALUE_LENGTH) {
        return NextResponse.json(
          {
            error: `Memory text must be ${MAX_MEMORY_VALUE_LENGTH} characters or fewer`,
          },
          { status: 400 },
        );
      }
      await store.update(id, text);
      return NextResponse.json(await memoryPayload());
    }

    return NextResponse.json(
      { error: "Unsupported memory action" },
      { status: 400 },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "memory action failed",
      },
      { status: 400 },
    );
  }
}
