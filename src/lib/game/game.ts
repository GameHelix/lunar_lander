import { detectContact } from "./collision";
import {
  DIFFICULTY,
  DRIFT_BASE,
  DRIFT_STEP,
  FUEL_CAPACITY,
  GRAVITY_STEP,
  GRAVITY_STEPS_MAX,
  LIVES,
  LOW_FUEL,
  LOW_FUEL_BEEP,
  PAD_SCALE_MIN,
  PAD_SHRINK,
  REFUEL_DECAY,
  REFUEL_MIN_FRACTION,
  SPAWN_ALTITUDE,
  WORLD_WIDTH,
} from "./constants";
import { judgeTouchdown } from "./judge";
import { integrate } from "./physics";
import { makeRng } from "./rng";
import { refuelFor, scoreLanding } from "./scoring";
import { FOOT_X, FOOT_Y } from "./shape";
import { generateTerrain } from "./terrain";
import type { Difficulty, GameEvent, GameState, Input, Lander, LevelParams, Outcome } from "./types";

/**
 * Tuning for a level: gravity creeps up, pads narrow and refuels shrink as
 * the levels rise, each change capped so late levels stay flyable.
 */
export function levelParams(difficulty: Difficulty, level: number): LevelParams {
  const cfg = DIFFICULTY[difficulty];
  const n = Math.max(0, level - 1);
  return {
    gravity: cfg.gravity * (1 + GRAVITY_STEP * Math.min(n, GRAVITY_STEPS_MAX)),
    padScale: Math.max(PAD_SCALE_MIN, 1 - PAD_SHRINK * n),
    refuel: Math.round(cfg.refuel * Math.max(REFUEL_MIN_FRACTION, 1 - REFUEL_DECAY * n)),
    drift: DRIFT_BASE + DRIFT_STEP * Math.min(n, GRAVITY_STEPS_MAX),
  };
}

/**
 * A fresh lander high over one half of the map, drifting toward the middle,
 * upright and sinking slowly. Seeded by run, level and attempt, so a retry
 * after a crash comes in on a different line over the same ground.
 */
export function spawnLander(seed: string, level: number, attempt: number, fuel: number, drift: number): Lander {
  const rng = makeRng(`spawn|${seed}|${level}|${attempt}`);
  const side = rng.next() < 0.5 ? -1 : 1;
  const x = WORLD_WIDTH / 2 + side * WORLD_WIDTH * (0.1 + rng.next() * 0.25);
  const speed = drift * (0.75 + rng.next() * 0.5);
  return {
    x,
    y: SPAWN_ALTITUDE,
    vx: -side * speed,
    vy: -(2 + rng.next() * 4),
    angle: 0,
    fuel,
    thrusting: false,
    rotDir: 0,
    rotHeld: 0,
  };
}

/** The per-attempt fields reset whenever a new lander enters the sky. */
function freshAttempt(): Pick<GameState, "phase" | "phaseTime" | "flightTime" | "lowFuelClock" | "outcome" | "events"> {
  // The beep clock starts full so the warning sounds the moment fuel runs low.
  return { phase: "flying", phaseTime: 0, flightTime: 0, lowFuelClock: LOW_FUEL_BEEP, outcome: null, events: [] };
}

export function createGame(difficulty: Difficulty, seed: string | number): GameState {
  const runSeed = String(seed);
  const cfg = DIFFICULTY[difficulty];
  const params = levelParams(difficulty, 1);
  return {
    difficulty,
    seed: runSeed,
    level: 1,
    attempt: 0,
    terrain: generateTerrain(runSeed, 1, params.padScale),
    params,
    safe: cfg.safe,
    hard: cfg.hard,
    lander: spawnLander(runSeed, 1, 0, cfg.startFuel, params.drift),
    lives: LIVES,
    score: 0,
    landings: 0,
    gameOver: false,
    ...freshAttempt(),
  };
}

/**
 * Advance the game by one fixed step.
 *
 * While flying: integrate the lander, raise fuel warnings, then test for
 * contact. The first step that touches the surface ends the flight — the
 * touchdown is judged on that step's velocity and tilt, and the lander either
 * comes to rest on its pad (scored and refuelled) or is lost (a life gone,
 * and the run over if that was the last lander or the tanks are dry).
 *
 * After touchdown the step only advances the phase clock (which paces the
 * celebration or the wreckage before the report) and eases a lander that
 * touched down slightly tilted level onto its pad.
 */
