import { NextResponse } from "next/server";
import { assertAllowedGoogleEmail } from "@/lib/auth/allowlist";

export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production")
    return NextResponse.json({ error: "disabled" }, { status: 404 });
  const { email } = (await request.json()) as { email?: string };
  if (!email)
    return NextResponse.json({ error: "email required" }, { status: 400 });
  const allowed = assertAllowedGoogleEmail(email);
  const response = NextResponse.json({ ok: true, email: allowed });
  response.cookies.set("trainer_email", allowed, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  });
  return response;
}
