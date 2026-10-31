/**
 * Core Lunar Lander types — pure data, no React, no DOM.
 *
 * World space is y-up and measured in abstract units (four units to the
 * metre, see `METERS_PER_UNIT`): `x` runs left to right across the moonscape,
 * `y` is height above the bottom of the world. The renderer flips y when it
 * maps the world onto the canvas.
 */

/** A point or vector in world units. */
export interface Vec {
  x: number;
  y: number;
}

export type Difficulty = "cadet" | "pilot" | "commander";

/** Score multipliers carried by the landing pads; narrower pads pay more. */
export type Multiplier = 1 | 2 | 3 | 5;

export interface Pad {
  /** Position in left-to-right order, unique within a terrain. */
  id: number;
  /** Left and right ends of the flat pad surface. */
  x0: number;
  x1: number;
  /** Height of the pad surface. */
  y: number;
  multiplier: Multiplier;
}

export interface Terrain {
  /** Surface polyline: strictly increasing x, from 0 to `width`. */
  points: Vec[];
  /** Flat landing pads, left to right. Each is exactly one polyline segment. */
  pads: Pad[];
  width: number;
}

/** Touchdown limits: speeds in units/s, tilt in radians from upright. */
export interface Limits {
  vy: number;
  vx: number;
  tilt: number;
}

export interface Lander {
  /** Centre of the body, in world units. */
  x: number;
  y: number;
  /** Velocity in units/s (y-up, so a descent has negative `vy`). */
  vx: number;
  vy: number;
  /** Radians from upright; positive leans the nose clockwise, to the right. */
  angle: number;
  fuel: number;
  /** Whether the engine actually fired during the last step. */
  thrusting: boolean;
  /** Rotation input held during the last step: −1 left, 1 right, 0 none. */
  rotDir: -1 | 0 | 1;
  /** Seconds the current rotation input has been held; drives the rate ramp. */
  rotHeld: number;
}

/** The controls sampled for one physics step. */
export interface Input {
  left: boolean;
  right: boolean;
  thrust: boolean;
}

export type Verdict = "safe" | "hard" | "crash";

/**
 * Why a touchdown was rated below "safe". The first three are positional
 * (where the lander touched); the rest name the limit that was exceeded.
 */
export type Reason = "hull" | "rocks" | "edge" | "vSpeed" | "hSpeed" | "tilt";

export interface ScoreBreakdown {
  /** Points per multiplier step: full for a safe landing, reduced for a hard one. */
  base: number;
  multiplier: Multiplier;
  /** `base × multiplier`. */
  landing: number;
  fuelBonus: number;
  softBonus: number;
  total: number;
}

/** The judged result of a touchdown, kept for the report panel. */
export interface Outcome {
  verdict: Verdict;
  reasons: Reason[];
  /** The pad under the lander, when both feet were on one. */
  pad: Pad | null;
  /** Velocity and tilt (radians) at the moment of contact. */
  vx: number;
  vy: number;
  tilt: number;
  /** Points scored; `null` for a crash. */
  score: ScoreBreakdown | null;
  /** Fuel added by the landing (0 for a crash). */
  refuel: number;
}

export type Phase = "flying" | "landed" | "crashed";

/** One-shot notifications raised by a step, for sound and effects. */
export type GameEvent =
  | { type: "lowFuel" }
  | { type: "fuelOut" }
  | { type: "landed"; verdict: "safe" | "hard" }
  | { type: "crashed" };

/** Per-level tuning derived from the difficulty and the level number. */
export interface LevelParams {
  gravity: number;
  /** Scale applied to the pad widths; shrinks as levels rise. */
  padScale: number;
  /** Fuel granted by a safe landing on this level. */
  refuel: number;
  /** Typical horizontal drift (units/s) of a freshly spawned lander. */
  drift: number;
}

export interface GameState {
  difficulty: Difficulty;
  /** Run seed: the terrain of every level and each spawn derive from it. */
  seed: string;
  /** 1-based level number. */
  level: number;
  /** 0-based lander attempt within the current level (bumped after a crash). */
  attempt: number;
  terrain: Terrain;
  params: LevelParams;
  safe: Limits;
  hard: Limits;
  lander: Lander;
  /** Landers left, counting the one in flight. */
  lives: number;
  score: number;
  /** Safe or hard landings made this run. */
  landings: number;
  phase: Phase;
  /** Seconds spent in the current phase. */
  phaseTime: number;
  /** Seconds flown by the current lander. */
  flightTime: number;
  /** Counts toward the next low-fuel warning beep. */
  lowFuelClock: number;
  /** Result of the most recent touchdown in this attempt. */
  outcome: Outcome | null;
  /** Set when the last lander is lost, or a lander crashes with dry tanks. */
  gameOver: boolean;
  /** Events raised by the most recent step only. */
  events: GameEvent[];
}