export function step(state: GameState, input: Input, dt: number): GameState {
  if (state.phase !== "flying") return settle(state, dt);

  const events: GameEvent[] = [];
  const before = state.lander;
  const lander = integrate(before, input, state.params.gravity, dt, state.terrain.width);
  if (before.fuel > 0 && lander.fuel <= 0) events.push({ type: "fuelOut" });

  let lowFuelClock = LOW_FUEL_BEEP;
  if (lander.fuel > 0 && lander.fuel < LOW_FUEL) {
    lowFuelClock = state.lowFuelClock + dt;
    if (lowFuelClock >= LOW_FUEL_BEEP) {
      lowFuelClock -= LOW_FUEL_BEEP;
      events.push({ type: "lowFuel" });
    }
  }
  const flightTime = state.flightTime + dt;

  const contact = detectContact(lander, state.terrain);
  if (!contact.left && !contact.right && !contact.hull) {
    return { ...state, lander, lowFuelClock, flightTime, events };
  }

  const td = judgeTouchdown(lander, contact, state.terrain, state.safe, state.hard);
  if (td.verdict === "crash" || !td.pad) {
    const lives = state.lives - 1;
    events.push({ type: "crashed" });
    const outcome: Outcome = {
      verdict: "crash",
      reasons: td.reasons,
      pad: null,
      vx: lander.vx,
      vy: lander.vy,
      tilt: lander.angle,
      score: null,
      refuel: 0,
    };
    return {
      ...state,
      lander: { ...lander, thrusting: false },
      lives,
      gameOver: lives <= 0 || lander.fuel <= 0,
      phase: "crashed",
      phaseTime: 0,
      flightTime,
      lowFuelClock,
      outcome,
      events,
    };
  }

  const verdict = td.verdict;
  const score = scoreLanding(verdict, td.pad.multiplier, lander.fuel, lander.vy, state.safe.vy);
  const refuel = Math.min(refuelFor(verdict, state.params.refuel), FUEL_CAPACITY - lander.fuel);
  events.push({ type: "landed", verdict });
  return {
    ...state,
    lander: {
      ...lander,
      y: restingY(td.pad.y, lander.angle),
      vx: 0,
      vy: 0,
      fuel: lander.fuel + refuel,
      thrusting: false,
      rotDir: 0,
      rotHeld: 0,
    },
    score: state.score + score.total,
    landings: state.landings + 1,
    phase: "landed",
    phaseTime: 0,
    flightTime,
    lowFuelClock,
    outcome: {
      verdict,
      reasons: td.reasons,
      pad: td.pad,
      vx: lander.vx,
      vy: lander.vy,
      tilt: lander.angle,
      score,
      refuel,
    },
    events,
  };
}

/** Body-centre height that puts the lower foot exactly on a pad at `padY`. */
function restingY(padY: number, angle: number): number {
  return padY + FOOT_X * Math.abs(Math.sin(angle)) - FOOT_Y * Math.cos(angle);
}

function settle(state: GameState, dt: number): GameState {
  const pad = state.outcome?.pad;
  let lander = state.lander;
  if (state.phase === "landed" && pad && lander.angle !== 0) {
    // Rock back onto both feet over a fraction of a second.
    const angle = Math.abs(lander.angle) < 1e-4 ? 0 : lander.angle * Math.exp(-dt * 10);
    lander = { ...lander, angle, y: restingY(pad.y, angle) };
  }
  return { ...state, lander, phaseTime: state.phaseTime + dt, events: [] };
}

/** After a landing: the next level, new ground, the same tanks. */
export function nextLevel(state: GameState): GameState {
  if (state.phase !== "landed") return state;
  const level = state.level + 1;
  const params = levelParams(state.difficulty, level);
  return {
    ...state,
    level,
    attempt: 0,
    params,
    terrain: generateTerrain(state.seed, level, params.padScale),
    lander: spawnLander(state.seed, level, 0, state.lander.fuel, params.drift),
    ...freshAttempt(),
  };
}

/** After a crash with landers to spare: the same ground, a new approach. */
export function nextLander(state: GameState): GameState {
  if (state.phase !== "crashed" || state.gameOver) return state;
  const attempt = state.attempt + 1;
  return {
    ...state,
    attempt,
    lander: spawnLander(state.seed, state.level, attempt, state.lander.fuel, state.params.drift),
    ...freshAttempt(),
  };
}

/** Whichever of `nextLevel` / `nextLander` applies; unchanged mid-flight or when the run is over. */
export function continueGame(state: GameState): GameState {
  return state.phase === "landed" ? nextLevel(state) : nextLander(state);
}
