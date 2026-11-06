import React, { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { color, radius, space, type } from "../design/tokens";

/**
 * Contextual guide: an "i" on a metric or flag that opens
 * What / Why / How / Where / Who / When. Keyboard: Tab to it, Enter to open,
 * Escape to close.
 *
 * v0.12.7: the panel is placed against the window, not the icon. It used to
 * hang 360px to the right of the icon, so an (i) near the right edge (column
 * headers) or inside a scrolling table was cut off. Now it measures the space
 * on every open, shifts left to stay on screen, opens upwards when there is
 * no room below, and follows the icon on scroll and resize.
 */
const PANEL_W = 360;
const EDGE = 16;
const GAP = 6;
export type Guide = { what: string; why?: string; how?: string; where?: string; who?: string; when?: string };

/**
 * `children` replaces the (i) with another trigger (v0.12.13: the price chip
 * opens its own explanation); `action` ends the panel with a next step.
 */
export function Info({ label, guide, children, triggerStyle, action }: { label: string; guide: Guide; children?: ReactNode; triggerStyle?: CSSProperties; action?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLSpanElement>(null);

  // Place the panel fully inside the window: below the icon if it fits, otherwise above.
  const place = () => {
    const b = button.current?.getBoundingClientRect();
    if (!b) return;
    const width = Math.min(PANEL_W, window.innerWidth - EDGE * 2);
    const left = Math.max(EDGE, Math.min(b.left, window.innerWidth - width - EDGE));
    const height = panel.current?.offsetHeight ?? 0;
    const below = b.bottom + GAP;
    const fitsBelow = below + height <= window.innerHeight - EDGE;
    const above = b.top - GAP - height;
    const top = fitsBelow || above < EDGE ? Math.max(EDGE, Math.min(below, window.innerHeight - height - EDGE)) : above;
    setPos({ top, left, width });
  };
  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    place();
    // Second pass once the panel has its real height at the final width.
    const raf = requestAnimationFrame(place);
    return () => cancelAnimationFrame(raf);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onMove = () => place();
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!panel.current?.contains(t) && !button.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const rows: [string, string | undefined][] = [
    ["What", guide.what],
    ["Why", guide.why],
    ["How", guide.how],
    ["Where", guide.where],
    ["Who", guide.who],
    ["When", guide.when],
  ];
  return (
    <span style={{ position: "relative", display: "inline-flex", verticalAlign: "middle" }}>
      <button
        ref={button}
        type="button"
        aria-label={children ? `${label}: what this means` : `About ${label}`}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
        className={children ? "lc-btn" : "lc-btn lc-info"}
        style={children ? { font: "inherit", cursor: "pointer", background: "transparent", margin: 0, ...triggerStyle } : {
          width: 18,
          height: 18,
          padding: 0,
          boxSizing: "border-box",
          // The glyph sits in the exact centre of the circle: a flex box, no inherited line height.
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          verticalAlign: "middle",
          borderRadius: radius.full,
          border: `1px solid ${color.lineStrong}`, // 3:1 against the page in both themes (WCAG 1.4.11)
          background: "transparent",
          color: color.textSecondary,
        }}
      >
        {children ?? (
          // The "i" is drawn, not typed: a glyph's visual centre depends on the font; this one is the circle's.
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" focusable="false" style={{ display: "block" }}>
            <circle cx="9" cy="5.4" r="1.1" fill="currentColor" />
            <rect x="8.2" y="7.6" width="1.6" height="5.6" rx="0.8" fill="currentColor" />
          </svg>
        )}
      </button>
      {open && (
        <span
          ref={panel}
          id={id}
          role="dialog"
          aria-label={label}
          style={{
            position: "fixed",
            boxSizing: "border-box",
            zIndex: 1000,
            top: pos?.top ?? 0,
            left: pos?.left ?? 0,
            width: pos?.width ?? PANEL_W,
            maxHeight: `calc(100vh - ${EDGE * 2}px)`,
            overflowY: "auto",
            visibility: pos ? "visible" : "hidden",
            display: "flex",
            flexDirection: "column",
            gap: space[8],
            padding: space[16],
            borderRadius: radius.surface,
            background: color.surface2,
            border: `1px solid ${color.lineStrong}`,
            textAlign: "left",
            whiteSpace: "normal",
            fontWeight: 400,
          }}
        >
          <span style={{ ...type.heading }}>{label}</span>
          {rows
            .filter(([, v]) => v)
            .map(([k, v]) => (
              <span key={k} style={{ ...type.body, color: color.textSecondary }}>
                <strong style={{ color: color.textPrimary }}>{k}: </strong>
                {v}
              </span>
            ))}
          {action && <span style={{ ...type.body, paddingTop: space[4] }}>{action}</span>}
        </span>
      )}
    </span>
  );
}

/**
 * The screen's own guide (v0.12.37). Shell provides it; the headline draws it.
 * It used to end the tab row, where it read as part of the tabs, sat far from
 * the sentence it explains, and at 1024 wide was drawn over the last Cost tab.
 */
export const PageGuide = React.createContext<{ label: string; guide: Guide } | null>(null);

/** A screen headline with its guide beside it. The (i) is outside the h1 so the heading's name stays the sentence. */
export function Headline({ children }: { children: ReactNode }) {
  const page = React.useContext(PageGuide);
  return (
    <div style={{ margin: 0, ...type.display }}>
      <h1 style={{ display: "inline", margin: 0, font: "inherit", letterSpacing: "inherit" }}>{children}</h1>
      {page && (
        <>
          {" "}
          <span style={{ display: "inline-flex", verticalAlign: "middle", marginLeft: space[4] }}>
            <Info label={page.label} guide={page.guide} />
          </span>
        </>
      )}
    </div>
  );
}
