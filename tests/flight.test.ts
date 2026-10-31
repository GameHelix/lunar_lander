import { describe, expect, it } from "vitest";
import { DIFFICULTY, LOW_FUEL, METERS_PER_UNIT } from "@/lib/game/constants";
import { formatScore, readout } from "@/lib/game/flight";
import { toDeg } from "@/lib/game/geometry";
import { FOOT_Y } from "@/lib/game/shape";
import { flatTerrain, gameOn, TEST_PAD } from "./helpers/state";

const { safe, hard } = DIFFICULTY.pilot;

describe("instrument readout", () => {
  it("reports altitude, speeds and tilt in metres, m/s and degrees", () => {
    const r = readout(gameOn(flatTerrain(), { x: 930, y: 100 - FOOT_Y + 80, vx: 4, vy: -8, angle: 0.05 }));
    expect(r.altitude).toBeLessThan(80 * METERS_PER_UNIT);
    expect(r.altitude).toBeGreaterThan(75 * METERS_PER_UNIT);
    expect(r.vx).toBeCloseTo(4 * METERS_PER_UNIT, 12);
    expect(r.vy).toBeCloseTo(-8 * METERS_PER_UNIT, 12);
    expect(r.tilt).toBeCloseTo(toDeg(0.05), 12);
  });

  it("colours each reading with the same limits the touchdown judge uses", () => {
    const at = (vx: number, vy: number, angle: number) =>
      readout(gameOn(flatTerrain(), { x: 930, y: 600, vx, vy, angle }));
    const ok = at(safe.vx, -safe.vy, safe.tilt);
    expect([ok.vxBand, ok.vyBand, ok.tiltBand]).toEqual(["ok", "ok", "ok"]);
    const warn = at(safe.vx + 0.1, -(safe.vy + 0.1), -(safe.tilt + 0.01));
    expect([warn.vxBand, warn.vyBand, warn.tiltBand]).toEqual(["warn", "warn", "warn"]);
    const bad = at(-(hard.vx + 0.1), hard.vy + 0.1, hard.tilt + 0.01);
    expect([bad.vxBand, bad.vyBand, bad.tiltBand]).toEqual(["bad", "bad", "bad"]);
  });

  it("guides toward the nearest pad and lights up when both feet are over it", () => {
    const left = readout(gameOn(flatTerrain(), { x: 700, y: 600 }));
    expect(left.pad.multiplier).toBe(TEST_PAD.multiplier);
    expect(left.pad.dx).toBeCloseTo(230 * METERS_PER_UNIT, 9);
    expect(left.pad.over).toBe(false);
    const right = readout(gameOn(flatTerrain(), { x: 1200, y: 600 }));
    expect(right.pad.dx).toBeLessThan(0);
    const over = readout(gameOn(flatTerrain(), { x: 930, y: 600 }));
    expect(over.pad.over).toBe(true);
    const lip = readout(gameOn(flatTerrain(), { x: TEST_PAD.x1 - 5, y: 600 }));
    expect(lip.pad.over).toBe(false);
  });

  it("flags low fuel below the warning level", () => {
    expect(readout(gameOn(flatTerrain(), { fuel: LOW_FUEL - 1 })).lowFuel).toBe(true);
    expect(readout(gameOn(flatTerrain(), { fuel: LOW_FUEL })).lowFuel).toBe(false);
  });
});

describe("formatScore", () => {
  it("groups thousands with commas, whatever the locale", () => {
    expect(formatScore(0)).toBe("0");
    expect(formatScore(999)).toBe("999");
    expect(formatScore(1000)).toBe("1,000");
    expect(formatScore(1234567)).toBe("1,234,567");
    expect(formatScore(-5)).toBe("0");
  });
});
