import {
  EDGE_MARGIN,
  EDGE_MAX,
  EDGE_MIN,
  JAGGEDNESS,
  MAX_SEGMENT,
  MIN_PAD_WIDTH,
  PAD_GAP,
  PAD_MAX_Y,
  PAD_MIN_Y,
  PAD_SPECS,
  ROUGHNESS,
  SHOULDER_DROP,
  SHOULDER_MAX,
  SHOULDER_MIN,
  TERRAIN_MAX,
  TERRAIN_MIN,
  WORLD_WIDTH,
} from "./constants";
import { clamp } from "./geometry";
import { makeRng, type Rng } from "./rng";
import type { Pad, Terrain, Vec } from "./types";

/** Width of a pad after level scaling, never narrower than the feet allow. */
export function padWidthFor(baseWidth: number, padScale: number): number {
  return Math.max(MIN_PAD_WIDTH, Math.round(baseWidth * padScale));
}

/**
 * Seeded moonscape: the same seed and level always give the same ground.
 *
 * The pads are placed first — one per multiplier, dealt into equal slots in a
 * shuffled order so the prize pad is somewhere new each level — and then the
 * ground between them is grown by midpoint displacement. Pads and their
 * shoulders are fixed anchors the fractal fill never touches, which is what
 * keeps every pad perfectly flat and its lip clear.
 */
export function generateTerrain(seed: string | number, level: number, padScale = 1): Terrain {
  const rng = makeRng(`terrain|${seed}|${level}`);
  const width = WORLD_WIDTH;
  const slot = (width - 2 * EDGE_MARGIN) / PAD_SPECS.length;

  const order = rng.shuffle(PAD_SPECS.map((_, i) => i));
  const pads: Pad[] = order.map((specIndex, slotIndex) => {
    const spec = PAD_SPECS[specIndex];
    const w = padWidthFor(spec.width, padScale);
    // Slide the pad anywhere in its slot that still leaves half the minimum
    // gap at both slot ends, so neighbours are always PAD_GAP apart.
    const slack = Math.floor(slot - w - PAD_GAP);
    const x0 = Math.round(EDGE_MARGIN + slotIndex * slot + PAD_GAP / 2) + rng.int(0, slack);
    const y = rng.int(PAD_MIN_Y, PAD_MAX_Y);
    return { id: slotIndex, x0, x1: x0 + w, y, multiplier: spec.multiplier };
  });

  const points: Vec[] = [];
  let prev: Vec = { x: 0, y: rng.int(EDGE_MIN, EDGE_MAX) };
  points.push(prev);
  for (const pad of pads) {
    const left = shoulder(rng, pad.x0, -1, pad.y);
    displace(rng, prev, left, points);
    points.push(left, { x: pad.x0, y: pad.y }, { x: pad.x1, y: pad.y });
    const right = shoulder(rng, pad.x1, 1, pad.y);
    points.push(right);
    prev = right;
  }
  const end: Vec = { x: width, y: rng.int(EDGE_MIN, EDGE_MAX) };
  displace(rng, prev, end, points);
  points.push(end);

  return { points, pads, width };
}

/** A point a little outside a pad's edge, at or below the pad. */
function shoulder(rng: Rng, edgeX: number, side: -1 | 1, padY: number): Vec {
  const run = SHOULDER_MIN + rng.next() * (SHOULDER_MAX - SHOULDER_MIN);
  const drop = rng.next() * SHOULDER_DROP;
  return { x: edgeX + side * run, y: Math.max(TERRAIN_MIN, padY - drop) };
}

/**
 * Midpoint displacement between two fixed points: split the span at a
 * jittered midpoint, nudge it up or down by an amount that grows with the
 * span, recurse. Pushes the interior points (not `a` or `b`) onto `out` in
 * left-to-right order. Long spans get big hills; short ones, jagged rubble.
 */
function displace(rng: Rng, a: Vec, b: Vec, out: Vec[]): void {
  const span = b.x - a.x;
  if (span <= MAX_SEGMENT) return;
  const t = 0.35 + rng.next() * 0.3;
  const mid: Vec = {
    x: a.x + span * t,
    y: clamp(
      a.y + (b.y - a.y) * t + (rng.next() * 2 - 1) * ROUGHNESS * Math.pow(span, JAGGEDNESS),
      TERRAIN_MIN,
      TERRAIN_MAX
    ),
  };
  displace(rng, a, mid, out);
  out.push(mid);
  displace(rng, mid, b, out);
}

/* ---------------------------------------------------------------- queries */

/**
 * Index `i` of the surface segment `points[i] → points[i + 1]` spanning `x`
 * (binary search; `x` outside the world maps to the end segments).
 */
export function segmentIndex(points: readonly Vec[], x: number): number {
  let lo = 0;
  let hi = points.length - 1;
  if (x <= points[0].x) return 0;
  if (x >= points[hi].x) return hi - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid].x <= x) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** Surface height at `x`, interpolated along the polyline. */
export function heightAt(terrain: Terrain, x: number): number {
  const pts = terrain.points;
  const i = segmentIndex(pts, x);
  const a = pts[i];
  const b = pts[i + 1];
  if (x <= a.x) return a.y;
  if (x >= b.x) return b.y;
  return a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x);
}

/** Highest surface point anywhere over `[x0, x1]`. */
export function maxHeightBetween(terrain: Terrain, x0: number, x1: number): number {
  const lo = Math.min(x0, x1);
  const hi = Math.max(x0, x1);
  const pts = terrain.points;
  let best = Math.max(heightAt(terrain, lo), heightAt(terrain, hi));
  for (let i = segmentIndex(pts, lo) + 1; i < pts.length && pts[i].x < hi; i++) {
    if (pts[i].y > best) best = pts[i].y;
  }
  return best;
}

/** The pad whose surface spans `x`, if any. */
export function padUnder(terrain: Terrain, x: number): Pad | null {
  for (const pad of terrain.pads) {
    if (x >= pad.x0 && x <= pad.x1) return pad;
  }
  return null;
}

/** The pad whose centre is horizontally closest to `x`. */
export function nearestPad(terrain: Terrain, x: number): Pad {
  let best = terrain.pads[0];
  let bestDist = Infinity;
  for (const pad of terrain.pads) {
    const d = Math.abs((pad.x0 + pad.x1) / 2 - x);
    if (d < bestDist) {
      bestDist = d;
      best = pad;
    }
  }
  return best;
}

export const padCenter = (pad: Pad): number => (pad.x0 + pad.x1) / 2;
