import {
  BOUND_MARGIN,
  BURN_RATE,
  CEILING,
  MAX_TILT,
  ROT_RAMP,
  ROT_RATE_MAX,
  ROT_RATE_MIN,
  THRUST_ACCEL,
} from "./constants";
import { clamp } from "./geometry";
import type { Input, Lander } from "./types";

/** Rotation speed (rad/s) after holding a rotate input for `held` seconds. */
export function rotationRate(held: number): number {
  return ROT_RATE_MIN + (ROT_RATE_MAX - ROT_RATE_MIN) * clamp(held / ROT_RAMP, 0, 1);
}

/** Unit vector along which the main engine pushes at `angle` (y-up). */
export function thrustDirection(angle: number): { x: number; y: number } {
  return { x: Math.sin(angle), y: Math.cos(angle) };
}

/**
 * Advance the lander by one fixed step: rotate, burn, then move.
 *
 * Within a step the acceleration is constant (gravity plus a thrust vector
 * along the current heading), so the position update uses the exact
 * constant-acceleration form `x += v·dt + ½·a·dt²`. Free fall therefore
 * matches `½·g·t²` to rounding error no matter the step size.
 *
 * The engine only fires with fuel in the tank; the last partial step burns
 * what remains and delivers a matching fraction of thrust, so the tank lands
 * on exactly zero rather than going negative.
 *
 * `width` is the world width; the lander is held inside it and under the
 * ceiling, losing the velocity component that pushed it out.
 */
export function integrate(lander: Lander, input: Input, gravity: number, dt: number, width: number): Lander {
  const dir: -1 | 0 | 1 = input.right === input.left ? 0 : input.right ? 1 : -1;
  const rotHeld = dir === 0 ? 0 : dir === lander.rotDir ? lander.rotHeld + dt : dt;
  const angle = clamp(lander.angle + dir * rotationRate(rotHeld) * dt, -MAX_TILT, MAX_TILT);

  const burn = input.thrust && lander.fuel > 0 ? Math.min(lander.fuel, BURN_RATE * dt) : 0;
  const throttle = burn > 0 ? burn / (BURN_RATE * dt) : 0;
  const push = THRUST_ACCEL * throttle;
  const ax = Math.sin(angle) * push;
  const ay = Math.cos(angle) * push - gravity;

  let x = lander.x + lander.vx * dt + 0.5 * ax * dt * dt;
  let y = lander.y + lander.vy * dt + 0.5 * ay * dt * dt;
  let vx = lander.vx + ax * dt;
  let vy = lander.vy + ay * dt;

  if (x < BOUND_MARGIN) {
    x = BOUND_MARGIN;
    vx = Math.max(vx, 0);
  } else if (x > width - BOUND_MARGIN) {
    x = width - BOUND_MARGIN;
    vx = Math.min(vx, 0);
  }
  if (y > CEILING) {
    y = CEILING;
    vy = Math.min(vy, 0);
  }

  return {
    x,
    y,
    vx,
    vy,
    angle,
    fuel: burn > 0 ? lander.fuel - burn : lander.fuel,
    thrusting: burn > 0,
    rotDir: dir,
    rotHeld,
  };
}
