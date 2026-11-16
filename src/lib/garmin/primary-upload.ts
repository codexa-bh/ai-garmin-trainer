export type PrimaryUpload =
  | { kind: "known"; primaryId: string; uploadedAt: string }
  | {
      kind: "unknown";
      reason:
        | "no-devices"
        | "ambiguous-primary"
        | "invalid-device"
        | "invalid-upload"
        | "unrecognized-reply";
    };

/** The pinned get_devices curated wire shape. Never retain names/serials. */
export function primaryUpload(
  payload: unknown,
  observedAt: Date,
): PrimaryUpload {
  const unknown = (
    reason: Extract<PrimaryUpload, { kind: "unknown" }>["reason"],
  ): PrimaryUpload => ({ kind: "unknown", reason });
  if (!Array.isArray(payload)) return unknown("unrecognized-reply");
  if (!payload.length) return unknown("no-devices");
  if (
    payload.some(
      (item) => !item || typeof item !== "object" || Array.isArray(item),
    )
  )
    return unknown("invalid-device");
  const devices = payload as Record<string, unknown>[];
  if (
    devices.some(
      (device) =>
        device.is_primary !== undefined &&
        typeof device.is_primary !== "boolean",
    )
  )
    return unknown("invalid-device");
  const flagged = devices.filter((device) => device.is_primary === true);
  const device =
    flagged.length === 1
      ? flagged[0]
      : flagged.length === 0 && devices.length === 1
        ? devices[0]
        : null;
  if (!device) return unknown("ambiguous-primary");
  const id = device.device_id;
  if (!(
    (typeof id === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(id)) ||
    (typeof id === "number" && Number.isSafeInteger(id) && id > 0)
  ))
    return unknown("invalid-device");
  const raw = device.last_sync_time;
  let milliseconds = NaN;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    // Disjoint modern epoch ranges: no guessing numeric strings or small values.
    milliseconds =
      raw >= 946684800 && raw < 10000000000
        ? raw * 1000
        : raw >= 946684800000
          ? raw
          : NaN;
  } else if (
    typeof raw === "string" &&
    /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:0\d|1[0-3]):[0-5]\d|[+-]14:00)$/.test(
      raw,
    )
  ) {
    // Reject normalized impossible calendar dates (Date.parse accepts Feb 30).
    const calendar = raw.slice(0, 10);
    const parsedDate = new Date(`${calendar}T00:00:00Z`);
    if (
      Number.isFinite(parsedDate.getTime()) &&
      parsedDate.toISOString().slice(0, 10) === calendar
    )
      milliseconds = Date.parse(raw);
  }
  if (
    !Number.isFinite(milliseconds) ||
    milliseconds < 946684800000 ||
    milliseconds > observedAt.getTime()
  )
    return unknown("invalid-upload");
  return {
    kind: "known",
    primaryId: String(id),
    uploadedAt: new Date(milliseconds).toISOString(),
  };
}
