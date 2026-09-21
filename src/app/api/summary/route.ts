import { NextResponse } from "next/server";
import { importSummary } from "@/lib/local-data/composition";

export async function GET() {
  return NextResponse.json(importSummary());
}
