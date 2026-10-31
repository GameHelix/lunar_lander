"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cameraTarget, followCamera, type Camera, type Viewport } from "@/lib/game/camera";
import { altitudeOf } from "@/lib/game/collision";
import { REPORT_DELAY, STEP } from "@/lib/game/constants";
import { panelOf, samePanel, type Panel } from "@/lib/game/flight";
import {
  clearFx,
  createFx,
  emitCelebration,
  emitDust,
  emitExhaust,
  emitExplosion,
  makeStars,
  updateFx,
  type Fx,
} from "@/lib/game/fx";
import { continueGame, createGame, step } from "@/lib/game/game";
import { makeRng, randomSeed } from "@/lib/game/rng";
import type { Difficulty, GameEvent, GameState, Input } from "@/lib/game/types";
import { useSound } from "@/lib/hooks/useSound";
import { drawFrame } from "@/lib/render/scene";
import { Hud } from "./Hud";
import { ReportPanel } from "./ReportPanel";
import type { RunSummary } from "./ResultPanel";
import { TouchControls, type Control } from "./TouchControls";

interface PlayScreenProps {
  difficulty: Difficulty;
  seed: string;
  soundOn: boolean;
  onToggleSound: () => void;
  onRestart: () => void;
  onExit: () => void;
  /** Called whenever the score or the level reached changes. */
  onProgress: (score: number, level: number) => void;
  onGameOver: (summary: RunSummary) => void;
}

/** Catch-up cap: after a long stall, drop the backlog instead of spiralling. */
const MAX_STEPS_PER_FRAME = 12;
/** The HUD re-renders at most this often (seconds); the canvas runs every frame. */
const HUD_INTERVAL = 0.05;
/** A fresh key press only continues once the report has been up this long (ms). */
const REPORT_KEY_GUARD = 350;
/**
 * Every press acts for at least this long (seconds), even when it is released
 * sooner. Input is sampled once per physics step, so without it a quick tap
 * that starts and ends between two frames would be lost; with it, a tap is a
 * small, reliable nudge (about two degrees of rotation).
 */
const MIN_PRESS = 0.06;
const NO_INPUT: Input = { left: false, right: false, thrust: false };
const NO_PULSE: Record<keyof Input, number> = { left: 0, right: 0, thrust: 0 };

function keyOf(e: KeyboardEvent): keyof Input | null {
  switch (e.code) {
    case "ArrowLeft":
    case "KeyA":
      return "left";
    case "ArrowRight":
    case "KeyD":
      return "right";
    case "ArrowUp":
    case "KeyW":
    case "Space":
      return "thrust";
    default:
      return null;
  }
}

/**
 * One run, from the first lander to the last.
 *
 * The game state lives in a ref and is advanced by a fixed-timestep loop on
 * requestAnimationFrame — physics at 120 Hz however fast the screen refreshes
 * — while React only hears about it through a throttled HUD snapshot and the
 * phase changes that open a panel. Effects, camera and sound are driven from
 * the same loop, so they never fall out of step with the simulation.
 */
