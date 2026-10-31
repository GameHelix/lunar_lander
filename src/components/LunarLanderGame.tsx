"use client";

import { useCallback, useState } from "react";
import { cx } from "@/lib/cx";
import { DEFAULT_DIFFICULTY, DIFFICULTIES, DIFFICULTY_KEY, SOUND_KEY, STATS_KEY } from "@/lib/game/constants";
import { randomSeed } from "@/lib/game/rng";
import { bestFor, difficultyOr, recordRun, type BestRecord } from "@/lib/game/stats";
import type { Difficulty } from "@/lib/game/types";
import { useLocalStorage } from "@/lib/hooks/useLocalStorage";
import { MenuScreen } from "./MenuScreen";
import { PlayScreen } from "./PlayScreen";
import { ResultPanel, type RunSummary } from "./ResultPanel";
import { RulesPanel } from "./RulesPanel";

interface Run {
  seed: string;
  difficulty: Difficulty;
  /** Bumped on every start so PlayScreen remounts with a clean slate. */
  nonce: number;
  /** The standing best when this run began, to recognise a new one at the end. */
  bestBefore: number;
}

interface Result {
  summary: RunSummary;
  best: BestRecord;
  isNewBest: boolean;
}

/** The freshest stored stats, read at the moment they are about to be merged. */
function readStats(): unknown {
  try {
    return JSON.parse(window.localStorage.getItem(STATS_KEY) ?? "{}");
  } catch {
    return {};
  }
}

/**
 * Top-level orchestrator: routes between the menu and a run, and owns the
 * persisted difficulty, sound switch and best records, the rules dialog and
 * the game-over panel. Runs are seeded in the Start handler, so nothing
 * random happens during render and the server markup always hydrates cleanly.
 */
export function LunarLanderGame() {
  const { value: storedDifficulty, store: storeDifficulty } = useLocalStorage<unknown>(
    DIFFICULTY_KEY,
    DEFAULT_DIFFICULTY
  );
  const { value: storedSound, store: storeSound } = useLocalStorage<unknown>(SOUND_KEY, true);
  const { value: stats, store: storeStats } = useLocalStorage<unknown>(STATS_KEY, {});
  const difficulty = difficultyOr(storedDifficulty);
  const soundOn = storedSound !== false;

  const [run, setRun] = useState<Run | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  const start = useCallback((d: Difficulty) => {
    setResult(null);
    setRun((prev) => ({
      seed: String(randomSeed()),
      difficulty: d,
      nonce: (prev?.nonce ?? 0) + 1,
      bestBefore: bestFor(readStats(), d).score,
    }));
  }, []);

  const exit = useCallback(() => {
    setResult(null);
    setRun(null);
  }, []);

  const toggleSound = useCallback(() => storeSound(!soundOn), [soundOn, storeSound]);

  /** Bests are saved as the run goes, so quitting mid-run never loses them. */
  const progress = useCallback(
    (score: number, level: number) => {
      if (!run) return;
      const r = recordRun(readStats(), run.difficulty, score, level);
      if (r.changed) storeStats(r.stats);
    },
    [run, storeStats]
  );

  const gameOver = useCallback(
    (summary: RunSummary) => {
      const r = recordRun(readStats(), summary.difficulty, summary.score, summary.level);
      if (r.changed) storeStats(r.stats);
      setResult({
        summary,
        best: bestFor(r.stats, summary.difficulty),
        isNewBest: summary.score > 0 && summary.score > (run?.bestBefore ?? 0),
      });
    },
    [run, storeStats]
  );

  const bests = Object.fromEntries(DIFFICULTIES.map((d) => [d, bestFor(stats, d)])) as Record<
    Difficulty,
    BestRecord
  >;

  return (
    <main className={cx("ll-app", run && "is-playing")}>
      {run ? (
        <PlayScreen
          key={run.nonce}
          difficulty={run.difficulty}
          seed={run.seed}
          soundOn={soundOn}
          onToggleSound={toggleSound}
          onRestart={() => start(run.difficulty)}
          onExit={exit}
          onProgress={progress}
          onGameOver={gameOver}
        />
      ) : (
        <MenuScreen
          difficulty={difficulty}
          bests={bests}
          soundOn={soundOn}
          onDifficulty={storeDifficulty}
          onStart={() => start(difficulty)}
          onRules={() => setRulesOpen(true)}
          onToggleSound={toggleSound}
        />
      )}

      {result ? (
        <ResultPanel
          summary={result.summary}
          best={result.best}
          isNewBest={result.isNewBest}
          onPlayAgain={() => start(result.summary.difficulty)}
          onMenu={exit}
        />
      ) : null}

      {rulesOpen ? <RulesPanel difficulty={difficulty} onClose={() => setRulesOpen(false)} /> : null}
    </main>
  );
}
