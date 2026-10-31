import { ANTENNA, CABIN, DESCENT, FEET, LEGS, NOZZLE } from "@/lib/game/shape";
import type { Vec } from "@/lib/game/types";

/** SVG points for a body-local outline (y-up → y-down). */
const pts = (shape: readonly Vec[]) => shape.map((p) => `${p.x},${-p.y}`).join(" ");

interface LanderIconProps {
  className?: string;
  /** Draw a lit exhaust plume under the nozzle. */
  flame?: boolean;
  title?: string;
}

/**
 * The lander as a small inline SVG, drawn from the same geometry as the game
 * — for the lives counter and the menu.
 */
export function LanderIcon({ className, flame = false, title }: LanderIconProps) {
  return (
    <svg
      className={className}
      viewBox="-13 -14 26 32"
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      {flame ? <path className="ll-icon-flame" d="M -2.8 9.4 Q -1.6 14 0 18 Q 1.6 14 2.8 9.4 Z" /> : null}
      <g className="ll-icon-body">
        <polygon points={pts(CABIN)} />
        <polygon points={pts(DESCENT)} />
        <polygon points={pts(NOZZLE)} />
        {[...LEGS, ...FEET, ANTENNA].map(([a, b], i) => (
          <line key={i} x1={a.x} y1={-a.y} x2={b.x} y2={-b.y} />
        ))}
      </g>
    </svg>
  );
}
