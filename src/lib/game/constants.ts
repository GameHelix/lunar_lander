import { deg } from "./geometry";
import type { Difficulty, Limits, Multiplier } from "./types";

/**
 * Display scale. The world is laid out in abstract units; the HUD reports
 * metres, with four units to the metre, so the 22-unit lander stands about
 * 5.5 m tall — close to the real thing.
 */
export const METERS_PER_UNIT = 0.25;

/** Metres (or m/s, m/s²) → world units, so tuning below reads in real terms. */
const m = (metres: number): number => metres / METERS_PER_UNIT;

/* ------------------------------------------------------------------ world */

export const WORLD_WIDTH = 2000;
/** Vertical extent the overview camera frames: the whole moonscape plus sky. */
export const SCENE_HEIGHT = 1000;
/** The lander cannot climb above this; it would only fly off the frame. */
export const CEILING = 1150;
/** Height of a freshly spawned lander's centre. */
export const SPAWN_ALTITUDE = 860;

/** Every terrain point stays inside this band. */
export const TERRAIN_MIN = 24;
export const TERRAIN_MAX = 560;
/** The world edges rise into mountains between these heights. */
export const EDGE_MIN = 330;
export const EDGE_MAX = 540;
/** Pad surfaces sit between these heights. */
export const PAD_MIN_Y = 70;
export const PAD_MAX_Y = 420;
/** Pads keep this far from the world edges, and this much ground between each other. */
export const EDGE_MARGIN = 110;
export const PAD_GAP = 90;
/** The lander's centre is held this far inside the world edges. */
export const BOUND_MARGIN = 14;
/** Fractal fill: subdivide until segments are at most this long. */
export const MAX_SEGMENT = 22;
/**
 * Vertical jitter of each midpoint: up to ± ROUGHNESS × span^JAGGEDNESS. An
 * exponent below 1 makes short spans relatively rougher than long ones, so
 * sharp rubble sits on top of the big hills instead of smooth rolling ground.
 */
export const ROUGHNESS = 1.3;
export const JAGGEDNESS = 0.75;
/**
 * Each pad has a short shoulder on both sides that never rises above it, so a
 * lander a little off-centre is not clipped by a wall right at the pad's lip.
 */
export const SHOULDER_MIN = 8;
export const SHOULDER_MAX = 16;
export const SHOULDER_DROP = 22;

/* ------------------------------------------------------------------- pads */

/** One pad of each multiplier; the narrower the pad, the bigger the prize. */
export const PAD_SPECS: readonly { multiplier: Multiplier; width: number }[] = [
  { multiplier: 1, width: 120 },
  { multiplier: 2, width: 80 },
  { multiplier: 3, width: 56 },
  { multiplier: 5, width: 42 },
];
/** Feet are 20 units apart; even the tightest pad leaves 5 units either side. */
export const MIN_PAD_WIDTH = 30;

/* ---------------------------------------------------------------- physics */

/** Fixed simulation step, in seconds. */
export const STEP = 1 / 120;
/** Main-engine acceleration at full burn (about 2.5× lunar gravity). */
export const THRUST_ACCEL = m(4);
/** Fuel burned per second of thrust. */
export const BURN_RATE = 10;
/** Tank size; refuels never fill beyond it. */
export const FUEL_CAPACITY = 1000;
/** Below this the fuel gauge turns red and the warning beeps start. */
export const LOW_FUEL = 150;
/** Seconds between low-fuel beeps. */
export const LOW_FUEL_BEEP = 0.9;
/**
 * Rotation ramps from a slow rate (fine trim on a tap) to a fast one (big
 * turns on a hold) over `ROT_RAMP` seconds.
 */
export const ROT_RATE_MIN = deg(40);
export const ROT_RATE_MAX = deg(140);
export const ROT_RAMP = 0.4;
/** The lander can lean at most a quarter turn either way. */
export const MAX_TILT = deg(90);

/* ------------------------------------------------------------------- game */

export const LIVES = 3;
/** Points per multiplier step for a safe and for a hard landing. */
export const BASE_SAFE = 100;
export const BASE_HARD = 40;
/** A touchdown at zero descent speed earns the whole softness bonus. */
export const SOFT_BONUS_MAX = 50;
/** One bonus point for every this-many units of fuel left at touchdown. */
export const FUEL_PER_BONUS_POINT = 10;

export interface DifficultyConfig {
  label: string;
  blurb: string;
  /** Level-1 gravity, units/s². */
  gravity: number;
  startFuel: number;
  /** Level-1 refuel for a safe landing. */
  refuel: number;
  /** Within every safe limit: a clean landing. */
  safe: Limits;
  /** Past a safe limit but within these: a hard (rough but survivable) landing. */
  hard: Limits;
}

export const DIFFICULTIES: readonly Difficulty[] = ["cadet", "pilot", "commander"];
export const DEFAULT_DIFFICULTY: Difficulty = "pilot";

export const DIFFICULTY: Record<Difficulty, DifficultyConfig> = {
  cadet: {
    label: "Cadet",
    blurb: "Light gravity, full tanks, forgiving legs",
    gravity: m(1.3),
    startFuel: 1000,
    refuel: 300,
    safe: { vy: m(4), vx: m(2.5), tilt: deg(10) },
    hard: { vy: m(6), vx: m(4), tilt: deg(16) },
  },
  pilot: {
    label: "Pilot",
    blurb: "True lunar gravity, the standard limits",
    gravity: m(1.62),
    startFuel: 900,
    refuel: 250,
    safe: { vy: m(3), vx: m(2), tilt: deg(7) },
    hard: { vy: m(4.5), vx: m(3), tilt: deg(11) },
  },
  commander: {
    label: "Commander",
    blurb: "Heavy pull, lean tanks, tight tolerances",
    gravity: m(1.9),
    startFuel: 750,
    refuel: 200,
    safe: { vy: m(2.4), vx: m(1.5), tilt: deg(5) },
    hard: { vy: m(3.6), vx: m(2.3), tilt: deg(8) },
  },
};

/* --------------------------------------------------------- level scaling */

/** Gravity grows 5% a level, for at most eight levels (+40%). */
export const GRAVITY_STEP = 0.05;
export const GRAVITY_STEPS_MAX = 8;
/** Pads shrink 4% a level, down to 72% of their starting width. */
export const PAD_SHRINK = 0.04;
export const PAD_SCALE_MIN = 0.72;
/** Refuels shrink 7% a level, down to half. */
export const REFUEL_DECAY = 0.07;
export const REFUEL_MIN_FRACTION = 0.5;
/** Spawn drift (units/s) grows a little with each level. */
export const DRIFT_BASE = 14;
export const DRIFT_STEP = 2;

/* -------------------------------------------------------------------- ui */

/** Seconds of celebration or wreckage before the report panel appears. */
export const REPORT_DELAY: Record<"landed" | "crashed", number> = {
  landed: 1.5,
  crashed: 1.8,
};

/** localStorage keys. */
export const STATS_KEY = "lunar_lander.stats.v1";
export const DIFFICULTY_KEY = "lunar_lander.difficulty.v1";
export const SOUND_KEY = "lunar_lander.sound.v1";
