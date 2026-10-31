import { describe, expect, it } from "vitest";
import {
  BOUND_MARGIN,
  BURN_RATE,
  CEILING,
  MAX_TILT,
  ROT_RAMP,
  ROT_RATE_MAX,
  ROT_RATE_MIN,
  STEP,
  THRUST_ACCEL,
  WORLD_WIDTH,
} from "@/lib/game/constants";
import { deg } from "@/lib/game/geometry";
import { integrate, rotationRate, thrustDirection } from "@/lib/game/physics";
import type { Input, Lander } from "@/lib/game/types";
import { makeLander } from "./helpers/state";

const IDLE: Input = { left: false, right: false, thrust: false };
const THRUST: Input = { left: false, right: false, thrust: true };
const RIGHT: Input = { left: false, right: true, thrust: false };
const LEFT: Input = { left: true, right: false, thrust: false };
const G = 6.48;

function run(l: Lander, input: Input, seconds: number, dt = STEP, gravity = G): Lander {
  const steps = Math.round(seconds / dt);
  let out = l;
  for (let i = 0; i < steps; i++) out = integrate(out, input, gravity, dt, WORLD_WIDTH);
  return out;
}

describe("free fall", () => {
  it("matches v = g·t and y = y0 − ½·g·t² from rest", () => {
    const end = run(makeLander(), IDLE, 3);
    expect(end.vy).toBeCloseTo(-G * 3, 9);
    expect(end.y).toBeCloseTo(800 - 0.5 * G * 9, 6);
    expect(end.x).toBe(1000);
    expect(end.vx).toBe(0);
  });

  it("carries sideways drift unchanged", () => {
    const end = run(makeLander({ vx: 12 }), IDLE, 2);
    expect(end.vx).toBe(12);
    expect(end.x).toBeCloseTo(1000 + 24, 9);
  });

  it("does not depend on the step size", () => {
    const coarse = run(makeLander({ vy: 5 }), IDLE, 2, 1 / 30);
    const fine = run(makeLander({ vy: 5 }), IDLE, 2, 1 / 240);
    expect(coarse.y).toBeCloseTo(fine.y, 6);
    expect(coarse.vy).toBeCloseTo(fine.vy, 9);
  });

  it("burns no fuel and reports the engine off", () => {
    const end = run(makeLander(), IDLE, 2);
    expect(end.fuel).toBe(500);
    expect(end.thrusting).toBe(false);
  });
});

describe("thrust", () => {
  it("pushes straight up when upright", () => {
    const end = run(makeLander(), THRUST, 1);
    expect(end.vy).toBeCloseTo(THRUST_ACCEL - G, 9);
    expect(end.vx).toBeCloseTo(0, 12);
    expect(end.thrusting).toBe(true);
  });

  it("pushes right when leaning right and left when leaning left", () => {
    const right = run(makeLander({ angle: deg(90) }), THRUST, 1);
    expect(right.vx).toBeCloseTo(THRUST_ACCEL, 9);
    expect(right.vy).toBeCloseTo(-G, 9);
    const left = run(makeLander({ angle: deg(-90) }), THRUST, 1);
    expect(left.vx).toBeCloseTo(-THRUST_ACCEL, 9);
  });

  it("splits along the heading at intermediate angles", () => {
    const a = deg(30);
    const end = run(makeLander({ angle: a }), THRUST, 1);
    expect(end.vx).toBeCloseTo(Math.sin(a) * THRUST_ACCEL, 9);
    expect(end.vy).toBeCloseTo(Math.cos(a) * THRUST_ACCEL - G, 9);
    expect(end.vx / (end.vy + G)).toBeCloseTo(Math.tan(a), 9);
  });

  it("follows thrustDirection, a unit vector", () => {
    for (const d of [-90, -45, -7, 0, 12, 60, 90]) {
      const dir = thrustDirection(deg(d));
      expect(Math.hypot(dir.x, dir.y)).toBeCloseTo(1, 12);
      expect(Math.sign(dir.x)).toBe(Math.sign(d));
    }
  });
});

