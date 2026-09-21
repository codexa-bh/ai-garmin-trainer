import { NextResponse } from "next/server";
import { deleteLocalData } from "@/lib/local-data/composition";

export async function POST(request: Request) {
  const { scope } = (await request.json()) as {
    scope: "chat-profile" | "garmin-all";
  };
  const result = deleteLocalData(scope);
  if (result) return NextResponse.json(result);
  return NextResponse.json(
    { error: "unknown deletion scope" },
    { status: 400 },
  );
}
