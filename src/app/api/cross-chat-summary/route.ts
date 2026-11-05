import { NextResponse } from "next/server";
import {
  applySummaryCommand,
  prepareSummaryAdoption,
  nativeSummaryStatus,
  readCrossChatSummary,
  tickCrossChatSummary,
  summaryRebuildPending,
} from "@/lib/memory/summary-composition";
import { parseSummaryCommand } from "@/lib/memory/summary-controls";

export async function GET(request: Request) {
  try {
    if (new URL(request.url).searchParams.get("view") === "native")
      return NextResponse.json(nativeSummaryStatus(), {
        headers: { "cache-control": "no-store" },
      });
    return NextResponse.json(
      readCrossChatSummary(
        new URL(request.url).searchParams.get("view") === "content",
        new URL(request.url).searchParams.get("conversationId") ?? undefined,
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
      const command = parseSummaryCommand(await request.json());
      if (!command)
        return NextResponse.json(
          { error: "Unsupported summary control." },
          { status: 400 },
        );
      applySummaryCommand(await prepareSummaryAdoption(command));
    }
    return NextResponse.json(readCrossChatSummary(), {
      headers: identity
        ? { "x-trainer-rebuild-pending": String(summaryRebuildPending()) }
        : undefined,
    });
  } catch (error) {
    const stale =
      error instanceof Error &&
      [
        "summary_stale_action",
        "summary_rebuild_stale_preflight",
        "summary_rebuild_busy",
        "summary_rebuild_identity_conflict",
        "conversation_busy_retry_after_current_turn",
      ].includes(error.message);
    return NextResponse.json(
      {
        error: stale
          ? "Memory changed or this chat is busy. Reload and review before trying again."
          : "Summary operation unavailable; no success claimed.",
      },
      { status: stale ? 409 : 503 },
    );
  }
}
