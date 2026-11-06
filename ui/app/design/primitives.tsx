import React, { forwardRef, type CSSProperties, type ReactNode } from "react";
import { color, radius, size, space, type, layout } from "./tokens";
import { Headline } from "../components/Info";

/** Primary: text/primary fill, bg/base text, 14/600. One per screen at most. */
export function PrimaryButton({ children, onClick, "aria-label": ariaLabel }: { children: ReactNode; onClick?: () => void; "aria-label"?: string }) {
  return (
    <button
      type="button"
      className="lc-btn"
      onClick={onClick}
      aria-label={ariaLabel}
      aria-disabled={!onClick}
      style={{
        ...buttonBase,
        ...(onClick ? null : disabled),
        background: color.accent,
        color: color.onAccent,
        fontWeight: 600,
      }}
    >
      {children}
    </button>
  );
}

/** Secondary: surface/2 fill, text/primary text, 14/500. Forwards its ref (menus return focus to it). */
export const SecondaryButton = forwardRef<
  HTMLButtonElement,
  {
    children: ReactNode;
    onClick?: () => void;
    style?: CSSProperties;
    "aria-label"?: string;
    /** For on/off buttons ("Show names"). */
    "aria-pressed"?: boolean;
    /** For a button that opens a menu or dialog. */
    "aria-expanded"?: boolean;
    "aria-controls"?: string;
    "aria-haspopup"?: "true" | "dialog" | "menu";
  }
>(function SecondaryButton({ children, onClick, style, ...aria }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      className="lc-btn"
      onClick={onClick}
      {...aria}
      aria-disabled={!onClick}
      style={{ ...buttonBase, background: color.surface2, color: color.textPrimary, fontWeight: 500, ...(onClick ? null : disabled), ...style }}
    >
      {children}
    </button>
  );
});

/** A button without an action: dimmed and announced as unavailable (WCAG exempts disabled controls from contrast). */
const disabled: CSSProperties = { opacity: 0.45, cursor: "not-allowed" };

const buttonBase: CSSProperties = {
  ...type.body,
  fontFamily: "inherit",
  height: size.control,
  padding: `0 ${space[16]}px`,
  border: 0,
  borderRadius: radius.control,
  display: "inline-flex",
  alignItems: "center",
  whiteSpace: "nowrap",
};

/** Quiet third button: text only, for navigation-like actions ("See all", "Back"). */
export function TextButton({ children, onClick, "aria-label": ariaLabel, "aria-expanded": ariaExpanded }: { children: ReactNode; onClick?: () => void; "aria-label"?: string; "aria-expanded"?: boolean }) {
  return (
    <button
      type="button"
      className="lc-textbtn"
      onClick={onClick}
      aria-label={ariaLabel}
      aria-expanded={ariaExpanded}
      aria-disabled={!onClick}
      style={{ ...type.body, fontWeight: 500, fontFamily: "inherit", border: 0, background: "transparent", color: color.textSecondary, padding: `${space[8]}px ${space[4]}px`, ...(onClick ? null : disabled) }}
    >
      {children}
    </button>
  );
}

/**
 * Text tabs on a hairline, for switching views inside one screen (Entities
 * types, Spend sections). The selected tab carries a 1px primary underline.
 */
export function Tabs<T extends string>({ options, value, onChange, label }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <div role="tablist" aria-label={label} style={{ display: "flex", gap: space[24], borderBottom: `1px solid ${color.line}`, flexWrap: "wrap" }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={on}
            className="lc-tab"
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => {
              if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
              const i = options.findIndex((x) => x.value === value);
              const next = options[(i + (e.key === "ArrowRight" ? 1 : options.length - 1)) % options.length];
              onChange(next.value);
              const tabs = (e.currentTarget.parentElement?.querySelectorAll('[role="tab"]') ?? []) as NodeListOf<HTMLButtonElement>;
              tabs[options.indexOf(next)]?.focus();
            }}
            style={{
              ...type.body,
              fontWeight: 500,
              fontFamily: "inherit",
              height: size.control,
              padding: 0,
              marginBottom: -1,
              border: 0,
              borderBottom: `1px solid ${on ? color.accent : "transparent"}`,
              background: "transparent",
              color: on ? color.accent : color.textSecondary,
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** 6 x 6 square, radius 1.5. Square, not a circle, to match the app icon. */
export function Marker({ tone = "signal" }: { tone?: "signal" | "primary" | "muted" }) {
  const fill = tone === "signal" ? color.signal : tone === "primary" ? color.textPrimary : color.lineStrong;
  return (
    <span
      aria-hidden="true"
      style={{ flex: "none", display: "inline-block", width: size.marker, height: size.marker, borderRadius: radius.marker, background: fill }}
    />
  );
}

/** Signal marker followed by a Label in signal, e.g. NOT FIXABLE TODAY. */
export function SignalLabel({ children }: { children: ReactNode }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: space[8], ...type.label, color: color.signal }}>
      <Marker />
      {children}
    </span>
  );
}

