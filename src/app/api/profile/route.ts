import { NextResponse } from "next/server";
import { getTrainerProfile, saveTrainerProfile } from "@/lib/db/repository";
import type { TrainerProfile } from "@/lib/ai/context";

function lines(value: unknown): string[] {
  if (Array.isArray(value))
    return value
      .map(String)
      .map((item) => item.trim())
      .filter(Boolean);
  if (typeof value === "string")
    return value
      .split(/\r?\n|,/)
      .map((item) => item.trim())
      .filter(Boolean);
  return [];
}

export async function GET() {
  return NextResponse.json(getTrainerProfile());
}

export async function POST(request: Request) {
  const body = (await request.json()) as Partial<TrainerProfile>;
  const profile = saveTrainerProfile({
    goals: lines(body.goals),
    sports: lines(body.sports),
    preferences:
      typeof body.preferences === "object" &&
      body.preferences &&
      !Array.isArray(body.preferences)
        ? body.preferences
        : {},
    constraints: lines(body.constraints),
  });
  return NextResponse.json({ ok: true, profile });
}
