import { describe, expect, it } from "vitest";
import {
  EDGE_MARGIN,
  MIN_PAD_WIDTH,
  PAD_GAP,
  PAD_SCALE_MIN,
  PAD_SPECS,
  SHOULDER_MIN,
  SPAWN_ALTITUDE,
  TERRAIN_MAX,
  TERRAIN_MIN,
  WORLD_WIDTH,
} from "@/lib/game/constants";
import { FOOT_X, FOOT_Y, HALF_WIDTH } from "@/lib/game/shape";
import {
  generateTerrain,
  heightAt,
  maxHeightBetween,
  nearestPad,
  padCenter,
  padUnder,
  padWidthFor,
  segmentIndex,
} from "@/lib/game/terrain";
import type { Terrain } from "@/lib/game/types";
import { flatTerrain, TEST_PAD } from "./helpers/state";

const SEEDS = Array.from({ length: 150 }, (_, i) => `seed-${i}`);
const SCALES = [1, 0.86, PAD_SCALE_MIN];

/** Every terrain the invariants are checked on: 150 seeds × 3 pad scales. */
const SAMPLES: { label: string; terrain: Terrain }[] = SEEDS.flatMap((seed, i) =>
  SCALES.map((scale) => ({ label: `${seed}@${scale}`, terrain: generateTerrain(seed, 1 + (i % 9), scale) }))
);

function forAll(check: (t: Terrain, label: string) => void) {
  for (const { label, terrain } of SAMPLES) check(terrain, label);
}

describe("terrain generator", () => {
  it("is deterministic per seed and level", () => {
    expect(generateTerrain("moon", 3, 0.9)).toEqual(generateTerrain("moon", 3, 0.9));
    expect(generateTerrain(42, 1)).toEqual(generateTerrain("42", 1));
  });

  it("changes with the seed and with the level", () => {
    const a = generateTerrain("moon", 1);
    expect(generateTerrain("mars", 1).points).not.toEqual(a.points);
    expect(generateTerrain("moon", 2).points).not.toEqual(a.points);
  });

  it("spans the world with strictly increasing x", () => {
    forAll((t) => {
      expect(t.width).toBe(WORLD_WIDTH);
      expect(t.points[0].x).toBe(0);
      expect(t.points[t.points.length - 1].x).toBe(WORLD_WIDTH);
      for (let i = 1; i < t.points.length; i++) expect(t.points[i].x).toBeGreaterThan(t.points[i - 1].x);
    });
  });

  it("keeps every point inside the height band, and the ground jagged", () => {
    forAll((t) => {
      for (const p of t.points) {
        expect(p.y).toBeGreaterThanOrEqual(TERRAIN_MIN);
        expect(p.y).toBeLessThanOrEqual(TERRAIN_MAX);
      }
      // A real moonscape, not a few long ramps.
      expect(t.points.length).toBeGreaterThan(70);
    });
  });

  it("places one pad per multiplier, flat and inside the bounds", () => {
    forAll((t) => {
      expect(t.pads.map((p) => p.multiplier).sort((a, b) => a - b)).toEqual([1, 2, 3, 5]);
      for (const pad of t.pads) {
        expect(pad.x0).toBeGreaterThanOrEqual(EDGE_MARGIN);
        expect(pad.x1).toBeLessThanOrEqual(WORLD_WIDTH - EDGE_MARGIN);
        // The pad is a single flat segment of the surface polyline.
        const i = t.points.findIndex((p) => p.x === pad.x0);
        expect(i).toBeGreaterThan(0);
        expect(t.points[i]).toEqual({ x: pad.x0, y: pad.y });
        expect(t.points[i + 1]).toEqual({ x: pad.x1, y: pad.y });
        for (let k = 0; k <= 10; k++) {
          expect(heightAt(t, pad.x0 + ((pad.x1 - pad.x0) * k) / 10)).toBe(pad.y);
        }
      }
    });
  });

  it("makes narrower pads pay more", () => {
    forAll((t) => {
      const byMult = [...t.pads].sort((a, b) => a.multiplier - b.multiplier);
      for (let i = 1; i < byMult.length; i++) {
        expect(byMult[i].x1 - byMult[i].x0).toBeLessThan(byMult[i - 1].x1 - byMult[i - 1].x0);
      }
    });
  });

  it("keeps pads in order, apart from each other and never overlapping", () => {
    forAll((t) => {
      t.pads.forEach((pad, i) => expect(pad.id).toBe(i));
      for (let i = 1; i < t.pads.length; i++) {
        expect(t.pads[i].x0 - t.pads[i - 1].x1).toBeGreaterThanOrEqual(PAD_GAP);
      }
    });
  });

  it("leaves every pad wide enough for both feet, with room to spare", () => {
    forAll((t) => {
      for (const pad of t.pads) {
        expect(pad.x1 - pad.x0).toBeGreaterThanOrEqual(MIN_PAD_WIDTH);
        expect(pad.x1 - pad.x0).toBeGreaterThan(2 * FOOT_X + 8);
      }
    });
  });

  it("never lets the ground rise above a pad right at its lip", () => {
    forAll((t) => {
      for (const pad of t.pads) {
        for (let d = 0; d <= SHOULDER_MIN; d += 0.5) {
          expect(heightAt(t, pad.x0 - d)).toBeLessThanOrEqual(pad.y);
          expect(heightAt(t, pad.x1 + d)).toBeLessThanOrEqual(pad.y);
        }
      }
    });
  });

  it("keeps every pad reachable: open sky above it and the spawn clear of every peak", () => {
    forAll((t) => {
      const peak = Math.max(...t.points.map((p) => p.y));
      // A freshly spawned lander's feet clear the highest peak by a wide margin…
      expect(SPAWN_ALTITUDE + FOOT_Y - peak).toBeGreaterThanOrEqual(250);
      // …and above each pad there is nothing but sky: centred over it, the
      // lander can sink straight down without touching anything but the pad.
      for (const pad of t.pads) {
        const c = padCenter(pad);
        expect(maxHeightBetween(t, c - HALF_WIDTH, c + HALF_WIDTH)).toBe(pad.y);
      }
    });
  });

  it("narrows pads with the level scale, but never below the minimum", () => {
    for (const spec of PAD_SPECS) {
      expect(padWidthFor(spec.width, 1)).toBe(spec.width);
      expect(padWidthFor(spec.width, PAD_SCALE_MIN)).toBeLessThan(spec.width);
      expect(padWidthFor(spec.width, 0.1)).toBe(MIN_PAD_WIDTH);
    }
    const wide = generateTerrain("s", 1, 1);
    const narrow = generateTerrain("s", 1, PAD_SCALE_MIN);
    const width = (t: Terrain, m: number) => {
      const pad = t.pads.find((p) => p.multiplier === m);
      return pad ? pad.x1 - pad.x0 : 0;
    };
    for (const m of [1, 2, 3, 5]) expect(width(narrow, m)).toBeLessThan(width(wide, m));
  });
});

