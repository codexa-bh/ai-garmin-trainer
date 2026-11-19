export type PrimaryUpload =
  | {
      kind: "known";
      primaryId: string;
      /** Earliest possible upload instant. */
      uploadedAt: string;
      /** Latest possible instant when the source rendered whole seconds only. */
      uploadedThrough?: string;
      via?: "last-used";
    }
  | {
      kind: "unknown";
      reason:
        | "no-devices"
        | "ambiguous-primary"
        | "invalid-device"
        | "invalid-upload"
        | "unrecognized-reply"
        | "last-used-unavailable"
        | "last-used-mismatch"
        | "last-used-invalid";
    };
type UnknownReason = Extract<PrimaryUpload, { kind: "unknown" }>["reason"];

/** Internal selection result: a validated selected identity survives an
 * unusable direct upload, so only that case may consult last-used evidence. */
export type PrimarySelection =
  | { kind: "unselected"; reason: UnknownReason }
  | { kind: "selected"; primaryId: string; upload: PrimaryUpload };

const MIN_UPLOAD = 946684800000;
const ID_KEYS = new Set(["device_id", "user_device_id"]);
const unknown = (reason: UnknownReason): PrimaryUpload => ({
  kind: "unknown",
  reason,
});

/** Parses curated device replies, keeping numeric identifiers only when their
 * exact JSON spelling is a canonical safe integer (no 1.0, 1e3, rounding). */
export function parseCuratedDeviceJson(text: string): unknown {
  return JSON.parse(
    text,
    function (key, value: unknown, context?: { source?: string }) {
      if (!ID_KEYS.has(key) || typeof value !== "number") return value;
      return typeof context?.source === "string" &&
        /^[1-9]\d{0,15}$/.test(context.source) &&
        Number.isSafeInteger(value)
        ? value
        : NaN;
    },
  );
}

/** Lossless canonical identity: positive safe integer or bounded token text.
 * Cross-type equality is exact text equality of these canonical forms. */
function deviceId(id: unknown): string | null {
  if (typeof id === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(id)) return id;
  if (typeof id === "number" && Number.isSafeInteger(id) && id > 0)
    return String(id);
  return null;
}

function validCalendar(date: string): boolean {
  const parsed = new Date(`${date}T00:00:00Z`);
  return (
    Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === date
  );
}

function directUpload(raw: unknown, observedAt: Date): number {
  let milliseconds = NaN;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    // Disjoint modern epoch ranges: no guessing numeric strings or small values.
    milliseconds =
      raw >= 946684800 && raw < 10000000000
        ? raw * 1000
        : raw >= MIN_UPLOAD
          ? raw
          : NaN;
  } else if (
    typeof raw === "string" &&
    /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:0\d|1[0-3]):[0-5]\d|[+-]14:00)$/.test(
      raw,
    ) &&
    // Reject normalized impossible calendar dates (Date.parse accepts Feb 30).
    validCalendar(raw.slice(0, 10))
  )
    milliseconds = Date.parse(raw);
  return Number.isFinite(milliseconds) &&
    milliseconds >= MIN_UPLOAD &&
    milliseconds <= observedAt.getTime()
    ? milliseconds
    : NaN;
}

/** The pinned get_devices curated wire shape. Never retain names/serials. */
export function selectPrimary(
  payload: unknown,
  observedAt: Date,
): PrimarySelection {
  const unselected = (reason: UnknownReason): PrimarySelection => ({
    kind: "unselected",
    reason,
  });
  if (!Array.isArray(payload)) return unselected("unrecognized-reply");
  if (!payload.length) return unselected("no-devices");
  if (
    payload.some(
      (item) => !item || typeof item !== "object" || Array.isArray(item),
    )
  )
    return unselected("invalid-device");
  const devices = payload as Record<string, unknown>[];
  if (
    devices.some(
      (device) =>
        device.is_primary !== undefined &&
        typeof device.is_primary !== "boolean",
    )
  )
    return unselected("invalid-device");
  const flagged = devices.filter((device) => device.is_primary === true);
  const device =
    flagged.length === 1
      ? flagged[0]
      : flagged.length === 0 && devices.length === 1
        ? devices[0]
        : null;
  if (!device) return unselected("ambiguous-primary");
  const primaryId = deviceId(device.device_id);
  if (primaryId === null) return unselected("invalid-device");
  const milliseconds = directUpload(device.last_sync_time, observedAt);
  return {
    kind: "selected",
    primaryId,
    upload: Number.isFinite(milliseconds)
      ? {
          kind: "known",
          primaryId,
          uploadedAt: new Date(milliseconds).toISOString(),
        }
      : unknown("invalid-upload"),
  };
}

/**
 * Pinned get_device_last_used curated reply, read only from the dedicated
 * connector process whose local zone is fixed to UTC. Upstream renders the
 * source epoch with `fromtimestamp(...).strftime("%Y-%m-%d %H:%M:%S")`, so the
 * text names a whole UTC second: the upload lies in [second, second + 999 ms].
 * The entire interval must precede observation; never parse it host-locally.
 */
export function lastUsedUpload(
  payload: unknown,
  primaryId: string,
  observedAt: Date,
): PrimaryUpload {
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    return unknown("last-used-invalid");
  const reply = payload as Record<string, unknown>;
  const id = deviceId(reply.user_device_id);
  if (id === null) return unknown("last-used-invalid");
  if (id !== primaryId) return unknown("last-used-mismatch");
  const raw = reply.last_upload_time;
  const match =
    typeof raw === "string"
      ? /^(\d{4}-\d{2}-\d{2}) ((?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d)$/.exec(raw)
      : null;
  if (!match || !validCalendar(match[1])) return unknown("last-used-invalid");
  const earliest = Date.parse(`${match[1]}T${match[2]}.000Z`);
  const latest = earliest + 999;
  if (
    !Number.isFinite(earliest) ||
    earliest < MIN_UPLOAD ||
    latest > observedAt.getTime()
  )
    return unknown("last-used-invalid");
  return {
    kind: "known",
    primaryId,
    uploadedAt: new Date(earliest).toISOString(),
    uploadedThrough: new Date(latest).toISOString(),
    via: "last-used",
  };
}
