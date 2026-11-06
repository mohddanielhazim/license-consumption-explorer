import React from "react";
import { color, font, layout, paletteCss, motion, radius, space } from "./tokens";
import { STRATO_OVERRIDES } from "./strato-overrides";

/**
 * Fonts are bundled in ui/assets/fonts (SIL Open Font License 1.1, licence
 * files alongside), so no viewer's browser calls Google. Paths resolve
 * against the page's <base href="/ui/">.
 *
 * Hover states use token colours only: the mockup's off-token hovers
 * (#121214, #161618, #FFFFFF) are replaced by surface/1 and text/primary.
 */
const CSS = `
@font-face {
  font-family: 'Instrument Sans';
  src: url('assets/fonts/InstrumentSans-latin-400-600.woff2') format('woff2');
  font-weight: 400 600;
  font-style: normal;
  font-display: swap;
}
@font-face {
  font-family: 'JetBrains Mono';
  src: url('assets/fonts/JetBrainsMono-latin-400.woff2') format('woff2');
  font-weight: 400;
  font-style: normal;
  font-display: swap;
}
/* Theme: Strato's AppRoot writes the user's Dynatrace theme to <html data-theme>. */
:root, html[data-theme="dark"] {
${paletteCss("dark")}
  color-scheme: dark;
}
html[data-theme="light"] {
${paletteCss("light")}
  color-scheme: light;
}
html body {
${STRATO_OVERRIDES}
  margin: 0;
  background: ${color.bgBase};
  color: ${color.textPrimary};
  font-family: ${font.sans};
  font-variant-numeric: tabular-nums;
}
.lc-step { transition: background-color ${motion.hover}ms ${motion.ease}, border-color ${motion.hover}ms ${motion.ease}; }
.lc-step[data-selectable="true"]:hover { background-color: ${color.surface1}; }
.lc-nav { transition: background-color ${motion.hover}ms ${motion.ease}, color ${motion.hover}ms ${motion.ease}; }
.lc-nav:hover { background-color: ${color.surface1}; color: ${color.textPrimary}; }
.lc-btn { transition: opacity ${motion.hover}ms ${motion.ease}, transform ${motion.feedback}ms ${motion.ease}; cursor: pointer; }
.lc-btn:active { transform: scale(0.98); }
.lc-btn:hover { opacity: 0.88; }
/* Ranked list rows are links to the drill-down. */
.lc-row { transition: background-color ${motion.hover}ms ${motion.ease}; }
.lc-row:hover { background-color: ${color.surface1}; }
.lc-row:focus-visible { outline: 2px solid ${color.accent}; outline-offset: 2px; }
/* Bigger hit areas without bigger visuals: the (i) guide and sortable headers reach 40px. */
.lc-info, .lc-sort { position: relative; }
.lc-info::after { content: ""; position: absolute; inset: -8px; }
.lc-sort::after { content: ""; position: absolute; inset: -12px -6px; }
/* Skip link: off screen until focused. */
.lc-gutter { padding-left: ${space[56]}px; padding-right: ${space[56]}px; }
.lc-tabrow { gap: ${space[24]}px; }
/* Under 1280 wide: narrower margins, no app name, and tabs 16 apart, so five tabs and a full date range fit at 1024. */
@media (max-width: ${layout.narrow}px) { .lc-gutter { padding-left: ${space[32]}px; padding-right: ${space[32]}px; } .lc-brand { display: none; } .lc-tabrow { gap: ${space[16]}px; } }
.lc-stretch::after { content: ""; position: absolute; inset: 0; border-radius: inherit; }
.lc-stretch:focus-visible { outline: none; }
.lc-stretch:focus-visible::after { outline: 2px solid ${color.accent}; outline-offset: -2px; border-radius: ${radius.chip}px; }
.lc-skip { position: absolute; left: 16px; top: -48px; z-index: 1000; padding: 8px 12px; border-radius: 8px; background: var(--lc-text-primary); color: var(--lc-bg-base); text-decoration: none; }
.lc-skip:focus { top: 12px; }
/* Reduced motion covers inline transitions too. */
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { transition: none !important; animation: none !important; scroll-behavior: auto !important; } }
/* Focused or linked-to elements stop below the sticky header (WCAG 2.4.11). */
html { scroll-padding-top: 96px; }
/* A table ignores height, so hidden tables sit inside a hidden div; nothing here may add to the page height. */
.lc-visually-hidden { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; border: 0; overflow: hidden; clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap; }
/* Text links: at least 24px tall to click, same focus ring as controls. */
/* One key tint for actions: links, the selected place and tab,
   primary buttons, focus and the strongest bar are violet. Money, headlines and the orange signal are not. */
.lc-link { display: inline-block; padding: 4px 0; border-radius: 4px; color: ${color.accent} !important; }
.lc-step:focus-visible, .lc-btn:focus-visible, .lc-nav:focus-visible, .lc-seg:focus-visible, .lc-link:focus-visible {
  outline: 2px solid ${color.accent};
  outline-offset: 2px;
}
.lc-panel { animation: lcIn ${motion.enter}ms ${motion.ease}; }
/* Each screen rises in once; the key on <main> restarts it per route. */
/* Previous results stay on screen, dimmed, while a new timeframe loads. */
main { transition: opacity ${motion.hover}ms ${motion.ease}; }
.lc-updating main { opacity: 0.55; }
.lc-page { animation: lcIn ${motion.page}ms ${motion.ease}; }
.lc-textbtn { transition: color ${motion.hover}ms ${motion.ease}; cursor: pointer; }
.lc-textbtn:hover { color: ${color.textPrimary} !important; }
.lc-tab { transition: color ${motion.hover}ms ${motion.ease}, border-color ${motion.hover}ms ${motion.ease}; cursor: pointer; }
.lc-tab:hover { color: ${color.textPrimary} !important; }
.lc-tab:focus-visible, .lc-textbtn:focus-visible { outline: 2px solid ${color.accent}; outline-offset: 2px; border-radius: 4px; }
.lc-info { transition: border-color ${motion.hover}ms ${motion.ease}, color ${motion.hover}ms ${motion.ease}; }
.lc-info:hover, .lc-info:focus-visible { border-color: ${color.lineStrong} !important; color: ${color.textPrimary} !important; }
/* The ID stays visible; its copy button appears when the row is hovered or focused. */
/* Sortable column headers: brighten on hover so they read as clickable. */
.lc-sort:hover { color: var(--lc-text-primary) !important; }
/* The one dropdown: no native arrow (ours is drawn), and sized to the chosen option where supported. */
.lc-select { appearance: none; -webkit-appearance: none; -moz-appearance: none; field-sizing: content; }
.lc-input:focus-visible { outline: 2px solid ${color.accent}; outline-offset: 2px; }
/* Strato text inputs: the same look as the app's own fields, a line/strong edge on surface/1 (WCAG 1.4.11). */
.strato-inputgroup { background: ${color.surface1} !important; box-shadow: inset 0 0 0 1px ${color.lineStrong} !important; }
.lc-scroll:focus-visible { outline: 2px solid ${color.accent}; outline-offset: 2px; border-radius: ${radius.chip}px; }
.lc-select:focus-visible { outline: 2px solid ${color.accent}; outline-offset: 2px; }
.lc-bar:focus-visible { outline: 2px solid ${color.accent}; outline-offset: 2px; }
.lc-sort:focus-visible { outline: 2px solid ${color.accent}; outline-offset: 2px; border-radius: 4px; }
.lc-copy { opacity: 0; transition: opacity ${motion.hover}ms ${motion.ease}; }
.lc-row:hover .lc-copy, .lc-row:focus-within .lc-copy, li:hover .lc-copy, li:focus-within .lc-copy, .lc-copy:focus-visible, h1 + * .lc-copy, .lc-copy[data-copied="true"] { opacity: 1; }
@media (hover: none) { .lc-copy { opacity: 1; } }
/* Disclosure: a plain row that reads as a control. */
.lc-details > summary { list-style: none; cursor: pointer; display: inline-flex; align-items: center; gap: 8px; }
.lc-details > summary::-webkit-details-marker { display: none; }
.lc-details > summary::before { content: ""; width: 6px; height: 6px; border-right: 1.5px solid currentColor; border-bottom: 1.5px solid currentColor; transform: rotate(-45deg); transition: transform ${motion.hover}ms ${motion.ease}; }
.lc-details[open] > summary::before { transform: rotate(45deg); }
/* A lever summary is a full-width row: the chevron sits before the title. */
.lc-lever > summary { display: flex; }
.lc-lever > summary h2 { display: inline; }
.lc-skeleton { background: ${color.surface2}; animation: lcPulse 1.5s ease-in-out infinite; }
@keyframes lcPulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.55; } }
/* Motion that explains a change (v0.12.38). Bars slide to their new length with transform,
   never width, so nothing reflows; a changed figure fades in; an Overview panel drops from
   the check above it. All of it is skipped under reduced motion (rule below). */
.lc-grow { transform-origin: left center; transition: transform ${motion.bar}ms ${motion.ease}; }
.lc-num { animation: lcFade ${motion.number}ms linear; }
.lc-drop { animation: lcDrop ${motion.enter}ms ${motion.ease}; }
@keyframes lcFade { from { opacity: 0; } to { opacity: 1; } }
@keyframes lcDrop { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: none; } }
@keyframes lcIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) {
  .lc-panel, .lc-skeleton, .lc-page, .lc-num, .lc-drop { animation: none; }
  .lc-grow { transition: none; }
  .lc-copy, .lc-details > summary::before { transition: none; }
  .lc-step, .lc-nav, .lc-btn, .lc-row, .lc-tab, .lc-textbtn, .lc-info { transition: none; }
}
`;

export function GlobalStyles() {
  return <style>{CSS}</style>;
}
