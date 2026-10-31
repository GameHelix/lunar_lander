import { describe, expect, it } from "vitest";
import { altitudeOf, detectContact, feetOf } from "@/lib/game/collision";
import { deg, segmentsIntersect } from "@/lib/game/geometry";
import { FOOT_X, FOOT_Y } from "@/lib/game/shape";
import { flatTerrain, spikeTerrain } from "./helpers/state";

const flat = flatTerrain(); // ground at y = 100
const REST = 100 - FOOT_Y; // body-centre height with both feet on the ground

describe("feet", () => {
  it("sit FOOT_X either side of centre and FOOT_Y below it when upright", () => {
    const [l, r] = feetOf({ x: 500, y: 300, angle: 0 });
    expect(l).toEqual({ x: 500 - FOOT_X, y: 300 + FOOT_Y });
    expect(r).toEqual({ x: 500 + FOOT_X, y: 300 + FOOT_Y });
  });

  it("dip on the side the lander leans toward", () => {
    const [l, r] = feetOf({ x: 500, y: 300, angle: deg(10) });
    expect(r.y).toBeLessThan(l.y);
  });
});

describe("contact detection", () => {
  it("reports nothing while the lander is in the air", () => {
    expect(detectContact({ x: 300, y: REST + 0.5, angle: 0 }, flat)).toEqual({ left: false, right: false, hull: false });
    expect(detectContact({ x: 300, y: 600, angle: deg(40) }, flat)).toEqual({ left: false, right: false, hull: false });
  });

  it("puts both feet down, and only the feet, when resting upright", () => {
    expect(detectContact({ x: 300, y: REST, angle: 0 }, flat)).toEqual({ left: true, right: true, hull: false });
  });

  it("touches only the low foot first on a tilted descent", () => {
    // Leaning 6° right: the right foot is about 2 units lower than the left.
    const pose = { x: 300, y: REST + 0.5, angle: deg(6) };
    const c = detectContact(pose, flat);
    expect(c).toEqual({ left: false, right: true, hull: false });
  });

  it("flags a hull strike when a rock pokes up between the legs", () => {
    // The 8-unit spike reaches above the nozzle (3 units above the feet)
    // while both feet are still clear of the flat ground either side.
    const c = detectContact({ x: 1000, y: REST + 1, angle: 0 }, spikeTerrain());
    expect(c.left).toBe(false);
    expect(c.right).toBe(false);
    expect(c.hull).toBe(true);
  });

  it("flags a hull strike when the lander comes down on its side", () => {
    const c = detectContact({ x: 300, y: 100 + 7, angle: deg(90) }, flat);
    expect(c.hull).toBe(true);
  });

  it("flags a strut strike from a needle of rock inside the leg", () => {
    // A thin 10-unit needle at x 308, between the hip and the right foot.
    const needle = {
      width: 2000,
      pads: [],
      points: [
        { x: 0, y: 100 },
        { x: 307, y: 100 },
        { x: 308, y: 110 },
        { x: 309, y: 100 },
        { x: 2000, y: 100 },
      ],
    };
    const c = detectContact({ x: 300, y: REST + 4.5, angle: 0 }, needle);
    // Both feet hang 4.5 units above the ground; only the strut is pierced.
    expect(c.left).toBe(false);
    expect(c.right).toBe(false);
    expect(c.hull).toBe(true);
  });

  it("flags a hull buried in the ground", () => {
    expect(detectContact({ x: 300, y: 60, angle: 0 }, flat).hull).toBe(true);
  });
});

describe("altitude", () => {
  it("measures the clearance under the feet", () => {
    expect(altitudeOf({ x: 300, y: REST + 30, angle: 0 }, flat)).toBeCloseTo(30, 9);
    expect(altitudeOf({ x: 300, y: REST, angle: 0 }, flat)).toBeCloseTo(0, 9);
  });

  it("uses the lowest point of a tilted lander", () => {
    const upright = altitudeOf({ x: 300, y: REST + 30, angle: 0 }, flat);
    const tilted = altitudeOf({ x: 300, y: REST + 30, angle: deg(15) }, flat);
    expect(tilted).toBeLessThan(upright);
  });

  it("measures from the highest rock under the footprint", () => {
    expect(altitudeOf({ x: 1000, y: REST + 30, angle: 0 }, spikeTerrain())).toBeCloseTo(22, 9);
  });
});

describe("segment intersection", () => {
  const p = (x: number, y: number) => ({ x, y });

  it("detects crossings and touches, including endpoints", () => {
    expect(segmentsIntersect(p(0, 0), p(2, 2), p(0, 2), p(2, 0))).toBe(true);
    expect(segmentsIntersect(p(0, 0), p(1, 1), p(1, 1), p(2, 0))).toBe(true);
    expect(segmentsIntersect(p(0, 0), p(2, 0), p(1, 0), p(1, 5))).toBe(true);
  });

  it("handles collinear overlap and rejects misses", () => {
    expect(segmentsIntersect(p(0, 0), p(4, 0), p(2, 0), p(6, 0))).toBe(true);
    expect(segmentsIntersect(p(0, 0), p(1, 0), p(2, 0), p(3, 0))).toBe(false);
    expect(segmentsIntersect(p(0, 0), p(4, 0), p(0, 1), p(4, 1))).toBe(false);
    expect(segmentsIntersect(p(0, 0), p(1, 1), p(2, 0), p(3, -5))).toBe(false);
  });
});
