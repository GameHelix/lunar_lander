import { STEP, THRUST_ACCEL } from "@/lib/game/constants";
import { step } from "@/lib/game/game";
import { clamp } from "@/lib/game/geometry";
import { FOOT_Y } from "@/lib/game/shape";
import { maxHeightBetween, padCenter } from "@/lib/game/terrain";
import type { GameState, Input, Pad } from "@/lib/game/types";

/**
 * A plain bang-bang autopilot, used to prove that a safe landing is always
 * within reach of the controls a player has: rotate left, rotate right and
 * one on/off engine.
 *
 * It keeps clear of every peak between it and the pad and tilts to chase a
 * horizontal speed proportional to the distance left. Over the pad it sinks
 * on a braking curve (never faster than half the engine's spare thrust could
 * stop in the height left), pausing to hover and re-centre if it drifts off
 * the middle, and comes in almost level.
 */
export function autopilot(state: GameState, pad: Pad): Input {
  const l = state.lander;
  const target = padCenter(pad);
  const dx = target - l.x;
  const feetY = l.y + FOOT_Y;
  const abovePad = feetY - pad.y;
  // Clear every peak ahead, plus those just behind that the trailing leg could catch.
  const lo = Math.min(l.x, target) - 30;
  const hi = Math.max(l.x, target) + 30;
  const cruise = Math.max(maxHeightBetween(state.terrain, lo, hi), pad.y) + 70;
  const spare = THRUST_ACCEL - state.params.gravity;

  const overPad = Math.abs(dx) <= 10;
  const centred = Math.abs(dx) <= 2.5 && Math.abs(l.vx) <= 1;

  let vyWant: number;
  let vxWant: number;
  let tiltCap: number;
  if (overPad && (centred || abovePad > 45)) {
    // Sink on a braking curve, trimming drift with ever smaller tilts.
    vyWant = -Math.min(45, Math.sqrt(2 * 0.5 * spare * Math.max(0, abovePad)) + 1.5);
    vxWant = clamp(dx * 0.6, -3, 3);
    tiltCap = abovePad < 8 ? 0.02 : abovePad < 30 ? 0.05 : 0.12;
  } else if (overPad) {
    // Low and off-centre: ease up off the pad, then shuffle back over the
    // middle with tilts small enough to touch down on if it has to.
    vyWant = abovePad < 10 ? 2 : 0;
    vxWant = clamp(dx * 0.8, -4, 4);
    tiltCap = abovePad < 12 ? 0.04 : 0.1;
  } else {
    // Cross to the pad above the peaks in between.
    vyWant = clamp((cruise - feetY) * 0.6, -25, 15);
    // Never faster sideways than a gentle 3 units/s² could still stop in the distance left.
    vxWant = Math.sign(dx) * Math.min(34, Math.sqrt(2 * 3 * Math.abs(dx)));
    tiltCap = 0.45;
  }
  const vxErr = vxWant - l.vx;
  const tiltWant = clamp(vxErr * 0.05, -tiltCap, tiltCap);

  const thrust = l.vy < vyWant || (Math.abs(vxErr) > 1 && Math.abs(l.angle) > 0.1 && l.vy < vyWant + 6);
  const angErr = tiltWant - l.angle;
  return { left: angErr < -0.006, right: angErr > 0.006, thrust };
}

/** Fly the current lander with the autopilot until it touches down (or time runs out). */
export function flyTo(state: GameState, pad: Pad, maxSeconds = 240): GameState {
  let s = state;
  for (let t = 0; t < maxSeconds && s.phase === "flying"; t += STEP) {
    s = step(s, autopilot(s, pad), STEP);
  }
  return s;
}

/** Free-fall (no input) until the lander touches down. */
export function dropUntilContact(state: GameState, maxSeconds = 120): GameState {
  let s = state;
  const idle: Input = { left: false, right: false, thrust: false };
  for (let t = 0; t < maxSeconds && s.phase === "flying"; t += STEP) s = step(s, idle, STEP);
  return s;
}
