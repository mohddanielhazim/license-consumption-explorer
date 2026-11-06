import { useEffect } from "react";
import { getTheme } from "@dynatrace-sdk/user-preferences";

/**
 * Keeps <html data-theme> in step with the user's Dynatrace theme while the
 * app is open. Strato's AppRoot reads getTheme() once at mount (useMemo), so
 * a theme switch after the app opened was ignored until reload. This re-reads
 * the same source when the colour scheme changes, when the tab regains focus
 * or becomes visible, and every 2 seconds (a local call, no network).
 * If the preference is neither "light" nor "dark", it follows the system.
 */
export function useLiveTheme() {
  useEffect(() => {
    const scheme = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      let pref: string | undefined;
      try {
        pref = getTheme();
      } catch {
        pref = undefined;
      }
      const theme = pref === "light" || pref === "dark" ? pref : scheme.matches ? "dark" : "light";
      if (document.documentElement.getAttribute("data-theme") !== theme) {
        document.documentElement.setAttribute("data-theme", theme);
      }
    };
    apply();
    scheme.addEventListener("change", apply);
    window.addEventListener("focus", apply);
    document.addEventListener("visibilitychange", apply);
    const timer = window.setInterval(apply, 2000);
    return () => {
      scheme.removeEventListener("change", apply);
      window.removeEventListener("focus", apply);
      document.removeEventListener("visibilitychange", apply);
      window.clearInterval(timer);
    };
  }, []);
}
