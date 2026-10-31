import { describe, expect, it } from "vitest";
import {
  DIFFICULTIES,
  DIFFICULTY,
  FUEL_CAPACITY,
  GRAVITY_STEPS_MAX,
  LIVES,
  LOW_FUEL,
  LOW_FUEL_BEEP,
  PAD_SCALE_MIN,
  SPAWN_ALTITUDE,
  STEP,
} from "@/lib/game/constants";
import { continueGame, createGame, levelParams, nextLander, nextLevel, spawnLander, step } from "@/lib/game/game";
import { FOOT_Y } from "@/lib/game/shape";
import type { GameEvent, GameState, Input } from "@/lib/game/types";
import { dropUntilContact, flyTo } from "./helpers/autopilot";
import { flatTerrain, gameOn, TEST_PAD } from "./helpers/state";

const IDLE: Input = { left: false, right: false, thrust: false };
const THRUST: Input = { left: false, right: false, thrust: true };

/** Land the current lander on its level's widest pad. */
function land(s: GameState): GameState {
  const pad = s.terrain.pads.find((p) => p.multiplier === 1);
  if (!pad) throw new Error("no ×1 pad");
  return flyTo(s, pad);
}

function collect(s: GameState, input: Input, seconds: number): { state: GameState; events: GameEvent[] } {
  const events: GameEvent[] = [];
  let out = s;
  for (let t = 0; t < seconds && out.phase === "flying"; t += STEP) {
    out = step(out, input, STEP);
    events.push(...out.events);
  }
  return { state: out, events };
}

describe("a new game", () => {
  it("starts on level 1 with three landers, a full start tank and a lander high in the sky", () => {
    for (const d of DIFFICULTIES) {
      const g = createGame(d, 7);
      expect(g.level).toBe(1);
      expect(g.lives).toBe(LIVES);
      expect(g.score).toBe(0);
      expect(g.phase).toBe("flying");
      expect(g.lander.fuel).toBe(DIFFICULTY[d].startFuel);
      expect(g.lander.y).toBe(SPAWN_ALTITUDE);
      expect(g.lander.angle).toBe(0);
      expect(g.lander.vx).not.toBe(0);
    }
  });

  it("is reproducible from its seed", () => {
    expect(createGame("pilot", "abc")).toEqual(createGame("pilot", "abc"));
    expect(createGame("pilot", "abc").terrain).not.toEqual(createGame("pilot", "abd").terrain);
  });

  it("spawns drifting toward the middle of the map", () => {
    for (let i = 0; i < 40; i++) {
      const l = spawnLander(`s${i}`, 1, 0, 500, 14);
      expect(Math.sign(l.vx)).toBe(Math.sign(1000 - l.x));
      expect(l.vy).toBeLessThan(0);
    }
  });
});

describe("difficulty and level tuning", () => {
  it("orders the difficulties from gentle to strict", () => {
    const [c, p, k] = DIFFICULTIES.map((d) => DIFFICULTY[d]);
    expect(c.gravity).toBeLessThan(p.gravity);
    expect(p.gravity).toBeLessThan(k.gravity);
    expect(c.startFuel).toBeGreaterThan(p.startFuel);
    expect(p.startFuel).toBeGreaterThan(k.startFuel);
    for (const key of ["vy", "vx", "tilt"] as const) {
      expect(c.safe[key]).toBeGreaterThan(p.safe[key]);
      expect(p.safe[key]).toBeGreaterThan(k.safe[key]);
      for (const cfg of [c, p, k]) expect(cfg.hard[key]).toBeGreaterThan(cfg.safe[key]);
    }
  });

  it("raises gravity and narrows pads level by level, within caps", () => {
    for (const d of DIFFICULTIES) {
      let prev = levelParams(d, 1);
      expect(prev.gravity).toBe(DIFFICULTY[d].gravity);
      expect(prev.padScale).toBe(1);
      expect(prev.refuel).toBe(DIFFICULTY[d].refuel);
      for (let level = 2; level <= 20; level++) {
        const p = levelParams(d, level);
        expect(p.gravity).toBeGreaterThanOrEqual(prev.gravity);
        expect(p.padScale).toBeLessThanOrEqual(prev.padScale);
        expect(p.refuel).toBeLessThanOrEqual(prev.refuel);
        expect(p.padScale).toBeGreaterThanOrEqual(PAD_SCALE_MIN);
        expect(p.refuel).toBeGreaterThanOrEqual(DIFFICULTY[d].refuel / 2);
        prev = p;
      }
      expect(levelParams(d, 2).gravity).toBeGreaterThan(levelParams(d, 1).gravity);
      expect(levelParams(d, 40).gravity).toBe(levelParams(d, GRAVITY_STEPS_MAX + 1).gravity);
    }
  });
});

