import React, { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { color, layout, radius, size, space, type } from "../design/tokens";
import { Dropdown, Segmented } from "../design/primitives";
import { type FilterDef, useFilters } from "./Filters";

/**
 * filters"): a single row directly above the content it controls.
 *
 *   [Group by  Host | Host group | Mode]            [Search…] [Filter · 2]
 *   Monitoring mode: Full-Stack ×   Clear all        ← only when filters are on
 *
 * - Left: Group by, inline label, as a segmented control. When the row is too
 *   narrow it becomes a "Group by: Host" dropdown instead of wrapping.
 * - Right: the screen's search field, then one Filter button. Every other
 *   filter lives in its popover, each option with how many items it matches.
 * - Chips appear on their own line only when a filter is on, with Clear all.
 * - Everything is in the URL (see useFilters and useGroupBy).
 */
export type Filters = ReturnType<typeof useFilters>;

export function Toolbar<K extends string>({
  group,
  defs,
  f,
  counts,
  trailing,
}: {
  group?: { value: K; onChange: (k: K) => void; options: { value: K; label: string }[] };
  defs: FilterDef[];
  f: Filters;
  /** How many items each option would match: counts[filterKey][optionValue]. */
  counts?: Record<string, Record<string, number>>;
  /** Anything else that belongs in the row (rare). */
  trailing?: ReactNode;
}) {
  const row = useRef<HTMLDivElement>(null);
  // Collapse Group by to a dropdown below the width at which the row overflowed.
  const [collapseBelow, setCollapseBelow] = useState<number | null>(null);
  const [width, setWidth] = useState<number>(0);
  useEffect(() => {
    const el = row.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const compact = collapseBelow !== null && width < collapseBelow;
  useLayoutEffect(() => {
    const el = row.current;
    if (!el || compact || !group) return;
    // The width the two halves need side by side. Not scrollWidth: an (i) button's enlarged
    // hit area reaches 8 px past the edge and read as overflow, collapsing Queries at 1440 px.
    const need = [...el.children].reduce((a, c) => a + (c as HTMLElement).offsetWidth, 0) + space[12];
    if (need > el.clientWidth + 1) setCollapseBelow(need + 1);
  }, [width, compact, group]);

  const search = defs.find((d) => d.kind === "search");
  const selects = defs.filter((d): d is Extract<FilterDef, { kind: "select" }> => d.kind === "select");
  const activeSelects = selects.filter((d) => f.values[d.key]).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: space[8] }}>
      <div
        ref={row}
        role="toolbar"
        aria-label="Group and filter"
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: space[12], minWidth: 0, flexWrap: "nowrap" }}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: space[8], flex: "none" }}>
          {group &&
            (compact ? (
              <GroupDropdown {...group} />
            ) : (
              <>
                <span style={{ ...type.body, color: color.textSecondary }}>Group by</span>
                <Segmented<K> label="Group by" value={group.value} onChange={group.onChange} options={group.options} />
              </>
            ))}
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: space[8], minWidth: 0, flex: "0 1 auto" }}>
          {search && (
            <input
              type="search"
              className="lc-input"
              aria-label={search.label}
              placeholder={`Search ${search.label.toLowerCase()}`}
              value={f.values[search.key] ?? ""}
              onChange={(e) => f.set(search.key, e.target.value.trim() ? e.target.value : null)}
              style={{
                ...type.body,
                fontFamily: "inherit",
                height: size.control,
                width: 240,
                minWidth: 120,
                flex: "0 1 240px",
                boxSizing: "border-box",
                padding: `0 ${space[12]}px`,
                border: `1px solid ${color.lineStrong}`,
                borderRadius: radius.control,
                background: color.surface1,
                color: color.textPrimary,
              }}
            />
          )}
          {selects.length > 0 && <FilterButton defs={selects} f={f} counts={counts} active={activeSelects} />}
          {trailing}
        </span>
      </div>
      <Chips defs={defs} f={f} />
    </div>
  );
}

function GroupDropdown<K extends string>({ value, onChange, options }: { value: K; onChange: (k: K) => void; options: { value: K; label: string }[] }) {
  const id = useId();
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: space[8] }}>
      <label htmlFor={id} style={{ ...type.body, color: color.textSecondary }}>
        Group by
      </label>
      <Dropdown id={id} value={value} onChange={(v) => onChange(v as K)} options={options} />
    </span>
  );
}

type SelectDef = Extract<FilterDef, { kind: "select" }>;
const isMulti = (d: SelectDef) => !d.single && d.options.length > 2;

