import { cookies } from "next/headers";
import { assertAllowedGoogleEmail } from "./allowlist";

export async function requireSessionEmail(): Promise<string> {
  const cookieStore = await cookies();
  const email = cookieStore.get("trainer_email")?.value;
  if (!email) throw new Error("Authentication required");
  return assertAllowedGoogleEmail(email);
}
