import { execFileSync } from "node:child_process";

// Exercise the real activation entrypoint in an isolated process, as the existing
// desktop runtime tests do. Its environment/umask/Next overlay never leaks here.
export function activateConfiguration(fields: Record<string, string>) {
  const script = `
    const { adoptConfiguration } = require(process.cwd() + '/scripts/desktop/config.ts');
    try {
      const available = adoptConfiguration({ version: 1, fields: {AI_PROVIDER:'openai', ...JSON.parse(process.argv[1])}, secrets:{OPENAI_API_KEY:'synthetic-test-key'} });
      console.log(JSON.stringify({available, uv:process.env.GARMIN_FIT_BASELINE_COMMAND, uvx:process.env.GARMIN_MCP_COMMAND}));
    } catch (error) { console.error(error.message); process.exit(1); }
  `;
  return JSON.parse(
    execFileSync(
      process.execPath,
      ["--import", "tsx", "-e", script, JSON.stringify(fields)],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          NODE_ENV: "production",
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          USERPROFILE: process.env.USERPROFILE,
          SystemRoot: process.env.SystemRoot,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    ),
  ) as { available: { uv: boolean; uvx: boolean }; uv: string; uvx: string };
}
