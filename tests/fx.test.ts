import { describe, expect, it } from "vitest";
import {
  createFx,
  emitCelebration,
  emitDust,
  emitExhaust,
  emitExplosion,
  makeStars,
  MAX_PARTICLES,
  updateFx,
} from "@/lib/game/fx";
import { makeRng } from "@/lib/game/rng";
import { outlineSegments } from "@/lib/game/shape";
import { heightAt } from "@/lib/game/terrain";
import { flatTerrain, TEST_PAD } from "./helpers/state";

const terrain = flatTerrain();
const lander = { x: 930, y: 140, angle: 0, vx: 4, vy: -10 };

describe("visual effects", () => {
  it("blows the explosion apart into sparks, one debris piece per line, a ring and a shake", () => {
    const fx = createFx();
    emitExplosion(fx, lander, makeRng(1), false);
    expect(fx.particles.length).toBeGreaterThan(100);
    expect(fx.debris).toHaveLength(outlineSegments().length);
    expect(fx.rings).toHaveLength(1);
    expect(fx.shake).toBe(1);
  });

  it("tones everything down for reduced motion: fewer particles, no shake or flash", () => {
    const full = createFx();
    const calm = createFx();
    emitExplosion(full, lander, makeRng(2), false);
    emitExplosion(calm, lander, makeRng(2), true);
    expect(calm.particles.length).toBeLessThan(full.particles.length / 2);
    expect(calm.shake).toBe(0);
    expect(calm.flash).toBe(0);
    expect(calm.rings).toHaveLength(0);

    const exhaustFull = createFx();
    const exhaustCalm = createFx();
    for (let i = 0; i < 60; i++) {
      emitExhaust(exhaustFull, lander, 1 / 60, makeRng(i), false);
      emitExhaust(exhaustCalm, lander, 1 / 60, makeRng(i), true);
    }
    expect(exhaustCalm.particles.length).toBeLessThan(exhaustFull.particles.length / 2);
  });

  it("expires particles and debris after their lifetimes, and never lets them sink into the ground", () => {
    const fx = createFx();
    const rng = makeRng(3);
    emitExplosion(fx, lander, rng, false);
    emitCelebration(fx, lander, TEST_PAD, "+300", "good", rng, false);
    for (let i = 0; i < 300; i++) {
      emitDust(fx, { x: 930, y: 120, angle: 0 }, 8, terrain, 1 / 60, rng, false);
      updateFx(fx, terrain, 1 / 60);
      for (const p of fx.particles) {
        if (p.kind !== "flame") expect(p.y).toBeGreaterThanOrEqual(heightAt(terrain, p.x) - 1e-9);
      }
    }
    // Stop emitting and let everything run out.
    for (let i = 0; i < 400; i++) updateFx(fx, terrain, 1 / 60);
    expect(fx.particles).toHaveLength(0);
    expect(fx.debris).toHaveLength(0);
    expect(fx.rings).toHaveLength(0);
    expect(fx.texts).toHaveLength(0);
    expect(fx.shake).toBe(0);
  });

  it("caps the particle pool", () => {
    const fx = createFx();
    for (let i = 0; i < 20; i++) emitExplosion(fx, lander, makeRng(i), false);
    expect(fx.particles.length).toBeLessThanOrEqual(MAX_PARTICLES);
  });

  it("raises dust only when the plume reaches the ground", () => {
    const high = createFx();
    const low = createFx();
    for (let i = 0; i < 30; i++) {
      emitDust(high, { x: 930, y: 400, angle: 0 }, 280, terrain, 1 / 60, makeRng(i), false);
      emitDust(low, { x: 930, y: 125, angle: 0 }, 13, terrain, 1 / 60, makeRng(i), false);
    }
    expect(high.particles).toHaveLength(0);
    expect(low.particles.length).toBeGreaterThan(20);
  });

  it("scatters a reproducible starfield across the sky", () => {
    const a = makeStars(makeRng("sky"), 120);
    expect(a).toEqual(makeStars(makeRng("sky"), 120));
    for (const s of a) {
      expect(s.u).toBeGreaterThanOrEqual(0);
      expect(s.u).toBeLessThan(1);
      expect(s.v).toBeGreaterThanOrEqual(0);
      expect(s.v).toBeLessThan(1);
    }
  });
});
