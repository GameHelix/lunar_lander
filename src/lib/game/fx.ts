import { toWorld, type Pose } from "./geometry";
import type { Rng } from "./rng";
import { NOZZLE_EXIT, outlineSegments } from "./shape";
import { heightAt } from "./terrain";
import type { Pad, Terrain, Vec } from "./types";

/**
 * Purely visual effects: exhaust, dust, explosion sparks, tumbling debris,
 * celebration fireworks and floating score text. None of it feeds back into
 * the game, so it is free to use any random source.
 *
 * The pools are mutated in place: at sixty frames a second with hundreds of
 * live particles, rebuilding arrays every frame would only feed the garbage
 * collector.
 */

export type ParticleKind = "flame" | "dust" | "spark" | "ember" | "star";

export interface Particle {
  kind: ParticleKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Seconds lived, and seconds to live. */
  life: number;
  ttl: number;
  size: number;
  /** Palette slot, for kinds that come in several colours. */
  tint: number;
}

/** One line of a broken lander, tumbling under gravity. */
export interface Debris {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  spin: number;
  /** Segment endpoints relative to (x, y), before rotation. */
  a: Vec;
  b: Vec;
  life: number;
  ttl: number;
}

export interface Ring {
  x: number;
  y: number;
  radius: number;
  speed: number;
  life: number;
  ttl: number;
  tone: "crash" | "land";
}

export interface FloatText {
  x: number;
  y: number;
  text: string;
  rise: number;
  life: number;
  ttl: number;
  tone: "good" | "warn";
}

export interface Fx {
  particles: Particle[];
  debris: Debris[];
  rings: Ring[];
  texts: FloatText[];
  /** Screen-shake strength, 0..1, decaying. */
  shake: number;
  /** Full-screen flash strength, 0..1, decaying. */
  flash: number;
}

export const MAX_PARTICLES = 900;
/** Effects fall a little faster than the lander does; it reads better on screen. */
const FX_GRAVITY = 24;

export function createFx(): Fx {
  return { particles: [], debris: [], rings: [], texts: [], shake: 0, flash: 0 };
}

export function clearFx(fx: Fx): void {
  fx.particles.length = 0;
  fx.debris.length = 0;
  fx.rings.length = 0;
  fx.texts.length = 0;
  fx.shake = 0;
  fx.flash = 0;
}

function add(fx: Fx, p: Particle): void {
  if (fx.particles.length < MAX_PARTICLES) fx.particles.push(p);
}

/** How many to emit this frame for a steady `rate` per second, dithered by the rng. */
function countFor(rate: number, dt: number, rng: Rng): number {
  return Math.floor(rate * dt + rng.next());
}

/** Exhaust from the nozzle, opposite the thrust, inheriting the lander's motion. */
export function emitExhaust(fx: Fx, lander: Pose & { vx: number; vy: number }, dt: number, rng: Rng, reduced: boolean): void {
  const n = countFor(reduced ? 60 : 200, dt, rng);
  const dx = -Math.sin(lander.angle);
  const dy = -Math.cos(lander.angle);
  const origin = toWorld(lander, NOZZLE_EXIT);
  for (let i = 0; i < n; i++) {
    const speed = 70 + rng.next() * 70;
    const spread = (rng.next() - 0.5) * 46;
    add(fx, {
      kind: "flame",
      x: origin.x + (rng.next() - 0.5) * 3,
      y: origin.y + (rng.next() - 0.5) * 3,
      vx: lander.vx + dx * speed - dy * spread,
      vy: lander.vy + dy * speed + dx * spread,
      life: 0,
      ttl: 0.22 + rng.next() * 0.3,
      size: 1.1 + rng.next() * 1.4,
      tint: 0,
    });
  }
}

