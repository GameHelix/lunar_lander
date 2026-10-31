"use client";

import { useRef, useState, type PointerEvent, type ReactNode } from "react";
import { cx } from "@/lib/cx";

export type Control = "left" | "right" | "thrust";

interface TouchControlsProps {
  onControl: (control: Control, down: boolean) => void;
}

/**
 * Big thumb buttons for phones: rotate left, THRUST, rotate right. Every
 * button tracks its own set of pointers, so two thumbs work at once — hold
 * THRUST with one and steer with the other.
 */
export function TouchControls({ onControl }: TouchControlsProps) {
  return (
    <div className="ll-touch" onContextMenu={(e) => e.preventDefault()}>
      <HoldButton control="left" label="Rotate left" onControl={onControl}>
        <span className="ll-hold-glyph" aria-hidden>
          ⟲
        </span>
      </HoldButton>
      <HoldButton control="thrust" label="Thrust" onControl={onControl} className="is-thrust">
        <span className="ll-hold-word">THRUST</span>
      </HoldButton>
      <HoldButton control="right" label="Rotate right" onControl={onControl}>
        <span className="ll-hold-glyph" aria-hidden>
          ⟳
        </span>
      </HoldButton>
    </div>
  );
}

interface HoldButtonProps {
  control: Control;
  label: string;
  className?: string;
  children: ReactNode;
  onControl: (control: Control, down: boolean) => void;
}

/**
 * Pressed while at least one pointer holds it. The pointer is captured, so a
 * thumb that slides off the edge mid-burn keeps the engine lit until it
 * lifts; cancel and lost-capture count as a lift so nothing stays stuck on.
 */
function HoldButton({ control, label, className, children, onControl }: HoldButtonProps) {
  const [held, setHeld] = useState(false);
  const pointers = useRef<Set<number>>(new Set());

  const press = (e: PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Capture can fail for synthetic pointers; holding still works without it.
    }
    if (pointers.current.size === 0) {
      setHeld(true);
      onControl(control, true);
    }
    pointers.current.add(e.pointerId);
  };

  const release = (e: PointerEvent<HTMLButtonElement>) => {
    if (!pointers.current.delete(e.pointerId)) return;
    if (pointers.current.size === 0) {
      setHeld(false);
      onControl(control, false);
    }
  };

  return (
    <button
      type="button"
      tabIndex={-1}
      aria-label={label}
      aria-pressed={held}
      className={cx("ll-hold", className, held && "is-held")}
      onPointerDown={press}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={release}
    >
      {children}
    </button>
  );
}
