import React from "react";

import { color } from "../design/tokens";
import { formatQuantity } from "../rates";
import { stillArriving } from "../data/math";
import { dayShiftMinutes, formatDay } from "../locale";
import { BarTip, useBarHover } from "./BarHover";

/**
 * A small daily bar preview: no axes or gridlines,
 * the peak in the strong colour, days still arriving in outline, an instant
 * value on hover and the same values in a hidden table for keyboard and
 * screen-reader users.
 */
export function MiniBars({ days, values, unit, label, height = 40, partialFirst = false }: { days: string[]; values: (number | null)[]; unit: string; label: string; height?: number; partialFirst?: boolean }) {
  const hover = useBarHover(days.length);
  const max = Math.max(0, ...values.map((v) => v ?? 0));
  const peak = values.reduce<number>((best, v, i) => ((v ?? -1) > (values[best] ?? -1) ? i : best), 0);
  const shift = dayShiftMinutes();
  const hv = hover.index === null ? undefined : values[hover.index];
  return (
    <span style={{ display: "block", minWidth: 0 }}>
      <span role="img" aria-label={`${label}: usage per day`} {...hover.handlers} style={{ position: "relative", display: "flex", alignItems: "flex-end", gap: 2, height }}>
        {hover.index !== null && (
          <BarTip index={hover.index} count={days.length}>
            {formatDay(days[hover.index])}: {hv === null || hv === undefined ? "no records" : `${formatQuantity(hv)} ${unit}`}
            {partialFirst && hover.index === 0 ? " (part of a day)" : stillArriving(days[hover.index], Date.now(), shift) ? " (still arriving)" : ""}
          </BarTip>
        )}
        {values.map((v, i) => {
          const arriving = stillArriving(days[i], Date.now(), shift) || (partialFirst && i === 0);
          const h = v === null || max === 0 ? 0 : Math.max((v / max) * 100, v > 0 ? 6 : 0);
          return (
            <span
              key={days[i]}
              style={{
                flex: 1,
                height: `${h}%`,
                minHeight: v ? 1 : 0,
                boxSizing: "border-box",
                borderRadius: 1,
                background: arriving ? "transparent" : i === peak && max > 0 ? color.textPrimary : i === hover.index ? color.textSecondary : color.lineStrong,
                border: arriving && v !== null ? `1px solid ${color.lineStrong}` : "none",
              }}
            />
          );
        })}
      </span>
      <span className="lc-visually-hidden">
      <table>
        <caption>{label}: usage per day</caption>
        <tbody>
          {days.map((d, i) => (
            <tr key={d}>
              <th scope="row">{formatDay(d)}</th>
              <td>{values[i] === null ? "no records" : `${formatQuantity(values[i] ?? 0)} ${unit}`}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </span>
    </span>
  );
}
