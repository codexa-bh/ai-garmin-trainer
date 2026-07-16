import { NextResponse } from "next/server";
import { assertAllowedGoogleEmail } from "@/lib/auth/allowlist";
import { allowedEmails, getOptionalEnv } from "@/lib/env";

export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production")
    return NextResponse.json({ error: "disabled" }, { status: 404 });
  const { email } = (await request.json().catch(() => ({}))) as {
    email?: string;
  };
  const configuredEmail = [...allowedEmails(getOptionalEnv())][0];
  const selectedEmail = email?.trim() || configuredEmail;
  if (!selectedEmail)
    return NextResponse.json(
      { error: "ALLOWED_GOOGLE_EMAILS must contain at least one email" },
      { status: 400 },
    );
  const allowed = assertAllowedGoogleEmail(selectedEmail);
  const response = NextResponse.json({ ok: true, email: allowed });
  response.cookies.set("trainer_email", allowed, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  });
  return response;
}
