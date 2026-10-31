import { altitudeOf, feetOf } from "./collision";
import { FUEL_CAPACITY, LOW_FUEL, METERS_PER_UNIT } from "./constants";
import { toDeg } from "./geometry";
import { rateMetric } from "./judge";
import { nearestPad, padCenter, padUnder } from "./terrain";
import type { GameState, Multiplier, Verdict } from "./types";

/** How a live reading compares with the touchdown limits. */
export type Band = "ok" | "warn" | "bad";

const BAND: Record<Verdict, Band> = { safe: "ok", hard: "warn", crash: "bad" };

export interface Readout {
  /** Metres of clearance under the feet. */
  altitude: number;
  /** Signed speeds in m/s (y-up: negative `vy` is a descent). */
  vx: number;
  vy: number;
  /** Signed tilt in degrees, positive leaning right. */
  tilt: number;
  /** Each reading rated as if the lander touched down right now. */
  vxBand: Band;
  vyBand: Band;
  tiltBand: Band;
  fuel: number;
  fuelFrac: number;
  lowFuel: boolean;
  /** Guidance to the nearest pad: signed metres from the lander to its centre. */
  pad: { multiplier: Multiplier; dx: number; over: boolean };
}

/**
 * Everything the instrument panel shows, in display units. The bands use the
 * same judge as a real touchdown, so a green readout means "this would land".
 */
export function readout(state: GameState): Readout {
  const l = state.lander;
  const pad = nearestPad(state.terrain, l.x);
  const [fl, fr] = feetOf(l);
  const over = padUnder(state.terrain, fl.x) === pad && padUnder(state.terrain, fr.x) === pad;
  return {
    altitude: Math.max(0, altitudeOf(l, state.terrain)) * METERS_PER_UNIT,
    vx: l.vx * METERS_PER_UNIT,
    vy: l.vy * METERS_PER_UNIT,
    tilt: toDeg(l.angle),
    vxBand: BAND[rateMetric(Math.abs(l.vx), state.safe.vx, state.hard.vx)],
    vyBand: BAND[rateMetric(Math.abs(l.vy), state.safe.vy, state.hard.vy)],
    tiltBand: BAND[rateMetric(Math.abs(l.angle), state.safe.tilt, state.hard.tilt)],
    fuel: l.fuel,
    fuelFrac: l.fuel / FUEL_CAPACITY,
    lowFuel: l.fuel < LOW_FUEL,
    pad: { multiplier: pad.multiplier, dx: (padCenter(pad) - l.x) * METERS_PER_UNIT, over },
  };
}

/** Thousands separated with commas, independent of the visitor's locale (SSR-safe). */
export function formatScore(n: number): string {
  const s = String(Math.max(0, Math.round(n)));
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * The HUD as plain values and display strings. Rounded to what is shown, so
 * two snapshots that would look identical compare equal and the panel does
 * not re-render for invisible changes.
 */
export interface Panel {
  score: number;
  level: number;
  lives: number;
  /** Whole fuel units, and the tank fill in percent. */
  fuel: number;
  fuelPct: number;
  lowFuel: boolean;
  alt: string;
  h: string;
  v: string;
  tilt: string;
  pad: string;
  hBand: Band;
  vBand: Band;
  tiltBand: Band;
  padOver: boolean;
  padMultiplier: Multiplier;
}

/** Speeds under this (m/s) read as standing still, with no arrow. */
const STILL = 0.05;

export function panelOf(state: GameState): Panel {
  const r = readout(state);
  const alt = r.altitude < 10 ? r.altitude.toFixed(1) : String(Math.round(r.altitude));
  const h = Math.abs(r.vx) < STILL ? "0.0" : `${r.vx < 0 ? "←" : "→"} ${Math.abs(r.vx).toFixed(1)}`;
  const v = Math.abs(r.vy) < STILL ? "0.0" : `${r.vy < 0 ? "↓" : "↑"} ${Math.abs(r.vy).toFixed(1)}`;
  const deg = Math.round(Math.abs(r.tilt));
  const tilt = deg === 0 ? "0°" : `${r.tilt > 0 ? "↻" : "↺"} ${deg}°`;
  const dist = Math.round(Math.abs(r.pad.dx));
  const pad = r.pad.over
    ? `×${r.pad.multiplier} ▼`
    : r.pad.dx < 0
      ? `×${r.pad.multiplier} ◀ ${dist}`
      : `×${r.pad.multiplier} ${dist} ▶`;
  return {
    score: state.score,
    level: state.level,
    lives: state.lives,
    fuel: Math.ceil(r.fuel),
    fuelPct: Math.round(r.fuelFrac * 1000) / 10,
    lowFuel: r.lowFuel,
    alt,
    h,
    v,
    tilt,
    pad,
    hBand: r.vxBand,
    vBand: r.vyBand,
    tiltBand: r.tiltBand,
    padOver: r.pad.over,
    padMultiplier: r.pad.multiplier,
  };
}

export function samePanel(a: Panel, b: Panel): boolean {
  for (const key of Object.keys(a) as (keyof Panel)[]) {
    if (a[key] !== b[key]) return false;
  }
  return true;
}
