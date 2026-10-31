import { describe, expect, it } from "vitest";
import { DIFFICULTIES } from "@/lib/game/constants";
import { continueGame, createGame } from "@/lib/game/game";
import { nearestPad } from "@/lib/game/terrain";
import { flyTo } from "./helpers/autopilot";
import { stateAt } from "./helpers/state";

/**
 * End to end: the same three controls a player has are enough to put the
 * lander down safely on every pad, on every difficulty, early and late —
 * so every pad the generator makes is genuinely reachable, and the tanks
 * hold enough fuel to get there.
 */
describe("the safe-landing path", () => {
  for (const difficulty of DIFFICULTIES) {
    it(`${difficulty}: lands safely on every pad, across seeds and levels`, () => {
      for (const seed of ["a", "b", "c", "d", "e", "f"]) {
        for (const level of [1, 4, 9]) {
          const start = stateAt(difficulty, seed, level);
          for (const pad of start.terrain.pads) {
            const end = flyTo(start, pad);
            const where = `${seed} L${level} ×${pad.multiplier}`;
            expect(end.phase, where).toBe("landed");
            expect(end.outcome?.verdict, where).toBe("safe");
            expect(end.outcome?.pad?.id, where).toBe(pad.id);
            expect(end.lander.fuel, where).toBeGreaterThan(0);
          }
        }
      }
    });
  }

  it("chains six levels on the starting tank plus refuels, flying to the nearest pad", () => {
    for (const difficulty of DIFFICULTIES) {
      let s = createGame(difficulty, "chain");
      for (let level = 1; level <= 6; level++) {
        s = flyTo(s, nearestPad(s.terrain, s.lander.x));
        expect(s.outcome?.verdict, `${difficulty} L${level}`).toBe("safe");
        if (level < 6) s = continueGame(s);
      }
      expect(s.level).toBe(6);
      expect(s.landings).toBe(6);
      expect(s.lives).toBe(3);
      expect(s.score).toBeGreaterThan(6 * 100);
      expect(s.lander.fuel).toBeGreaterThan(0);
    }
  });
});
