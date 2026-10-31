import { describe, expect, it } from "vitest";
import {
  cameraTarget,
  farZoom,
  followCamera,
  MIN_FAR_ZOOM,
  nearZoom,
  toScreen,
  ZOOM_IN_ALT,
  ZOOM_OUT_ALT,
  zoomForAltitude,
  type Camera,
  type Viewport,
} from "@/lib/game/camera";
import { SCENE_HEIGHT, SPAWN_ALTITUDE, WORLD_WIDTH } from "@/lib/game/constants";
import { makeRng } from "@/lib/game/rng";
import { generateTerrain, heightAt } from "@/lib/game/terrain";

const DESKTOP: Viewport = { width: 1240, height: 640 };
const PHONE: Viewport = { width: 374, height: 520 };
const LANDSCAPE: Viewport = { width: 800, height: 230 };
const VIEWPORTS = [DESKTOP, PHONE, LANDSCAPE];
const terrain = generateTerrain("camera", 1);

function inFrame(cam: Camera, vp: Viewport, x: number, y: number): boolean {
  const s = toScreen(cam, vp, { x, y });
  return s.x >= 0 && s.x <= vp.width && s.y >= 0 && s.y <= vp.height;
}

describe("zoom", () => {
  it("frames the whole scene height when high, on a desktop", () => {
    expect(DESKTOP.height / farZoom(DESKTOP)).toBeCloseTo(SCENE_HEIGHT, 6);
  });

  it("never shrinks the lander to a dot on small or squat screens", () => {
    for (const vp of VIEWPORTS) expect(farZoom(vp)).toBeGreaterThanOrEqual(MIN_FAR_ZOOM);
  });

  it("closes in near the ground and pulls out high up, smoothly and monotonically", () => {
    for (const vp of VIEWPORTS) {
      expect(nearZoom(vp)).toBeGreaterThan(farZoom(vp) * 1.4);
      expect(zoomForAltitude(vp, 0)).toBeCloseTo(nearZoom(vp), 9);
      expect(zoomForAltitude(vp, ZOOM_IN_ALT)).toBeCloseTo(nearZoom(vp), 9);
      expect(zoomForAltitude(vp, ZOOM_OUT_ALT)).toBeCloseTo(farZoom(vp), 9);
      expect(zoomForAltitude(vp, 2000)).toBeCloseTo(farZoom(vp), 9);
      let prev = Infinity;
      for (let alt = 0; alt <= 400; alt += 5) {
        const z = zoomForAltitude(vp, alt);
        expect(z).toBeLessThanOrEqual(prev + 1e-12);
        // No jumps: each 5-unit step changes the zoom by under 5%.
        if (prev !== Infinity) expect(prev / z).toBeLessThan(1.05);
        prev = z;
      }
    }
  });
});

describe("framing", () => {
  it("shows the floor-to-sky scene and the lander at spawn height", () => {
    const cam = cameraTarget({ x: WORLD_WIDTH / 2, y: SPAWN_ALTITUDE }, terrain, 500, DESKTOP);
    expect(inFrame(cam, DESKTOP, WORLD_WIDTH / 2, 0)).toBe(true);
    expect(inFrame(cam, DESKTOP, WORLD_WIDTH / 2, SPAWN_ALTITUDE + 20)).toBe(true);
  });

  it("keeps the ground under the lander in view in a close-up", () => {
    for (const vp of VIEWPORTS) {
      const x = 700;
      const ground = heightAt(terrain, x);
      const cam = cameraTarget({ x, y: ground + 40 }, terrain, 28, vp);
      expect(cam.zoom).toBeCloseTo(nearZoom(vp), 9);
      expect(inFrame(cam, vp, x, ground + 40)).toBe(true);
      expect(inFrame(cam, vp, x, ground - 2)).toBe(true);
    }
  });

  it("always keeps the lander in frame, wherever it flies", () => {
    const rng = makeRng("frame");
    for (const vp of VIEWPORTS) {
      for (let i = 0; i < 300; i++) {
        const x = 14 + rng.next() * (WORLD_WIDTH - 28);
        const y = 40 + rng.next() * 1100;
        const alt = rng.next() * 600;
        const cam = cameraTarget({ x, y }, terrain, alt, vp);
        expect(inFrame(cam, vp, x, y)).toBe(true);
      }
    }
  });

  it("eases toward its target and keeps the lander framed on the way", () => {
    const vp = PHONE;
    const focus = { x: 300, y: 400 };
    const target = cameraTarget(focus, terrain, 40, vp);
    let cam: Camera = { x: 1500, y: 900, zoom: farZoom(vp) };
    for (let i = 0; i < 600; i++) {
      cam = followCamera(cam, target, focus, vp, 1 / 120);
      expect(inFrame(cam, vp, focus.x, focus.y)).toBe(true);
    }
    expect(cam.zoom).toBeCloseTo(target.zoom, 3);
    expect(cam.x).toBeCloseTo(target.x, 1);
    expect(cam.y).toBeCloseTo(target.y, 1);
  });

  it("maps the camera centre to the middle of the screen", () => {
    const cam = { x: 123, y: 456, zoom: 1.7 };
    expect(toScreen(cam, DESKTOP, { x: 123, y: 456 })).toEqual({ x: 620, y: 320 });
    // y-up world, y-down screen.
    expect(toScreen(cam, DESKTOP, { x: 123, y: 466 }).y).toBeLessThan(320);
  });
});
