import { NextResponse } from "next/server";
import { activeMemoryStatus, memoryManagement } from "@/lib/memory/composition";

export async function GET(request?: Request) {
  const statusOnly =
    request && new URL(request.url).searchParams.get("view") === "status";
  try {
    if (statusOnly)
      return NextResponse.json(activeMemoryStatus(), {
        headers: { "cache-control": "no-store" },
      });
    return NextResponse.json(await memoryManagement.read());
  } catch (error) {
    return NextResponse.json(
      {
        error: statusOnly
          ? "Memory status unavailable; no readiness claim."
          : error instanceof Error
            ? error.message
            : "memory list failed",
      },
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
