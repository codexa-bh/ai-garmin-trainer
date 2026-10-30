export function acceptsDesktopRequest(
  headers: { host?: string; origin?: string; "sec-fetch-site"?: string },
  origin: string,
): boolean {
  if (headers.host !== new URL(origin).host) return false;
  if (headers.origin !== undefined && headers.origin !== origin) return false;
  return (
    !headers["sec-fetch-site"] ||
    ["same-origin", "none"].includes(headers["sec-fetch-site"])
  );
}