/** Regolith blown sideways when the exhaust reaches the ground. */
export function emitDust(fx: Fx, lander: Pose, altitude: number, terrain: Terrain, dt: number, rng: Rng, reduced: boolean): void {
  const reach = 90;
  if (altitude > reach) return;
  const strength = 1 - Math.max(0, altitude) / reach;
  const n = countFor((reduced ? 25 : 110) * strength, dt, rng);
  // Where the plume meets the ground: straight down the thrust axis.
  const gx = lander.x - Math.sin(lander.angle) * (altitude + 12);
  const gy = heightAt(terrain, gx);
  for (let i = 0; i < n; i++) {
    const side = rng.next() < 0.5 ? -1 : 1;
    add(fx, {
      kind: "dust",
      x: gx + side * rng.next() * 6,
      y: gy + 1,
      vx: side * (40 + rng.next() * 90) * (0.5 + strength * 0.5),
      vy: 6 + rng.next() * 26,
      life: 0,
      ttl: 0.5 + rng.next() * 0.7,
      size: 1 + rng.next() * 1.6,
      tint: 0,
    });
  }
}

/** Sparks, embers, a shock ring, tumbling wreckage and a jolt of shake. */
export function emitExplosion(fx: Fx, lander: Pose & { vx: number; vy: number }, rng: Rng, reduced: boolean): void {
  const sparks = reduced ? 45 : 170;
  for (let i = 0; i < sparks; i++) {
    const ang = rng.next() * Math.PI * 2;
    const speed = 25 + 150 * rng.next() * rng.next();
    const ember = rng.next() < 0.35;
    add(fx, {
      kind: ember ? "ember" : "spark",
      x: lander.x + (rng.next() - 0.5) * 8,
      y: lander.y + (rng.next() - 0.5) * 8,
      vx: Math.cos(ang) * speed + lander.vx * 0.3,
      vy: Math.abs(Math.sin(ang)) * speed * 0.9 + 10,
      life: 0,
      ttl: (ember ? 1.2 : 0.6) + rng.next() * 1.1,
      size: ember ? 1.6 + rng.next() * 1.8 : 1 + rng.next() * 1.2,
      tint: Math.floor(rng.next() * 3),
    });
  }
  for (const [a, b] of outlineSegments()) {
    const wa = toWorld(lander, a);
    const wb = toWorld(lander, b);
    const mx = (wa.x + wb.x) / 2;
    const my = (wa.y + wb.y) / 2;
    const ox = mx - lander.x;
    const oy = my - lander.y;
    const len = Math.hypot(ox, oy) || 1;
    const burst = 20 + rng.next() * 55;
    fx.debris.push({
      x: mx,
      y: my,
      vx: (ox / len) * burst + lander.vx * 0.25 + (rng.next() - 0.5) * 20,
      vy: (oy / len) * burst * 0.5 + 25 + rng.next() * 45,
      angle: 0,
      spin: (rng.next() - 0.5) * 16,
      a: { x: wa.x - mx, y: wa.y - my },
      b: { x: wb.x - mx, y: wb.y - my },
      life: 0,
      ttl: 2.8 + rng.next() * 1.2,
    });
  }
  if (!reduced) {
    fx.rings.push({ x: lander.x, y: lander.y, radius: 4, speed: 170, life: 0, ttl: 0.55, tone: "crash" });
    fx.shake = 1;
    fx.flash = 0.6;
  }
}

/** Fireworks from both ends of the pad, a ring, and the points floating up. */
export function emitCelebration(
  fx: Fx,
  lander: Pose,
  pad: Pad,
  label: string,
  tone: "good" | "warn",
  rng: Rng,
  reduced: boolean
): void {
  const perSide = reduced ? 10 : tone === "good" ? 55 : 22;
  for (const ex of [pad.x0, pad.x1]) {
    for (let i = 0; i < perSide; i++) {
      const ang = Math.PI / 2 + (rng.next() - 0.5) * 1.1;
      const speed = 45 + rng.next() * 95;
      add(fx, {
        kind: "star",
        x: ex,
        y: pad.y + 2,
        vx: Math.cos(ang) * speed,
        vy: Math.sin(ang) * speed,
        life: 0,
        ttl: 0.9 + rng.next() * 0.9,
        size: 1.2 + rng.next() * 1.5,
        tint: Math.floor(rng.next() * 3),
      });
    }
  }
  if (!reduced) fx.rings.push({ x: lander.x, y: pad.y, radius: 6, speed: 90, life: 0, ttl: 0.8, tone: "land" });
  fx.texts.push({ x: lander.x, y: lander.y + 26, text: label, rise: reduced ? 0 : 14, life: 0, ttl: 1.7, tone });
}

