import { NextResponse } from "next/server";
import {
  verifyGarminConnection as verifyConnectorToken,
  runGarminSync,
  isGarminSyncRunning,
  syncSummary,
} from "@/lib/garmin/composition";

export async function GET() {
  const verification = await verifyConnectorToken();
  return NextResponse.json(verification, {
    status: verification.ok ? 200 : 409,
  });
}

export async function POST(request?: Request) {
  // Bodyless legacy callers keep their bounded interactive semantics. New UI
  // callers always name one intent; reject unknown inputs before capabilities.
  let intent: import("@/lib/garmin/sync-policy").SyncIntent | undefined;
  const body = request ? await request.text() : "";
  if (body) {
    try {
      if (body.length > 128) throw new Error("oversized");
      const input = JSON.parse(body) as Record<string, unknown>;
      if (
        !input ||
        Array.isArray(input) ||
        Object.keys(input).length !== 1 ||
        (input.intent !== "latest" && input.intent !== "history")
      )
        throw new Error("invalid intent");
      intent = input.intent;
    } catch {
      return NextResponse.json(
        {
          status: "blocked",
          detail: "Expected exactly one Sync intent: latest or history.",
        },
        { status: 400 },
      );
    }
  }
  // The only alternate envelope strictly lowers admission for native/API smoke.
  // It grants no private-input/account authority and never changes normal UI Sync.
  const budget = request?.headers.get("x-trainer-sync-budget");
  if (budget && budget !== "finite-live-smoke")
    return NextResponse.json(
      { status: "blocked", detail: "Unsupported Sync budget selector." },
      { status: 400 },
    );
  if (isGarminSyncRunning())
    return NextResponse.json(
      {
        status: "blocked",
        detail:
          "A Garmin sync is still running; refresh summary before retrying.",
      },
      { status: 409 },
    );
  if (
    intent === "history" &&
    syncSummary().sync.historical.state !== "available"
  )
    return NextResponse.json(
      {
        status: "blocked",
        detail:
          "Historical work is not actionable. Refresh summary; preserve saved checkpoints for recovery.",
      },
      { status: 409 },
    );
  const verification = await verifyConnectorToken();
  if (!verification.ok) {
    return NextResponse.json(
      {
        status: "blocked",
        detail: verification.detail,
      },
      { status: 409 },
    );
  }
  const encoder = new TextEncoder();
  let disconnected = false;
  const cancelled = () => disconnected || Boolean(request?.signal.aborted);
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: unknown) => {
        if (!cancelled())
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };
      try {
        const result = await runGarminSync(
          (progress) => send({ type: "progress", ...progress }),
          {
            cancelled,
            intent,
            interactive: true,
            finiteLiveSmoke: budget === "finite-live-smoke",
          },
        );
        send({ type: "result", ...result });
        if (!disconnected) controller.close();
      } catch {
        send({
          type: "result",
          status: "failed",
          detail:
            "Sync could not settle; refresh durable summary before retrying.",
        });
        if (!disconnected) controller.close();
      }
    },
    cancel() {
      disconnected = true;
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-cache",
    },
  });
}
