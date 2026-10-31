import type { Vec } from "./types";

/** Small, allocation-light 2-D helpers shared by the physics, camera and effects. */

export const deg = (d: number): number => (d * Math.PI) / 180;
export const toDeg = (r: number): number => (r * 180) / Math.PI;

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Hermite ease between two edges: 0 below `e0`, 1 above `e1`, smooth between. */
export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * Rotate a body-local point clockwise by `angle` (y-up space), matching the
 * lander's convention that a positive angle leans the nose to the right.
 */
export function rotate(p: Vec, angle: number): Vec {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: p.x * c + p.y * s, y: -p.x * s + p.y * c };
}

export interface Pose {
  x: number;
  y: number;
  angle: number;
}

/** Map a body-local point onto the world for a lander at `pose`. */
export function toWorld(pose: Pose, p: Vec): Vec {
  const r = rotate(p, pose.angle);
  return { x: pose.x + r.x, y: pose.y + r.y };
}

function orient(a: Vec, b: Vec, c: Vec): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function onSegment(a: Vec, b: Vec, p: Vec): boolean {
  return (
    Math.min(a.x, b.x) <= p.x &&
    p.x <= Math.max(a.x, b.x) &&
    Math.min(a.y, b.y) <= p.y &&
    p.y <= Math.max(a.y, b.y)
  );
}

/**
 * Whether segments `ab` and `cd` share at least one point. Touching counts —
 * a lander resting exactly on a surface is in contact with it.
 */
export function segmentsIntersect(a: Vec, b: Vec, c: Vec, d: Vec): boolean {
  const d1 = orient(c, d, a);
  const d2 = orient(c, d, b);
  const d3 = orient(a, b, c);
  const d4 = orient(a, b, d);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true;
  }
  if (d1 === 0 && onSegment(c, d, a)) return true;
  if (d2 === 0 && onSegment(c, d, b)) return true;
  if (d3 === 0 && onSegment(a, b, c)) return true;
  if (d4 === 0 && onSegment(a, b, d)) return true;
  return false;
}
