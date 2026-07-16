import { NextResponse } from "next/server";
import { requireSessionEmail } from "@/lib/auth/session";
import { importSummary } from "@/lib/db/repository";

export async function GET() {
  await requireSessionEmail();
  return NextResponse.json(importSummary());
}
