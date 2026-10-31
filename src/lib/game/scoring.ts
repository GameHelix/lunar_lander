import { BASE_HARD, BASE_SAFE, FUEL_PER_BONUS_POINT, SOFT_BONUS_MAX } from "./constants";
import { clamp } from "./geometry";
import type { Multiplier, ScoreBreakdown } from "./types";

/**
 * Points for a landing: `base × pad multiplier`, plus a fuel bonus for what
 * is left in the tank and a softness bonus for how gently the feet met the
 * pad.
 *
 * A hard landing is rough but survivable, and pays for it: a smaller base,
 * half the fuel bonus and no softness bonus. A touchdown at zero descent
 * speed earns the whole softness bonus; one right on the safe limit earns
 * none.
 */
export function scoreLanding(
  verdict: "safe" | "hard",
  multiplier: Multiplier,
  fuelLeft: number,
  vy: number,
  safeVy: number
): ScoreBreakdown {
  const base = verdict === "safe" ? BASE_SAFE : BASE_HARD;
  const landing = base * multiplier;
  const fullFuel = Math.floor(Math.max(0, fuelLeft) / FUEL_PER_BONUS_POINT);
  const fuelBonus = verdict === "safe" ? fullFuel : Math.floor(fullFuel / 2);
  const softBonus =
    verdict === "safe" ? Math.round(SOFT_BONUS_MAX * clamp(1 - Math.abs(vy) / safeVy, 0, 1)) : 0;
  return { base, multiplier, landing, fuelBonus, softBonus, total: landing + fuelBonus + softBonus };
}

/** Fuel granted for a landing: the level's full refuel when safe, half when hard. */
export function refuelFor(verdict: "safe" | "hard", levelRefuel: number): number {
  return verdict === "safe" ? levelRefuel : Math.round(levelRefuel / 2);
}
