import React, { useState } from "react";
import { appLocale } from "../locale";
import { getEnvironmentId } from "@dynatrace-sdk/app-environment";

import { color, space, type } from "../design/tokens";
import { TextButton } from "../design/primitives";
import { usePeriod } from "./shared";

/**
 * "Download CSV" under a list (v0.12.7). The screen ranks; the file is for
 * handing the whole list to the people who know the hosts, so it carries every
 * row that matches the filters (never just the ten on screen) and the columns
 * a receiver needs to act. Built in the browser from data already loaded: no
 * extra query, no new permission.
 */
export type CsvColumn<T> = { header: string; value: (row: T) => string | number | boolean | null | undefined };

/** Text a spreadsheet would run as a formula (=, +, -, @, tab, CR) is prefixed with an apostrophe. */
function cell(v: string | number | boolean | null | undefined): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return Number.isFinite(v) ? String(Math.round(v * 1e6) / 1e6) : "";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  const s = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv<T>(columns: CsvColumn<T>[], rows: T[]): string {
  const lines = [columns.map((c) => cell(c.header)).join(","), ...rows.map((r) => columns.map((c) => cell(c.value(r))).join(","))];
  // Byte-order mark so Excel reads UTF-8 names correctly; CRLF line ends per RFC 4180.
  return `${String.fromCharCode(0xfeff)}${lines.join("\r\n")}\r\n`;
}

function envId(): string {
  try {
    return getEnvironmentId();
  } catch {
    return "environment";
  }
}

export function CsvDownload<T>({
  name,
  noun,
  columns,
  rows,
  filtered = true,
}: {
  /** File name stem, e.g. "hosts". */
  name: string;
  /** Plural noun for the button, e.g. "hosts". */
  noun: string;
  columns: CsvColumn<T>[];
  rows: T[];
  /** The screen has filters: say the file holds every matching row. Lists without filters say nothing. */
  filtered?: boolean;
}) {
  const period = usePeriod();
  const [note, setNote] = useState<string | null>(null);
  if (rows.length === 0) return null;
  const download = () => {
    const blob = new Blob([toCsv(columns, rows)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${name}-${envId()}-${period.fromIso.slice(0, 10)}-to-${period.toIso.slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    setNote(`${rows.length.toLocaleString(appLocale())} ${noun}: download started.`);
    setTimeout(() => setNote(null), 4000);
  };
  // Copy works even where the platform's security policy blocks a download.
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(toCsv(columns, rows));
      setNote(`${rows.length.toLocaleString(appLocale())} ${noun} copied as CSV.`);
    } catch {
      setNote("Copying isn't allowed here; use Download.");
    }
    setTimeout(() => setNote(null), 4000);
  };
  return (
    <span style={{ display: "flex", alignItems: "center", gap: space[12], flexWrap: "wrap", paddingLeft: space[4] }}>
      <TextButton onClick={download}>
        Download CSV ({rows.length.toLocaleString(appLocale())} {noun})
      </TextButton>
      <TextButton onClick={() => void copy()}>Copy CSV</TextButton>
      <span role="status" aria-live="polite" style={{ ...type.body, color: color.textTertiary }}>
        {note ?? (filtered ? "Every row that matches the filters, not only those on screen." : "")}
      </span>
    </span>
  );
}
