import { NextResponse } from "next/server";
import { importSummary } from "@/lib/db/repository";

export async function GET() {
  return NextResponse.json(importSummary());
}
