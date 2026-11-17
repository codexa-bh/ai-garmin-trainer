// Run a desktop Python helper with the platform's interpreter name: `python3`
// on macOS/Linux, `python` in UTF-8 mode on Windows. Arguments pass through
// unchanged without a shell; the exit status is preserved.
import { spawnSync } from "node:child_process";

const windows = process.platform === "win32";
const [script, ...args] = process.argv.slice(2);
if (!script || !/^scripts\/desktop\/[a-z_]+\.py$/.test(script))
  throw new Error(
    "Usage: node scripts/desktop/python.mjs scripts/desktop/<helper>.py [args]",
  );
const result = spawnSync(
  windows ? "python" : "python3",
  [...(windows ? ["-X", "utf8"] : []), script, ...args],
  { stdio: "inherit" },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
