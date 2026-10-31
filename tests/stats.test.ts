import { describe, expect, it } from "vitest";
import { DEFAULT_DIFFICULTY } from "@/lib/game/constants";
import { bestFor, difficultyOr, isDifficulty, recordRun } from "@/lib/game/stats";

describe("stored difficulty", () => {
  it("accepts only the three difficulties", () => {
    expect(isDifficulty("cadet")).toBe(true);
    expect(isDifficulty("commander")).toBe(true);
    expect(isDifficulty("admiral")).toBe(false);
    expect(isDifficulty(3)).toBe(false);
    expect(difficultyOr("pilot")).toBe("pilot");
    expect(difficultyOr(null)).toBe(DEFAULT_DIFFICULTY);
    expect(difficultyOr({})).toBe(DEFAULT_DIFFICULTY);
  });
});

describe("best records", () => {
  it("reads malformed storage as no record", () => {
    for (const junk of [null, undefined, 7, "x", [], { pilot: 3 }, { pilot: { score: "9", level: -2 } }]) {
      expect(bestFor(junk, "pilot")).toEqual({ score: 0, level: 0 });
    }
    expect(bestFor({ pilot: { score: 1234.9, level: 4 } }, "pilot")).toEqual({ score: 1234, level: 4 });
  });

  it("raises the best score and the furthest level independently", () => {
    const start = { pilot: { score: 900, level: 3 } };
    const higherScore = recordRun(start, "pilot", 1200, 2);
    expect(higherScore.stats.pilot).toEqual({ score: 1200, level: 3 });
    expect(higherScore.changed).toBe(true);
    expect(higherScore.newBestScore).toBe(true);

    const furtherLevel = recordRun(start, "pilot", 500, 5);
    expect(furtherLevel.stats.pilot).toEqual({ score: 900, level: 5 });
    expect(furtherLevel.newBestScore).toBe(false);

    const nothing = recordRun(start, "pilot", 100, 1);
    expect(nothing.changed).toBe(false);
    expect(nothing.stats.pilot).toEqual(start.pilot);
  });

  it("keeps the other difficulties and drops junk", () => {
    const r = recordRun({ cadet: { score: 50, level: 2 }, bogus: 1 }, "commander", 300, 2);
    expect(r.stats).toEqual({ cadet: { score: 50, level: 2 }, commander: { score: 300, level: 2 } });
  });
});
