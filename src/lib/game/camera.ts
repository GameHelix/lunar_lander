import { SCENE_HEIGHT, WORLD_WIDTH } from "./constants";
import { clamp, lerp, smoothstep } from "./geometry";
import { heightAt } from "./terrain";
import type { Terrain, Vec } from "./types";

/** Centre of view in world units, and scale in CSS pixels per unit. */
export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export interface Viewport {
  width: number;
  height: number;
}

/** Fully zoomed in at or below this altitude (units)… */
export const ZOOM_IN_ALT = 70;
/** …fully zoomed out at or above this one. */
export const ZOOM_OUT_ALT = 300;
/** The overview never shrinks the lander below about ten pixels. */
export const MIN_FAR_ZOOM = 0.45;
export const MAX_ZOOM = 4;
/** World area a close-up aims to show. */
const NEAR_VIEW_WIDTH = 280;
const NEAR_VIEW_HEIGHT = 300;
/** How much void below the floor and beyond the side edges may show. */
const FLOOR_PAD = 30;
const SIDE_PAD = 40;
/** In a close-up the ground under the lander sits this far up the frame. */
const GROUND_FRAC = 0.24;
/** The lander is kept this many units, plus this many pixels, inside the frame. */
const LANDER_EXTENT = 14;
const FRAME_MARGIN_PX = 28;
/** Easing time constants, seconds. */
const ZOOM_TAU = 0.45;
const PAN_TAU = 0.22;

/** Overview scale: the full height of the scene, unless the screen is too small or too wide for that. */
export function farZoom(vp: Viewport): number {
  return Math.max(vp.height / SCENE_HEIGHT, vp.width / (WORLD_WIDTH + 2 * SIDE_PAD), MIN_FAR_ZOOM);
}

/** Close-up scale for the last stretch of a descent. */
export function nearZoom(vp: Viewport): number {
  const far = farZoom(vp);
  const z = Math.min(vp.width / NEAR_VIEW_WIDTH, vp.height / NEAR_VIEW_HEIGHT);
  return clamp(z, far * 1.5, Math.max(MAX_ZOOM, far * 1.5));
}

/**
 * Scale for an altitude: overview when high, close-up near the ground, and a
 * smooth blend between. The blend runs in log space, where equal steps look
 * like equal changes of size.
 */
export function zoomForAltitude(vp: Viewport, altitude: number): number {
  const t = smoothstep(ZOOM_IN_ALT, ZOOM_OUT_ALT, altitude);
  return Math.exp(lerp(Math.log(nearZoom(vp)), Math.log(farZoom(vp)), t));
}

/**
 * Where the camera wants to be. High up it frames the scene from the floor
 * upward; low down it centres on the lander with the ground beneath it in
 * the lower part of the frame, so the pilot always sees what is coming.
 */
export function cameraTarget(focus: Vec, terrain: Terrain, altitude: number, vp: Viewport): Camera {
  const zoom = zoomForAltitude(vp, altitude);
  const t = smoothstep(ZOOM_IN_ALT, ZOOM_OUT_ALT, altitude);
  const viewH = vp.height / zoom;
  const nearY = heightAt(terrain, focus.x) + viewH * (0.5 - GROUND_FRAC);
  const farY = viewH / 2 - FLOOR_PAD;
  return constrain({ x: focus.x, y: lerp(nearY, farY, t), zoom }, focus, vp);
}

function clampOrMid(v: number, lo: number, hi: number): number {
  return lo > hi ? (lo + hi) / 2 : clamp(v, lo, hi);
}

/**
 * Keep a camera over the world (or centred, if the view is wider than it),
 * out of the void under the floor, and — overriding both — with the lander
 * inside the frame.
 */
export function constrain(cam: Camera, focus: Vec, vp: Viewport): Camera {
  const viewW = vp.width / cam.zoom;
  const viewH = vp.height / cam.zoom;
  let x = clampOrMid(cam.x, -SIDE_PAD + viewW / 2, WORLD_WIDTH + SIDE_PAD - viewW / 2);
  let y = Math.max(cam.y, viewH / 2 - FLOOR_PAD);
  const m = LANDER_EXTENT + FRAME_MARGIN_PX / cam.zoom;
  x = clampOrMid(x, focus.x - viewW / 2 + m, focus.x + viewW / 2 - m);
  y = clampOrMid(y, focus.y - viewH / 2 + m, focus.y + viewH / 2 - m);
  return { x, y, zoom: cam.zoom };
}

/** Ease toward the target (zoom in log space), then re-frame the lander. */
export function followCamera(cam: Camera, target: Camera, focus: Vec, vp: Viewport, dt: number): Camera {
  const kz = 1 - Math.exp(-dt / ZOOM_TAU);
  const kp = 1 - Math.exp(-dt / PAN_TAU);
  const zoom = Math.exp(lerp(Math.log(cam.zoom), Math.log(target.zoom), kz));
  return constrain({ x: lerp(cam.x, target.x, kp), y: lerp(cam.y, target.y, kp), zoom }, focus, vp);
}

/** World point → CSS pixel within the viewport. */
export function toScreen(cam: Camera, vp: Viewport, p: Vec): Vec {
  return { x: (p.x - cam.x) * cam.zoom + vp.width / 2, y: vp.height / 2 - (p.y - cam.y) * cam.zoom };
}
