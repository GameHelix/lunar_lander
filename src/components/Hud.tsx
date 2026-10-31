"use client";

import type { MouseEvent } from "react";
import { cx } from "@/lib/cx";
import { LIVES } from "@/lib/game/constants";
import { formatScore, type Band, type Panel } from "@/lib/game/flight";
import { LanderIcon } from "./LanderIcon";

interface HudProps {
  panel: Panel;
  soundOn: boolean;
  onPause: () => void;
  onToggleSound: () => void;
}

/** Drop focus after a click so Space (thrust) can never re-press a HUD button. */
function blurAfter(fn: () => void) {
  return (e: MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.blur();
    fn();
  };
}

/**
 * Two layers of readout: the run (score, level, landers, fuel) and the
 * flight instruments. Each instrument is coloured by the same limits the
 * touchdown judge uses — green would land, amber would be rough, red would
 * crash — so the panel teaches the limits as you fly.
 */
export function Hud({ panel, soundOn, onPause, onToggleSound }: HudProps) {
  return (
    <header className="ll-hud">
      <div className="ll-hud-row">
        <div className="ll-stat">
          <span className="ll-stat-label">Score</span>
          <span className="ll-stat-value" data-testid="score">
            {formatScore(panel.score)}
          </span>
        </div>
        <div className="ll-stat">
          <span className="ll-stat-label">Level</span>
          <span className="ll-stat-value" data-testid="level">
            {panel.level}
          </span>
        </div>
        <div className="ll-stat">
          <span className="ll-stat-label">Landers</span>
          <span className="ll-lives" data-testid="lives" data-lives={panel.lives} aria-label={`${panel.lives} landers left`}>
            {Array.from({ length: LIVES }, (_, i) => (
              <LanderIcon key={i} className={cx("ll-life", i >= panel.lives && "is-lost")} />
            ))}
          </span>
        </div>
        <div className="ll-hud-buttons">
          <button type="button" className="ll-icon-btn" onClick={blurAfter(onPause)} aria-label="Pause">
            ❚❚
          </button>
          <button
            type="button"
            className="ll-icon-btn"
            onClick={blurAfter(onToggleSound)}
            aria-label={soundOn ? "Mute sound" : "Unmute sound"}
            aria-pressed={soundOn}
          >
            {soundOn ? "🔊" : "🔇"}
          </button>
        </div>
      </div>

      <div className={cx("ll-fuel", panel.lowFuel && "is-low")}>
        <span className="ll-stat-label">Fuel</span>
        <div
          className="ll-fuel-track"
          role="meter"
          aria-label="Fuel"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={panel.fuelPct}
        >
          <div className="ll-fuel-bar" style={{ width: `${panel.fuelPct}%` }} />
        </div>
        <span className="ll-fuel-value" data-testid="fuel">
          {panel.fuel}
        </span>
        {panel.lowFuel ? <span className="ll-fuel-warn">LOW</span> : null}
      </div>

      <div className="ll-instruments">
        <Gauge label="Alt" unit="m" value={panel.alt} testId="alt" />
        <Gauge label="H-spd" unit="m/s" value={panel.h} band={panel.hBand} testId="hspeed" />
        <Gauge label="V-spd" unit="m/s" value={panel.v} band={panel.vBand} testId="vspeed" />
        <Gauge label="Tilt" value={panel.tilt} band={panel.tiltBand} testId="tilt" />
        <Gauge label="Pad" unit="m" value={panel.pad} band={panel.padOver ? "ok" : undefined} testId="pad" />
      </div>
    </header>
  );
}

function Gauge({
  label,
  unit,
  value,
  band,
  testId,
}: {
  label: string;
  unit?: string;
  value: string;
  band?: Band;
  testId: string;
}) {
  return (
    <div className={cx("ll-gauge", band && `is-${band}`)}>
      <span className="ll-gauge-label">
        {label}
        {unit ? <span className="ll-gauge-unit"> {unit}</span> : null}
      </span>
      <span className="ll-gauge-value" data-testid={testId}>
        {value}
      </span>
    </div>
  );
}
