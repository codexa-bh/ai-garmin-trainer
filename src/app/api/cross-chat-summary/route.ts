import { NextResponse } from "next/server";
import {
  changeCrossChatSummary,
  readCrossChatSummary,
  tickCrossChatSummary,
} from "@/lib/memory/summary-composition";

export async function GET(request: Request) {
  try {
    return NextResponse.json(
      readCrossChatSummary(
        new URL(request.url).searchParams.get("view") === "content",
      ),
    );
  } catch {
    return NextResponse.json(
      {
        error: "Summary unavailable; preserve data and use a compatible build.",
      },
      { status: 503 },
    );
  }
}
export async function POST(request: Request) {
  try {
    const identity = request.headers.get("x-trainer-identity");
    if (identity) {
      if (
        request.headers.has("origin") ||
        request.headers.has("sec-fetch-site")
      )
        return NextResponse.json(
          { error: "Summary tick denied." },
          { status: 403 },
        );
      await tickCrossChatSummary(identity);
    } else {
      const body: unknown = await request.json();
      if (
        !body ||
        typeof body !== "object" ||
        Array.isArray(body) ||
        Object.keys(body).join() !== "action" ||
        !["clear", "disable", "enable", "retry"].includes(
          String((body as { action?: unknown }).action),
        )
      )
        return NextResponse.json(
          { error: "Unsupported summary control." },
          { status: 400 },
        );
      changeCrossChatSummary(
        (body as { action: "clear" | "disable" | "enable" | "retry" }).action,
      );
    }
    return NextResponse.json(readCrossChatSummary());
  } catch {
    return NextResponse.json(
      { error: "Summary operation unavailable; no success claimed." },
      { status: 503 },
    );
  }
}
