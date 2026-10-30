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
const analyze = (p: TerrainPoint[], limit = 100) =>
  analyzeTerrainSections("synthetic", "hiking", p, limit);
describe("shared terrain-v1", () => {
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
    const a = analyze(profile((d) => (d <= 200 ? d * 0.2 : 40), 1000));
    // Triangular smoothing at the climb/flat boundary leaves 38.75m in the first 200m; the flat tail retains the remaining 1.25m.
    expect(a.sections[0].meanGradePct).toBeCloseTo(19.375, 8);
    expect((a.ascentMeters / a.supportedDistanceMeters) * 100).toBeCloseTo(
      4,
      8,
    );
    expect(a.sections[0].distanceMeters).toBe(200);
    expect(a.sections[1].kind).toBe("flat");
  });
  it("keeps rolling ascent/descent despite zero net grade and rejects isolated spikes", () => {
    const rolling = analyze(
      profile((d) =>
        d % 100 <= 50 ? (d % 100) * 0.2 : (100 - (d % 100)) * 0.2,
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
    const p = profile((d) => d * 0.1, 200);
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
    expect(a.sections[0].estimatedMovingSec).toBe(200);
    expect(a.sections[0].elapsedSec).toBe(260);
    const gap = profile((d) => d * 0.1, 400).map((x, i) =>
      i >= 20
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
    expect(b.supportedDistanceMeters).toBe(390);
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
    const p = profile((d) =>
      Math.floor(d / 100) % 2 ? 10 - (d % 100) * 0.1 : (d % 100) * 0.1,
    );
    const full = analyze(p),
      limited = analyze(p, 1);
    expect(limited.truncated).toBe(true);
    expect(limited.sections).toEqual(full.sections.slice(0, 1));
    expect(limited.ascentMeters).toBe(full.ascentMeters);
    expect(limited.supportedDistanceMeters).toBe(1000);
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
