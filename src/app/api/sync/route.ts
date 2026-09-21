import { NextResponse } from "next/server";
import {
  verifyGarminConnection as verifyConnectorToken,
  runGarminSync,
} from "@/lib/garmin/composition";

export async function GET() {
  const verification = await verifyConnectorToken();
  return NextResponse.json(verification, {
    status: verification.ok ? 200 : 409,
  });
}

export async function POST() {
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
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: unknown) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };
      const result = await runGarminSync((progress) =>
        send({ type: "progress", ...progress }),
      );
      send({ type: "result", ...result });
      controller.close();
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