function FilterButton({ defs, f, counts, active }: { defs: SelectDef[]; f: Filters; counts?: Record<string, Record<string, number>>; active: number }) {
  const [open, setOpen] = useState(false);
  const [maxH, setMaxH] = useState<number>(layout.popoverMaxHeight);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    // Fit the room below the button,
    // never shorter than about six options; if even that doesn't fit, bring it into view.
    const below = window.innerHeight - (button.current?.getBoundingClientRect().bottom ?? 0) - space[8] - space[16];
    setMaxH(Math.max(240, Math.min(layout.popoverMaxHeight, below)));
    requestAnimationFrame(() => panel.current?.scrollIntoView({ block: "nearest" }));
    panel.current?.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true });
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

  return (
    <span style={{ position: "relative", flex: "none" }}>
      <button
        ref={button}
        type="button"
        className="lc-btn"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
        style={{
          ...type.body,
          fontFamily: "inherit",
          fontWeight: 500,
          height: size.control,
          padding: `0 ${space[16]}px`,
          border: 0,
          borderRadius: radius.control,
          background: color.surface2,
          color: color.textPrimary,
          whiteSpace: "nowrap",
          minWidth: 96,
          justifyContent: "center",
        }}
      >
        {active > 0 ? `Filter (${active})` : "Filter"}
      </button>
      {open && (
        <div
          ref={panel}
          id={id}
          role="dialog"
          aria-label="Filters"
          className="lc-panel"
          style={{
            position: "absolute",
            top: size.control + space[8],
            right: 0,
            zIndex: 20,
            width: layout.popover,
            maxHeight: maxH,
            overflowY: "auto",
            boxSizing: "border-box",
            padding: space[16],
            display: "flex",
            flexDirection: "column",
            gap: space[16],
            borderRadius: radius.surface,
            border: `1px solid ${color.lineStrong}`,
            background: color.surface1,
          }}
        >
          {defs.map((d) => (
            <FilterGroup key={d.key} d={d} f={f} counts={counts?.[d.key]} />
          ))}
        </div>
      )}
    </span>
  );
}

/**
 * Several values (checkboxes) or one of two (radios). Nothing ticked means no
 * filter; ticking every option is the same as nothing ticked, so "All" turns on.
 */
function FilterGroup({ d, f, counts }: { d: SelectDef; f: Filters; counts?: Record<string, number> }) {
  const multi = isMulti(d);
  const picked = multi ? f.lists[d.key] ?? [] : f.values[d.key] ? [f.values[d.key]] : [];
  const all = picked.length === 0;
  // With counts supplied, an option nothing matches says 0 rather than nothing.
  const count = (v: string) => (counts ? counts[v] ?? 0 : null);
  const toggle = (v: string) => {
    if (!multi) return f.set(d.key, v);
    const next = picked.includes(v) ? picked.filter((x) => x !== v) : [...picked, v];
    f.setList(d.key, next.length === d.options.length ? [] : next);
  };
  const line = { display: "flex", alignItems: "center", gap: space[8], minHeight: size.chip, cursor: "pointer", accentColor: color.accent, ...type.body } as const;
  return (
    <fieldset style={{ border: 0, margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: space[4] }}>
      <legend style={{ ...type.label, color: color.textSecondary, padding: 0, marginBottom: space[4] }}>{d.label}</legend>
      <label style={line}>
        <input type={multi ? "checkbox" : "radio"} name={d.key} checked={all} onChange={() => (multi ? f.setList(d.key, []) : f.set(d.key, null))} />
        {multi ? "All" : "Any"}
      </label>
      {d.options.map((o) => (
        <label key={o.value} style={line}>
          <input type={multi ? "checkbox" : "radio"} name={d.key} checked={!all && picked.includes(o.value)} onChange={() => toggle(o.value)} />
          {/* An option nothing matches stays listed but recedes, so the list doesn't change shape as counts change. */}
          <span style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere", color: count(o.value) === 0 && !picked.includes(o.value) ? color.textTertiary : undefined }}>{o.label}</span>
          {count(o.value) !== null && <span style={{ color: color.textTertiary, fontVariantNumeric: "tabular-nums" }}>{count(o.value)}</span>}
        </label>
      ))}
    </fieldset>
  );
}

function Chips({ defs, f }: { defs: FilterDef[]; f: Filters }) {
  const active = defs.filter((d) => f.values[d.key]);
  if (active.length === 0) return null;
  const text = (d: FilterDef) => {
    if (d.kind === "search") return `${d.label}: "${f.values[d.key]}"`;
    const picked = isMulti(d) ? f.lists[d.key] ?? [] : [f.values[d.key]];
    return `${d.label}: ${picked.map((v) => d.options.find((o) => o.value === v)?.label ?? v).join(", ")}`;
  };
  return (
    <div role="list" aria-label="Active filters" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: space[8] }}>
      {active.map((d) => (
        <span
          role="listitem"
          key={d.key}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: space[4],
            height: size.chip,
            padding: `0 ${space[4]}px 0 ${space[12]}px`,
            borderRadius: radius.chip,
            background: color.surface2,
            ...type.body,
          }}
        >
          {text(d)}
          <button
            type="button"
            className="lc-btn"
            aria-label={`Remove filter ${text(d)}`}
            onClick={() => (d.kind === "select" && isMulti(d) ? f.setList(d.key, []) : f.set(d.key, null))}
            style={{ ...type.body, width: size.chipSmall, height: size.chipSmall, border: 0, borderRadius: radius.chip - space[4], background: "transparent", color: color.textSecondary }}
          >
            ×
          </button>
        </span>
      ))}
      <button
        type="button"
        className="lc-link"
        onClick={f.clear}
        style={{ ...type.body, border: 0, background: "transparent", color: color.textPrimary, cursor: "pointer", textDecoration: "underline" }}
      >
        Clear all
      </button>
    </div>
  );
}

/** counts[filterKey][optionValue] from the full, unfiltered list. */
export function countOptions<T>(items: T[], by: Record<string, (item: T) => string | null | undefined>): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const [key, fn] of Object.entries(by)) {
    const m: Record<string, number> = {};
    for (const it of items) {
      const v = fn(it);
      if (v === null || v === undefined) continue;
      m[v] = (m[v] ?? 0) + 1;
    }
    out[key] = m;
  }
  return out;
}