describe("landing and progression", () => {
  it("scores, refuels and counts a landing, then moves on to the next level", () => {
    const start = createGame("pilot", "prog");
    const landed = land(start);
    expect(landed.phase).toBe("landed");
    const out = landed.outcome;
    expect(out?.verdict).toBe("safe");
    expect(landed.score).toBe(out?.score?.total);
    expect(landed.landings).toBe(1);
    expect(landed.lives).toBe(LIVES);
    expect(out?.refuel).toBe(levelParams("pilot", 1).refuel);

    const next = continueGame(landed);
    expect(next.level).toBe(2);
    expect(next.phase).toBe("flying");
    expect(next.outcome).toBeNull();
    expect(next.terrain).not.toEqual(landed.terrain);
    expect(next.params.gravity).toBeGreaterThan(landed.params.gravity);
    // Fuel carries over, refuel included.
    expect(next.lander.fuel).toBe(landed.lander.fuel);
    expect(next.score).toBe(landed.score);
    expect(next.lander.y).toBe(SPAWN_ALTITUDE);
  });

  it("never refuels past the tank's capacity", () => {
    // Nearly full tank, a gentle touchdown on the test pad.
    const g = gameOn(flatTerrain(), { x: 930, y: TEST_PAD.y - FOOT_Y + 0.05, vy: -2, fuel: FUEL_CAPACITY - 10 });
    let s = g;
    for (let i = 0; i < 60 && s.phase === "flying"; i++) s = step(s, IDLE, STEP);
    expect(s.outcome?.verdict).toBe("safe");
    expect(s.outcome?.refuel).toBe(10);
    expect(s.lander.fuel).toBe(FUEL_CAPACITY);
  });

  it("only advances a level after a landing", () => {
    const g = createGame("pilot", "x");
    expect(nextLevel(g)).toBe(g);
    expect(nextLander(g)).toBe(g);
    expect(continueGame(g)).toBe(g);
  });
});

describe("crashes, lives and game over", () => {
  it("costs a lander, then flies the same ground again with the fuel left", () => {
    const start = createGame("pilot", "crash");
    const wreck = dropUntilContact(start);
    expect(wreck.phase).toBe("crashed");
    expect(wreck.lives).toBe(LIVES - 1);
    expect(wreck.gameOver).toBe(false);
    expect(wreck.score).toBe(0);
    expect(wreck.outcome?.verdict).toBe("crash");

    const retry = continueGame(wreck);
    expect(retry.phase).toBe("flying");
    expect(retry.level).toBe(1);
    expect(retry.attempt).toBe(1);
    expect(retry.terrain).toBe(wreck.terrain);
    expect(retry.lander.fuel).toBe(wreck.lander.fuel);
    expect(retry.lander.x).not.toBe(start.lander.x);
  });

  it("ends the run when the last lander is lost", () => {
    let s = createGame("commander", "doom");
    for (let i = 0; i < LIVES; i++) {
      s = dropUntilContact(s);
      expect(s.phase).toBe("crashed");
      expect(s.lives).toBe(LIVES - 1 - i);
      if (i < LIVES - 1) s = continueGame(s);
    }
    expect(s.gameOver).toBe(true);
    expect(continueGame(s)).toBe(s);
  });

  it("ends the run on a crash with dry tanks, even with landers to spare", () => {
    const start = createGame("pilot", "dry");
    const empty = { ...start, lander: { ...start.lander, fuel: 0 } };
    const wreck = dropUntilContact(empty);
    expect(wreck.lives).toBe(LIVES - 1);
    expect(wreck.gameOver).toBe(true);
  });

  it("keeps the score of earlier landings through a crash", () => {
    const landed = land(createGame("cadet", "mixed"));
    const wreck = dropUntilContact(continueGame(landed));
    expect(wreck.phase).toBe("crashed");
    expect(wreck.score).toBe(landed.score);
    expect(wreck.level).toBe(2);
  });
});

describe("events and the phase clock", () => {
  it("raises fuelOut once, the moment the tank runs dry", () => {
    const start = createGame("pilot", "ev");
    const low = { ...start, lander: { ...start.lander, fuel: 2 } };
    const { events } = collect(low, THRUST, 1.5);
    expect(events.filter((e) => e.type === "fuelOut")).toHaveLength(1);
  });

  it("beeps a low-fuel warning at a steady cadence while flying low on fuel", () => {
    const start = createGame("pilot", "beep");
    const low = { ...start, lander: { ...start.lander, fuel: LOW_FUEL - 1 } };
    const { events } = collect(low, IDLE, 3 * LOW_FUEL_BEEP + 0.05);
    // One immediately, then one per interval.
    expect(events.filter((e) => e.type === "lowFuel")).toHaveLength(4);
    const plenty = collect(start, IDLE, 3).events;
    expect(plenty.filter((e) => e.type === "lowFuel")).toHaveLength(0);
  });

  it("only ticks the clock after touchdown", () => {
    const wreck = dropUntilContact(createGame("pilot", "clock"));
    const later = step(step(wreck, THRUST, STEP), THRUST, STEP);
    expect(later.phaseTime).toBeCloseTo(2 * STEP, 12);
    expect(later.lander).toEqual(wreck.lander);
    expect(later.events).toEqual([]);
    expect(later.lives).toBe(wreck.lives);
  });
});
