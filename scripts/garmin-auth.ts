import { loadEnvConfig } from "@next/env";
import { runAuth } from "../src/lib/garmin/auth-command";

loadEnvConfig(process.cwd());
try {
  process.exitCode = runAuth(process.env, process.argv.slice(2));
} catch (error) {
  console.error(
    error instanceof Error
      ? error.message
      : "Garmin authentication could not start.",
  );
  process.exitCode = 1;
}
