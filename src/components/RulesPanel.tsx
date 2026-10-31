"use client";

import { DIFFICULTY, METERS_PER_UNIT } from "@/lib/game/constants";
import { toDeg } from "@/lib/game/geometry";
import type { Difficulty } from "@/lib/game/types";

interface RulesPanelProps {
  difficulty: Difficulty;
  onClose: () => void;
}

const mps = (u: number) => (u * METERS_PER_UNIT).toFixed(1);

export function RulesPanel({ difficulty, onClose }: RulesPanelProps) {
  const cfg = DIFFICULTY[difficulty];
  return (
    <div className="ll-overlay" role="dialog" aria-modal aria-labelledby="ll-rules-title" data-testid="rules">
      <div className="ll-dialog">
        <h2 id="ll-rules-title" className="ll-dialog-title">
          How to play
        </h2>
        <div className="ll-rules">
          <p>
            Gravity pulls the lander down. <b>Rotate</b> it and fire the <b>main engine</b> to fight the fall and
            steer — every second of thrust burns fuel.
          </p>
          <p>
            Touch down on a <b>flat pad</b> with <b>both feet</b>. Narrow pads pay more: <b>×1</b>, <b>×2</b>,{" "}
            <b>×3</b> and <b>×5</b>.
          </p>
          <p>
            {`A safe landing on ${cfg.label} needs descent under `}
            <b>{`${mps(cfg.safe.vy)} m/s`}</b>
            {", drift under "}
            <b>{`${mps(cfg.safe.vx)} m/s`}</b>
            {" and tilt within "}
            <b>{`${Math.round(toDeg(cfg.safe.tilt))}°`}</b>
            {". A little over is a "}
            <b>hard landing</b>: you live, for fewer points. Anything more is a crash.
          </p>
          <p>
            The instruments turn <span className="ll-ok">green</span> inside the safe limits,{" "}
            <span className="ll-warn">amber</span> in the hard band and <span className="ll-bad">red</span> beyond.
            The camera zooms in as you near the ground.
          </p>
          <p>
            Each landing scores <b>base × multiplier</b> plus a fuel and a softness bonus, refuels the tank and
            takes you to a new level with stronger gravity and narrower pads. Fuel carries over. You have{" "}
            <b>three landers</b>; crash with dry tanks and the mission is over.
          </p>
          <p>
            <b>Keys:</b> ← → or A D rotate · ↑, W or Space thrust · P or Esc pause · Enter continues. On a phone,
            hold the on-screen buttons — thrust and rotate together with two thumbs.
          </p>
        </div>
        <button type="button" className="ll-primary" onClick={onClose}>
          Got it
        </button>
      </div>
    </div>
  );
}
