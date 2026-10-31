import { METERS_PER_UNIT } from "./constants";
import { toDeg } from "./geometry";
import type { Limits, Outcome, Reason } from "./types";

/** Speeds and tilts as the report prints them: one decimal of m/s, whole degrees. */
const mps = (units: number): string => (Math.abs(units) * METERS_PER_UNIT).toFixed(1);
const degs = (radians: number): string => String(Math.round(toDeg(Math.abs(radians))));

export function outcomeTitle(outcome: Outcome): string {
  if (outcome.verdict === "safe") return "Safe landing";
  if (outcome.verdict === "hard") return "Hard landing";
  return "Crashed";
}

/**
 * One plain sentence per reason, quoting the measured value and the limit it
 * broke: the crash limit for a crash, the safe limit for a hard landing.
 */
export function reasonText(reason: Reason, outcome: Outcome, safe: Limits, hard: Limits): string {
  const crash = outcome.verdict === "crash";
  const lim = crash ? hard : safe;
  switch (reason) {
    case "hull":
      return "The hull struck the surface.";
    case "rocks":
      return "Touched down on rough ground, away from the pads.";
    case "edge":
      return "One leg came down off the edge of the pad.";
    case "vSpeed":
      return crash
        ? `Came down too fast: ${mps(outcome.vy)} m/s (limit ${mps(lim.vy)}).`
        : `Descent ${mps(outcome.vy)} m/s (safe up to ${mps(lim.vy)}).`;
    case "hSpeed":
      return crash
        ? `Sliding sideways at ${mps(outcome.vx)} m/s (limit ${mps(lim.vx)}).`
        : `Drift ${mps(outcome.vx)} m/s (safe up to ${mps(lim.vx)}).`;
    case "tilt":
      return crash
        ? `Tilted ${degs(outcome.tilt)}° (limit ${degs(lim.tilt)}°).`
        : `Tilt ${degs(outcome.tilt)}° (safe up to ${degs(lim.tilt)}°).`;
  }
}

/** The touchdown numbers in one line: descent, drift and tilt. */
export function touchdownLine(outcome: Outcome): string {
  return `↓ ${mps(outcome.vy)} m/s · ↔ ${mps(outcome.vx)} m/s · tilt ${degs(outcome.tilt)}°`;
}
