import { NextResponse } from "next/server";
import { trainerProfile } from "@/lib/profile/composition";
import type { TrainerProfile } from "@/lib/profile/contracts";

export async function GET() {
  return NextResponse.json(trainerProfile.read());
}

export async function POST(request: Request) {
  const body = (await request.json()) as Partial<TrainerProfile>;
  return NextResponse.json({ ok: true, profile: trainerProfile.save(body) });
}
