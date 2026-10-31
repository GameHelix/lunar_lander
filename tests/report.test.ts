import { describe, expect, it } from "vitest";
import { DIFFICULTY } from "@/lib/game/constants";
import { panelOf, samePanel } from "@/lib/game/flight";
import { deg } from "@/lib/game/geometry";
import { outcomeTitle, reasonText, touchdownLine } from "@/lib/game/report";
import type { Outcome } from "@/lib/game/types";
import { flatTerrain, gameOn, TEST_PAD } from "./helpers/state";

const { safe, hard } = DIFFICULTY.pilot;

function outcome(over: Partial<Outcome>): Outcome {
  return { verdict: "crash", reasons: [], pad: null, vx: 0, vy: 0, tilt: 0, score: null, refuel: 0, ...over };
}

describe("touchdown report", () => {
  it("titles each verdict", () => {
    expect(outcomeTitle(outcome({ verdict: "safe" }))).toBe("Safe landing");
    expect(outcomeTitle(outcome({ verdict: "hard" }))).toBe("Hard landing");
    expect(outcomeTitle(outcome({ verdict: "crash" }))).toBe("Crashed");
  });

  it("quotes the crash limit for a crash and the safe limit for a hard landing", () => {
    const crash = outcome({ verdict: "crash", vy: -22, vx: 14, tilt: deg(-14) });
    expect(reasonText("vSpeed", crash, safe, hard)).toBe("Came down too fast: 5.5 m/s (limit 4.5).");
    expect(reasonText("hSpeed", crash, safe, hard)).toBe("Sliding sideways at 3.5 m/s (limit 3.0).");
    expect(reasonText("tilt", crash, safe, hard)).toBe("Tilted 14° (limit 11°).");
    const rough = outcome({ verdict: "hard", vy: -14, vx: -9, tilt: deg(9) });
    expect(reasonText("vSpeed", rough, safe, hard)).toBe("Descent 3.5 m/s (safe up to 3.0).");
    expect(reasonText("hSpeed", rough, safe, hard)).toBe("Drift 2.3 m/s (safe up to 2.0).");
    expect(reasonText("tilt", rough, safe, hard)).toBe("Tilt 9° (safe up to 7°).");
  });

  it("explains where a lander came down wrong", () => {
    const o = outcome({});
    expect(reasonText("hull", o, safe, hard)).toMatch(/hull/);
    expect(reasonText("rocks", o, safe, hard)).toMatch(/rough ground/);
    expect(reasonText("edge", o, safe, hard)).toMatch(/edge of the pad/);
  });

  it("sums up the touchdown numbers in one line", () => {
    expect(touchdownLine(outcome({ vy: -6, vx: 2, tilt: deg(-3) }))).toBe("↓ 1.5 m/s · ↔ 0.5 m/s · tilt 3°");
  });
});

describe("instrument panel", () => {
  it("formats speeds with direction arrows and one decimal", () => {
    const p = panelOf(gameOn(flatTerrain(), { x: 930, y: 600, vx: -6, vy: -10, angle: deg(4) }));
    expect(p.h).toBe("← 1.5");
    expect(p.v).toBe("↓ 2.5");
    expect(p.tilt).toBe("↻ 4°");
    const up = panelOf(gameOn(flatTerrain(), { x: 930, y: 600, vx: 6, vy: 4, angle: deg(-12) }));
    expect(up.h).toBe("→ 1.5");
    expect(up.v).toBe("↑ 1.0");
    expect(up.tilt).toBe("↺ 12°");
    const still = panelOf(gameOn(flatTerrain(), { x: 930, y: 600 }));
    expect([still.h, still.v, still.tilt]).toEqual(["0.0", "0.0", "0°"]);
  });

  it("shows altitude to a tenth of a metre only near the ground", () => {
    expect(panelOf(gameOn(flatTerrain(), { x: 930, y: 100 + 12 + 20 })).alt).toBe("5.0");
    expect(panelOf(gameOn(flatTerrain(), { x: 930, y: 100 + 12 + 400 })).alt).toBe("100");
  });

  it("points to the pad, then marks it once the feet are over it", () => {
    expect(panelOf(gameOn(flatTerrain(), { x: 700, y: 600 })).pad).toBe("×2 58 ▶");
    expect(panelOf(gameOn(flatTerrain(), { x: 1200, y: 600 })).pad).toBe("×2 ◀ 68");
    const over = panelOf(gameOn(flatTerrain(), { x: (TEST_PAD.x0 + TEST_PAD.x1) / 2, y: 600 }));
    expect(over.pad).toBe("×2 ▼");
    expect(over.padOver).toBe(true);
  });

  it("reports the tank as a percentage and compares snapshots by what is shown", () => {
    const g = gameOn(flatTerrain(), { x: 700, y: 600, fuel: 412.4 });
    const p = panelOf(g);
    expect(p.fuel).toBe(413);
    expect(p.fuelPct).toBe(41.2);
    expect(samePanel(p, panelOf(g))).toBe(true);
    expect(samePanel(p, panelOf({ ...g, score: 10 }))).toBe(false);
  });
});
