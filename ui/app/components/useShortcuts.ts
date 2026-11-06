import { useEffect, useSyncExternalStore } from "react";
import { useNavigate } from "react-router-dom";

import { R } from "../routes";
import { usePref, type PrefSpec } from "../data/prefs";

/**
 * rule 8): six, no more. Two-key "g" chords for the five places people go most,
 * and "/" for the search box on the screen. The same six are declared in
 * app.config.json (uiCommands) so Dynatrace lists them in its "?" dialog.
 *
 * Never fires while typing: anything with focus in a text field, select or
 * editable area is left alone (rule 9). Modifier combinations are left to the
 * platform, whose own bindings are not documented, so nothing here collides.
 *
 * They are single character keys, so Help has an on/off switch, kept in the user's
 * app state: speech-input
 * and screen-reader users can turn them off.
 */
export const SHORTCUTS: { keys: string; label: string; to?: string }[] = [
  { keys: "g h", label: "Go to Home", to: R.home },
  { keys: "g o", label: "Go to the Overview", to: R.overview },
  { keys: "g e", label: "Go to Entities", to: R.entities("hosts") },
  { keys: "g s", label: "Go to Spend", to: R.spend },
  { keys: "g f", label: "Go to Findings", to: R.fixes },
  { keys: "/", label: "Search the list on this screen" },
];

const CHORD_MS = 1000;

const typing = (el: Element | null) =>
  !!el && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement || (el as HTMLElement).isContentEditable);

export const SHORTCUT_PREF: PrefSpec<{ on: boolean }> = {
  key: "shortcuts",
  version: 1,
  defaults: { on: true },
  validate: (v) => (typeof (v as { on?: unknown } | null)?.on === "boolean" ? { on: (v as { on: boolean }).on } : null),
};

/** One live copy, so the switch takes effect at once wherever the menu is used. */
let live: boolean | null = null;
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** Help > Keyboard shortcuts: on or off. */
export function useShortcutsSwitch() {
  const pref = usePref(SHORTCUT_PREF);
  const current = useSyncExternalStore(subscribe, () => live);
  const on = current ?? pref.value.on;
  return {
    on,
    toggle: () => {
      live = !on;
      listeners.forEach((l) => l());
      void pref.save({ on: !on }).catch(() => undefined);
    },
  };
}

export function useShortcuts(href: (path: string) => string) {
  const navigate = useNavigate();
  const { on } = useShortcutsSwitch();
  useEffect(() => {
    if (!on) return;
    let pending: number | null = null;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || typing(document.activeElement)) return;
      if (e.key === "/") {
        const box = document.querySelector<HTMLInputElement>("input[type=search]");
        if (box) {
          e.preventDefault();
          box.focus();
          box.select();
        }
        return;
      }
      if (pending !== null) {
        window.clearTimeout(pending);
        pending = null;
        const hit = SHORTCUTS.find((s) => s.keys === `g ${e.key.toLowerCase()}`);
        if (hit?.to) {
          e.preventDefault();
          navigate(href(hit.to));
        }
        return;
      }
      if (e.key.toLowerCase() === "g") pending = window.setTimeout(() => (pending = null), CHORD_MS);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [navigate, href, on]);
}
