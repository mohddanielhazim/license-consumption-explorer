import { useSearchParams } from "react-router-dom";

/**
 * Filter bars on list screens only: at most 4 filters,
 * active filters as removable chips, Clear all, values kept in the URL as
 * f.<key>=<value>. Drawn by the one-row Toolbar (components/Toolbar.tsx).
 *
 * v0.12.7: dropdown filters take several values (Logs and Events), kept in the
 * URL as repeated f.<key> parameters. Filters with two options (yes/no,
 * web/mobile) stay single: both picked would mean no filter. Pages test a
 * value with `f.pick(key, v)`.
 *
 * v0.12.11: every screen opens with its filters empty (nothing ticked = no filter,
 * everything shown). Ticking every option ticks "Select all" and still shows
 * everything; unticking all returns to no filter. Filters are not remembered
 * between visits: links carry only the timeframe.
 */
export type FilterDef =
  | { key: string; label: string; kind: "search" }
  | { key: string; label: string; kind: "select"; options: { value: string; label: string }[]; single?: boolean };

/** The filter row was replaced by the one-row Toolbar (components/Toolbar.tsx) in v0.12.12. */

/** Several values only where it means something: two options (yes/no, web/mobile) picked together would be no filter. */
const isMulti = (d: FilterDef) => d.kind === "select" && !d.single && d.options.length > 2;

export function useFilters(defs: FilterDef[]) {
  const [params, setParams] = useSearchParams();
  const values: Record<string, string> = {};
  const lists: Record<string, string[]> = {};
  for (const d of defs) {
    if (isMulti(d)) {
      const all = params.getAll(`f.${d.key}`).filter(Boolean);
      if (all.length) {
        lists[d.key] = all;
        values[d.key] = all.join(", ");
      }
    } else {
      const v = params.get(`f.${d.key}`);
      if (v) values[d.key] = v;
    }
  }
  // History: choosing a filter is a step Back can undo; each
  // keystroke in a search box only updates the current entry.
  const isSearch = (key: string) => defs.find((d) => d.key === key)?.kind === "search";
  const set = (key: string, value: string | null) => {
    const p = new URLSearchParams(params);
    p.delete(`f.${key}`);
    if (value) p.set(`f.${key}`, value);
    // A search pushes once when it starts (empty → typed) and then replaces while typing,
    // so Back returns to just before the search, not one step further.
    setParams(p, { replace: isSearch(key) && Boolean(params.get(`f.${key}`)) });
  };
  const setList = (key: string, list: string[]) => {
    const p = new URLSearchParams(params);
    p.delete(`f.${key}`);
    // Exactly what is ticked; nothing ticked is no filter.
    for (const v of list) p.append(`f.${key}`, v);
    setParams(p);
  };
  const clear = () => {
    const p = new URLSearchParams(params);
    for (const d of defs) p.delete(`f.${d.key}`);
    setParams(p);
  };
  /** True when nothing is picked for this filter, or `value` is one of the picks. */
  const pick = (key: string, value: string | null | undefined) => {
    const l = lists[key] ?? (values[key] ? [values[key]] : []);
    return l.length === 0 || (value !== null && value !== undefined && l.includes(value));
  };
  return { values, lists, set, setList, clear, pick };
}

/** Case-insensitive "contains" for search filters. */
export const matches = (text: string, needle: string | undefined) =>
  !needle || text.toLowerCase().includes(needle.toLowerCase());
