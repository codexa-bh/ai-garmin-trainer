import { deflateRawSync } from "node:zlib";
import { FitBaseType, FitEncoder } from "fit-file-parser/encoder";

/** Authored synthetic FIT/ZIP builders. No personal data, no recorded files. */
const BASE = 1_000_000_000; // FIT seconds

type FitOptions = {
  records?: Array<{ at: number; hr?: number }>;
  /** Session-referenced time_in_zone buckets (index 0 = below zone 1). */
  sessionZones?: number[];
  /** Lap-referenced buckets, which must never be added to session totals. */
  lapZones?: number[];
  highBoundaries?: number[];
  zonesTarget?: { max?: number; threshold?: number; ftp?: number };
  sport?: number;
  sessions?: number;
};

function u32(values: number[]): Uint8Array {
  const bytes = new Uint8Array(values.length * 4);
  const view = new DataView(bytes.buffer);
  values.forEach((value, index) => view.setUint32(index * 4, value, true));
  return bytes;
}

export function buildFit(options: FitOptions = {}): Uint8Array {
  const encoder = new FitEncoder();
  encoder.writeMessage(0, [
    { number: 0, size: 1, baseType: FitBaseType.Enum, value: 4 },
    { number: 4, size: 4, baseType: FitBaseType.Uint32, value: BASE },
  ]);
  const records = options.records ?? [
    { at: 0, hr: 120 },
    { at: 1, hr: 130 },
    { at: 2, hr: 150 },
  ];
  records.forEach((point, index) => {
    const fields = [
      {
        number: 253,
        size: 4,
        baseType: FitBaseType.Uint32,
        value: BASE + point.at,
      },
      { number: 5, size: 4, baseType: FitBaseType.Uint32, value: index * 300 },
      {
        number: 78,
        size: 4,
        baseType: FitBaseType.Uint32,
        value: (1000 + index) * 5,
      },
      {
        number: 73,
        size: 4,
        baseType: FitBaseType.Uint32,
        value: 3000 + index,
      },
    ];
    if (point.hr !== undefined)
      fields.push({
        number: 3,
        size: 1,
        baseType: FitBaseType.Uint8,
        value: point.hr,
      });
    encoder.writeMessage(20, fields);
  });
  const end = BASE + (records.at(-1)?.at ?? 0) + 1;
  encoder.writeMessage(19, [
    { number: 253, size: 4, baseType: FitBaseType.Uint32, value: end },
    { number: 254, size: 2, baseType: FitBaseType.Uint16, value: 0 },
    { number: 2, size: 4, baseType: FitBaseType.Uint32, value: BASE },
    { number: 7, size: 4, baseType: FitBaseType.Uint32, value: 5000 },
  ]);
  const sessions = options.sessions ?? 1;
  for (let index = 0; index < sessions; index += 1)
    encoder.writeMessage(18, [
      { number: 253, size: 4, baseType: FitBaseType.Uint32, value: end },
      { number: 254, size: 2, baseType: FitBaseType.Uint16, value: index },
      { number: 2, size: 4, baseType: FitBaseType.Uint32, value: BASE },
      { number: 7, size: 4, baseType: FitBaseType.Uint32, value: 5000 },
      {
        number: 5,
        size: 1,
        baseType: FitBaseType.Enum,
        value: options.sport ?? 1,
      },
      { number: 16, size: 1, baseType: FitBaseType.Uint8, value: 130 },
    ]);
  if (options.zonesTarget)
    encoder.writeMessage(7, [
      { number: 253, size: 4, baseType: FitBaseType.Uint32, value: BASE },
      ...(options.zonesTarget.max
        ? [
            {
              number: 1,
              size: 1,
              baseType: FitBaseType.Uint8,
              value: options.zonesTarget.max,
            },
          ]
        : []),
      ...(options.zonesTarget.threshold
        ? [
            {
              number: 2,
              size: 1,
              baseType: FitBaseType.Uint8,
              value: options.zonesTarget.threshold,
            },
          ]
        : []),
      ...(options.zonesTarget.ftp
        ? [
            {
              number: 3,
              size: 2,
              baseType: FitBaseType.Uint16,
              value: options.zonesTarget.ftp,
            },
          ]
        : []),
    ]);
  const zoneMessage = (reference: number, index: number, zones?: number[]) =>
    encoder.writeMessage(216, [
      { number: 253, size: 4, baseType: FitBaseType.Uint32, value: end },
      { number: 0, size: 2, baseType: FitBaseType.Uint16, value: reference },
      { number: 1, size: 2, baseType: FitBaseType.Uint16, value: index },
      ...(zones
        ? [
            {
              number: 2,
              size: zones.length * 4,
              baseType: FitBaseType.Uint32,
              value: u32(zones.map((seconds) => seconds * 1000)),
            },
          ]
        : []),
      ...(options.highBoundaries
        ? [
            {
              number: 6,
              size: options.highBoundaries.length,
              baseType: FitBaseType.Uint8,
              value: Uint8Array.from(options.highBoundaries),
            },
          ]
        : []),
    ]);
  if (options.lapZones) zoneMessage(19, 0, options.lapZones);
  if (options.sessionZones)
    for (let index = 0; index < sessions; index += 1)
      zoneMessage(18, index, options.sessionZones);
  // Boundaries without any buckets: the only way a file can carry zones for estimation.
  else if (options.highBoundaries) zoneMessage(18, 0);
  return encoder.close();
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let k = 0; k < 8; k += 1)
      crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

type ZipOptions = {
  name?: string;
  method?: 0 | 8;
  flags?: number;
  entries?: number;
  declaredExpanded?: number;
  corruptCrc?: boolean;
  corruptData?: boolean;
};

/** Hand-built ZIP so tests can author malformed archives deterministically. */
export function buildZip(
  fit: Uint8Array,
  options: ZipOptions = {},
): Uint8Array {
  const name = Buffer.from(options.name ?? "100_ACTIVITY.fit");
  const method = options.method ?? 8;
  let data = method === 8 ? deflateRawSync(fit) : fit;
  if (options.corruptData)
    data = Uint8Array.from(data, (byte, i) => (i === 4 ? byte ^ 0xff : byte));
  const crc = options.corruptCrc ? 1 : crc32(fit);
  const expanded = options.declaredExpanded ?? fit.length;
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(options.flags ?? 0, 6);
  local.writeUInt16LE(method, 8);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(expanded, 22);
  local.writeUInt16LE(name.length, 26);
  const entry = Buffer.concat([local, name, data]);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(options.flags ?? 0, 8);
  central.writeUInt16LE(method, 10);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(expanded, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt32LE(0, 42);
  const directory = Buffer.concat([central, name]);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  const count = options.entries ?? 1;
  end.writeUInt16LE(count, 8);
  end.writeUInt16LE(count, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(entry.length, 16);
  return Buffer.concat([entry, directory, end]);
}