describe("fuel", () => {
  it("drains at the burn rate only while thrusting", () => {
    expect(run(makeLander(), IDLE, 2).fuel).toBe(500);
    expect(run(makeLander(), RIGHT, 2).fuel).toBe(500);
    expect(run(makeLander(), THRUST, 2).fuel).toBeCloseTo(500 - BURN_RATE * 2, 9);
  });

  it("stops at exactly zero, and the engine then cuts out", () => {
    const dry = run(makeLander({ fuel: 3 }), THRUST, 1);
    expect(dry.fuel).toBe(0);
    expect(dry.thrusting).toBe(false);
    // With the tank dry, holding thrust is just free fall.
    const next = integrate(dry, THRUST, G, STEP, WORLD_WIDTH);
    expect(next.fuel).toBe(0);
    expect(next.vy).toBeCloseTo(dry.vy - G * STEP, 12);
  });

  it("never goes negative however long the burn", () => {
    let l = makeLander({ fuel: 1 });
    for (let i = 0; i < 1000; i++) {
      l = integrate(l, THRUST, G, STEP, WORLD_WIDTH);
      expect(l.fuel).toBeGreaterThanOrEqual(0);
    }
    expect(l.fuel).toBe(0);
  });

  it("gives proportional thrust on the last partial step", () => {
    const half = makeLander({ fuel: (BURN_RATE * STEP) / 2 });
    const next = integrate(half, THRUST, G, STEP, WORLD_WIDTH);
    expect(next.fuel).toBe(0);
    expect(next.vy).toBeCloseTo((THRUST_ACCEL / 2 - G) * STEP, 12);
  });
});

describe("rotation", () => {
  it("turns clockwise on right and counter-clockwise on left", () => {
    expect(run(makeLander(), RIGHT, 0.2).angle).toBeGreaterThan(0);
    expect(run(makeLander(), LEFT, 0.2).angle).toBeLessThan(0);
  });

  it("ramps from a slow trim rate to a fast turn", () => {
    expect(rotationRate(0)).toBe(ROT_RATE_MIN);
    expect(rotationRate(ROT_RAMP / 2)).toBeCloseTo((ROT_RATE_MIN + ROT_RATE_MAX) / 2, 12);
    expect(rotationRate(ROT_RAMP)).toBe(ROT_RATE_MAX);
    expect(rotationRate(10)).toBe(ROT_RATE_MAX);
    // A tap turns gently: one step is a fraction of a degree.
    const tap = integrate(makeLander(), RIGHT, G, STEP, WORLD_WIDTH);
    expect(tap.angle).toBeLessThan(deg(0.5));
    // Held, the turn speeds up: the second quarter second turns more than the first.
    const first = run(makeLander(), RIGHT, 0.25);
    const second = run(first, RIGHT, 0.25);
    expect(second.angle - first.angle).toBeGreaterThan(first.angle);
  });

  it("restarts the ramp when the direction changes", () => {
    const held = run(makeLander(), RIGHT, 1);
    expect(held.rotHeld).toBeGreaterThan(ROT_RAMP);
    const flipped = integrate(held, LEFT, G, STEP, WORLD_WIDTH);
    expect(flipped.rotDir).toBe(-1);
    expect(flipped.rotHeld).toBeCloseTo(STEP, 12);
    expect(held.angle - flipped.angle).toBeLessThan(ROT_RATE_MIN * STEP * 1.1);
  });

  it("holds still when both or neither are pressed", () => {
    const both = run(makeLander({ angle: 0.1 }), { left: true, right: true, thrust: false }, 1);
    expect(both.angle).toBe(0.1);
    expect(run(makeLander({ angle: 0.1 }), IDLE, 1).angle).toBe(0.1);
  });

  it("never leans past a quarter turn", () => {
    expect(run(makeLander(), RIGHT, 5).angle).toBe(MAX_TILT);
    expect(run(makeLander(), LEFT, 5).angle).toBe(-MAX_TILT);
  });
});

describe("world bounds", () => {
  it("stops the lander at the side edges", () => {
    const left = run(makeLander({ x: 20, vx: -30 }), IDLE, 1);
    expect(left.x).toBe(BOUND_MARGIN);
    expect(left.vx).toBe(0);
    const right = run(makeLander({ x: WORLD_WIDTH - 20, vx: 30 }), IDLE, 1);
    expect(right.x).toBe(WORLD_WIDTH - BOUND_MARGIN);
    expect(right.vx).toBe(0);
  });

  it("caps the climb at the ceiling", () => {
    const top = run(makeLander({ y: CEILING - 5, vy: 40 }), IDLE, 0.5);
    expect(top.y).toBeLessThanOrEqual(CEILING);
    expect(top.vy).toBeLessThanOrEqual(0);
  });
});
