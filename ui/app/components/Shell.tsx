import React, { useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { getAppVersion, getEnvironmentId } from "@dynatrace-sdk/app-environment";

import { color, layout, radius, size, space, type, motion } from "../design/tokens";
import { Card, SecondaryButton } from "../design/primitives";
import { R, WORKSPACE_HOME, sectionFor, workspaceOf, type Workspace } from "../routes";
import { PAGE_GUIDES } from "./pageGuides";
import { PageGuide } from "./Info";
import { trackPath, RefreshContext, TimeframeBar, useAnyUpdating, useAppHref } from "./shared";
import { useShortcuts, useShortcutsSwitch } from "./useShortcuts";
import { usePermissions } from "../data/permissions";
import { useLiveTheme } from "../design/useLiveTheme";
import { MSG, SOURCE_OF_TRUTH } from "../strings";
import { useShowTipsAgain } from "./Tip";

/** The app icon, from design/icon/license-consumption-icon-v2.svg, drawn with theme tokens. */
function AppMark() {
  return (
    <svg width="24" height="24" viewBox="0 0 512 512" aria-hidden="true">
      <rect width="512" height="512" rx="116" style={{ fill: color.surface1 }} />
      <rect x="96" y="120" width="320" height="72" rx="18" style={{ fill: color.textPrimary }} />
      <rect x="140" y="220" width="232" height="72" rx="18" style={{ fill: color.textPrimary }} />
      <rect x="194" y="330" width="124" height="52" rx="14" style={{ fill: "none", stroke: color.textTertiary }} strokeWidth="20" />
      <rect x="392" y="318" width="48" height="48" rx="10" style={{ fill: color.signal }} />
    </svg>
  );
}

/**
 * One navigation link, shown as a tab: an underline marks where you are. Used for the
 * three destinations in the top bar and for a section's screens in the row below it.
 */
function TabLink({ to, end, match, children, tall }: { to: string; end?: boolean; match?: string; children: ReactNode; tall?: boolean }) {
  const href = useAppHref();
  const { pathname } = useLocation();
  // `match` also marks the tab current on its sub-screens (Entities and its types; the
  // Overview's Not linked list), so you always see which tab you are in.
  const forced = match && (pathname === match || pathname.startsWith(`${match}/`)) ? true : undefined;
  return (
    <NavLink
      to={href(to)}
      end={end}
      className="lc-tab"
      aria-current={forced ? "page" : undefined}
      style={({ isActive: active }) => {
        const on = forced ?? active;
        return {
          display: "inline-flex",
          alignItems: "center",
          height: tall ? layout.appBar : layout.subNav,
          boxSizing: "border-box",
          borderBottom: `2px solid ${on ? color.accent : "transparent"}`,
          ...type.body,
          fontWeight: on ? 500 : 400,
          color: on ? color.accent : color.textSecondary,
          textDecoration: "none",
          whiteSpace: "nowrap",
        };
      }}
    >
      {children}
    </NavLink>
  );
}

const SECTION_TABS: Record<Workspace, { to: string; label: string; end?: boolean; match?: string }[]> = {
  consumption: [
    { to: R.overview, label: "Overview", end: true, match: R.notLinked },
    { to: R.usage, label: "Usage" },
    { to: R.entities("hosts"), label: "Entities", match: "/consumption/entities" },
    // Queries before Ownership: it answers "what drives usage", like Entities; Ownership is setup work.
    { to: R.queries, label: "Queries" },
    { to: R.ownership, label: "Ownership" },
  ],
  cost: [
    { to: R.spend, label: "Spend", end: true },
    { to: R.perHost, label: "Cost per host" },
    { to: R.fixes, label: "Findings" },
    { to: R.budgets, label: "Team budgets" },
    { to: R.rates, label: "Rate card", match: R.rates },
  ],
};

/**
 * Help (top right): the Glossary with the keyboard shortcuts, the one note on where the
 * figures come from, Diagnostics, and the environment. A menu, so it costs the screen nothing.
 */
function HelpMenu({ envId, quiet }: { envId: string | null; quiet: React.CSSProperties }) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  const href = useAppHref();
  const navigate = useNavigate();
  const showTipsAgain = useShowTipsAgain();
  const shortcuts = useShortcutsSwitch();
  const appVersion = (() => {
    try {
      return getAppVersion();
    } catch {
      return null;
    }
  })();
  const { pathname } = useLocation();
  // Following a link closes the menu.
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLElement>("a")?.focus();
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
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const item = { ...type.body, color: color.textPrimary, textDecoration: "none", padding: `${space[8]}px ${space[12]}px`, borderRadius: radius.control, display: "block" } as const;
  return (
    <span style={{ position: "relative", flex: "none" }}>
      <SecondaryButton ref={button} style={quiet} aria-expanded={open} aria-controls={id} aria-haspopup="true" onClick={() => setOpen(!open)}>
        Help
      </SecondaryButton>
      {open && (
        <div
          ref={panel}
          id={id}
          role="dialog"
          aria-label="Help"
          className="lc-panel"
          style={{
            position: "absolute",
            top: size.control + space[8],
            right: 0,
            zIndex: 20,
            width: layout.popover,
            boxSizing: "border-box",
            padding: space[8],
            display: "flex",
            flexDirection: "column",
            gap: space[4],
            borderRadius: radius.surface,
            border: `1px solid ${color.lineStrong}`,
            background: color.surface1,
          }}
        >
          <Link to={href(R.glossary)} className="lc-nav" style={item}>
            Glossary and keyboard shortcuts
          </Link>
          <Link to={href(R.diagnostics)} className="lc-nav" style={item}>
            Diagnostics: check a figure against the raw records
          </Link>
          <button
            type="button"
            className="lc-nav"
            onClick={() => {
              // Clears the dismissed tips, then opens the Overview, where the tip lives.
              showTipsAgain();
              navigate(href(R.overview));
            }}
            style={{ ...item, border: 0, background: "transparent", textAlign: "left", cursor: "pointer", fontFamily: "inherit" }}
          >
            Show tips again
          </button>
          <button
            type="button"
            className="lc-nav"
            aria-pressed={shortcuts.on}
            onClick={shortcuts.toggle}
            style={{ ...item, border: 0, background: "transparent", textAlign: "left", cursor: "pointer", fontFamily: "inherit" }}
          >
            {shortcuts.on ? "Keyboard shortcuts: on" : "Keyboard shortcuts: off"}
          </button>
          <p style={{ margin: 0, padding: `${space[8]}px ${space[12]}px`, ...type.body, color: color.textSecondary, borderTop: `1px solid ${color.line}` }}>
            {SOURCE_OF_TRUTH}
          </p>
          {envId && (
            <span style={{ padding: `0 ${space[12]}px ${space[8]}px`, ...type.mono, color: color.textTertiary }}>
              Environment {envId}
            </span>
          )}
          {/* The installed version, so whoever updates the app can confirm it took (guide: "Update to a newer version"). */}
          {appVersion && (
            <span style={{ padding: `0 ${space[12]}px ${space[8]}px`, ...type.mono, color: color.textTertiary }}>
              Version {appVersion}
            </span>
          )}
        </div>
      )}
    </span>
  );
}

