import {
  accessSync,
  constants,
  lstatSync,
  mkdirSync,
  readdirSync,
} from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

export type TokenLocation = {
  directory: string;
  tokenFile: string;
  companionFile: string;
};
export type TokenPresence = { ok: boolean; className: string; detail: string };

// Relative settings are relative to the app process cwd (the selected checkout).
// Do not expand shell syntax: upstream must receive an unambiguous absolute path.
export function resolveTokenLocation(
  value: string | undefined,
  cwd = process.cwd(),
): TokenLocation {
  if (!value?.trim())
    throw new Error(
      "Garmin is not connected. Open native Settings → Connect Garmin; chat and offline history remain available.",
    );
  if (
    value !== value.trim() ||
    /[~$]/.test(value) ||
    [...value].some((character) => character.charCodeAt(0) < 32) ||
    /^[a-z]+:/i.test(value)
  ) {
    throw new Error(
      "GARMIN_MCP_TOKEN_DIR must be a literal directory path, without shell expansion or a URL.",
    );
  }
  const directory = isAbsolute(value) ? resolve(value) : resolve(cwd, value);
  return {
    directory,
    tokenFile: join(directory, "garmin_tokens.json"),
    companionFile: join(directory, "garmin_tokens.base64"),
  };
}

export function inspectTokenLocation(value: string | undefined): TokenPresence {
  let location: TokenLocation;
  try {
    location = resolveTokenLocation(value);
  } catch {
    return {
      ok: false,
      className: "garmin.auth_config_invalid",
      detail:
        "Open native Settings → Connect Garmin; no alternate connection is searched.",
    };
  }
  let stage = "directory";
  try {
    const directory = lstatSync(location.directory);
    if (!directory.isDirectory() || directory.isSymbolicLink())
      return {
        ok: false,
        className: "garmin.auth_directory_wrong_type",
        detail: "Configured token location must be a directory, not a symlink.",
      };
    accessSync(location.directory, constants.R_OK | constants.X_OK);
    stage = "file";
    const token = lstatSync(location.tokenFile);
    if (!token.isFile() || token.isSymbolicLink())
      return {
        ok: false,
        className: "garmin.auth_file_wrong_type",
        detail:
          "Expected Garmin token file must be a regular file, not a symlink.",
      };
    if (!token.size)
      return {
        ok: false,
        className: "garmin.auth_file_empty",
        detail:
          "Configured Garmin connection is unavailable. Open native Settings for explicit reconnect; no automatic login.",
      };
    accessSync(location.tokenFile, constants.R_OK);
    return {
      ok: true,
      className: "garmin.auth_state_present",
      detail:
        "Expected Garmin token file is readable and nonempty (metadata only). Presence does not establish authentication validity or expiry.",
    };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    const missing = code === "ENOENT";
    return {
      ok: false,
      className: missing
        ? `garmin.auth_${stage}_missing`
        : "garmin.auth_state_inaccessible",
      detail: missing
        ? "Configured Garmin connection is missing. Open native Settings → Reconnect Garmin, Save and explicitly quit/reopen."
        : "Configured Garmin auth state is inaccessible; check file types and private permissions. No token contents were read.",
    };
  }
}

export function garminTokenEnvironment(
  input: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const location = resolveTokenLocation(input.GARMIN_MCP_TOKEN_DIR);
  const env: NodeJS.ProcessEnv = {
    ...input,
    GARMIN_MCP_TOKEN_DIR: location.directory,
    GARMINTOKENS: location.directory,
    GARMINTOKENS_BASE64: location.companionFile,
    GARMIN_MCP_TRANSPORT: "stdio",
  };
  // Never let an unattended connector switch to password login or read secret files.
  for (const key of [
    "GARMIN_EMAIL",
    "GARMIN_EMAIL_FILE",
    "GARMIN_PASSWORD",
    "GARMIN_PASSWORD_FILE",
    "OPENAI_API_KEY",
    "DEEPSEEK_API_KEY",
    "OPENROUTER_API_KEY",
  ])
    delete env[key];
  return env;
}

// Upstream auth may chmod every file and write both credential artifacts.
// Refuse symlinks and existing credentials rather than silently overwriting them.
export function prepareAuthDirectory(location: TokenLocation): void {
  try {
    mkdirSync(location.directory, { recursive: true, mode: 0o700 });
    const directory = lstatSync(location.directory);
    if (
      !directory.isDirectory() ||
      directory.isSymbolicLink() ||
      directory.mode & 0o077
    )
      throw new Error();
    for (const name of readdirSync(location.directory)) {
      if (
        lstatSync(join(location.directory, name)).isSymbolicLink() ||
        name === "garmin_tokens.json" ||
        name === "garmin_tokens.base64"
      )
        throw new Error();
    }
    accessSync(location.directory, constants.W_OK | constants.X_OK);
  } catch {
    throw new Error(
      "Authentication requires an owner-private directory without symlinks or existing credentials. Preserve and verify existing credentials before requesting a replacement.",
    );
  }
}
