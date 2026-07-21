import { NextResponse } from "next/server";
import {
  confirmTrainerMemory,
  createTrainerMemoryProposal,
  forgetTrainerMemory,
  listTrainerMemoriesForReview,
  rejectTrainerMemory,
  type StoredTrainerMemory,
  type TrainerMemoryCategory,
} from "@/lib/db/repository";

const MAX_MEMORY_VALUE_LENGTH = 500;
const ALLOWED_CATEGORIES = new Set<TrainerMemoryCategory>([
  "learned_preference",
  "temporary_constraint",
  "commitment",
]);

function serializeMemory(memory: StoredTrainerMemory) {
  return {
    id: memory.id,
    category: memory.category,
    value: memory.value,
    status: memory.status,
    provenanceText: memory.provenanceText,
    expiresAt: memory.expiresAt?.toISOString() ?? null,
    reconfirmAfter: memory.reconfirmAfter?.toISOString() ?? null,
    createdAt: memory.createdAt.toISOString(),
    updatedAt: memory.updatedAt.toISOString(),
  };
}

function compactText(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function unsafeMemoryReason(value: string): string | null {
  const lower = value.toLowerCase();
  if (/\b(password|passcode|api key|secret|token|credential)\b/.test(lower)) {
    return "Credential-like content cannot be stored as learned memory.";
  }
  if (/\b(raw fit|fit bytes|connector payload|garmin password)\b/.test(lower)) {
    return "Raw connector, FIT, or Garmin credential details cannot be stored as learned memory.";
  }
  if (
    /\b(diagnos(?:e|is|ed)|prescription|medication dosage|blood pressure|symptom)\b/.test(
      lower,
    )
  ) {
    return "Medical or sensitive health details need a safer Profile/task flow, not learned memory.";
  }
  return null;
}

function parseCategory(value: unknown): TrainerMemoryCategory {
  return typeof value === "string" &&
    ALLOWED_CATEGORIES.has(value as TrainerMemoryCategory)
    ? (value as TrainerMemoryCategory)
    : "learned_preference";
}

function memoryListPayload() {
  const memories = listTrainerMemoriesForReview().map(serializeMemory);
  return {
    memories,
    pending: memories.filter((item) => item.status === "pending_confirmation"),
    confirmed: memories.filter((item) => item.status === "confirmed"),
  };
}

export async function GET() {
  try {
    return NextResponse.json(memoryListPayload());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "memory list failed" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      value?: unknown;
      category?: unknown;
      provenanceText?: unknown;
    };
    const value = compactText(body.value);
    if (!value) {
      return NextResponse.json(
        { error: "Memory text is required" },
        { status: 400 },
      );
    }
    if (value.length > MAX_MEMORY_VALUE_LENGTH) {
      return NextResponse.json(
        {
          error: `Memory text must be ${MAX_MEMORY_VALUE_LENGTH} characters or fewer`,
        },
        { status: 400 },
      );
    }
    const unsafeReason = unsafeMemoryReason(value);
    if (unsafeReason) {
      return NextResponse.json({ error: unsafeReason }, { status: 400 });
    }
    const memory = createTrainerMemoryProposal({
      category: parseCategory(body.category),
      value,
      sourceType: "user_interface",
      provenanceText:
        compactText(body.provenanceText) || "User-created memory proposal.",
    });
    return NextResponse.json({
      memory: serializeMemory(memory),
      ...memoryListPayload(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "memory proposal failed",
      },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const body = (await request.json()) as { id?: unknown; action?: unknown };
    const id = compactText(body.id);
    const action = compactText(body.action);
    if (!id) {
      return NextResponse.json(
        { error: "Memory id is required" },
        { status: 400 },
      );
    }
    let memory: StoredTrainerMemory;
    if (action === "approve") {
      memory = confirmTrainerMemory(id);
    } else if (action === "reject") {
      memory = rejectTrainerMemory(id);
    } else if (action === "forget") {
      memory = forgetTrainerMemory(id);
    } else {
      return NextResponse.json(
        { error: "Unsupported memory action" },
        { status: 400 },
      );
    }
    return NextResponse.json({
      memory: serializeMemory(memory),
      ...memoryListPayload(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "memory action failed",
      },
      { status: 400 },
    );
  }
}
