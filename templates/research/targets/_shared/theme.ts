/** The visual register, as data. Fonts are bundled (the desktop CSP and the
 *  local-first promise both rule out remote stylesheets). */
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "@fontsource-variable/source-serif-4";

export const color = {
  ground: "#F6F6F3",
  panel: "#EFEFEA",
  card: "#FFFFFF",
  card2: "#F2F2EE",
  line: "#E5E5DF",
  ink: "#1B1B1F",
  dim: "#6C6C74",
  faint: "#A2A2AA",
  ember: "#DD6B4A",
  emberDeep: "#C4522F",
  emberWash: "#FBEDE7",
  ok: "#177550",
  okWash: "#E4F1EA",
  wait: "#9A6700",
  waitWash: "#F9F0DA",
  danger: "#B3392E",
} as const;

/** Inquiry identity — muted, assigned by section index; semantic color
 *  (ok / wait / danger) stays reserved for meaning. */
export const inquiryColor = (index: number): string =>
  (["#4E7DC7", "#199178", "#C08A2E", "#9A66C7", "#5B7FA6"] as const)[
    ((index % 5) + 5) % 5
  ];

export const font = {
  ui: "'Geist Variable', 'Segoe UI', system-ui, sans-serif",
  serif: "'Source Serif 4 Variable', Georgia, serif",
  mono: "'Geist Mono Variable', ui-monospace, Menlo, monospace",
} as const;

/** The one gradient — reserved for live model streams and the progress line. */
export const thinking = "linear-gradient(90deg, #DD6B4A, #B65AC4 55%, #5B7FD9)";

export const shadow = {
  card: "0 1px 2px rgba(20,20,30,.05), 0 3px 12px rgba(20,20,30,.06)",
  raised: "0 4px 24px rgba(20,20,30,.14)",
} as const;

export const radius = { card: 11, panel: 14, control: 8, pill: 999 } as const;
