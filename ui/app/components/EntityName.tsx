import React, { useState } from "react";
import { color, radius, space, type } from "../design/tokens";
import { entityMode } from "../data/entities";

/**
 * Entity display rule: always the human name, never a
 * raw id as the label. The id sits on its own line beneath the name, always
 * visible (12px mono, tertiary) with a copy button. Duplicates get a short
 * disambiguator; a missing name says "Deleted host" / "Unnamed host".
 */
export type NameState = "ok" | "deleted" | "unnamed" | "unlisted";

export function displayName(name: string | null | undefined, kind: string, state: NameState = "ok"): string {
  if (state === "deleted") return `Deleted ${kind}`;
  // No entity table to look names up in: the kind alone, and disambiguate() adds the id's end.
  if (state === "unlisted") return kind.charAt(0).toUpperCase() + kind.slice(1);
  if (state === "unnamed" || !name) return `Unnamed ${kind}`;
  return name;
}

/** "abc…1234": the last characters of an id, as a disambiguator. */
export const shortId = (id: string) => (id.length > 6 ? id.slice(-6) : id);

/**
 * Lookup result → state: the lookup's id column is null when the entity is
 * not in the entity table any more (deleted); present without a name is
 * unnamed.
 */
export function nameState(lookupId: unknown, name: unknown): NameState {
  // Without classic tables a missing name proves nothing (Smartscape may not carry that kind):
  // never "deleted", just the kind and the id.
  if (entityMode() !== "classic") return typeof lookupId === "string" && lookupId && typeof name === "string" && name ? "ok" : "unlisted";
  if (typeof lookupId !== "string" || !lookupId) return "deleted";
  return typeof name === "string" && name ? "ok" : "unnamed";
}

/** Adds a disambiguator to names that appear more than once in a list. */
export function disambiguate<T extends { name: string; entityId?: string; disambiguator?: string }>(items: T[]): T[] {
  const counts = new Map<string, number>();
  for (const i of items) counts.set(i.name, (counts.get(i.name) ?? 0) + 1);
  return items.map((i) =>
    (counts.get(i.name) ?? 0) > 1 ? { ...i, name: `${i.name} (${i.disambiguator ?? (i.entityId ? shortId(i.entityId) : "")})` } : i,
  );
}

const COPY_KEY = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent) ? "Cmd+C" : "Ctrl+C";

export function CopyId({ id }: { id: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const copied = state !== "idle";
  const flash = (next: "copied" | "failed") => {
    setState(next);
    window.setTimeout(() => setState("idle"), 1800);
  };
  /** No clipboard API, or it was refused: select the ID text beside the button so Ctrl/Cmd+C copies it. */
  const fallback = (button: HTMLButtonElement) => {
    const idText = button.previousElementSibling;
    const sel = window.getSelection();
    if (idText && sel) {
      const range = document.createRange();
      range.selectNodeContents(idText);
      sel.removeAllRanges();
      sel.addRange(range);
    }
    flash("failed");
  };
  return (
    <button
      type="button"
      className="lc-btn lc-copy"
      data-copied={copied}
      aria-label={`Copy ID ${id}`}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        // The event's target is released once the handler returns: keep the button.
        const button = e.currentTarget;
        // A clipboard call that never answers (permission prompt in a locked-down
        // browser) must not leave the button silent: fall back after 800 ms.
        if (navigator.clipboard?.writeText) {
          const timeout = new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error("timeout")), 800));
          Promise.race([navigator.clipboard.writeText(id), timeout])
            .then(() => flash("copied"))
            .catch(() => fallback(button));
        } else fallback(button);
      }}
      style={{
        ...type.label,
        textTransform: "none",
        letterSpacing: 0,
        height: 24,
        padding: "0 8px",
        border: `1px solid ${color.line}`,
        borderRadius: radius.chip,
        background: "transparent",
        color: state === "failed" ? color.signal : color.textTertiary,
        whiteSpace: "nowrap",
      }}
      aria-live="polite"
    >
      {state === "copied" ? "Copied" : state === "failed" ? `Selected, press ${COPY_KEY}` : "Copy ID"}
    </button>
  );
}

/** The second line under an entity name: full id, always visible, copyable. */
export function EntityIdLine({ id }: { id: string }) {
  return (
    <span style={{ display: "flex", alignItems: "center", gap: space[8], minWidth: 0 }}>
      <span style={{ ...type.mono, color: color.textTertiary, overflowWrap: "anywhere" }}>{id}</span>
      <CopyId id={id} />
    </span>
  );
}