describe("terrain queries", () => {
  const t = flatTerrain();
  const ramp: Terrain = {
    width: 100,
    pads: [],
    points: [
      { x: 0, y: 10 },
      { x: 10, y: 30 },
      { x: 20, y: 30 },
      { x: 40, y: 0 },
      { x: 100, y: 60 },
    ],
  };

  it("interpolates heights along the polyline and clamps outside it", () => {
    expect(heightAt(ramp, 5)).toBe(20);
    expect(heightAt(ramp, 10)).toBe(30);
    expect(heightAt(ramp, 30)).toBe(15);
    expect(heightAt(ramp, 70)).toBe(30);
    expect(heightAt(ramp, -5)).toBe(10);
    expect(heightAt(ramp, 150)).toBe(60);
  });

  it("finds the segment under x by binary search", () => {
    expect(segmentIndex(ramp.points, 0)).toBe(0);
    expect(segmentIndex(ramp.points, 15)).toBe(1);
    expect(segmentIndex(ramp.points, 20)).toBe(2);
    expect(segmentIndex(ramp.points, 99)).toBe(3);
    expect(segmentIndex(ramp.points, 1000)).toBe(3);
  });

  it("reports the highest ground over a span, including peaks inside it", () => {
    expect(maxHeightBetween(ramp, 2, 38)).toBe(30);
    expect(maxHeightBetween(ramp, 25, 35)).toBeCloseTo(22.5, 9);
    expect(maxHeightBetween(ramp, 35, 25)).toBeCloseTo(22.5, 9);
  });

  it("finds the pad under a point and the nearest pad", () => {
    expect(padUnder(t, TEST_PAD.x0)).toBe(TEST_PAD);
    expect(padUnder(t, 930)).toBe(TEST_PAD);
    expect(padUnder(t, TEST_PAD.x1 + 0.01)).toBeNull();
    expect(nearestPad(t, 0)).toBe(TEST_PAD);
    const g = generateTerrain("near", 1);
    for (const pad of g.pads) expect(nearestPad(g, padCenter(pad))).toBe(pad);
  });
});
