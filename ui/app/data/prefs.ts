import { useCallback, useEffect, useState } from "react";
import { isNotFound, stateClient } from "@dynatrace-sdk/client-state";

/**
 * Per-user preferences in user app state, stored as { version, data }
 *. On read: validate, migrate older versions forward,
 * and fall back to the defaults on any failure. A missing key means defaults,
 * not an error. Read failures are reported so screens can say so, but never
 * block a screen.
 */
export type Stored = { version: number; data: unknown };

export type PrefSpec<T> = {
  key: string;
  version: number;
  defaults: T;
  /** Returns the value if `data` is valid for the current version, else null. */
  validate: (data: unknown) => T | null;
  /** Upgrades an older stored version; null when it cannot. */
  migrate?: (stored: Stored) => T | null;
  /** A pre-versioning key whose raw value can be migrated (read once). */
  legacyKey?: string;
};

function parseStored(raw: string): Stored | null {
  try {
    const v: unknown = JSON.parse(raw);
    if (typeof v === "object" && v !== null && "version" in v && "data" in v) {
      const s = v;
      if (typeof s.version === "number") return { version: s.version, data: s.data };
    }
    return { version: 0, data: v };
  } catch {
    return null;
  }
}

export function usePref<T>(spec: PrefSpec<T>) {
  const [value, setValue] = useState<T>(spec.defaults);
  const [isLoading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let live = true;
    const read = async (key: string) => {
      try {
        return (await stateClient.getUserAppState({ key })).value;
      } catch (e) {
        if (isNotFound(e)) return null;
        throw e;
      }
    };
    void (async () => {
      try {
        let raw = await read(spec.key);
        if (raw === null && spec.legacyKey) raw = await read(spec.legacyKey);
        if (raw === null) return;
        const stored = parseStored(raw);
        if (!stored) return;
        const v =
          stored.version === spec.version ? spec.validate(stored.data) : spec.migrate ? spec.migrate(stored) : null;
        if (live && v !== null) {
          setValue(v);
          setSaved(true);
        }
      } catch (e) {
        if (live) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => {
      live = false;
    };
    // The spec object is defined at module level; only its key matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec.key]);

  // A failed read leaves `value` at the defaults: saving then would overwrite what is stored.
  const readFailed = error !== null && !saved;
  const save = useCallback(
    async (next: T) => {
      if (readFailed) {
        throw new Error("Your saved settings couldn't be read, so saving now could overwrite them. Reload the app and try again.");
      }
      const body: Stored = { version: spec.version, data: next };
      await stateClient.setUserAppState({ key: spec.key, body: { value: JSON.stringify(body) } });
      setValue(next);
      setSaved(true);
      setError(null);
    },
    [spec.key, spec.version, readFailed],
  );

  return { value, saved, isLoading, error, readFailed, save };
}
