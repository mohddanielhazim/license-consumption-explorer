import React, { useState } from "react";

import { color, radius, type } from "../design/tokens";

/**
 * Instant hover values for daily bar charts. The browser's own tooltip waits
 * about a second and skips a moving pointer, and thin bars with gaps leave
 * most of the chart unhoverable; here the whole column above each day answers.
 */
export function useBarHover(count: number) {
  const [index, setIndex] = useState<number | null>(null);
  const handlers = {
    onMouseMove: (e: React.MouseEvent<HTMLElement>) => {
      const box = e.currentTarget.getBoundingClientRect();
      if (box.width <= 0 || count <= 0) return;
      const i = Math.floor(((e.clientX - box.left) / box.width) * count);
      setIndex(Math.max(0, Math.min(count - 1, i)));
    },
    onMouseLeave: () => setIndex(null),
  };
  return { index, handlers };
}

/** The value label, above the hovered column; kept inside the chart at both ends. */
export function BarTip({ index, count, children }: { index: number; count: number; children: React.ReactNode }) {
  const centre = ((index + 0.5) / count) * 100;
  const edge = centre < 15 ? "left" : centre > 85 ? "right" : "centre";
  return (
    <span
      aria-hidden="true"
      style={{
        position: "absolute",
        bottom: "calc(100% + 6px)",
        left: edge === "right" ? undefined : edge === "left" ? `max(0px, calc(${centre}% - 12px))` : `${centre}%`,
        right: edge === "right" ? `max(0px, calc(${100 - centre}% - 12px))` : undefined,
        transform: edge === "centre" ? "translateX(-50%)" : undefined,
        ...type.label,
        color: color.textPrimary,
        background: color.surface3,
        border: `1px solid ${color.line}`,
        borderRadius: radius.chip,
        padding: "4px 8px",
        whiteSpace: "nowrap",
        pointerEvents: "none",
        zIndex: 5,
      }}
    >
      {children}
    </span>
  );
}
