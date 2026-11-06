/**
 * The design system, copied value for value from design/DESIGN-TOKENS.md.
 * Nothing in the app's own look may use a value that is not here.
 */
/**
 * Theme values. Roles are identical in both themes; only the values differ.
 * Checked for contrast in design/DESIGN-TOKENS.md (text 4.5:1, indicators
 * 3:1 on every surface each token is used on). This is the only place hex
 * colour values live.
 */
export const palettes = {
  dark: {
    bgBase: "#0C0C0D",
    bgSidebar: "#0F0F11",
    surface1: "#151517",
    surface2: "#1B1B1E",
    surface3: "#26262A",
    line: "#1E1E21",
    lineStrong: "#726F69",
    textPrimary: "#EDEBE6",
    textSecondary: "#A3A09A",
    textTertiary: "#8F8C87",
    signal: "#D6935C",
    accent: "#B3B1E6",
    accentSoft: "#25243F",
    onAccent: "#0C0C0D",
  },
  light: {
    bgBase: "#F6F5F2",
    bgSidebar: "#EFEEEA",
    surface1: "#FFFFFF",
    surface2: "#ECEAE6",
    surface3: "#DFDDD8",
    line: "#E3E1DC",
    lineStrong: "#807D76",
    textPrimary: "#1B1A18",
    textSecondary: "#4A4743",
    textTertiary: "#64615C",
    signal: "#A54D12",
    accent: "#454482",
    accentSoft: "#EEEDF8",
    onAccent: "#FFFFFF",
  },
} as const;

export type ColorRole = keyof typeof palettes.dark;

const cssName = (role: string) => `--lc-${role.replace(/[A-Z0-9]/g, (m) => `-${m.toLowerCase()}`)}`;

/**
 * Colours as CSS variables, so screens never know which theme is active.
 * GlobalStyles sets the variables from `palettes`, keyed off the
 * data-theme attribute Strato's AppRoot puts on <html>.
 */
export const color = Object.fromEntries(
  (Object.keys(palettes.dark) as ColorRole[]).map((k) => [k, `var(${cssName(k)})`]),
) as Record<ColorRole, string>;

export function paletteCss(theme: keyof typeof palettes): string {
  return (Object.entries(palettes[theme]) as [string, string][])
    .map(([k, v]) => `  ${cssName(k)}: ${v};`)
    .join("\n");
}

export const font = {
  sans: "'Instrument Sans', 'Helvetica Neue', Helvetica, Arial, sans-serif",
  mono: "'JetBrains Mono', ui-monospace, Menlo, monospace",
} as const;

/**
 * The five type sizes: 12, 14, 16, 20, 32. v0.12: the display came down from
 * 40 to 32 so the answer sentence usually fits one line and leaves room for
 * the content; it stays Instrument Sans.
 * Weight 500 is the loudest a list gets; labels are sentence case.
 */
export const type = {
  display: { fontSize: 32, lineHeight: "38px", fontWeight: 500, letterSpacing: "-0.025em" },
  title: { fontSize: 20, lineHeight: "26px", fontWeight: 500, letterSpacing: "-0.01em" },
  heading: { fontSize: 16, lineHeight: "22px", fontWeight: 500, letterSpacing: "-0.01em" },
  bodyLarge: { fontSize: 16, lineHeight: "24px", fontWeight: 400 },
  body: { fontSize: 14, lineHeight: "20px", fontWeight: 400 },
  label: {
    fontSize: 12,
    lineHeight: "16px",
    fontWeight: 500,
    letterSpacing: 0,
    textTransform: "none",
  },
  mono: { fontSize: 12, lineHeight: "16px", fontWeight: 400, fontFamily: font.mono },
} as const;

/** Spacing scale. */
export const space = { 4: 4, 8: 8, 12: 12, 16: 16, 24: 24, 32: 32, 48: 48, 56: 56 } as const;

/**
 * Radii. Concentric rule: a shape nested in another's corner gets
 * outer radius minus padding. The timeframe segment sits in a 10px track
 * with 3px padding, so it is 7. Where padding is as large as the outer
 * radius or larger, the shapes share no corner and the inner keeps its own
 * token (e.g. buttons and chips inside a panel).
 */
export const radius = { segment: 7, chip: 8, control: 10, surface: 14, full: 9999, marker: 1.5 } as const;

export const size = { control: 40, segment: 34, trackPadding: 3, stepNode: 30, marker: 6, chip: 28, chipSmall: 24, icon: 18 } as const;

/**
 * Layout (v0.12.32): the frame's fixed heights and the widths content keeps to. The page
 * gutter is 56 px from 1280 px wide and 32 px below it (GlobalStyles, .lc-gutter).
 */
export const layout = {
  appBar: 52, // top bar: name, Home / Consumption / Cost switch, Help
  subNav: 52, // this section's screens as tabs, with the timeframe and Refresh
  content: 920, // reading width for sentences and panels
  popover: 320, // Filter and Help popovers
  popoverMaxHeight: 420,
  narrow: 1279, // below this the gutter narrows and the app name hides (the platform shows it)
} as const;

/**
 * Motion: the only durations in the app. Ease-out
 * for everything that moves; nothing above 400 ms; reduced motion turns it all off.
 */
export const motion = {
  feedback: 100, // press
  hover: 150, // hover, small state changes
  enter: 250, // panels and popovers appearing
  exit: 200, // panels leaving
  page: 300, // a new screen fading in
  bar: 250, // a bar sliding to its new length (timeframe or grouping change)
  number: 150, // a figure fading to its new value; no counting up
  ease: "cubic-bezier(0.2, 0, 0, 1)",
} as const;
