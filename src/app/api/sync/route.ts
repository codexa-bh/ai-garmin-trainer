import { NextResponse } from "next/server";
import {
  verifyGarminConnection as verifyConnectorToken,
  runGarminSync,
  isGarminSyncRunning,
} from "@/lib/garmin/composition";

export async function GET() {
  const verification = await verifyConnectorToken();
  return NextResponse.json(verification, {
    status: verification.ok ? 200 : 409,
  });
}

export async function POST(request?: Request) {
  if (isGarminSyncRunning())
    return NextResponse.json(
      {
        status: "blocked",
        detail:
          "A Garmin sync is still running; refresh summary before retrying.",
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
          { cancelled, interactive: true },
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
