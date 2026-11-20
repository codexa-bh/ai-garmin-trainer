import { execFileSync } from "node:child_process";

// Exercise the real activation entrypoint in an isolated process, as the existing
// desktop runtime tests do. Its environment/umask/Next overlay never leaks here.
export function activateConfiguration(
  fields: Record<string, string>,
  extra: Record<string, unknown> = {},
) {
  const script = `
    const { adoptConfiguration } = require(process.cwd() + '/scripts/desktop/config.ts');
    const { garminKeyConfigured } = require(process.cwd() + '/src/lib/garmin/connection.ts');
    try {
      adoptConfiguration({ version: 3, fields: {AI_PROVIDER:'openai', ...JSON.parse(process.argv[1])}, secrets:{OPENAI_API_KEY:'synthetic-test-key'}, chatCatalog:{version:1,entries:[],defaultEntryId:null}, selectionCompatibility:{database:null,catalog:{version:1,entries:[],defaultEntryId:null}}, ...JSON.parse(process.argv[2]) });
      console.log(JSON.stringify({ env: Object.keys(process.env).filter((k) => /GARMIN|UV_|PYTHON/.test(k)), envText: JSON.stringify(process.env), path: process.env.PATH, garmin: garminKeyConfigured() }));
    } catch (error) { console.error(error.message); process.exit(1); }
  `;
  return JSON.parse(
    execFileSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "-e",
        script,
        JSON.stringify(fields),
        JSON.stringify(extra),
      ],
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
  ) as { env: string[]; envText: string; path: string; garmin: boolean };
}
