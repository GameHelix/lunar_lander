import { feetOf, type Contact } from "./collision";
import type { Pose } from "./geometry";
import { padUnder } from "./terrain";
import type { Limits, Pad, Reason, Terrain, Verdict } from "./types";

/**
 * Rate one touchdown measurement. Values exactly on a limit still count as
 * within it, so "3.0 m/s, limit 3.0" is a pass — the boundary belongs to the
 * gentler verdict.
 */
export function rateMetric(value: number, safe: number, hard: number): Verdict {
  if (value <= safe) return "safe";
  if (value <= hard) return "hard";
  return "crash";
}

export interface Judgement {
  verdict: Verdict;
  /** The measurements responsible for the verdict (empty when safe). */
  reasons: Reason[];
}

/**
 * Rate descent speed, sideways speed and tilt together. The worst of the
 * three decides; the reasons name every measurement at that worst level, so
 * a crash report lists what broke the lander and a hard-landing report lists
 * what made it rough.
 */
export function judgeApproach(vx: number, vy: number, angle: number, safe: Limits, hard: Limits): Judgement {
  const rated: [Reason, Verdict][] = [
    ["vSpeed", rateMetric(Math.abs(vy), safe.vy, hard.vy)],
    ["hSpeed", rateMetric(Math.abs(vx), safe.vx, hard.vx)],
    ["tilt", rateMetric(Math.abs(angle), safe.tilt, hard.tilt)],
  ];
  const verdict: Verdict = rated.some(([, r]) => r === "crash")
    ? "crash"
    : rated.some(([, r]) => r === "hard")
      ? "hard"
      : "safe";
  return {
    verdict,
    reasons: verdict === "safe" ? [] : rated.filter(([, r]) => r === verdict).map(([reason]) => reason),
  };
}

export interface Touchdown extends Judgement {
  /** The pad both feet came down on, if they did. */
  pad: Pad | null;
}

/**
 * Decide what a contact with the surface means.
 *
 * In order: a hull or strut strike is a crash whatever the speed; then both
 * feet must be over the same pad (one foot on and one off is a crash at the
 * lip, neither on is a crash on the rocks); only then are speed and tilt
 * judged. The check happens on the first step of contact, so on a slightly
 * tilted touchdown the high foot is still in the air — it only needs to be
 * above the pad, not on it.
 *
 * A crash for where the lander came down also lists any speed or tilt that
 * would have wrecked it anyway, so the report tells the whole story.
 */
export function judgeTouchdown(
  pose: Pose & { vx: number; vy: number },
  contact: Contact,
  terrain: Terrain,
  safe: Limits,
  hard: Limits
): Touchdown {
  const approach = judgeApproach(pose.vx, pose.vy, pose.angle, safe, hard);
  const blown = approach.verdict === "crash" ? approach.reasons : [];
  if (contact.hull) return { verdict: "crash", reasons: ["hull", ...blown], pad: null };
  const [fl, fr] = feetOf(pose);
  const padL = padUnder(terrain, fl.x);
  const padR = padUnder(terrain, fr.x);
  if (!padL || !padR || padL.id !== padR.id) {
    return { verdict: "crash", reasons: [padL || padR ? "edge" : "rocks", ...blown], pad: null };
  }
  return { ...approach, pad: padL };
}
