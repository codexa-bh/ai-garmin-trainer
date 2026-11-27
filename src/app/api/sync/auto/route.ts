import { NextResponse } from "next/server";
import {
  garminAutoSyncOwner,
  runGarminAutoSync,
} from "@/lib/garmin/composition";

/** Fixed private launcher tick; not another public Sync intent or renderer timer. */
export async function POST(request: Request) {
  try {
    if (
      !garminAutoSyncOwner(request.headers.get("x-trainer-identity")) ||
      (request.headers.has("content-length") &&
        request.headers.get("content-length") !== "0") ||
      request.headers.has("transfer-encoding") ||
      (await request.text()) !== ""
    )
      return new Response(null, { status: 404 });
  } catch {
    return new Response(null, { status: 404 });
  }
  try {
    const result = await runGarminAutoSync(request.signal);
    return NextResponse.json({ status: result?.status ?? "idle" });
  } catch {
    // Preserve existing checkpoints and failure/recovery. No private exceptions
    // or speculative success, and no immediate automatic replay.
    return NextResponse.json({ status: "blocked" }, { status: 409 });
  }
}
