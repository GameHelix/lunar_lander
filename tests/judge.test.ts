import { describe, expect, it } from "vitest";
import { DIFFICULTIES, DIFFICULTY, STEP } from "@/lib/game/constants";
import { step } from "@/lib/game/game";
import { deg } from "@/lib/game/geometry";
import { judgeApproach, judgeTouchdown, rateMetric } from "@/lib/game/judge";
import { FOOT_X, FOOT_Y } from "@/lib/game/shape";
import type { Input, Limits } from "@/lib/game/types";
import { flatTerrain, gameOn, spikeTerrain, TEST_PAD } from "./helpers/state";

const EPS = 1e-9;
const IDLE: Input = { left: false, right: false, thrust: false };

describe("rateMetric", () => {
  it("puts each boundary on the gentler side", () => {
    expect(rateMetric(0, 10, 20)).toBe("safe");
    expect(rateMetric(10, 10, 20)).toBe("safe");
    expect(rateMetric(10 + EPS, 10, 20)).toBe("hard");
    expect(rateMetric(20, 10, 20)).toBe("hard");
    expect(rateMetric(20 + EPS, 10, 20)).toBe("crash");
  });
});

describe("judgeApproach: every limit, just inside and just outside", () => {
  for (const difficulty of DIFFICULTIES) {
    const { safe, hard } = DIFFICULTY[difficulty];
    const metrics: { key: keyof Limits; reason: string; at: (v: number) => [number, number, number] }[] = [
      { key: "vy", reason: "vSpeed", at: (v) => [0, -v, 0] },
      { key: "vx", reason: "hSpeed", at: (v) => [v, 0, 0] },
      { key: "tilt", reason: "tilt", at: (v) => [0, 0, v] },
    ];
    for (const m of metrics) {
      it(`${difficulty} · ${m.key}`, () => {
        const judge = (v: number) => judgeApproach(...m.at(v), safe, hard);
        expect(judge(safe[m.key])).toEqual({ verdict: "safe", reasons: [] });
        expect(judge(safe[m.key] + EPS)).toEqual({ verdict: "hard", reasons: [m.reason] });
        expect(judge(hard[m.key])).toEqual({ verdict: "hard", reasons: [m.reason] });
        expect(judge(hard[m.key] + EPS)).toEqual({ verdict: "crash", reasons: [m.reason] });
        // Direction does not matter: rising or sinking, left or right.
        expect(judge(-(hard[m.key] + EPS)).verdict).toBe("crash");
        expect(judge(-safe[m.key]).verdict).toBe("safe");
      });
    }
  }

  const { safe, hard } = DIFFICULTY.pilot;

  it("lets the worst measurement decide, and names only those at that level", () => {
    // Rough descent, broken tilt: a crash blamed on the tilt alone.
    const r = judgeApproach(0, -(safe.vy + 1), hard.tilt + 0.01, safe, hard);
    expect(r).toEqual({ verdict: "crash", reasons: ["tilt"] });
  });

  it("names every measurement that made a landing rough", () => {
    const r = judgeApproach(safe.vx + 0.5, -(safe.vy + 0.5), 0, safe, hard);
    expect(r).toEqual({ verdict: "hard", reasons: ["vSpeed", "hSpeed"] });
  });
});

describe("judgeTouchdown: where the feet came down", () => {
  const t = flatTerrain();
  const { safe, hard } = DIFFICULTY.pilot;
  const rest = TEST_PAD.y - FOOT_Y;
  const gentle = { vx: 0, vy: -2, angle: 0 };

  it("judges speed and tilt when both feet are on one pad", () => {
    const r = judgeTouchdown({ ...gentle, x: 930, y: rest }, { left: true, right: true, hull: false }, t, safe, hard);
    expect(r.verdict).toBe("safe");
    expect(r.pad).toBe(TEST_PAD);
  });

  it("accepts a foot right on the pad's end", () => {
    const x = TEST_PAD.x0 + 10;
    const r = judgeTouchdown({ ...gentle, x, y: rest }, { left: true, right: true, hull: false }, t, safe, hard);
    expect(r.verdict).toBe("safe");
  });

  it("crashes with one leg over the edge", () => {
    const x = TEST_PAD.x0 + 9.9;
    const r = judgeTouchdown({ ...gentle, x, y: rest }, { left: true, right: true, hull: false }, t, safe, hard);
    expect(r).toEqual({ verdict: "crash", reasons: ["edge"], pad: null });
  });

  it("crashes on the rocks, however gentle", () => {
    const r = judgeTouchdown({ ...gentle, x: 400, y: rest }, { left: true, right: true, hull: false }, t, safe, hard);
    expect(r).toEqual({ verdict: "crash", reasons: ["rocks"], pad: null });
  });

  it("crashes on any hull strike, even over a pad", () => {
    const r = judgeTouchdown({ ...gentle, x: 930, y: rest }, { left: true, right: true, hull: true }, t, safe, hard);
    expect(r).toEqual({ verdict: "crash", reasons: ["hull"], pad: null });
  });

  it("also names any limit that would have wrecked the lander anyway", () => {
    const fast = { vx: 0, vy: -(hard.vy + 5), angle: hard.tilt + 0.1 };
    const rocks = judgeTouchdown({ ...fast, x: 400, y: rest }, { left: true, right: true, hull: false }, t, safe, hard);
    expect(rocks.reasons).toEqual(["rocks", "vSpeed", "tilt"]);
    // A merely rough approach adds nothing to a crash on the rocks.
    const rough = { vx: 0, vy: -(safe.vy + 0.1), angle: 0 };
    const r = judgeTouchdown({ ...rough, x: 400, y: rest }, { left: true, right: true, hull: false }, t, safe, hard);
    expect(r.reasons).toEqual(["rocks"]);
  });
});

