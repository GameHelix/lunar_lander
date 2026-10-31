"use client";

import { cx } from "@/lib/cx";
import { DIFFICULTIES, DIFFICULTY, METERS_PER_UNIT } from "@/lib/game/constants";
import { formatScore } from "@/lib/game/flight";
import { toDeg } from "@/lib/game/geometry";
import type { BestRecord } from "@/lib/game/stats";
import type { Difficulty } from "@/lib/game/types";
import { LanderIcon } from "./LanderIcon";

interface MenuScreenProps {
  difficulty: Difficulty;
  bests: Record<Difficulty, BestRecord>;
  soundOn: boolean;
  onDifficulty: (d: Difficulty) => void;
  onStart: () => void;
  onRules: () => void;
  onToggleSound: () => void;
}

const fixed = (n: number, d = 1) => n.toFixed(d);

export function MenuScreen({
  difficulty,
  bests,
  soundOn,
  onDifficulty,
  onStart,
  onRules,
  onToggleSound,
}: MenuScreenProps) {
  const cfg = DIFFICULTY[difficulty];
  return (
    <div className="ll-menu">
      <div className="ll-hero" aria-hidden>
        <LanderIcon className="ll-hero-lander" flame />
        <div className="ll-hero-moon" />
      </div>
      <h1 className="ll-title">{"🚀 LUNAR LANDER"}</h1>
      <p className="ll-subtitle">Fight gravity on a tank of fuel. Touch down soft, upright, on the pad.</p>

      <div className="ll-card">
        <span className="ll-field-label">Difficulty</span>
        <div className="ll-diff-row" role="radiogroup" aria-label="Difficulty">
          {DIFFICULTIES.map((d) => (
            <button
              key={d}
              type="button"
              role="radio"
              aria-checked={d === difficulty}
              className={cx("ll-diff", d === difficulty && "is-on")}
              onClick={() => onDifficulty(d)}
            >
              {DIFFICULTY[d].label}
            </button>
          ))}
        </div>
        <p className="ll-diff-blurb">{cfg.blurb}</p>
        <dl className="ll-specs">
          <div>
            <dt>Gravity</dt>
            <dd>{`${fixed(cfg.gravity * METERS_PER_UNIT, 2)} m/s²`}</dd>
          </div>
          <div>
            <dt>Fuel</dt>
            <dd>{cfg.startFuel}</dd>
          </div>
          <div>
            <dt>Safe ↓</dt>
            <dd>{`${fixed(cfg.safe.vy * METERS_PER_UNIT)} m/s`}</dd>
          </div>
          <div>
            <dt>Safe ↔</dt>
            <dd>{`${fixed(cfg.safe.vx * METERS_PER_UNIT)} m/s`}</dd>
          </div>
          <div>
            <dt>Tilt</dt>
            <dd>{`${Math.round(toDeg(cfg.safe.tilt))}°`}</dd>
          </div>
        </dl>

        <button type="button" className="ll-primary" onClick={onStart} data-testid="start">
          Start mission
        </button>

        <div className="ll-best-grid">
          {DIFFICULTIES.map((d) => {
            const best = bests[d];
            return (
              <div key={d} className={cx("ll-best", d === difficulty && "is-on")}>
                <span className="ll-best-name">{DIFFICULTY[d].label}</span>
                <span className="ll-best-score">{best.score > 0 ? formatScore(best.score) : "—"}</span>
                <span className="ll-best-level">{best.level > 0 ? `level ${best.level}` : "no flights"}</span>
              </div>
            );
          })}
        </div>

        <div className="ll-menu-actions">
          <button type="button" className="ll-ghost" onClick={onRules}>
            How to play
          </button>
          <button type="button" className="ll-ghost" onClick={onToggleSound} aria-pressed={soundOn}>
            {soundOn ? "🔊 Sound on" : "🔇 Sound off"}
          </button>
        </div>
      </div>
    </div>
  );
}
