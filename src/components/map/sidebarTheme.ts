// Target path: src/components/map/sidebarTheme.ts
//
// Small shared token file so Sidebar.tsx and SearchModal.tsx agree on the
// same light/dark palette instead of duplicating hex values in both files.
//
// NOTE on fonts: Claude's actual product typefaces (Styrene / Tiempos) are
// proprietary to Anthropic and aren't publicly licensed, so they can't be
// bundled here. `brandFont`/`uiFont` below use open Google Fonts chosen to
// be *similar in spirit* (a warm serif wordmark + a clean grotesk for UI) —
// swap them for whatever your brand actually uses.
//
// NOTE on `themeVars`: Sidebar.tsx is written with Tailwind utility classes
// (bg-[var(--sb-bg)], hover:bg-[var(--sb-hover)], etc.) instead of inline
// style objects, so spacing/layout/hover states read like normal Tailwind.
// Since the palette still needs to swap at runtime for dark mode, we expose
// it as CSS custom properties via `themeVars(theme)` — spread that once on
// the component's root element and every descendant can reference the vars.
//
// PALETTE PASS (this pass): retuned the hex values toward Apple's system
// gray scale (the neutrals used across macOS/iOS — systemGray6, the
// #1d1d1f "apple black" body text color, etc.) instead of the generic
// Tailwind slate/gray defaults. No keys, shape, or consumer API changed —
// every existing `theme.foo` / `var(--sb-foo)` reference still resolves,
// just to a quieter, warmer neutral.

import { Fraunces, Inter } from "next/font/google";
import type { CSSProperties } from "react";

export const uiFont = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-ui",
});

export const brandFont = Fraunces({
  subsets: ["latin"],
  weight: ["600"],
  style: ["normal"],
  variable: "--font-brand",
});

export const ACCENT = "#4f46e5";

export type SidebarTheme = {
  bg: string;
  bgElevated: string; // popovers, the hover flyout, the search modal card
  border: string;
  text: string;
  textMuted: string;
  textFaint: string;
  hoverBg: string;
  accent: string;
  accentBg: string;
  accentText: string;
  onAccent: string; // text/icon color drawn ON TOP of the accent (buttons, badges)
  shadow: string;
  overlayBg: string; // modal / drawer backdrop
};

export const lightTheme: SidebarTheme = {
  bg: "#ffffff",
  bgElevated: "#ffffff",
  border: "#d8d8dd",
  text: "#1d1d1f",
  textMuted: "#6e6e73",
  textFaint: "#8e8e93",
  hoverBg: "#f5f5f7",
  accent: ACCENT,
  accentBg: "#eef1ff",
  accentText: "#3730a3",
  onAccent: "#ffffff",
  shadow: "0 10px 30px rgba(15, 23, 42, 0.10)",
  overlayBg: "rgba(15, 23, 42, 0.4)",
};

export const darkTheme: SidebarTheme = {
  bg: "#1c1c1e",
  bgElevated: "#2c2c2e",
  border: "#3a3a3d",
  text: "#f5f5f7",
  textMuted: "#a1a1a6",
  textFaint: "#6e6e73",
  hoverBg: "#28282a",
  accent: "#818cf8",
  accentBg: "rgba(129, 140, 248, 0.16)",
  accentText: "#c7d2fe",
  onAccent: "#ffffff",
  shadow: "0 10px 30px rgba(0, 0, 0, 0.5)",
  overlayBg: "rgba(0, 0, 0, 0.6)",
};

// Preset accent colors offered in the theme picker. The first one is the
// original default (indigo).
export const ACCENT_PRESETS: { label: string; value: string }[] = [
  { label: "Indigo", value: "#4f46e5" },
  { label: "Blue", value: "#2563eb" },
  { label: "Teal", value: "#0d9488" },
  { label: "Green", value: "#16a34a" },
  { label: "Orange", value: "#ea580c" },
  { label: "Rose", value: "#e11d48" },
  { label: "Purple", value: "#9333ea" },
];

function hexToRgb(hex: string) {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function rgbToHex(r: number, g: number, b: number) {
  return (
    "#" +
    [r, g, b]
      .map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0"))
      .join("")
  );
}

// Blends `hex` toward black (target 0) or white (target 255).
function mixWith(hex: string, target: 0 | 255, amount: number) {
  const { r, g, b } = hexToRgb(hex);
  return rgbToHex(r + (target - r) * amount, g + (target - g) * amount, b + (target - b) * amount);
}

// Returns the theme with accent, accentBg and accentText derived from a
// single chosen hex color. Everything else in the palette is unchanged.
// WCAG relative luminance + contrast ratio, used to keep a user-chosen
// accent readable against the theme background.
function luminance(hex: string) {
  const { r, g, b } = hexToRgb(hex);
  const f = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrastRatio(a: string, b: string) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// If the accent is too close to the background (e.g. white on a white
// theme), push it away from the background until it reaches `min` contrast.
function ensureContrast(hex: string, bg: string, darkMode: boolean, min = 3) {
  const target: 0 | 255 = darkMode ? 255 : 0;
  let out = hex;
  for (let i = 0; i < 30 && contrastRatio(out, bg) < min; i++) {
    out = mixWith(out, target, 0.1);
  }
  return out;
}

// Returns the theme with accent, accentBg, accentText and onAccent derived
// from a single chosen hex color. Everything else is unchanged.
export function withAccent(theme: SidebarTheme, accentHex: string, darkMode: boolean): SidebarTheme {
  const accent = ensureContrast(accentHex, theme.bg, darkMode);
  const { r, g, b } = hexToRgb(accent);
  return {
    ...theme,
    accent,
    accentBg: `rgba(${r}, ${g}, ${b}, ${darkMode ? 0.16 : 0.1})`,
    accentText: darkMode ? mixWith(accent, 255, 0.55) : mixWith(accent, 0, 0.35),
    // White text unless the accent is light enough that white gets hard to read.
    onAccent: contrastRatio(accent, "#ffffff") >= 2.5 ? "#ffffff" : "#111111",
  };
}

// accentHex is optional, so existing getTheme(darkMode) calls keep working.
export function getTheme(darkMode: boolean, accentHex?: string): SidebarTheme {
  const base = darkMode ? darkTheme : lightTheme;
  return accentHex ? withAccent(base, accentHex, darkMode) : base;
}

/**
 * Exposes a SidebarTheme as CSS custom properties, e.g.:
 *   <div style={themeVars(theme)} className="bg-[var(--sb-bg)] text-[var(--sb-text)]">
 * Spread onto one root element; every descendant can then use
 * `bg-[var(--sb-hover)]`, `hover:bg-[var(--sb-hover)]`, `border-[var(--sb-border)]`,
 * etc. without re-deriving the palette on each node.
 */
export function themeVars(theme: SidebarTheme): CSSProperties {
  return {
    "--sb-bg": theme.bg,
    "--sb-bg-elevated": theme.bgElevated,
    "--sb-border": theme.border,
    "--sb-text": theme.text,
    "--sb-text-muted": theme.textMuted,
    "--sb-text-faint": theme.textFaint,
    "--sb-hover": theme.hoverBg,
    "--sb-accent": theme.accent,
    "--sb-accent-bg": theme.accentBg,
    "--sb-accent-text": theme.accentText,
    "--sb-on-accent": theme.onAccent,
    "--sb-shadow": theme.shadow,
    "--sb-overlay": theme.overlayBg,
  } as CSSProperties;
}