export function PlayScreen({
  difficulty,
  seed,
  soundOn,
  onToggleSound,
  onRestart,
  onExit,
  onProgress,
  onGameOver,
}: PlayScreenProps) {
  const [initial] = useState(() => createGame(difficulty, seed));
  const gameRef = useRef<GameState>(initial);
  const [panel, setPanel] = useState<Panel>(() => panelOf(initial));
  const [report, setReport] = useState<GameState | null>(null);
  const [paused, setPaused] = useState(false);

  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const keysRef = useRef<Input>(NO_INPUT);
  const touchRef = useRef<Input>(NO_INPUT);
  /** Seconds each control must still act for, so a brief tap is never dropped. */
  const pulseRef = useRef(NO_PULSE);
  const fxRef = useRef<Fx | null>(null);
  const pausedRef = useRef(false);
  /** performance.now() when the report panel appeared; 0 while it is closed. */
  const reportAtRef = useRef(0);
  /** Whether the current touchdown has been handed to a panel yet. */
  const reportedRef = useRef(false);
  /** Jump the camera to its target on the next frame instead of easing. */
  const snapRef = useRef(true);

  const sound = useSound(soundOn);
  const soundRef = useRef(sound);
  const handlers = useRef({ onProgress, onGameOver });
  useEffect(() => {
    soundRef.current = sound;
  }, [sound]);
  useEffect(() => {
    handlers.current = { onProgress, onGameOver };
  }, [onProgress, onGameOver]);

  const setPause = useCallback((on: boolean) => {
    pausedRef.current = on;
    setPaused(on);
    if (on) soundRef.current.engine(false);
  }, []);

  /** Leave the report: next level after a landing, next lander after a crash. */
  const advance = useCallback(() => {
    const g = gameRef.current;
    if (g.phase === "flying" || g.gameOver) return;
    const next = continueGame(g);
    gameRef.current = next;
    reportedRef.current = false;
    reportAtRef.current = 0;
    snapRef.current = true;
    if (fxRef.current) clearFx(fxRef.current);
    setReport(null);
    setPanel(panelOf(next));
    if (next.level > g.level) handlers.current.onProgress(next.score, next.level);
    soundRef.current.play("start");
  }, []);

  const onControl = useCallback((control: Control, down: boolean) => {
    touchRef.current = { ...touchRef.current, [control]: down };
    if (down) pulseRef.current = { ...pulseRef.current, [control]: MIN_PRESS };
  }, []);

  // A quick radio beep as the first lander drops in.
  useEffect(() => {
    soundRef.current.play("start");
  }, []);

  // Keyboard, plus pausing when the window loses focus or the tab hides.
  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const g = gameRef.current;
      const reportOpen = reportAtRef.current > 0;
      if (reportOpen && (e.code === "Enter" || e.code === "NumpadEnter" || (e.code === "Space" && !e.repeat))) {
        e.preventDefault();
        if (performance.now() - reportAtRef.current > REPORT_KEY_GUARD) advance();
        return;
      }
      if (e.code === "KeyP" || e.code === "Escape") {
        if (!reportOpen && !g.gameOver) {
          e.preventDefault();
          setPause(!pausedRef.current);
        }
        return;
      }
      const k = keyOf(e);
      if (k) {
        e.preventDefault();
        if (!keysRef.current[k]) {
          keysRef.current = { ...keysRef.current, [k]: true };
          pulseRef.current = { ...pulseRef.current, [k]: MIN_PRESS };
        }
      }
    };
    const onUp = (e: KeyboardEvent) => {
      const k = keyOf(e);
      if (k) {
        e.preventDefault();
        keysRef.current = { ...keysRef.current, [k]: false };
      }
    };
    // Key-ups are lost while the window is unfocused, so drop held keys and
    // stop mid-flight rather than leave the engine stuck on.
    const onBlur = () => {
      keysRef.current = NO_INPUT;
      if (gameRef.current.phase === "flying" && !pausedRef.current) setPause(true);
    };
    const onVisibility = () => {
      if (document.hidden) onBlur();
    };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    window.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [advance, setPause]);

  // The loop: simulate, animate, render.
  useEffect(() => {
    const stage = stageRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!stage || !canvas || !ctx) return;

    const rng = makeRng(randomSeed());
    const fx = createFx();
    fxRef.current = fx;
    const stars = makeStars(makeRng(`stars|${seed}`), 260);
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    let reduced = media.matches;
    const onMedia = () => {
      reduced = media.matches;
    };
    media.addEventListener("change", onMedia);

    const vp: Viewport = { width: 1, height: 1 };
    let cam: Camera = { x: 0, y: 0, zoom: 1 };
    let dirty = true;
    const resize = () => {
      const rect = stage.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      vp.width = Math.max(1, rect.width);
      vp.height = Math.max(1, rect.height);
      canvas.width = Math.round(vp.width * dpr);
      canvas.height = Math.round(vp.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      snapRef.current = true;
      dirty = true;
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(stage);

    const onEvent = (ev: GameEvent, g: GameState) => {
      const s = soundRef.current;
      if (ev.type === "lowFuel") s.play("lowFuel");
      else if (ev.type === "fuelOut") s.play("fuelOut");
      else if (ev.type === "crashed") {
        s.engine(false);
        s.play("crash");
        emitExplosion(fx, g.lander, rng, reduced);
      } else if (ev.type === "landed") {
        s.engine(false);
        s.play(ev.verdict === "safe" ? "land" : "hardLand");
        const out = g.outcome;
        if (out?.pad && out.score) {
          emitCelebration(fx, g.lander, out.pad, `+${out.score.total}`, ev.verdict === "safe" ? "good" : "warn", rng, reduced);
        }
        handlers.current.onProgress(g.score, g.level);
      }
    };

    let time = 0;
    const place = (dt: number) => {
      const g = gameRef.current;
      const target = cameraTarget(g.lander, g.terrain, altitudeOf(g.lander, g.terrain), vp);
      cam = snapRef.current ? target : followCamera(cam, target, g.lander, vp, dt);
      snapRef.current = false;
    };
    const draw = () => {
      drawFrame(ctx, { state: gameRef.current, cam, vp, fx, stars, time, flicker: Math.random(), reduced });
    };

    let last = performance.now();
    let acc = 0;
    let hudClock = 0;
    let raf = 0;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
      last = now;

      if (pausedRef.current) {
        soundRef.current.engine(false);
        if (dirty) {
          place(0);
          draw();
          dirty = false;
        }
        return;
      }

      time += dt;
      acc += dt;
      let g = gameRef.current;
      let steps = 0;
      while (acc >= STEP && steps < MAX_STEPS_PER_FRAME) {
        const k = keysRef.current;
        const t = touchRef.current;
        const p = pulseRef.current;
        const input: Input = {
          left: k.left || t.left || p.left > 0,
          right: k.right || t.right || p.right > 0,
          thrust: k.thrust || t.thrust || p.thrust > 0,
        };
        if (p.left > 0 || p.right > 0 || p.thrust > 0) {
          pulseRef.current = {
            left: Math.max(0, p.left - STEP),
            right: Math.max(0, p.right - STEP),
            thrust: Math.max(0, p.thrust - STEP),
          };
        }
        g = step(g, input, STEP);
        for (const ev of g.events) onEvent(ev, g);
        acc -= STEP;
        steps++;
      }
      if (steps === MAX_STEPS_PER_FRAME) acc = 0;
      gameRef.current = g;

      const burning = g.phase === "flying" && g.lander.thrusting;
      if (burning) {
        emitExhaust(fx, g.lander, dt, rng, reduced);
        emitDust(fx, g.lander, altitudeOf(g.lander, g.terrain), g.terrain, dt, rng, reduced);
      }
      updateFx(fx, g.terrain, dt);
      soundRef.current.engine(burning);

      place(dt);
      draw();
      dirty = false;

      hudClock += dt;
      if (hudClock >= HUD_INTERVAL) {
        hudClock = 0;
        const next = panelOf(g);
        setPanel((prev) => (samePanel(prev, next) ? prev : next));
      }

      if (g.phase !== "flying" && !reportedRef.current && g.phaseTime >= REPORT_DELAY[g.phase]) {
        reportedRef.current = true;
        setPanel(panelOf(g));
        if (g.gameOver) {
          handlers.current.onGameOver({
            difficulty: g.difficulty,
            score: g.score,
            level: g.level,
            landings: g.landings,
            outOfFuel: g.lander.fuel <= 0,
          });
        } else {
          reportAtRef.current = performance.now();
          setReport(g);
        }
      }
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      media.removeEventListener("change", onMedia);
      soundRef.current.engine(false);
    };
  }, [seed]);

  return (
    <div className="ll-play">
      <Hud panel={panel} soundOn={soundOn} onPause={() => setPause(true)} onToggleSound={onToggleSound} />

      <div className="ll-stage" ref={stageRef}>
        <canvas
          ref={canvasRef}
          className="ll-canvas"
          role="img"
          aria-label="The lander over the lunar surface and its landing pads"
        />
        {report ? <ReportPanel state={report} onContinue={advance} onMenu={onExit} /> : null}
        {paused ? (
          <div className="ll-pause" data-testid="paused">
            <div className="ll-pause-card" role="dialog" aria-modal="false" aria-labelledby="ll-pause-title">
              <h2 id="ll-pause-title" className="ll-dialog-title">
                Paused
              </h2>
              <button type="button" className="ll-primary" onClick={() => setPause(false)}>
                Resume
              </button>
              <button type="button" className="ll-ghost" onClick={onRestart}>
                Restart mission
              </button>
              <button type="button" className="ll-ghost" onClick={onExit}>
                Menu
              </button>
              <span className="ll-key-hint">P or Esc to resume</span>
            </div>
          </div>
        ) : null}
      </div>

      <TouchControls onControl={onControl} />
      <p className="ll-keys">← → rotate · ↑ W or Space thrust · P pause</p>
    </div>
  );
}
