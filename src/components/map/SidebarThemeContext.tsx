"use client";

// Target path: src/components/map/SidebarThemeContext.tsx
//
// PERSISTENCE (this pass): darkMode is now saved to localStorage so a
// reload keeps whatever the user last picked, instead of always starting
// back on the light theme.
//
// State still initializes to `defaultDarkMode` on first render (not from
// localStorage directly) because this runs during SSR too, where
// `window` doesn't exist — reading localStorage at that point would
// throw, and even guarding it would make the server-rendered HTML and the
// client's first render disagree (a React hydration mismatch). Instead,
// a `useEffect` runs once after mount, reads the stored value, and
// applies it then; effects only run in the browser, so this is safe.
// This means there's a single, usually-invisible frame at load where the
// default theme flashes before the stored one applies.
//
// A second `useEffect` writes darkMode back to localStorage every time it
// changes (including that first correction, harmlessly re-saving the same
// value), keeping storage in sync going forward.

import { createContext, useContext, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { getTheme, themeVars, type SidebarTheme } from "./sidebarTheme";

const DARK_MODE_STORAGE_KEY = "ocm-dark-mode";
const ACCENT_STORAGE_KEY = "ocm-accent-color";

interface SidebarThemeContextValue {
  darkMode: boolean;
  setDarkMode: (value: boolean) => void;
  toggleDarkMode: () => void;
  // null = the original default accent.
  accentColor: string | null;
  setAccentColor: (hex: string | null) => void;
  theme: SidebarTheme;
  vars: CSSProperties;
}

const SidebarThemeContext = createContext<SidebarThemeContextValue | null>(null);

export function SidebarThemeProvider({
  children,
  defaultDarkMode = false,
}: {
  children: ReactNode;
  defaultDarkMode?: boolean;
}) {
  const [darkMode, setDarkMode] = useState(defaultDarkMode);
  const [accentColor, setAccentColor] = useState<string | null>(null);
  // False until the saved preferences have been read from localStorage.
  // The save effects below wait for this, so they can't overwrite the
  // stored values with defaults on first mount (or under Strict Mode's
  // double-run of effects).
  const [hydrated, setHydrated] = useState(false);

  // Restore the saved preference once, after mount.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(DARK_MODE_STORAGE_KEY);
      if (stored !== null) setDarkMode(stored === "1");
      const storedAccent = window.localStorage.getItem(ACCENT_STORAGE_KEY);
      if (storedAccent && /^#[0-9a-fA-F]{6}$/.test(storedAccent)) setAccentColor(storedAccent);
    } catch {
      // localStorage unavailable (e.g. private browsing) — fall back to defaultDarkMode.
    }
    setHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist every change (including the restore above) going forward.
  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(DARK_MODE_STORAGE_KEY, darkMode ? "1" : "0");
    } catch {
      // ignore
    }
  }, [darkMode, hydrated]);

  
  // Persist the accent choice; null (default) removes the saved value.
  useEffect(() => {
    if (!hydrated) return;
    try {
      if (accentColor) window.localStorage.setItem(ACCENT_STORAGE_KEY, accentColor);
      else window.localStorage.removeItem(ACCENT_STORAGE_KEY);
    } catch {
      // ignore
    }
  }, [accentColor, hydrated]);

  const value = useMemo<SidebarThemeContextValue>(() => {
    const theme = getTheme(darkMode, accentColor ?? undefined);
    return {
      darkMode,
      setDarkMode,
      toggleDarkMode: () => setDarkMode((v) => !v),
      accentColor,
      setAccentColor,
      theme,
      vars: themeVars(theme),
    };
  }, [darkMode, accentColor]);

  return <SidebarThemeContext.Provider value={value}>{children}</SidebarThemeContext.Provider>;
}

export function useSidebarTheme(): SidebarThemeContextValue {
  const ctx = useContext(SidebarThemeContext);
  if (!ctx) {
    throw new Error("useSidebarTheme() must be called within a <SidebarThemeProvider>.");
  }
  return ctx;
}