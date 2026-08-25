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
  shadow: "0 10px 30px rgba(0, 0, 0, 0.5)",
  overlayBg: "rgba(0, 0, 0, 0.6)",
};

export function getTheme(darkMode: boolean): SidebarTheme {
  return darkMode ? darkTheme : lightTheme;
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
    "--sb-shadow": theme.shadow,
    "--sb-overlay": theme.overlayBg,
  } as CSSProperties;
}