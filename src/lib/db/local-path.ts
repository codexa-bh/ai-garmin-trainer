import { realpathSync } from "node:fs";
import { isAbsolute } from "node:path";

// Supported desktop storage paths are local and already canonical. The native
// owner (private_fs.rs) applies the same rule before any private-state effect.
const WINDOWS_DEVICE =
  /^(con|prn|aux|nul|conin\$|conout\$|com[0-9¹²³]|lpt[0-9¹²³])$/i;

/** Windows drive-letter absolute form: no UNC, device, verbatim, relative-drive,
 * forward-slash, alternate-stream, reserved-device or trailing dot/space names. */
function windowsLocalForm(value: string): boolean {
  if (!/^[A-Za-z]:\\/.test(value) || value.length > 32767) return false;
  const rest = value.slice(3);
  if (rest === "") return true;
  return rest
    .split("\\")
    .every(
      (part) =>
        part !== "" &&
        part !== "." &&
        part !== ".." &&
        part.length <= 255 &&
        !/[<>:"/|?*]/.test(part) &&
        ![...part].some((character) => character.charCodeAt(0) < 32) &&
        !/[. ]$/.test(part) &&
        !WINDOWS_DEVICE.test(part.split(".")[0]!.trimEnd()),
    );
}

/** Resolve links and, on Windows, case/8.3/junction/subst aliases to the final path. */
export function realLocalPath(
  path: string,
  platform: NodeJS.Platform = process.platform,
): string {
  return platform === "win32" ? realpathSync.native(path) : realpathSync(path);
}

/** True only for the absolute local canonical spelling of an existing object. */
export function isCanonicalLocalPath(
  value: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (platform === "win32" ? !windowsLocalForm(value) : !isAbsolute(value))
    return false;
  try {
    return realLocalPath(value, platform) === value;
  } catch {
    return false;
  }
}
