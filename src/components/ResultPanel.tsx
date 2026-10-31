"use client";

import { DIFFICULTY } from "@/lib/game/constants";
import { formatScore } from "@/lib/game/flight";
import type { BestRecord } from "@/lib/game/stats";
import type { Difficulty } from "@/lib/game/types";

/** How a run ended, for the game-over panel. */
export interface RunSummary {
  difficulty: Difficulty;
  score: number;
  level: number;
  landings: number;
  /** True when the last lander went down with dry tanks. */
  outOfFuel: boolean;
}

interface ResultPanelProps {
  summary: RunSummary;
  best: BestRecord;
  isNewBest: boolean;
  onPlayAgain: () => void;
  onMenu: () => void;
}

/** Game over: the final score, how far the run got, and the standing best. */
export function ResultPanel({ summary, best, isNewBest, onPlayAgain, onMenu }: ResultPanelProps) {
  return (
    <div className="ll-overlay" role="dialog" aria-modal aria-labelledby="ll-result-title" data-testid="result">
      <div className="ll-dialog">
        <h2 id="ll-result-title" className="ll-dialog-title">
          {"🌕 Mission over"}
        </h2>
        <p className="ll-result-cause">{summary.outOfFuel ? "Out of fuel, and out of luck." : "All landers lost."}</p>
        <p className="ll-result-score" data-testid="final-score">
          {formatScore(summary.score)}
        </p>
        <p className="ll-result-note">
          {`${DIFFICULTY[summary.difficulty].label} · reached level ${summary.level} · ${summary.landings} landing${
            summary.landings === 1 ? "" : "s"
          }`}
        </p>
        <p className="ll-result-note">
          {isNewBest ? (
            <b className="ll-new-best">New best score!</b>
          ) : (
            `Best ${best.score > 0 ? formatScore(best.score) : "—"} · furthest level ${best.level}`
          )}
        </p>
        <button type="button" className="ll-primary" onClick={onPlayAgain}>
          Fly again
        </button>
        <button type="button" className="ll-ghost" onClick={onMenu}>
          Back to menu
        </button>
      </div>
    </div>
  );
}
