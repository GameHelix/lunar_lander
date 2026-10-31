"use client";

import { cx } from "@/lib/cx";
import { formatScore } from "@/lib/game/flight";
import { outcomeTitle, reasonText, touchdownLine } from "@/lib/game/report";
import type { GameState } from "@/lib/game/types";

interface ReportPanelProps {
  /** The game as it stood at touchdown. */
  state: GameState;
  onContinue: () => void;
  onMenu: () => void;
}

const EMOJI = { safe: "✨", hard: "⚠️", crash: "💥" } as const;

/**
 * The card between attempts: what happened at touchdown, why, and what it
 * paid. A landing shows the score breakdown and the refuel; a crash names the
 * cause and how many landers are left.
 */
export function ReportPanel({ state, onContinue, onMenu }: ReportPanelProps) {
  const outcome = state.outcome;
  if (!outcome) return null;
  const landed = outcome.verdict !== "crash";
  const score = outcome.score;

  return (
    <div className="ll-report-wrap">
      <section
        className={cx("ll-report", `is-${outcome.verdict}`)}
        role="dialog"
        aria-modal="false"
        aria-labelledby="ll-report-title"
        data-testid="report"
        data-verdict={outcome.verdict}
      >
        <h2 id="ll-report-title" className="ll-report-title">
          {`${EMOJI[outcome.verdict]} ${outcomeTitle(outcome)}`}
        </h2>

        {outcome.reasons.length > 0 ? (
          <ul className="ll-report-reasons">
            {outcome.reasons.map((r) => (
              <li key={r}>{reasonText(r, outcome, state.safe, state.hard)}</li>
            ))}
          </ul>
        ) : (
          <p className="ll-report-note">Both feet on the pad, inside every limit.</p>
        )}

        {landed && score ? (
          <>
            <p className="ll-report-note">{`Pad ×${score.multiplier} · ${touchdownLine(outcome)}`}</p>
            <dl className="ll-breakdown">
              <div>
                <dt>{`Landing ${score.base} × ${score.multiplier}`}</dt>
                <dd>{formatScore(score.landing)}</dd>
              </div>
              <div>
                <dt>Fuel bonus</dt>
                <dd>{`+${score.fuelBonus}`}</dd>
              </div>
              <div>
                <dt>Softness bonus</dt>
                <dd>{`+${score.softBonus}`}</dd>
              </div>
              <div className="is-total">
                <dt>Total</dt>
                <dd>{`+${formatScore(score.total)}`}</dd>
              </div>
            </dl>
            <p className="ll-report-refuel">{`⛽ Refuel +${Math.round(outcome.refuel)} · tank ${Math.ceil(state.lander.fuel)}`}</p>
          </>
        ) : (
          <p className="ll-report-note">
            {`${state.lives} lander${state.lives === 1 ? "" : "s"} left · fuel ${Math.ceil(state.lander.fuel)}`}
          </p>
        )}

        <button type="button" className="ll-primary" onClick={onContinue} data-testid="continue">
          {landed ? `Level ${state.level + 1} ▸` : "Next lander ▸"}
        </button>
        <div className="ll-report-foot">
          <span className="ll-key-hint">Enter ↵</span>
          <button type="button" className="ll-link" onClick={onMenu}>
            Menu
          </button>
        </div>
      </section>
    </div>
  );
}
