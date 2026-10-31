import { segmentsIntersect, toWorld, type Pose } from "./geometry";
import { BODY_HULL, FOOT_POINTS, HALF_WIDTH, STRUTS } from "./shape";
import { heightAt, maxHeightBetween, segmentIndex } from "./terrain";
import type { Terrain, Vec } from "./types";

/** Which parts of the lander are touching (or below) the surface. */
export interface Contact {
  left: boolean;
  right: boolean;
  /** Cabin, descent stage, nozzle or a strut — any of them means a crash. */
  hull: boolean;
}

export function feetOf(pose: Pose): [Vec, Vec] {
  return [toWorld(pose, FOOT_POINTS[0]), toWorld(pose, FOOT_POINTS[1])];
}

export function hullOf(pose: Pose): Vec[] {
  return BODY_HULL.map((p) => toWorld(pose, p));
}

/** True when a point is on or under the surface. */
function below(terrain: Terrain, p: Vec): boolean {
  return p.y <= heightAt(terrain, p.x);
}

/** Whether a segment touches the surface polyline anywhere along its length. */
function segmentHits(terrain: Terrain, a: Vec, b: Vec): boolean {
  if (below(terrain, a) || below(terrain, b)) return true;
  const pts = terrain.points;
  const hiX = Math.max(a.x, b.x);
  for (let i = segmentIndex(pts, Math.min(a.x, b.x)); i < pts.length - 1 && pts[i].x <= hiX; i++) {
    if (segmentsIntersect(a, b, pts[i], pts[i + 1])) return true;
  }
  return false;
}

/**
 * Contact test for a lander pose against the surface.
 *
 * Feet are points: a foot is down when it is on or under the ground beneath
 * it. The hull is a convex polygon, tested edge by edge against the terrain
 * segments under it — the surface runs the full width of the world, so any
 * rock poking into the hull must cross one of its edges, and a hull sunk
 * entirely underground is caught by its vertices. The struts are segments.
 */
export function detectContact(pose: Pose, terrain: Terrain): Contact {
  const [fl, fr] = feetOf(pose);
  const left = below(terrain, fl);
  const right = below(terrain, fr);

  const hull = hullOf(pose);
  let hit = false;
  for (let i = 0; i < hull.length && !hit; i++) {
    hit = segmentHits(terrain, hull[i], hull[(i + 1) % hull.length]);
  }
  for (let i = 0; i < STRUTS.length && !hit; i++) {
    hit = segmentHits(terrain, toWorld(pose, STRUTS[i][0]), toWorld(pose, STRUTS[i][1]));
  }
  return { left, right, hull: hit };
}

/**
 * Clearance between the lowest point of the lander (normally a foot) and the
 * highest ground under its footprint — the altitude a pilot cares about.
 * Zero or less means contact.
 */
export function altitudeOf(pose: Pose, terrain: Terrain): number {
  const [fl, fr] = feetOf(pose);
  let lowest = Math.min(fl.y, fr.y);
  for (const p of BODY_HULL) lowest = Math.min(lowest, toWorld(pose, p).y);
  return lowest - maxHeightBetween(terrain, pose.x - HALF_WIDTH, pose.x + HALF_WIDTH);
}
