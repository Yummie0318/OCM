"use client";

// Target path: src/components/map/SearchBar.tsx
//
// Typeahead search over owner / lot no. / survey no. / patent no.
// Debounced so we're not firing a request per keystroke. Selecting a
// result hands the lightweight LotSearchResult up to the parent, which is
// responsible for flying the map there and fetching the full polygon.
//
// APPLE-STYLE / THEME PASS (this pass): previously this whole component
// was written with hardcoded inline styles (#f3f4f6, #9ca3af, a fixed
// ACCENT constant, "white" backgrounds, 13px text) — it was the one piece
// of the sidebar system that didn't move with dark mode and didn't match
// the density of the rest of the app. It now:
//   - Reads the shared `--sb-*` tokens via useSidebarTheme(), same as
//     Sidebar/AttributeTable/SummaryBar, so it re-skins automatically with
//     the dark mode toggle instead of always rendering a light field.
//   - Uses Tailwind utility classes instead of inline style objects, with
//     a hairline (color-mix against --sb-border) ring instead of a flat
//     border, and a full-radius pill field to match the rest of the
//     sidebar's controls (tabs, CTA button).
//   - Dropped to the same ~11.5–12px type scale as the rest of the pass,
//     with tighter row padding so more results fit without scrolling.
//   - The active/keyboard-highlighted result now uses --sb-accent-bg
//     instead of a hardcoded #eef2ff, so it stays legible in dark mode.
// No behavior changed: debounce timing, keyboard nav (↑/↓/Enter/Esc), and
// outside-click handling are all identical to before.

import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import type { LotSearchResult } from "@/lib/geo";
import { useSidebarTheme } from "./SidebarThemeContext";

interface Props {
  onSelect: (result: LotSearchResult) => void;
}

const hairline = "color-mix(in srgb, var(--sb-border) 75%, transparent)";
const hairlineSoft = "color-mix(in srgb, var(--sb-border) 45%, transparent)";

export default function SearchBar({ onSelect }: Props) {
  const { theme } = useSidebarTheme();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<LotSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [focused, setFocused] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    debounceRef.current = setTimeout(() => {
      fetch(`/api/map/search?q=${encodeURIComponent(q)}`)
        .then((r) => r.json())
        .then((data: LotSearchResult[]) => {
          setResults(data);
          setOpen(true);
          setActiveIndex(-1);
        })
        .catch(() => setResults([]))
        .finally(() => setLoading(false));
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  // Close the dropdown on outside click.
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function pick(result: LotSearchResult) {
    onSelect(result);
    setQuery("");
    setResults([]);
    setOpen(false);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!open || results.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && activeIndex >= 0) {
      e.preventDefault();
      pick(results[activeIndex]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <div
        className="flex items-center gap-2 rounded-full px-2.5 transition-shadow duration-100"
        style={{
          background: "var(--sb-hover)",
          boxShadow: focused
            ? `inset 0 0 0 1.5px var(--sb-accent), 0 0 0 3px color-mix(in srgb, var(--sb-accent) 16%, transparent)`
            : `inset 0 0 0 1px ${hairline}`,
        }}
      >
        <Search size={14} className="flex-shrink-0 text-[var(--sb-text-faint)]" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => {
            setFocused(true);
            if (results.length > 0) setOpen(true);
          }}
          onBlur={() => setFocused(false)}
          onKeyDown={handleKeyDown}
          placeholder="Search owner, lot no., survey no…"
          className="min-w-0 flex-1 border-0 bg-transparent py-[9px] text-[12px] text-[var(--sb-text)] outline-none placeholder:text-[var(--sb-text-faint)]"
        />
      </div>

      {open && (loading || results.length > 0 || query.trim().length >= 2) && (
        <div
          className="absolute left-0 right-0 top-[calc(100%+6px)] z-20 max-h-[320px] overflow-y-auto rounded-[14px] bg-[var(--sb-bg-elevated)] p-1"
          style={{ boxShadow: theme.shadow, border: `1px solid ${hairline}` }}
        >
          {loading && <div className="px-2.5 py-2 text-[11.5px] text-[var(--sb-text-faint)]">Searching…</div>}
          {!loading && results.length === 0 && (
            <div className="px-2.5 py-2 text-[11.5px] text-[var(--sb-text-faint)]">
              No lots found for &ldquo;{query}&rdquo;.
            </div>
          )}
          {!loading &&
            results.map((r, idx) => (
              <div
                key={r.id}
                onMouseDown={() => pick(r)}
                onMouseEnter={() => setActiveIndex(idx)}
                className="cursor-pointer rounded-[9px] px-2.5 py-[7px] transition-colors duration-75"
                style={{
                  background: idx === activeIndex ? "var(--sb-accent-bg)" : "transparent",
                  borderBottom: idx === results.length - 1 ? "none" : `1px solid ${hairlineSoft}`,
                }}
              >
                <div className="truncate text-[12px] font-semibold text-[var(--sb-text)]">
                  Lot {r.lotNo ?? "—"} · {r.owner || "Unnamed owner"}
                </div>
                <div className="truncate text-[10.5px] text-[var(--sb-text-faint)]">
                  {[r.barangay, r.municipality, r.province].filter(Boolean).join(", ") || "—"}
                  {r.surveyNo ? ` · Survey ${r.surveyNo}` : ""}
                  {r.patentNo ? ` · Patent ${r.patentNo}` : ""}
                </div>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}