export function Label({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return <span style={{ ...type.label, color: color.textTertiary, ...style }}>{children}</span>;
}

/** Card: surface/1, radius 14, padding 24, no border. */
export function Card({ children, style, role }: { children: ReactNode; style?: CSSProperties; role?: string }) {
  return (
    <div role={role} style={{ background: color.surface1, borderRadius: radius.surface, padding: space[24], ...style }}>
      {children}
    </div>
  );
}

/** Timeframe control: surface/1 track with 3px padding, 34px segments, selected surface/3. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  block,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  /** Stretch to the container width with equal segments (the sidebar workspace switch). */
  block?: boolean;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      style={{
        display: block ? "flex" : "inline-flex",
        // Inside a column layout an inline switch would still stretch to full width.
        alignSelf: block ? undefined : "flex-start",
        gap: space[4],
        padding: size.trackPadding,
        borderRadius: radius.control,
        background: color.surface1,
      }}
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            className="lc-seg"
            aria-pressed={on}
            onClick={() => onChange(o.value)}
            style={{
              ...type.body,
              fontFamily: "inherit",
              fontWeight: on ? 500 : 400,
              height: size.segment,
              padding: `0 ${block ? space[8] : space[16]}px`,
              flex: block ? "1 1 0" : undefined,
              // Selected segment carries a line/strong border: the fill alone
              // is under 3:1 against the track in both themes.
              border: `1px solid ${on ? color.accent : "transparent"}`,
              boxSizing: "border-box",
              borderRadius: radius.segment,
              cursor: "pointer",
              background: on ? color.accentSoft : "transparent",
              color: on ? color.accent : color.textSecondary,
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** The screen's one-sentence answer: setup in text/tertiary, conclusion in text/primary. */
/** delta: the one-sentence comparison with the previous period, kept tight under the lead. */
export function Answer({ setup, conclusion, lead, delta }: { setup: string; conclusion: string; lead?: ReactNode; delta?: ReactNode }) {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: space[12], maxWidth: layout.content }}>
      <Headline>
        <span style={{ color: color.textTertiary }}>{setup}</span>{" "}
        <span style={{ color: color.textPrimary }}>{conclusion}</span>
      </Headline>
      {lead && <p style={{ margin: 0, ...type.bodyLarge, color: color.textSecondary }}>{lead}</p>}
      {delta}
    </section>
  );
}


/**
 * The one dropdown (v0.12.15). The browser's own arrow sits against the right
 * edge and the box takes the width of the longest option, so a short choice
 * left a gap before a misplaced arrow. Here: no native arrow, our chevron 14 px
 * from the right, 12 px of padding on the left and room for the chevron on the
 * right, 40 px tall, and (where the browser supports it) a box sized to the
 * selected choice.
 */
export function Dropdown({
  id,
  value,
  onChange,
  options,
  style,
  "aria-label": ariaLabel,
}: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  style?: CSSProperties;
  "aria-label"?: string;
}) {
  return (
    <span style={{ position: "relative", display: "inline-flex", alignItems: "center", maxWidth: "100%" }}>
      <select
        id={id}
        aria-label={ariaLabel}
        className="lc-input lc-select"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          ...type.body,
          fontFamily: "inherit",
          height: size.control,
          maxWidth: "100%",
          padding: `0 ${space[32] + space[4]}px 0 ${space[12]}px`,
          border: `1px solid ${color.lineStrong}`,
          borderRadius: radius.control,
          background: color.surface1,
          color: color.textPrimary,
          cursor: "pointer",
          ...style,
        }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" style={{ position: "absolute", right: 14, pointerEvents: "none", color: color.textSecondary }}>
        <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}
