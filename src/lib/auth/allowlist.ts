import { getOptionalEnv, isEmailAllowed } from "../env";

export function assertAllowedGoogleEmail(email: string): string {
  if (!isEmailAllowed(email, getOptionalEnv()))
    throw new Error(
      "Google account is not allowlisted for this private trainer",
    );
  return email.toLowerCase();
}

export function authDisclosure(): string {
  return "Google sign-in is restricted by ALLOWED_GOOGLE_EMAILS and protected routes/actions re-check the server-side session.";
}