/**
 * Advance every effect by `dt`. Particles and debris fall, bounce off the
 * surface with heavy damping and expire; flame that reaches the ground just
 * dies (the dust emitter draws the splash).
 */
export function updateFx(fx: Fx, terrain: Terrain, dt: number): void {
  const ps = fx.particles;
  for (let i = ps.length - 1; i >= 0; i--) {
    const p = ps[i];
    p.life += dt;
    if (p.life >= p.ttl) {
      ps[i] = ps[ps.length - 1];
      ps.pop();
      continue;
    }
    const g = p.kind === "flame" ? FX_GRAVITY * 0.15 : p.kind === "dust" ? FX_GRAVITY * 0.9 : FX_GRAVITY;
    p.vy -= g * dt;
    if (p.kind === "dust") {
      p.vx *= Math.exp(-dt * 1.8);
    }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    const ground = heightAt(terrain, p.x);
    if (p.y < ground) {
      if (p.kind === "flame") {
        p.life = p.ttl;
      } else {
        p.y = ground;
        p.vy = Math.abs(p.vy) * 0.3;
        p.vx *= 0.6;
      }
    }
  }

  const ds = fx.debris;
  for (let i = ds.length - 1; i >= 0; i--) {
    const d = ds[i];
    d.life += dt;
    if (d.life >= d.ttl) {
      ds[i] = ds[ds.length - 1];
      ds.pop();
      continue;
    }
    d.vy -= FX_GRAVITY * dt;
    d.x += d.vx * dt;
    d.y += d.vy * dt;
    d.angle += d.spin * dt;
    // Bounce on whichever end dips under the surface.
    const c = Math.cos(d.angle);
    const s = Math.sin(d.angle);
    const low = Math.min(d.a.x * -s + d.a.y * c, d.b.x * -s + d.b.y * c);
    const ground = heightAt(terrain, d.x);
    if (d.y + low < ground) {
      d.y = ground - low;
      if (d.vy < 0) d.vy = -d.vy * 0.32;
      d.vx *= 0.62;
      d.spin *= 0.55;
    }
  }

  const rs = fx.rings;
  for (let i = rs.length - 1; i >= 0; i--) {
    const r = rs[i];
    r.life += dt;
    r.radius += r.speed * dt;
    if (r.life >= r.ttl) rs.splice(i, 1);
  }

  const ts = fx.texts;
  for (let i = ts.length - 1; i >= 0; i--) {
    const t = ts[i];
    t.life += dt;
    t.y += t.rise * dt;
    if (t.life >= t.ttl) ts.splice(i, 1);
  }

  fx.shake = Math.max(0, fx.shake - dt / 0.7);
  fx.flash = Math.max(0, fx.flash - dt / 0.3);
}

/** A fixed backdrop star: position as a fraction of the sky, plus twinkle. */
export interface Star {
  u: number;
  v: number;
  size: number;
  phase: number;
  speed: number;
  bright: number;
}

export function makeStars(rng: Rng, count: number): Star[] {
  const stars: Star[] = [];
  for (let i = 0; i < count; i++) {
    stars.push({
      u: rng.next(),
      v: rng.next(),
      size: rng.next() < 0.1 ? 1.6 : 0.6 + rng.next() * 0.7,
      phase: rng.next() * Math.PI * 2,
      speed: 0.6 + rng.next() * 1.8,
      bright: 0.35 + rng.next() * 0.65,
    });
  }
  return stars;
}
