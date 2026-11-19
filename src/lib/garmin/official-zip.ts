import { inflateRawSync } from "node:zlib";

/**
 * Bounded admission of the one original FIT file Garmin returns inside a ZIP.
 * Deliberately not an archive subsystem: exactly one `.fit` entry, a plain
 * filename that is never used as a path, no encryption/zip64/multi-disk, and
 * hard compressed, expanded and ratio bounds. Bytes only; nothing touches disk.
 */
const FIT_ADMISSION_LIMITS = {
  compressedBytes: 4 * 1024 * 1024,
  expandedBytes: 8 * 1024 * 1024,
  /** Measured originals expand about 1.5–3×; this still bounds a zip bomb. */
  maxRatio: 100,
} as const;

export class FitAdmissionError extends Error {
  constructor(readonly reason: string) {
    super(`Garmin activity file was refused (${reason}).`);
  }
}

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

let crcTable: Uint32Array | undefined;
function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1)
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function refuse(reason: string): never {
  throw new FitAdmissionError(reason);
}

/** `.FIT` marker in a raw FIT header (bytes 8–11). */
function isRawFit(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 14 &&
    bytes[8] === 0x2e &&
    bytes[9] === 0x46 &&
    bytes[10] === 0x49 &&
    bytes[11] === 0x54
  );
}

export function admitFitBytes(input: Uint8Array): Uint8Array {
  const limits = FIT_ADMISSION_LIMITS;
  if (input.byteLength === 0) refuse("empty");
  if (input.byteLength > limits.compressedBytes) refuse("too-large");
  if (isRawFit(input)) return input;
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  if (input.byteLength < 22 || view.getUint32(0, true) !== LOCAL)
    refuse("not-a-zip");

  // End-of-central-directory: the comment must account for every remaining byte.
  let eocd = -1;
  for (
    let at = input.byteLength - 22;
    at >= Math.max(0, input.byteLength - 22 - 65_535);
    at -= 1
  ) {
    if (
      view.getUint32(at, true) === EOCD &&
      at + 22 + view.getUint16(at + 20, true) === input.byteLength
    ) {
      eocd = at;
      break;
    }
  }
  if (eocd < 0) refuse("no-directory");
  const disk = view.getUint16(eocd + 4, true);
  const cdDisk = view.getUint16(eocd + 6, true);
  const entriesHere = view.getUint16(eocd + 8, true);
  const entries = view.getUint16(eocd + 10, true);
  const cdSize = view.getUint32(eocd + 12, true);
  const cdOffset = view.getUint32(eocd + 16, true);
  if (
    disk !== 0 ||
    cdDisk !== 0 ||
    entriesHere !== entries ||
    entries === 0xffff ||
    cdSize === 0xffffffff ||
    cdOffset === 0xffffffff
  )
    refuse("unsupported-archive");
  if (entries !== 1) refuse("unexpected-entry-count");
  if (cdOffset + cdSize !== eocd) refuse("directory-bounds");
  if (cdSize < 46 || view.getUint32(cdOffset, true) !== CENTRAL)
    refuse("directory-bounds");

  const flags = view.getUint16(cdOffset + 8, true);
  const method = view.getUint16(cdOffset + 10, true);
  const crc = view.getUint32(cdOffset + 16, true);
  const compressed = view.getUint32(cdOffset + 20, true);
  const expanded = view.getUint32(cdOffset + 24, true);
  const nameLength = view.getUint16(cdOffset + 28, true);
  const extraLength = view.getUint16(cdOffset + 30, true);
  const commentLength = view.getUint16(cdOffset + 32, true);
  const localOffset = view.getUint32(cdOffset + 42, true);
  if (
    46 + nameLength + extraLength + commentLength !== cdSize ||
    nameLength === 0 ||
    nameLength > 255
  )
    refuse("directory-bounds");
  if (flags & 0x1 || flags & 0x40) refuse("encrypted");
  if (![0, 8].includes(method)) refuse("unsupported-compression");
  if (compressed === 0xffffffff || expanded === 0xffffffff)
    refuse("unsupported-archive");
  if (compressed > limits.compressedBytes || expanded > limits.expandedBytes)
    refuse("too-large");
  if (expanded === 0 || expanded > Math.max(1, compressed) * limits.maxRatio)
    refuse("ratio");

  // The name is only a label: it must be a plain `.fit` filename, never a path.
  const nameBytes = input.subarray(cdOffset + 46, cdOffset + 46 + nameLength);
  let name: string;
  try {
    name = new TextDecoder("utf-8", { fatal: true }).decode(nameBytes);
  } catch {
    return refuse("entry-name");
  }
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._ -]{0,200}\.fit$/i.test(name) ||
    name.includes("..")
  )
    refuse("entry-name");

  if (
    localOffset + 30 > cdOffset ||
    view.getUint32(localOffset, true) !== LOCAL
  )
    refuse("local-header");
  const localFlags = view.getUint16(localOffset + 6, true);
  if (localFlags & 0x1) refuse("encrypted");
  const start =
    localOffset +
    30 +
    view.getUint16(localOffset + 26, true) +
    view.getUint16(localOffset + 28, true);
  if (start + compressed > cdOffset) refuse("entry-bounds");

  const data = input.subarray(start, start + compressed);
  let fit: Uint8Array;
  if (method === 0) {
    if (compressed !== expanded) refuse("size-mismatch");
    fit = data;
  } else {
    try {
      fit = inflateRawSync(data, { maxOutputLength: expanded + 1 });
    } catch {
      return refuse("corrupt");
    }
  }
  if (fit.byteLength !== expanded) refuse("size-mismatch");
  if (crc32(fit) !== crc) refuse("checksum");
  if (!isRawFit(fit)) refuse("not-a-fit");
  return fit;
}
