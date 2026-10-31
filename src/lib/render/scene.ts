import { toScreen, type Camera, type Viewport } from "@/lib/game/camera";
import { altitudeOf, feetOf } from "@/lib/game/collision";
import { CEILING, TERRAIN_MAX, WORLD_WIDTH } from "@/lib/game/constants";
import type { Fx, Star } from "@/lib/game/fx";
import { clamp, rotate } from "@/lib/game/geometry";
import { ANTENNA, CABIN, DESCENT, FEET, HALF_WIDTH, LEGS, NOZZLE, WINDOWS } from "@/lib/game/shape";
import { heightAt, padCenter, padUnder, segmentIndex } from "@/lib/game/terrain";
import type { GameState, Multiplier, Vec } from "@/lib/game/types";

/**
 * Canvas renderer: a neon vector moonscape. Everything is stroked lines with
 * a cheap glow — the same path drawn wide and faint, then narrow and bright —
 * because `shadowBlur` on long paths is far too slow on phones.
 *
 * The renderer only reads the game state; it never changes it.
 */

export interface Frame {
  state: GameState;
  cam: Camera;
  vp: Viewport;
  fx: Fx;
  stars: Star[];
  /** Seconds since the screen mounted; drives twinkle and blink. */
  time: number;
  /** A fresh random number each frame, for the flame's flicker. */
  flicker: number;
  reduced: boolean;
}

/** Pad colours by multiplier, shared with the HUD legend. */
export const PAD_COLORS: Record<Multiplier, string> = {
  1: "#22d3ee",
  2: "#34d399",
  3: "#fbbf24",
  5: "#f472b6",
};

const FONT = "'Share Tech Mono', ui-monospace, monospace";
const SPARK_TINTS = ["#fde68a", "#fb923c", "#f472b6"];
const STAR_TINTS = ["#67e8f9", "#6ee7b7", "#fde68a"];

export function drawFrame(ctx: CanvasRenderingContext2D, f: Frame): void {
  const { vp } = f;
  ctx.save();
  ctx.fillStyle = "#070610";
  ctx.fillRect(0, 0, vp.width, vp.height);
  drawStars(ctx, f);
  drawEarth(ctx, f);

  // Shake moves the world, never the sky.
  let cam = f.cam;
  if (f.fx.shake > 0 && !f.reduced) {
    const px = f.fx.shake * f.fx.shake * 8;
    cam = {
      ...cam,
      x: cam.x + (Math.sin(f.time * 91) * px) / cam.zoom,
      y: cam.y + (Math.cos(f.time * 117) * px) / cam.zoom,
    };
  }
  const S = (p: Vec) => toScreen(cam, vp, p);

  drawTerrain(ctx, f, cam, S);
  drawBounds(ctx, f, S);
  drawPads(ctx, f, cam, S);
  drawShadow(ctx, f, cam, S);
  drawParticles(ctx, f, cam, S, false);
  if (f.state.phase !== "crashed") drawLander(ctx, f, cam, S);
  drawDebris(ctx, f, cam, S);
  drawParticles(ctx, f, cam, S, true);
  drawRings(ctx, f, cam, S);
  drawTexts(ctx, f, S);
  drawPadArrows(ctx, f, S);
  drawVignette(ctx, vp);

  if (f.fx.flash > 0 && !f.reduced) {
    ctx.fillStyle = `rgba(255, 214, 196, ${(f.fx.flash * 0.22).toFixed(3)})`;
    ctx.fillRect(0, 0, vp.width, vp.height);
  }
  ctx.restore();
}

/* ------------------------------------------------------------------ sky */

function drawStars(ctx: CanvasRenderingContext2D, f: Frame): void {
  const { vp, cam } = f;
  // Density follows the screen area, so a phone is not crowded with stars.
  const n = Math.min(f.stars.length, Math.round((vp.width * vp.height) / 6500));
  const ox = -cam.x * cam.zoom * 0.04;
  const oy = cam.y * cam.zoom * 0.04;
  ctx.fillStyle = "#e0f2fe";
  for (let i = 0; i < n; i++) {
    const s = f.stars[i];
    let x = (s.u * vp.width + ox) % vp.width;
    let y = (s.v * vp.height + oy) % vp.height;
    if (x < 0) x += vp.width;
    if (y < 0) y += vp.height;
    const twinkle = f.reduced ? 1 : 0.6 + 0.4 * Math.sin(f.time * s.speed + s.phase);
    ctx.globalAlpha = s.bright * twinkle;
    ctx.fillRect(x, y, s.size, s.size);
  }
  ctx.globalAlpha = 1;
}

