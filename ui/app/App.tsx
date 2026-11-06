import React, { useMemo, useState, type ReactNode } from "react";
import { NavigationType, useLocation, useNavigationType } from "react-router-dom";
import { Navigate, Route, Routes, useParams } from "react-router-dom";
import { GlobalStyles } from "./design/GlobalStyles";
import { space } from "./design/tokens";
import { Shell } from "./components/Shell";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { RefreshContext } from "./components/shared";
import { AmSetup } from "./pages/AmSetup";
import { Explorer } from "./pages/Explorer";
import { HostDetail } from "./pages/Hosts";
import { NotLinked } from "./pages/NotLinked";
import { Overview } from "./pages/Overview";
import { RateCardPage } from "./pages/RateCardPage";
import { Stacking } from "./pages/Stacking";
import { Usage } from "./pages/Usage";
import { Queries } from "./pages/Queries";
import { Glossary } from "./pages/Glossary";
import { Fixes } from "./pages/Fixes";
import { Spend } from "./pages/Spend";
import { Ownership } from "./pages/Ownership";
import { Reconcile } from "./pages/Reconcile";
import { Entities } from "./pages/Entities";
import { TeamBudgets } from "./pages/TeamBudgets";
import { Home } from "./pages/Home";
import { OLD_ROUTES, R } from "./routes";

/** Detail screens share the Overview's page margin. */
function Page({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  return (
    <main id="main" tabIndex={-1} key={pathname} className="lc-page lc-gutter" style={{ paddingTop: space[32], paddingBottom: space[48] }}>
      <ErrorBoundary page={pathname}>{children}</ErrorBoundary>
    </main>
  );
}

/**
 * Back restores the user's place: each history entry
 * remembers its scroll position, Back and Forward return to it, and moving to a
 * new screen starts at the top. Kept in memory for the visit only.
 */
const scrollByEntry = new Map<string, number>();
function ScrollMemory() {
  const location = useLocation();
  const navType = useNavigationType();
  React.useEffect(() => {
    const key = location.key;
    if (navType === NavigationType.Pop && scrollByEntry.has(key)) {
      const y = scrollByEntry.get(key) ?? 0;
      // The screen redraws from cache over a few frames: keep trying until it is tall enough (at most 2 s).
      const started = Date.now();
      const tryRestore = () => {
        window.scrollTo(0, y);
        if (Math.abs(window.scrollY - y) > 2 && Date.now() - started < 2000) setTimeout(tryRestore, 100);
      };
      requestAnimationFrame(tryRestore);
    } else if (navType === NavigationType.Push) window.scrollTo(0, 0);
    const save = () => scrollByEntry.set(key, window.scrollY);
    window.addEventListener("scroll", save, { passive: true });
    // No save on the way out: by then the next screen has drawn and the browser has clamped the scroll.
    return () => window.removeEventListener("scroll", save);
  }, [location.key, navType]);
  return null;
}

/** Sends an old or unknown path to its new home, keeping the query string (timeframe, filters). */
function Redirect({ to }: { to: string }) {
  const params = useParams();
  const { search } = useLocation();
  const target = to.replace(/:(\w+)/g, (_, k: string) => encodeURIComponent(params[k] ?? ""));
  return <Navigate to={`${target}${search}`} replace />;
}

export const App = () => {
  const [token, setToken] = useState(0);
  const refresh = useMemo(() => ({ token, refresh: () => setToken((t) => t + 1) }), [token]);
  return (
    <RefreshContext.Provider value={refresh}>
      <GlobalStyles />
      <ScrollMemory />
      <Shell>
        <Routes>
          {/* Home: the four answers */}
          <Route path={R.home} element={<Page><Home /></Page>} />
          {/* Consumption: units */}
          <Route path={R.overview} element={<ErrorBoundary page="the Overview"><Overview /></ErrorBoundary>} />
          <Route path={R.notLinked} element={<Page><NotLinked /></Page>} />
          <Route path={R.usage} element={<Page><Usage /></Page>} />
          <Route path="/consumption/entities/hosts/:hostId" element={<Page><HostDetail /></Page>} />
          <Route path="/consumption/entities/:type" element={<Page><Entities /></Page>} />
          <Route path={R.ownership} element={<Page><Ownership /></Page>} />
          {/* Cost: money */}
          <Route path={R.spend} element={<Page><Spend /></Page>} />
          <Route path={R.perHost} element={<Page><Stacking /></Page>} />
          <Route path={R.fixes} element={<Page><Fixes /></Page>} />
          <Route path={R.budgets} element={<Page><TeamBudgets /></Page>} />
          <Route path={R.reconcile} element={<Page><Reconcile /></Page>} />
          {/* Shared */}
          <Route path={R.rates} element={<Page><RateCardPage /></Page>} />
          <Route path={R.amSetup} element={<Page><AmSetup /></Page>} />
          <Route path={R.queries} element={<Page><Queries /></Page>} />
          <Route path={R.glossary} element={<Page><Glossary /></Page>} />
          <Route path={R.diagnostics} element={<Page><Explorer /></Page>} />
          {/* Old routes (before v0.10.0) keep working */}
          {OLD_ROUTES.map(([from, to]) => (
            <Route key={from} path={from} element={<Redirect to={to} />} />
          ))}
          <Route path="*" element={<Redirect to={R.home} />} />
        </Routes>
      </Shell>
    </RefreshContext.Provider>
  );
};
