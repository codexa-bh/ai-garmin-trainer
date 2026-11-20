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
  splitSummaryCount?: number;
  /** Raw authored message 312 fields; units below match FIT wire scaling. */
  snowSplits?: Array<{
    index?: number;
    type: number;
    start?: number;
    end?: number;
    elapsedMs?: number;
    timerMs?: number;
    movingMs?: number;
    distanceCm?: number;
    avgSpeedMmps?: number;
    maxSpeedMmps?: number;
    verticalMmps?: number;
    ascent?: number;
    descent?: number;
    elevation5?: number;
    startLat?: number;
    startLon?: number;
    endLat?: number;
    endLon?: number;
  }>;
  /**
   * Authored multi-lap file: each lap carries its own `message_index`, FIT
   * cadence (cycles/min + 1/128 fraction), cycles and optional dynamics.
   * Replaces the single default lap when given.
   */
  laps?: Array<{
    index: number;
    startOffset: number;
    cadence?: number;
    fractionalCadence128?: number;
    cycles?: number;
    stepLengthMm?: number;
    oscillationMm10?: number;
  }>;
  /** Lap-referenced zone messages by referenced lap message_index. */
  lapZoneMessages?: Array<{
    reference: number;
    seconds: number[];
    high?: number[];
    maxHr?: number;
    restingHr?: number;
    calcType?: number;
  }>;
  /** Session cadence in FIT cycles/min with optional 1/128 fraction. */
  sessionCadence?: { avg: number; max?: number; fraction128?: number };
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
  if (!options.laps)
    encoder.writeMessage(19, [
      { number: 253, size: 4, baseType: FitBaseType.Uint32, value: end },
      { number: 254, size: 2, baseType: FitBaseType.Uint16, value: 0 },
      { number: 2, size: 4, baseType: FitBaseType.Uint32, value: BASE },
      { number: 7, size: 4, baseType: FitBaseType.Uint32, value: 5000 },
    ]);
  for (const lap of options.laps ?? []) {
    const fields = [
      { number: 253, size: 4, baseType: FitBaseType.Uint32, value: end },
      { number: 254, size: 2, baseType: FitBaseType.Uint16, value: lap.index },
      {
        number: 2,
        size: 4,
        baseType: FitBaseType.Uint32,
        value: BASE + lap.startOffset,
      },
      { number: 7, size: 4, baseType: FitBaseType.Uint32, value: 5000 },
    ];
    if (lap.cadence !== undefined)
      fields.push({
        number: 17,
        size: 1,
        baseType: FitBaseType.Uint8,
        value: lap.cadence,
      });
    if (lap.fractionalCadence128 !== undefined)
      fields.push({
        number: 80,
        size: 1,
        baseType: FitBaseType.Uint8,
        value: lap.fractionalCadence128,
      });
    if (lap.cycles !== undefined)
      fields.push({
        number: 10,
        size: 4,
        baseType: FitBaseType.Uint32,
        value: lap.cycles,
      });
    if (lap.stepLengthMm !== undefined)
      fields.push({
        number: 120,
        size: 2,
        baseType: FitBaseType.Uint16,
        value: lap.stepLengthMm * 10,
      });
    if (lap.oscillationMm10 !== undefined)
      fields.push({
        number: 77,
        size: 2,
        baseType: FitBaseType.Uint16,
        value: lap.oscillationMm10,
      });
    encoder.writeMessage(19, fields);
  }
  if (options.splitSummaryCount !== undefined)
    encoder.writeMessage(313, [
      { number: 0, size: 1, baseType: FitBaseType.Enum, value: 29 },
      {
        number: 3,
        size: 2,
        baseType: FitBaseType.Uint16,
        value: options.splitSummaryCount,
      },
    ]);
  for (const split of options.snowSplits ?? []) {
    const fields = [
      { number: 0, size: 1, baseType: FitBaseType.Enum, value: split.type },
    ];
    const specs = [
      [254, split.index, 2, FitBaseType.Uint16],
      [
        9,
        split.start === undefined ? undefined : BASE + split.start,
        4,
        FitBaseType.Uint32,
      ],
      [
        27,
        split.end === undefined ? undefined : BASE + split.end,
        4,
        FitBaseType.Uint32,
      ],
      [1, split.elapsedMs, 4, FitBaseType.Uint32],
      [2, split.timerMs, 4, FitBaseType.Uint32],
      [110, split.movingMs, 4, FitBaseType.Uint32],
      [3, split.distanceCm, 4, FitBaseType.Uint32],
      [4, split.avgSpeedMmps, 4, FitBaseType.Uint32],
      [25, split.maxSpeedMmps, 4, FitBaseType.Uint32],
      [26, split.verticalMmps, 4, FitBaseType.Sint32],
      [13, split.ascent, 2, FitBaseType.Uint16],
      [14, split.descent, 2, FitBaseType.Uint16],
      [74, split.elevation5, 4, FitBaseType.Uint32],
      [21, split.startLat, 4, FitBaseType.Sint32],
      [22, split.startLon, 4, FitBaseType.Sint32],
      [23, split.endLat, 4, FitBaseType.Sint32],
      [24, split.endLon, 4, FitBaseType.Sint32],
    ] as const;
    for (const [number, value, size, baseType] of specs)
      if (value !== undefined) fields.push({ number, value, size, baseType });
    encoder.writeMessage(312, fields);
  }
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
      ...(options.sessionCadence
        ? [
            {
              number: 18,
              size: 1,
              baseType: FitBaseType.Uint8,
              value: options.sessionCadence.avg,
            },
            ...(options.sessionCadence.max !== undefined
              ? [
                  {
                    number: 19,
                    size: 1,
                    baseType: FitBaseType.Uint8,
                    value: options.sessionCadence.max,
                  },
                ]
              : []),
            ...(options.sessionCadence.fraction128 !== undefined
              ? [
                  {
                    number: 92,
                    size: 1,
                    baseType: FitBaseType.Uint8,
                    value: options.sessionCadence.fraction128,
                  },
                ]
              : []),
          ]
        : []),
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
  for (const message of options.lapZoneMessages ?? [])
    encoder.writeMessage(216, [
      { number: 253, size: 4, baseType: FitBaseType.Uint32, value: end },
      { number: 0, size: 2, baseType: FitBaseType.Uint16, value: 19 },
      {
        number: 1,
        size: 2,
        baseType: FitBaseType.Uint16,
        value: message.reference,
      },
      {
        number: 2,
        size: message.seconds.length * 4,
        baseType: FitBaseType.Uint32,
        value: u32(message.seconds.map((seconds) => seconds * 1000)),
      },
      ...(message.high
        ? [
            {
              number: 6,
              size: message.high.length,
              baseType: FitBaseType.Uint8,
              value: Uint8Array.from(message.high),
            },
          ]
        : []),
      ...(message.calcType !== undefined
        ? [
            {
              number: 10,
              size: 1,
              baseType: FitBaseType.Enum,
              value: message.calcType,
            },
          ]
        : []),
      ...(message.maxHr !== undefined
        ? [
            {
              number: 11,
              size: 1,
              baseType: FitBaseType.Uint8,
              value: message.maxHr,
            },
          ]
        : []),
      ...(message.restingHr !== undefined
        ? [
            {
              number: 12,
              size: 1,
              baseType: FitBaseType.Uint8,
              value: message.restingHr,
            },
          ]
        : []),
    ]);
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
