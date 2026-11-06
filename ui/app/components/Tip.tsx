import React, { useSyncExternalStore } from "react";

import { color, space, type } from "../design/tokens";
import { usePref, type PrefSpec } from "../data/prefs";

/**
 * One contextual tip on a first visit:
 * shown next to what it explains, dismissed for good with "Got it", kept in the user's
 * Dynatrace app state (follows them across devices), and brought back from Help > Show
 * tips again. No tour.
 */
export const TIPS: PrefSpec<{ dismissed: string[] }> = {
  key: "tips",
  version: 1,
  defaults: { dismissed: [] },
  validate: (v) => {
    const d = (v as { dismissed?: unknown } | null)?.dismissed;
    return Array.isArray(d) && d.every((x) => typeof x === "string") ? { dismissed: d } : null;
  },
};

/**
 * One copy of the dismissed list for the whole app, so "Got it" hides the tip at once
 * (feedback within 100 ms) and Help > Show tips again brings it back wherever you are.
 * null until something changes it in this visit; then it wins over what was read.
 */
let live: Set<string> | null = null;
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const setLive = (next: Set<string>) => {
  live = next;
  listeners.forEach((l) => l());
};

export function useTip(id: string) {
  const tips = usePref(TIPS);
  const current = useSyncExternalStore(subscribe, () => live);
  const dismissed = current ?? new Set(tips.value.dismissed);
  // Hidden until the setting is read, so a returning user never sees it flash.
  const show = !tips.isLoading && !dismissed.has(id);
  return {
    show,
    dismiss: () => {
      const next = new Set([...dismissed, id]);
      setLive(next);
      void tips.save({ dismissed: [...next] }).catch(() => undefined);
    },
  };
}

/** Help > Show tips again: every tip shows again, now and on later visits. */
export function useShowTipsAgain() {
  const tips = usePref(TIPS);
  return () => {
    setLive(new Set());
    void tips.save({ dismissed: [] }).catch(() => undefined);
  };
}

/** The tip itself: one sentence and "Got it", inline in the text it sits in. */
export function Tip({ children, onDismiss }: { children: React.ReactNode; onDismiss: () => void }) {
  return (
    <span role="note" style={{ display: "flex", alignItems: "baseline", gap: space[12], flexWrap: "wrap", ...type.body, color: color.textPrimary }}>
      <span>
        <span style={{ fontWeight: 500 }}>Tip: </span>
        {children}
      </span>
      {/* Underlined, so it reads as something to click. */}
      <button type="button" className="lc-link" onClick={onDismiss} style={{ ...type.body, background: "transparent", border: 0, padding: 0, cursor: "pointer", color: color.textPrimary, textDecoration: "underline" }}>
        Got it
      </button>
    </span>
  );
}
