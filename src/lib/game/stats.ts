import { DEFAULT_DIFFICULTY, DIFFICULTIES } from "./constants";
import type { Difficulty } from "./types";

/** Best run on one difficulty: the top score and the furthest level reached. */
export interface BestRecord {
  score: number;
  level: number;
}

export type Stats = Partial<Record<Difficulty, BestRecord>>;

const EMPTY: BestRecord = { score: 0, level: 0 };

export function isDifficulty(v: unknown): v is Difficulty {
  return typeof v === "string" && (DIFFICULTIES as readonly string[]).includes(v);
}

/** A stored difficulty, or the default when storage holds anything else. */
export function difficultyOr(v: unknown): Difficulty {
  return isDifficulty(v) ? v : DEFAULT_DIFFICULTY;
}

function count(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

/**
 * The record for a difficulty, read defensively: localStorage is user-
 * editable, so anything malformed reads as "no record yet".
 */
export function bestFor(stats: unknown, difficulty: Difficulty): BestRecord {
  if (!stats || typeof stats !== "object") return EMPTY;
  const rec = (stats as Record<string, unknown>)[difficulty];
  if (!rec || typeof rec !== "object") return EMPTY;
  const r = rec as Record<string, unknown>;
  return { score: count(r.score), level: count(r.level) };
}

export interface RecordResult {
  stats: Stats;
  /** Whether either best improved (so there is something to save). */
  changed: boolean;
  newBestScore: boolean;
}

/** Fold a run's score and level into the stored bests. */
export function recordRun(stats: unknown, difficulty: Difficulty, score: number, level: number): RecordResult {
  const prev = bestFor(stats, difficulty);
  const next: BestRecord = { score: Math.max(prev.score, count(score)), level: Math.max(prev.level, count(level)) };
  const clean: Stats = {};
  for (const d of DIFFICULTIES) {
    const b = d === difficulty ? next : bestFor(stats, d);
    if (b.score > 0 || b.level > 0) clean[d] = b;
  }
  return {
    stats: clean,
    changed: next.score !== prev.score || next.level !== prev.level,
    newBestScore: next.score > prev.score,
  };
}