describe("touchdown inside the step", () => {
  const { safe, hard } = DIFFICULTY.pilot;
  const G = 6.48;
  // Hang the lander with its lower foot a hair above the ground, so the next
  // step makes contact, and pre-add one step of gravity so the speed at
  // contact is exactly `vy`.
  const touch = (vx: number, vy: number, angle = 0, x = 930) => {
    const y = TEST_PAD.y + 0.001 + FOOT_X * Math.abs(Math.sin(angle)) - FOOT_Y * Math.cos(angle);
    const g = gameOn(flatTerrain(), { x, y, vx, vy: vy + G * STEP, angle });
    return step({ ...g, params: { ...g.params, gravity: G } }, IDLE, STEP);
  };

  it("lands safely within every limit", () => {
    const s = touch(safe.vx * 0.5, -safe.vy * 0.5, safe.tilt * 0.5);
    expect(s.phase).toBe("landed");
    expect(s.outcome?.verdict).toBe("safe");
    expect(s.events).toContainEqual({ type: "landed", verdict: "safe" });
  });

  it("lands hard just past the safe descent limit", () => {
    const s = touch(0, -(safe.vy + 0.2));
    expect(s.phase).toBe("landed");
    expect(s.outcome?.verdict).toBe("hard");
    expect(s.outcome?.reasons).toEqual(["vSpeed"]);
    expect(s.events).toContainEqual({ type: "landed", verdict: "hard" });
  });

  it("crashes just past the hard descent limit", () => {
    const s = touch(0, -(hard.vy + 0.2));
    expect(s.phase).toBe("crashed");
    expect(s.outcome?.reasons).toEqual(["vSpeed"]);
    expect(s.events).toContainEqual({ type: "crashed" });
  });

  it("crashes when sliding sideways too fast", () => {
    expect(touch(hard.vx + 0.5, -2).outcome?.reasons).toEqual(["hSpeed"]);
  });

  it("crashes when tilted too far", () => {
    expect(touch(0, -2, deg(-12)).outcome?.reasons).toEqual(["tilt"]);
  });

  it("crashes when only one foot finds the pad", () => {
    expect(touch(0, -2, 0, TEST_PAD.x1 - 5).outcome?.reasons).toEqual(["edge"]);
  });

  it("crashes on rough ground away from the pads", () => {
    expect(touch(0, -2, 0, 1500).outcome?.reasons).toEqual(["rocks"]);
  });

  it("crashes when a rock spears the hull", () => {
    // Feet 8 units up; the 8-unit spike meets the nozzle while they hang 5 units clear.
    const g = gameOn(spikeTerrain(), { x: 1000, y: 100 - FOOT_Y + 8, vy: -3 });
    let s = g;
    for (let i = 0; i < 240 && s.phase === "flying"; i++) s = step(s, IDLE, STEP);
    expect(s.phase).toBe("crashed");
    expect(s.outcome?.reasons).toEqual(["hull"]);
  });

  it("settles a slightly tilted lander level onto the pad", () => {
    let s = touch(0, -2, safe.tilt * 0.8);
    expect(s.phase).toBe("landed");
    for (let i = 0; i < 120; i++) s = step(s, IDLE, STEP);
    expect(Math.abs(s.lander.angle)).toBeLessThan(1e-3);
    expect(s.lander.y).toBeCloseTo(TEST_PAD.y - FOOT_Y, 3);
    expect(s.lander.vx).toBe(0);
    expect(s.lander.vy).toBe(0);
  });
});
