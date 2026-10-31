import { DIFFICULTY, WORLD_WIDTH } from "@/lib/game/constants";
import { createGame, levelParams, spawnLander } from "@/lib/game/game";
import { generateTerrain } from "@/lib/game/terrain";
import type { Difficulty, GameState, Lander, Pad, Terrain } from "@/lib/game/types";

/** A full-tank game state dropped straight onto `level`. */
export function stateAt(difficulty: Difficulty, seed: string, level: number): GameState {
  const params = levelParams(difficulty, level);
  return {
    ...createGame(difficulty, seed),
    level,
    params,
    terrain: generateTerrain(seed, level, params.padScale),
    lander: spawnLander(seed, level, 0, DIFFICULTY[difficulty].startFuel, params.drift),
  };
}

/** The ×2 test pad: 60 units wide at x 900..960, flush with the ground. */
export const TEST_PAD: Pad = { id: 0, x0: 900, x1: 960, y: 100, multiplier: 2 };

/** Flat ground at height 100 across the world, with TEST_PAD set into it. */
export function flatTerrain(): Terrain {
  return {
    width: WORLD_WIDTH,
    pads: [TEST_PAD],
    points: [
      { x: 0, y: 100 },
      { x: TEST_PAD.x0, y: 100 },
      { x: TEST_PAD.x1, y: 100 },
      { x: WORLD_WIDTH, y: 100 },
    ],
  };
}

/** Flat ground at height 100 with one sharp 8-unit spike at x = 1000. */
export function spikeTerrain(): Terrain {
  return {
    width: WORLD_WIDTH,
    pads: [],
    points: [
      { x: 0, y: 100 },
      { x: 995, y: 100 },
      { x: 1000, y: 108 },
      { x: 1005, y: 100 },
      { x: WORLD_WIDTH, y: 100 },
    ],
  };
}

export function makeLander(over: Partial<Lander> = {}): Lander {
  return { x: 1000, y: 800, vx: 0, vy: 0, angle: 0, fuel: 500, thrusting: false, rotDir: 0, rotHeld: 0, ...over };
}

/** A pilot-level game over `terrain` with the lander placed as given. */
export function gameOn(terrain: Terrain, lander: Partial<Lander>, over: Partial<GameState> = {}): GameState {
  return { ...createGame("pilot", "fixture"), terrain, lander: makeLander(lander), ...over };
}