/** A crescent Earth hanging in the black, drifting a touch with the camera. */
function drawEarth(ctx: CanvasRenderingContext2D, f: Frame): void {
  const { vp, cam } = f;
  const r = clamp(Math.min(vp.width, vp.height) * 0.045, 9, 30);
  const x = vp.width * 0.84 + clamp(-(cam.x - WORLD_WIDTH / 2) * cam.zoom * 0.02, -24, 24);
  const y = vp.height * 0.15 + clamp((cam.y - 500) * cam.zoom * 0.02, -16, 16);
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = "#0a1330";
  ctx.fill();
  // Lit crescent: the right limb, closed by an elliptical terminator.
  ctx.beginPath();
  ctx.arc(x, y, r, -Math.PI / 2, Math.PI / 2);
  ctx.ellipse(x, y, r * 0.38, r, 0, Math.PI / 2, -Math.PI / 2, true);
  const g = ctx.createLinearGradient(x, y - r, x + r, y + r);
  g.addColorStop(0, "#38bdf8");
  g.addColorStop(1, "#0ea5e9");
  ctx.fillStyle = g;
  ctx.globalAlpha = 0.85;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.arc(x, y, r + 1.5, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(103, 232, 249, 0.35)";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
}

/* -------------------------------------------------------------- terrain */

/**
 * The surface points on screen, plus a flat run of ground past either world
 * edge when the view reaches beyond it, so the land never ends in a cliff.
 */
function visibleSurface(f: Frame, cam: Camera): Vec[] {
  const pts = f.state.terrain.points;
  const half = f.vp.width / 2 / cam.zoom + 30;
  const lo = cam.x - half;
  const hi = cam.x + half;
  const i0 = segmentIndex(pts, lo);
  const i1 = Math.min(pts.length - 1, segmentIndex(pts, hi) + 1);
  const out: Vec[] = [];
  if (i0 === 0 && lo < pts[0].x) out.push({ x: lo, y: pts[0].y });
  for (let i = i0; i <= i1; i++) out.push(pts[i]);
  const end = pts[pts.length - 1];
  if (i1 === pts.length - 1 && hi > end.x) out.push({ x: hi, y: end.y });
  return out;
}

function drawTerrain(ctx: CanvasRenderingContext2D, f: Frame, cam: Camera, S: (p: Vec) => Vec): void {
  const { vp } = f;
  const pts = visibleSurface(f, cam);
  const surface = new Path2D();
  pts.forEach((pt, i) => {
    const p = S(pt);
    if (i === 0) surface.moveTo(p.x, p.y);
    else surface.lineTo(p.x, p.y);
  });

  // Ground fill: a violet haze fading to black with depth.
  const first = S(pts[0]);
  const last = S(pts[pts.length - 1]);
  const fill = new Path2D(surface);
  fill.lineTo(last.x, vp.height + 4);
  fill.lineTo(first.x, vp.height + 4);
  fill.closePath();
  const top = S({ x: 0, y: TERRAIN_MAX }).y;
  const bottom = S({ x: 0, y: 0 }).y;
  const grad = ctx.createLinearGradient(0, top, 0, Math.max(bottom, top + 1));
  grad.addColorStop(0, "rgba(91, 33, 182, 0.42)");
  grad.addColorStop(0.55, "rgba(30, 14, 64, 0.88)");
  grad.addColorStop(1, "rgba(7, 6, 16, 0.98)");
  ctx.fillStyle = grad;
  ctx.fill(fill);

  // Two faint strata under the rim give the ground some depth.
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  for (const [depth, alpha] of [
    [16, 0.22],
    [44, 0.1],
  ] as const) {
    ctx.save();
    ctx.translate(0, depth * cam.zoom);
    ctx.strokeStyle = `rgba(168, 85, 247, ${alpha})`;
    ctx.lineWidth = 1;
    ctx.stroke(surface);
    ctx.restore();
  }

  // The glowing rim.
  ctx.strokeStyle = "rgba(168, 85, 247, 0.2)";
  ctx.lineWidth = 8;
  ctx.stroke(surface);
  ctx.strokeStyle = "rgba(34, 211, 238, 0.38)";
  ctx.lineWidth = 3.2;
  ctx.stroke(surface);
  ctx.strokeStyle = "#bdf4ff";
  ctx.lineWidth = 1.3;
  ctx.stroke(surface);
}

/** Dashed limits at the world's side edges. */
function drawBounds(ctx: CanvasRenderingContext2D, f: Frame, S: (p: Vec) => Vec): void {
  ctx.save();
  ctx.setLineDash([6, 8]);
  ctx.strokeStyle = "rgba(244, 114, 182, 0.32)";
  ctx.lineWidth = 1.5;
  for (const x of [0, WORLD_WIDTH]) {
    const a = S({ x, y: heightAt(f.state.terrain, x) });
    const b = S({ x, y: CEILING });
    if (a.x < -4 || a.x > f.vp.width + 4) continue;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawPads(ctx: CanvasRenderingContext2D, f: Frame, cam: Camera, S: (p: Vec) => Vec): void {
  const l = f.state.lander;
  const [fl, fr] = feetOf(l);
  const under = padUnder(f.state.terrain, fl.x);
  const aligned = under && padUnder(f.state.terrain, fr.x) === under && f.state.phase === "flying" ? under : null;
  const labelSize = clamp(11 + cam.zoom * 2, 12, 17);
  ctx.save();
  ctx.lineCap = "round";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.font = `${labelSize}px ${FONT}`;
  for (const pad of f.state.terrain.pads) {
    const a = S({ x: pad.x0, y: pad.y });
    const b = S({ x: pad.x1, y: pad.y });
    if (b.x < -40 || a.x > f.vp.width + 40) continue;
    const color = PAD_COLORS[pad.multiplier];
    const lit = aligned === pad;
    const pulse = lit && !f.reduced ? 0.5 + 0.5 * Math.sin(f.time * 10) : lit ? 1 : 0;
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.22 + 0.25 * pulse;
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.lineWidth = 3.4;
    ctx.stroke();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.2;
    ctx.stroke();

    // Beacons at both ends, blinking alternately.
    const blink = f.reduced ? [1, 1] : [Math.sin(f.time * 4) > 0 ? 1 : 0.35, Math.sin(f.time * 4) > 0 ? 0.35 : 1];
    [a, b].forEach((p, i) => {
      ctx.globalAlpha = blink[i];
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(p.x, p.y - 2.5, 2.4, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;

    ctx.fillStyle = color;
    ctx.fillText(`×${pad.multiplier}`, (a.x + b.x) / 2, a.y + 7);
  }
  ctx.restore();
}

/**
 * The altitude cue: a soft shadow on the ground straight below, growing
 * darker and tighter as the lander sinks, and a dotted drop line. Both turn
 * green while the feet are lined up over a pad.
 */
function drawShadow(ctx: CanvasRenderingContext2D, f: Frame, cam: Camera, S: (p: Vec) => Vec): void {
  const { state } = f;
  if (state.phase !== "flying") return;
  const l = state.lander;
  const alt = altitudeOf(l, state.terrain);
  const reach = 190;
  if (alt > reach) return;
  const t = 1 - Math.max(0, alt) / reach;
  const gy = heightAt(state.terrain, l.x);
  const g = S({ x: l.x, y: gy });
  const [fl, fr] = feetOf(l);
  const pad = padUnder(state.terrain, fl.x);
  const over = pad !== null && padUnder(state.terrain, fr.x) === pad;
  const rgb = over ? "52, 211, 153" : "226, 232, 240";

  ctx.save();
  const rx = HALF_WIDTH * cam.zoom * (1.9 - 0.8 * t);
  const ry = Math.max(1.5, 2.6 * cam.zoom);
  const grad = ctx.createRadialGradient(g.x, g.y, 0, g.x, g.y, rx);
  grad.addColorStop(0, `rgba(${rgb}, ${(0.5 * t).toFixed(3)})`);
  grad.addColorStop(1, `rgba(${rgb}, 0)`);
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.ellipse(g.x, g.y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();

  const top = S({ x: l.x, y: l.y - 12 });
  ctx.setLineDash([2, 5]);
  ctx.strokeStyle = `rgba(${rgb}, ${(0.45 * t).toFixed(3)})`;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(top.x, top.y);
  ctx.lineTo(g.x, g.y);
  ctx.stroke();
  ctx.restore();
}

/* --------------------------------------------------------------- lander */

function pathOf(ctx: CanvasRenderingContext2D, pts: readonly Vec[], z: number, closed: boolean): void {
  ctx.moveTo(pts[0].x * z, -pts[0].y * z);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x * z, -pts[i].y * z);
  if (closed) ctx.closePath();
}

function drawLander(ctx: CanvasRenderingContext2D, f: Frame, cam: Camera, S: (p: Vec) => Vec): void {
  const l = f.state.lander;
  const p = S(l);
  const z = cam.zoom;
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(l.angle);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  if (l.thrusting && f.state.phase === "flying") drawFlame(ctx, z, f.reduced ? 0.5 : f.flicker);

  const body = new Path2D();
  const shape = (pts: readonly Vec[], closed: boolean) => {
    body.moveTo(pts[0].x * z, -pts[0].y * z);
    for (let i = 1; i < pts.length; i++) body.lineTo(pts[i].x * z, -pts[i].y * z);
    if (closed) body.closePath();
  };
  shape(CABIN, true);
  shape(DESCENT, true);
  shape(NOZZLE, true);
  for (const seg of [...LEGS, ...FEET, ANTENNA]) shape(seg, false);

  // A dark fill keeps stars and ground from showing through the hull.
  ctx.beginPath();
  pathOf(ctx, CABIN, z, true);
  pathOf(ctx, DESCENT, z, true);
  ctx.fillStyle = "rgba(7, 6, 16, 0.88)";
  ctx.fill();

  const lw = clamp(z * 0.85, 1.1, 2.4);
  ctx.strokeStyle = "rgba(34, 211, 238, 0.28)";
  ctx.lineWidth = lw * 4;
  ctx.stroke(body);
  ctx.strokeStyle = "#e0faff";
  ctx.lineWidth = lw;
  ctx.stroke(body);

  // Windows and the antenna tip, in the accent colour.
  ctx.beginPath();
  for (const w of WINDOWS) pathOf(ctx, w, z, true);
  ctx.fillStyle = "rgba(34, 211, 238, 0.45)";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(ANTENNA[1].x * z, -ANTENNA[1].y * z, Math.max(1.2, z * 0.9), 0, Math.PI * 2);
  ctx.fillStyle = "#f472b6";
  ctx.fill();
  ctx.restore();
}

/** The exhaust plume, drawn in lander-local pixels (already translated and rotated). */
function drawFlame(ctx: CanvasRenderingContext2D, z: number, flicker: number): void {
  const len = (10 + flicker * 8) * z;
  const top = 9.3 * z;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  const outer = ctx.createLinearGradient(0, top, 0, top + len);
  outer.addColorStop(0, "rgba(251, 146, 60, 0.95)");
  outer.addColorStop(0.6, "rgba(244, 63, 94, 0.55)");
  outer.addColorStop(1, "rgba(168, 85, 247, 0)");
  ctx.fillStyle = outer;
  ctx.beginPath();
  ctx.moveTo(-2.9 * z, top);
  ctx.quadraticCurveTo(-1.8 * z, top + len * 0.55, 0, top + len);
  ctx.quadraticCurveTo(1.8 * z, top + len * 0.55, 2.9 * z, top);
  ctx.closePath();
  ctx.fill();
  const inner = ctx.createLinearGradient(0, top, 0, top + len * 0.6);
  inner.addColorStop(0, "rgba(255, 255, 255, 0.95)");
  inner.addColorStop(1, "rgba(253, 230, 138, 0)");
  ctx.fillStyle = inner;
  ctx.beginPath();
  ctx.moveTo(-1.3 * z, top);
  ctx.lineTo(0, top + len * 0.6);
  ctx.lineTo(1.3 * z, top);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/* -------------------------------------------------------------- effects */

function particleColor(kind: string, tint: number, k: number): string {
  switch (kind) {
    case "flame": {
      const g = Math.round(220 - 170 * k);
      const b = Math.round(120 - 100 * k);
      return `rgba(255, ${g}, ${b}, ${(1 - k).toFixed(3)})`;
    }
    case "dust":
      return `rgba(196, 181, 253, ${(0.55 * (1 - k)).toFixed(3)})`;
    case "ember":
      return `rgba(251, 146, 60, ${(1 - k * k).toFixed(3)})`;
    case "star":
      return STAR_TINTS[tint % STAR_TINTS.length];
    default:
      return SPARK_TINTS[tint % SPARK_TINTS.length];
  }
}

/** Exhaust and dust go under the lander; sparks and fireworks over everything. */
function drawParticles(ctx: CanvasRenderingContext2D, f: Frame, cam: Camera, S: (p: Vec) => Vec, top: boolean): void {
  const scale = clamp(cam.zoom, 0.8, 2.2);
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const p of f.fx.particles) {
    const above = p.kind === "spark" || p.kind === "ember" || p.kind === "star";
    if (above !== top) continue;
    const s = S(p);
    if (s.x < -8 || s.y < -8 || s.x > f.vp.width + 8 || s.y > f.vp.height + 8) continue;
    const k = p.life / p.ttl;
    ctx.fillStyle = particleColor(p.kind, p.tint, k);
    if (above) ctx.globalAlpha = p.kind === "star" ? (1 - k) * (f.reduced ? 1 : 0.6 + 0.4 * Math.sin(p.life * 30)) : 1 - k;
    const r = p.size * scale * (p.kind === "flame" ? 1 + k : 1);
    ctx.fillRect(s.x - r / 2, s.y - r / 2, r, r);
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

function drawDebris(ctx: CanvasRenderingContext2D, f: Frame, cam: Camera, S: (p: Vec) => Vec): void {
  if (f.fx.debris.length === 0) return;
  ctx.save();
  ctx.lineCap = "round";
  for (const d of f.fx.debris) {
    const k = d.life / d.ttl;
    const alpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
    const a = S({ x: d.x + rotate(d.a, d.angle).x, y: d.y + rotate(d.a, d.angle).y });
    const b = S({ x: d.x + rotate(d.b, d.angle).x, y: d.y + rotate(d.b, d.angle).y });
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = "rgba(251, 146, 60, 0.35)";
    ctx.lineWidth = clamp(cam.zoom * 3, 2.5, 6);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.strokeStyle = k < 0.15 ? "#ffffff" : "#fed7aa";
    ctx.lineWidth = clamp(cam.zoom * 0.85, 1.1, 2.2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawRings(ctx: CanvasRenderingContext2D, f: Frame, cam: Camera, S: (p: Vec) => Vec): void {
  ctx.save();
  for (const r of f.fx.rings) {
    const c = S(r);
    const k = r.life / r.ttl;
    ctx.globalAlpha = 1 - k;
    ctx.strokeStyle = r.tone === "crash" ? "#fb923c" : "#34d399";
    ctx.lineWidth = 2;
    ctx.beginPath();
    if (r.tone === "land") ctx.ellipse(c.x, c.y, r.radius * cam.zoom, r.radius * cam.zoom * 0.3, 0, 0, Math.PI * 2);
    else ctx.arc(c.x, c.y, r.radius * cam.zoom, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawTexts(ctx: CanvasRenderingContext2D, f: Frame, S: (p: Vec) => Vec): void {
  if (f.fx.texts.length === 0) return;
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `18px ${FONT}`;
  for (const t of f.fx.texts) {
    const p = S(t);
    const k = t.life / t.ttl;
    ctx.globalAlpha = k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4;
    ctx.fillStyle = t.tone === "good" ? "#6ee7b7" : "#fcd34d";
    ctx.shadowColor = t.tone === "good" ? "rgba(52, 211, 153, 0.8)" : "rgba(251, 191, 36, 0.8)";
    ctx.shadowBlur = 10;
    ctx.fillText(t.text, p.x, p.y);
  }
  ctx.restore();
}

/** Chevrons at the screen edge pointing to pads out of view, with their multipliers. */
function drawPadArrows(ctx: CanvasRenderingContext2D, f: Frame, S: (p: Vec) => Vec): void {
  if (f.state.phase !== "flying") return;
  const { vp } = f;
  ctx.save();
  ctx.font = `12px ${FONT}`;
  ctx.textBaseline = "middle";
  for (const pad of f.state.terrain.pads) {
    const c = S({ x: padCenter(pad), y: pad.y });
    if (c.x >= 0 && c.x <= vp.width) continue;
    const left = c.x < 0;
    const x = left ? 10 : vp.width - 10;
    const y = clamp(c.y, 28, vp.height - 28);
    const dir = left ? -1 : 1;
    ctx.fillStyle = PAD_COLORS[pad.multiplier];
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.moveTo(x + dir * 4, y);
    ctx.lineTo(x - dir * 4, y - 6);
    ctx.lineTo(x - dir * 4, y + 6);
    ctx.closePath();
    ctx.fill();
    ctx.textAlign = left ? "left" : "right";
    ctx.fillText(`×${pad.multiplier}`, x - dir * 8, y);
  }
  ctx.restore();
}

function drawVignette(ctx: CanvasRenderingContext2D, vp: Viewport): void {
  const r = Math.hypot(vp.width, vp.height) / 2;
  const g = ctx.createRadialGradient(vp.width / 2, vp.height / 2, r * 0.55, vp.width / 2, vp.height / 2, r);
  g.addColorStop(0, "rgba(7, 6, 16, 0)");
  g.addColorStop(1, "rgba(7, 6, 16, 0.45)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, vp.width, vp.height);
}
