import type { Vec } from "./types";

/**
 * The lander's geometry in body-local units (y-up, origin at the centre of
 * the body). One set of numbers drives the drawing, the collision tests and
 * the debris of a crash, so what you see is exactly what touches the ground.
 */

const v = (x: number, y: number): Vec => ({ x, y });

/** Ascent stage: the crew cabin on top. */
export const CABIN: readonly Vec[] = [
  v(-6, -1),
  v(-7.5, 2.5),
  v(-6, 7),
  v(-2.5, 9.2),
  v(2.5, 9.2),
  v(6, 7),
  v(7.5, 2.5),
  v(6, -1),
];

/** The two triangular windows. */
export const WINDOWS: readonly (readonly Vec[])[] = [
  [v(-4.6, 4.2), v(-1.2, 4.2), v(-1.2, 7)],
  [v(4.6, 4.2), v(1.2, 4.2), v(1.2, 7)],
];

/** Descent stage: the boxy lower half. */
export const DESCENT: readonly Vec[] = [v(-7, -1), v(7, -1), v(7, -6), v(-7, -6)];

/** Engine bell under the descent stage. */
export const NOZZLE: readonly Vec[] = [v(-2.2, -6), v(2.2, -6), v(3.4, -9), v(-3.4, -9)];

/** Centre of the nozzle exit, where the flame starts. */
export const NOZZLE_EXIT: Vec = v(0, -9);

/** Landing-leg struts and their braces. */
export const LEGS: readonly (readonly [Vec, Vec])[] = [
  [v(-6.5, -3.5), v(-10, -12)],
  [v(6.5, -3.5), v(10, -12)],
  [v(-4, -6), v(-8.6, -8.6)],
  [v(4, -6), v(8.6, -8.6)],
];

/** The foot pads drawn at the end of each leg. */
export const FEET: readonly (readonly [Vec, Vec])[] = [
  [v(-11.6, -12), v(-8.4, -12)],
  [v(8.4, -12), v(11.6, -12)],
];

/** Antenna mast on the cabin roof (decoration, no collision). */
export const ANTENNA: readonly [Vec, Vec] = [v(3.5, 9.2), v(5.5, 12.5)];

/** Contact points of the left and right feet. */
export const FOOT_X = 10;
export const FOOT_Y = -12;
export const FOOT_POINTS: readonly [Vec, Vec] = [v(-FOOT_X, FOOT_Y), v(FOOT_X, FOOT_Y)];

/**
 * Convex outline of cabin, descent stage and nozzle together. Anything
 * touching this is a hull strike, which is always a crash.
 */
export const BODY_HULL: readonly Vec[] = [
  v(-3.4, -9),
  v(3.4, -9),
  v(7, -6),
  v(7.5, 2.5),
  v(6, 7),
  v(2.5, 9.2),
  v(-2.5, 9.2),
  v(-6, 7),
  v(-7.5, 2.5),
  v(-7, -6),
];

/**
 * The upper 80% of each strut. The tip is left out so a foot resting on a
 * pad is not also reported as a strut strike; for any tilt the foot is always
 * lower than its own strut tip, so flat ground meets the foot first.
 */
export const STRUTS: readonly (readonly [Vec, Vec])[] = [
  [v(-6.5, -3.5), v(-9.3, -10.3)],
  [v(6.5, -3.5), v(9.3, -10.3)],
];

/** Half the overall width, foot pad to foot pad. */
export const HALF_WIDTH = 11.6;

/** Every visible line of the lander, closed outlines unrolled into segments. */
export function outlineSegments(): [Vec, Vec][] {
  const segs: [Vec, Vec][] = [];
  const closed = (poly: readonly Vec[]) => {
    for (let i = 0; i < poly.length; i++) segs.push([poly[i], poly[(i + 1) % poly.length]]);
  };
  closed(CABIN);
  closed(DESCENT);
  closed(NOZZLE);
  for (const leg of LEGS) segs.push([leg[0], leg[1]]);
  for (const foot of FEET) segs.push([foot[0], foot[1]]);
  segs.push([ANTENNA[0], ANTENNA[1]]);
  return segs;
}
