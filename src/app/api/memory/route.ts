import { NextResponse } from "next/server";
import { memoryManagement } from "@/lib/memory/composition";

export async function GET() {
  try {
    return NextResponse.json(await memoryManagement.read());
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
    return NextResponse.json(await memoryManagement.change(body));
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "memory action failed",
      },
      { status: 400 },
    );
  }
}
