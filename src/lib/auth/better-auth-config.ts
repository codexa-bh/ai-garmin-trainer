import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import * as schema from "../db/schema";
import { assertAllowedGoogleEmail } from "./allowlist";
import { getOptionalEnv } from "../env";

const env = getOptionalEnv();
mkdirSync(dirname(env.DATABASE_PATH), { recursive: true });
const sqlite = new Database(env.DATABASE_PATH);
const db = drizzle(sqlite, { schema });

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "sqlite" }),
  secret: env.BETTER_AUTH_SECRET ?? "local-build-placeholder-change-me",
  baseURL: env.NEXT_PUBLIC_APP_URL,
  socialProviders: {
    google: {
      clientId: env.GOOGLE_CLIENT_ID ?? "missing-google-client-id",
      clientSecret: env.GOOGLE_CLIENT_SECRET ?? "missing-google-client-secret",
    },
  },
  databaseHooks: {
    user: {
      create: {
        before: async (user) => ({
          data: { ...user, email: assertAllowedGoogleEmail(user.email) },
        }),
      },
    },
  },
});