function environmentId(): string | null {
  try {
    return getEnvironmentId();
  } catch {
    return null;
  }
}

/** The last screen (with its filters) used in each workspace, so Consumption and Cost return you there. */
const lastInWorkspace = new Map<Workspace, string>();

/**
 * The frame (v0.12.32). Dynatrace's own navigation already runs down the left of every
 * app, so this app's three destinations sit in a slim bar across the top instead of a
 * docs/screenshots/evidence/). Under it, the section's screens as tabs, and the page.
 */
export function Shell({ children }: { children: ReactNode }) {
  useLiveTheme();
  const permissions = usePermissions();
  const { refresh } = useContext(RefreshContext);
  const forbidden = permissions.status === "known" && permissions.systemEvents === "false";
  const partialAccess = permissions.status === "known" && permissions.systemEvents === "condition";
  const location = useLocation();
  const navigate = useNavigate();
  const href = useAppHref();
  const section = sectionFor(location.pathname);
  const pageGuide = useMemo(() => (PAGE_GUIDES[section] ? { label: `${section}: what this screen is for`, guide: PAGE_GUIDES[section] } : null), [section]);
  // Remembers the previous screen for the "‹ Parent" links (shared.tsx Crumbs).
  trackPath(location.pathname);
  const showTimeframe = !([R.rates, R.glossary, R.amSetup, R.reconcile] as string[]).includes(location.pathname);
  const here = workspaceOf(location.pathname);
  if (here) lastInWorkspace.set(here, `${location.pathname}${location.search}`);
  // A short "Refreshed" beside the button: the data often looks identical after a refresh.
  const [refreshedAt, setRefreshedAt] = useState<number | null>(null);
  useEffect(() => {
    if (!refreshedAt) return;
    const t = window.setTimeout(() => setRefreshedAt(null), 2000);
    return () => window.clearTimeout(t);
  }, [refreshedAt]);
  const envId = environmentId();
  const updating = useAnyUpdating();
  useShortcuts(href);

  // The three places as one compact switch (v0.12.33): it reads as a different level from
  // the section's tabs below, which keep the underline.
  const place = (to: string, label: string, on: boolean, onClick?: (e: React.MouseEvent) => void) => (
    <NavLink
      key={label}
      to={href(to)}
      className="lc-seg"
      aria-current={on ? "page" : undefined}
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        height: size.segment,
        padding: `0 ${space[16]}px`,
        // Same as the Segmented switch: the selected fill alone is under 3:1, so it carries a border.
        border: `1px solid ${on ? color.accent : "transparent"}`,
        boxSizing: "border-box",
        borderRadius: radius.segment,
        background: on ? color.accentSoft : "transparent",
        ...type.body,
        fontWeight: on ? 500 : 400,
        color: on ? color.accent : color.textSecondary,
        textDecoration: "none",
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </NavLink>
  );
  const workspaceLink = (w: Workspace, label: string) =>
    place(WORKSPACE_HOME[w], label, here === w, (e) => {
      // Back to the screen last used in that section, with its filters.
      const last = lastInWorkspace.get(w);
      if (last && here !== w) {
        e.preventDefault();
        navigate(last);
      }
    });
  const quiet = { background: "transparent", color: color.textSecondary } as const;

  return (
    <div className={updating ? "lc-updating" : undefined} style={{ minHeight: "100vh", display: "flex", flexDirection: "column", background: color.bgBase, color: color.textPrimary }}>
      {/* Focus moves by script: the page's <base> makes a bare "#main" resolve to the
          app root, so following the link would open Home instead of skipping. */}
      <a
        href="#main"
        className="lc-skip"
        onClick={(e) => {
          e.preventDefault();
          const main = document.getElementById("main");
          if (main) {
            if (!main.hasAttribute("tabindex")) main.setAttribute("tabindex", "-1");
            main.focus();
          }
        }}
      >
        Skip to content
      </a>
      {/* Two quiet rows:
          1. the app and its three places, and Help: the same on every screen;
          2. this section's screens, with the timeframe and Refresh beside the content they change. */}
      <header style={{ position: "sticky", top: 0, zIndex: 3, background: color.bgBase }}>
        <div className="lc-gutter" style={{ display: "flex", alignItems: "center", gap: space[24], height: layout.appBar }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: space[12], flex: "none" }}>
            <AppMark />
            <span className="lc-brand" style={{ ...type.body, fontWeight: 500, whiteSpace: "nowrap" }}>
              License Consumption Explorer
            </span>
          </span>
          <nav aria-label="Main" style={{ display: "flex", alignItems: "center", gap: space[4], padding: size.trackPadding, borderRadius: radius.control, background: color.surface1, flex: "none" }}>
            {place(R.home, "Home", location.pathname === R.home)}
            {workspaceLink("consumption", "Consumption")}
            {workspaceLink("cost", "Cost")}
          </nav>
          <span style={{ flex: "1 1 auto" }} />
          <HelpMenu envId={envId} quiet={quiet} />
        </div>
        <div className="lc-gutter" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: space[24], height: layout.subNav, borderTop: `1px solid ${color.line}`, borderBottom: `1px solid ${color.line}` }}>
          <span style={{ display: "flex", alignItems: "center", gap: space[24], minWidth: 0 }}>
            {here ? (
              <nav aria-label={here === "consumption" ? "Consumption" : "Cost"} className="lc-tabrow" style={{ display: "flex", alignItems: "center", minWidth: 0, overflowX: "auto" }}>
                {SECTION_TABS[here].map((t) => (
                  <TabLink key={t.to} to={t.to} end={t.end} match={t.match}>
                    {t.label}
                  </TabLink>
                ))}
              </nav>
            ) : (
              <span style={{ ...type.body, fontWeight: 500 }}>{section}</span>
            )}
          </span>
          {showTimeframe && !forbidden && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: space[8], minWidth: 0 }}>
              <span role="status" aria-live="polite" className="lc-status" style={{ ...type.body, color: color.textTertiary, opacity: refreshedAt || updating ? 1 : 0, transition: `opacity ${motion.hover}ms ${motion.ease}` }}>
                {updating ? "Updating…" : refreshedAt ? "Refreshed" : ""}
              </span>
              <TimeframeBar />
              {/* No polling: data refreshes on load, on timeframe change and here. */}
              <SecondaryButton
                style={quiet}
                onClick={() => {
                  refresh();
                  setRefreshedAt(Date.now());
                }}
              >
                Refresh
              </SecondaryButton>
            </span>
          )}
        </div>
      </header>
      {partialAccess && (
        <div role="status" className="lc-gutter" style={{ paddingTop: space[16] }}>
          <Card style={{ display: "flex", flexDirection: "column", gap: space[4], padding: space[16] }}>
            <span style={{ ...type.heading }}>Some usage may be missing.</span>
            <span style={{ ...type.body, color: color.textSecondary }}>Your access covers only part of this environment.</span>
          </Card>
        </div>
      )}
      {forbidden ? (
        <main className="lc-gutter" style={{ paddingTop: space[48] }}>
          <Card style={{ display: "flex", flexDirection: "column", gap: space[12], maxWidth: layout.content }}>
            <span style={{ ...type.title }}>{MSG.noPermissionShort}</span>
            <span style={{ ...type.bodyLarge, color: color.textSecondary }}>{MSG.noPermissionNext}</span>
          </Card>
        </main>
      ) : (
        <PageGuide.Provider value={pageGuide}>{children}</PageGuide.Provider>
      )}
    </div>
  );
}
