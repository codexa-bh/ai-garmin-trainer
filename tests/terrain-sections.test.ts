import { describe, it, expect } from "vitest";
import {
  analyzeTerrainSections,
  type TerrainPoint,
  TERRAIN_PARAMETERS,
} from "../src/lib/analytics/terrain-sections";
import { createTerrainAnalysis } from "../src/lib/local-data/application";
function profile(
  z: (d: number) => number,
  length = 1000,
  step = 10,
): { -readonly [K in keyof TerrainPoint]: TerrainPoint[K] }[] {
  return Array.from({ length: length / step + 1 }, (_, i) => ({
    timestamp: new Date(Date.UTC(2026, 0, 1) + i * step * 1000).toISOString(),
    elapsedSec: i,
    distanceMeters: i * step,
    altitudeMeters: z(i * step),
    heartRate: 120,
  }));
}
const analyze = (p: TerrainPoint[], limit = 100) => {
  const result = analyzeTerrainSections("synthetic", "hiking", p, limit);
  for (const section of result.sections)
    expect(section.distanceMeters).toBeGreaterThanOrEqual(300);
  return result;
};
describe("shared terrain-v2", () => {
  it.each([10, -10, 0])(
    "has exact constant grade %s and immutable inputs",
    (grade) => {
      const p = profile((d) => 100 + (d * grade) / 100);
      p.forEach(Object.freeze);
      Object.freeze(p);
      const a = analyze(p);
      expect(a.status).toBe("available");
      expect(a.sections).toHaveLength(1);
      expect(a.sections[0].meanGradePct).toBeCloseTo(grade, 8);
      expect(a.ascentMeters).toBeCloseTo(Math.max(grade * 10, 0), 8);
      expect(a.descentMeters).toBeCloseTo(Math.max(-grade * 10, 0), 8);
      expect(a.supportedDistanceMeters).toBe(1000);
      expect(a.sections[0].elapsedSec).toBe(1000);
      expect(a.sections[0].averageHeartRate).toBe(120);
      expect(a.sections[0].steepUpMeters).toBe(grade === 10 ? 1000 : 0);
      expect(analyze(p)).toEqual(a);
    },
  );
  it("distinguishes a supported climb from whole-route density", () => {
    const a = analyze(profile((d) => (d <= 600 ? d * 0.2 : 120), 3000));
    expect(a.sections[0].kind).toBe("climb");
    expect(a.sections[0].meanGradePct).toBeGreaterThan(18);
    expect((a.ascentMeters / a.supportedDistanceMeters) * 100).toBeCloseTo(
      4,
      8,
    );
    expect(Math.abs(a.sections[0].distanceMeters - 600)).toBeLessThanOrEqual(
      50,
    );
    expect(a.sections[1].kind).toBe("flat");
  });
  it("keeps rolling ascent/descent despite zero net grade and rejects isolated spikes", () => {
    const rolling = analyze(
      profile((d) =>
        d % 100 <= 50 ? (d % 100) * 0.4 : (100 - (d % 100)) * 0.4,
      ),
    );
    expect(rolling.sections[0].kind).toBe("rolling");
    expect(rolling.sections[0].meanGradePct).toBe(0);
    expect(rolling.ascentMeters).toBeGreaterThan(0);
    expect(rolling.ascentMeters).toBe(rolling.descentMeters);
    const noise = analyze(profile((d) => (d === 500 ? 300 : 100)));
    expect(noise.ascentMeters).toBe(0);
    expect(noise.sections[0].kind).toBe("flat");
  });
  it("is distance-density invariant on linear and rolling inputs", () => {
    for (const z of [
      (d: number) => d * 0.08,
      (d: number) => Math.sin(d / 100) * 10,
    ]) {
      const a = analyze(profile(z, 1000, 5)),
        b = analyze(profile(z, 1000, 10));
      expect(a.ascentMeters).toBeCloseTo(b.ascentMeters, 1);
      expect(a.descentMeters).toBeCloseTo(b.descentMeters, 1);
    }
  });
  it("accounts pauses without treating missing data gaps as stops", () => {
    const p = profile((d) => d * 0.1, 400);
    const stationary = Array.from({ length: 6 }, (_, i) => ({
      ...p[10],
      timestamp: new Date(
        Date.UTC(2026, 0, 1) + (110 + i * 10) * 1000,
      ).toISOString(),
    }));
    const tail = p.slice(11).map((x) => ({
      ...x,
      timestamp: new Date(Date.parse(x.timestamp!) + 60000).toISOString(),
    }));
    const a = analyze([...p.slice(0, 11), ...stationary, ...tail]);
    expect(a.sections[0].estimatedStationarySec).toBe(60);
    expect(a.sections[0].estimatedMovingSec).toBe(400);
    expect(a.sections[0].elapsedSec).toBe(460);
    const gap = profile((d) => d * 0.1, 1000).map((x, i) =>
      i >= 50
        ? {
            ...x,
            timestamp: new Date(Date.parse(x.timestamp!) + 60000).toISOString(),
          }
        : x,
    );
    const b = analyze(gap);
    expect(b.status).toBe("partial");
    expect(b.sections).toHaveLength(2);
    expect(
      b.sections.reduce((n, s) => n + (s.estimatedStationarySec ?? 0), 0),
    ).toBe(0);
    expect(b.supportedDistanceMeters).toBe(990);
    const garminClock = gap.map((p) => ({
      ...p,
      timestamp: p.timestamp!.replace("T", " ").replace("Z", ""),
    }));
    expect(analyze(garminClock)).toEqual(b);
  });
  it("retains geometry but not fabricated time or HR", () => {
    const a = analyze(
      profile((d) => d * 0.1).map((x) => ({
        ...x,
        timestamp: null,
        heartRate: null,
      })),
    );
    expect(a.status).toBe("partial");
    expect(a.sections[0].elapsedSec).toBeNull();
    expect(a.sections[0].averageHeartRate).toBeNull();
    expect(a.sections[0].meanGradePct).toBeCloseTo(10, 8);
    const b = analyze(
      profile((d) => d * 0.1).map((x) => ({
        ...x,
        timestamp: x.timestamp!.replace("Z", "").replace("T", " "),
      })),
    );
    expect(b.status).toBe("available");
    expect(b.sections[0].elapsedSec).toBe(1000);
  });
  it.each([
    "missing-altitude",
    "distance-reset",
    "reversed-time",
    "duplicate-time",
    "mixed-clock",
    "negative-distance",
    "infinite",
  ])("handles %s without hiding partial support", (kind) => {
    const p = profile((d) => d * 0.1);
    if (kind === "missing-altitude") p[50].altitudeMeters = null;
    if (kind === "distance-reset") p[50].distanceMeters = 0;
    if (kind === "reversed-time") p[50].timestamp = p[49].timestamp;
    if (kind === "duplicate-time") p[50].timestamp = p[51].timestamp;
    if (kind === "mixed-clock")
      p[50].timestamp = p[50].timestamp!.replace("Z", "");
    if (kind === "negative-distance") p[50].distanceMeters = -1;
    if (kind === "infinite") p[50].altitudeMeters = Infinity;
    const a = analyze(p);
    expect(a.status).toBe("partial");
    expect(JSON.stringify(a)).not.toMatch(/NaN|Infinity/);
  });
  it("caps input and rows, preserving canonical whole-analysis totals", () => {
    const p = profile(
      (d) => (Math.floor(d / 600) % 2 ? 60 - (d % 600) * 0.1 : (d % 600) * 0.1),
      2400,
    );
    const full = analyze(p),
      limited = analyze(p, 1);
    expect(limited.truncated).toBe(true);
    expect(limited.sections).toEqual(full.sections.slice(0, 1));
    expect(limited.ascentMeters).toBe(full.ascentMeters);
    expect(limited.supportedDistanceMeters).toBe(2400);
    expect(
      analyze(
        Array.from({ length: TERRAIN_PARAMETERS.maxPoints + 1 }, () => p[0]),
      ).reason,
    ).toBe("point_limit_exceeded");
    expect(analyze([]).reason).toBe("missing_stream");
    expect(analyze(p.slice(0, 1)).reason).toBe("missing_stream");
    expect(analyze(profile(() => 0, 40)).reason).toBe(
      "insufficient_supported_elevation_distance",
    );
    expect(analyzeTerrainSections("id", "cycling", p).reason).toBe(
      "unsupported_sport",
    );
    expect(analyzeTerrainSections("id", null, p).reason).toBe(
      "unknown_activity",
    );
  });
  it("detects natural off-grid plateau and summit boundaries instead of cutting every 300m", () => {
    const z = (d: number) =>
      d <= 675 ? d * 0.12 : d <= 1425 ? 81 : 81 - (d - 1425) * 0.1;
    const a = analyze(profile(z, 2400, 5));
    expect(a.sections.map((s) => s.kind)).toEqual(["climb", "flat", "descent"]);
    expect(Math.abs(a.sections[0].endDistanceMeters - 675)).toBeLessThanOrEqual(
      50,
    );
    expect(
      Math.abs(a.sections[1].endDistanceMeters - 1425),
    ).toBeLessThanOrEqual(50);
    // This profile happens to land at 700/1400 after smoothing. Moving its
    // actual terrain changes 25m must move the boundaries, not snap to bins.
    const shifted = analyze(
      profile(
        (d) => (d <= 700 ? d * 0.12 : d <= 1450 ? 84 : 84 - (d - 1450) * 0.1),
        2400,
        5,
      ),
    );
    expect(
      shifted.sections[0].endDistanceMeters - a.sections[0].endDistanceMeters,
    ).toBe(25);
    expect(
      shifted.sections[1].endDistanceMeters - a.sections[1].endDistanceMeters,
    ).toBe(25);
    expect(shifted.sections.some((s) => s.endDistanceMeters % 100 !== 0)).toBe(
      true,
    );
    expect(a.sections.every((s) => s.distanceMeters !== 300)).toBe(true);
    const mountain = analyze(
      profile((d) => (d <= 875 ? d * 0.1 : 87.5 - (d - 875) * 0.1), 2000, 5),
    );
    expect(mountain.sections.map((s) => s.kind)).toEqual(["climb", "descent"]);
    expect(
      Math.abs(mountain.sections[0].endDistanceMeters - 875),
    ).toBeLessThanOrEqual(25);
  });
  it("does not split a sustained climb on grade changes or brief reverse/flat fluctuations", () => {
    const varied = analyze(
      profile((d) => (d <= 650 ? d * 0.05 : 32.5 + (d - 650) * 0.15), 2000),
    );
    expect(varied.sections).toHaveLength(1);
    expect(varied.sections[0].kind).toBe("climb");
    const shortDip = analyze(
      profile(
        (d) =>
          d <= 700
            ? d * 0.1
            : d <= 800
              ? 70 - (d - 700) * 0.1
              : 60 + (d - 800) * 0.1,
        2000,
      ),
    );
    expect(shortDip.sections).toHaveLength(1);
    expect(shortDip.sections[0].kind).toBe("climb");
    const plateau = analyze(
      profile(
        (d) => (d <= 700 ? d * 0.1 : d <= 900 ? 70 : 70 + (d - 900) * 0.1),
        2000,
      ),
    );
    expect(plateau.sections).toHaveLength(1);
    expect(plateau.sections[0].kind).toBe("climb");
  });
  it("absorbs sub300m initial/tail features and excludes short disconnected runs without padding", () => {
    for (const cut of [50, 175, 275]) {
      const prefix = analyze(
        profile((d) => (d <= cut ? 0 : (d - cut) * 0.1), 1500, 5),
      );
      expect(prefix.sections).toHaveLength(1);
      const tail = analyze(
        profile(
          (d) => (d <= 1500 - cut ? d * 0.1 : (1500 - cut) * 0.1),
          1500,
          5,
        ),
      );
      expect(tail.sections).toHaveLength(1);
    }
    expect(analyze(profile((d) => d, 295, 5)).sections).toEqual([]);
    expect(
      analyze(profile((d) => d * 0.1, 300, 5)).sections[0].distanceMeters,
    ).toBe(300);
    const separated = profile((d) => d * 0.1, 500, 5).map((p, i) =>
      i >= 50
        ? {
            ...p,
            timestamp: new Date(Date.parse(p.timestamp!) + 60000).toISOString(),
          }
        : p,
    );
    expect(analyze(separated).sections).toEqual([]);
  });
  it("separates sustained rolling terrain from a subsequent sustained climb and ignores low-amplitude flat noise", () => {
    const p = profile(
      (d) =>
        d <= 1200
          ? d % 200 <= 100
            ? (d % 200) * 0.3
            : (200 - (d % 200)) * 0.3
          : (d - 1200) * 0.1,
      2500,
      5,
    );
    const a = analyze(p);
    expect(a.sections.map((s) => s.kind)).toEqual(["rolling", "climb"]);
    expect(
      Math.abs(a.sections[0].endDistanceMeters - 1200),
    ).toBeLessThanOrEqual(150);
    const noisy = analyze(profile((d) => 0.4 * Math.sin(d / 10), 2000, 5));
    expect(noisy.sections).toHaveLength(1);
    expect(noisy.sections[0].kind).toBe("flat");
  });
  it("does not label a long flat approach rolling because of one absorbed short hill", () => {
    for (const offset of [0, 500, 1500]) {
      const a = analyze(
        profile(
          (d) =>
            d < offset || d > offset + 200
              ? 0
              : d <= offset + 100
                ? (d - offset) * 0.2
                : (offset + 200 - d) * 0.2,
          2200,
          5,
        ),
      );
      expect(a.sections).toHaveLength(1);
      expect(a.sections[0].kind).toBe("flat");
      expect(a.ascentMeters).toBeGreaterThan(0);
      expect(a.descentMeters).toBeGreaterThan(0);
    }
  });
  it("conserves complete gap-free support across varied non-grid terrain changes", () => {
    for (let seed = 1; seed <= 30; seed++) {
      const turn = 475 + seed * 17,
        length = 2400;
      const z = (d: number) =>
        d < turn
          ? d * 0.08
          : d < turn + 350
            ? turn * 0.08
            : turn * 0.08 - (d - turn - 350) * 0.07;
      const a = analyze(profile(z, length, 5));
      expect(a.supportedDistanceMeters).toBe(length);
      expect(
        a.sections.reduce((n, s) => n + (s.elapsedSec ?? 0), 0),
      ).toBeCloseTo(length, 6);
      expect(a.sections.length).toBeLessThanOrEqual(Math.floor(length / 300));
      expect(a.sections[0].startDistanceMeters).toBe(0);
      expect(a.sections.at(-1)!.endDistanceMeters).toBe(length);
      for (let i = 1; i < a.sections.length; i++)
        expect(a.sections[i].startDistanceMeters).toBe(
          a.sections[i - 1].endDistanceMeters,
        );
    }
  });
  it("reads once, validates before reading and recomputes refreshed normalized inputs", () => {
    let reads = 0,
      p = profile((d) => d * 0.1);
    const use = createTerrainAnalysis(() => {
      reads++;
      return { sport: "walking", points: p };
    });
    expect(use("bad/id").reason).toBe("invalid_activity_id");
    expect(reads).toBe(0);
    expect(use("id").ascentMeters).toBe(100);
    expect(reads).toBe(1);
    p = profile((d) => d * 0.2);
    expect(use("id").ascentMeters).toBe(200);
  });
});
