import { describe, expect, it } from "vitest";
import { BASE_HARD, BASE_SAFE, SOFT_BONUS_MAX } from "@/lib/game/constants";
import { refuelFor, scoreLanding } from "@/lib/game/scoring";
import type { Multiplier } from "@/lib/game/types";

const SAFE_VY = 12;

describe("landing score", () => {
  it("pays base × multiplier plus the fuel and softness bonuses", () => {
    const s = scoreLanding("safe", 3, 640, -6, SAFE_VY);
    expect(s).toEqual({
      base: BASE_SAFE,
      multiplier: 3,
      landing: BASE_SAFE * 3,
      fuelBonus: 64,
      softBonus: 25,
      total: BASE_SAFE * 3 + 64 + 25,
    });
  });

  it("scales only the landing part with the pad multiplier", () => {
    const totals = ([1, 2, 3, 5] as Multiplier[]).map((m) => scoreLanding("safe", m, 300, -3, SAFE_VY));
    for (const s of totals) {
      expect(s.landing).toBe(BASE_SAFE * s.multiplier);
      expect(s.fuelBonus).toBe(totals[0].fuelBonus);
      expect(s.softBonus).toBe(totals[0].softBonus);
    }
    expect(totals[3].total - totals[0].total).toBe(BASE_SAFE * 4);
  });

  it("gives the whole softness bonus at zero descent and none at the safe limit", () => {
    expect(scoreLanding("safe", 1, 0, 0, SAFE_VY).softBonus).toBe(SOFT_BONUS_MAX);
    expect(scoreLanding("safe", 1, 0, -SAFE_VY, SAFE_VY).softBonus).toBe(0);
    expect(scoreLanding("safe", 1, 0, -SAFE_VY / 2, SAFE_VY).softBonus).toBe(SOFT_BONUS_MAX / 2);
  });

  it("awards a point per ten units of fuel, rounding down, never below zero", () => {
    expect(scoreLanding("safe", 1, 999, -SAFE_VY, SAFE_VY).fuelBonus).toBe(99);
    expect(scoreLanding("safe", 1, 9.9, -SAFE_VY, SAFE_VY).fuelBonus).toBe(0);
    expect(scoreLanding("safe", 1, -5, -SAFE_VY, SAFE_VY).fuelBonus).toBe(0);
  });

  it("pays a hard landing less: small base, half the fuel bonus, no softness", () => {
    const hard = scoreLanding("hard", 5, 640, -1, SAFE_VY);
    const safe = scoreLanding("safe", 5, 640, -1, SAFE_VY);
    expect(hard.base).toBe(BASE_HARD);
    expect(hard.landing).toBe(BASE_HARD * 5);
    expect(hard.fuelBonus).toBe(32);
    expect(hard.softBonus).toBe(0);
    expect(hard.total).toBeLessThan(safe.total);
  });
});

describe("refuel", () => {
  it("grants the full refuel for a safe landing and half for a hard one", () => {
    expect(refuelFor("safe", 210)).toBe(210);
    expect(refuelFor("hard", 210)).toBe(105);
    expect(refuelFor("hard", 171)).toBe(86);
  });
});
