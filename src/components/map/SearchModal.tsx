"use client";

// Target path: src/components/map/SearchModal.tsx
//
// Full-screen "command palette" search, opened by clicking the search icon
// on the sidebar (works the same whether the sidebar is collapsed or
// expanded — that's the point of pulling it out of the inline dropdown
// SearchBar used to be). Same debounced fetch/keyboard-nav logic as the
// old SearchBar, just presented as a centered modal over a backdrop.

import { useEffect, useRef, useState } from "react";
import { Search, X, CornerDownLeft } from "lucide-react";
import type { LotSearchResult } from "@/lib/geo";
import { getTheme } from "./sidebarTheme";

interface Props {
  open: boolean;
  onClose: () => void;
  onSelect: (result: LotSearchResult) => void;
  darkMode: boolean;
}

export default function SearchModal({ open, onClose, onSelect, darkMode }: Props) {
  const theme = getTheme(darkMode);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<LotSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset + autofocus every time the modal opens.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setResults([]);
    setActiveIndex(-1);
    const t = setTimeout(() => inputRef.current?.focus(), 20);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
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
          setActiveIndex(-1);
        })
        .catch(() => setResults([]))
        .finally(() => setLoading(false));
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, open]);

  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, results.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter" && activeIndex >= 0 && results[activeIndex]) {
        e.preventDefault();
        pick(results[activeIndex]);
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, results, activeIndex]);

  function pick(result: LotSearchResult) {
    onSelect(result);
    onClose();
  }

  if (!open) return null;

  return (
    <div
      onMouseDown={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: theme.overlayBg,
        backdropFilter: "blur(2px)",
        zIndex: 100,
        display: "flex",
        justifyContent: "center",
        alignItems: "flex-start",
        padding: "min(14vh, 120px) 16px 24px",
      }}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 560,
          background: theme.bgElevated,
          borderRadius: 14,
          boxShadow: theme.shadow,
          border: `1px solid ${theme.border}`,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          maxHeight: "70vh",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "14px 16px",
            borderBottom: `1px solid ${theme.border}`,
            flexShrink: 0,
          }}
        >
          <Search size={17} color={theme.textFaint} style={{ flexShrink: 0 }} />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search owner, lot no., survey no., or patent no."
            style={{
              flex: 1,
              minWidth: 0,
              border: "none",
              outline: "none",
              background: "transparent",
              fontSize: 15,
              color: theme.text,
            }}
          />
          <button
            type="button"
            onClick={onClose}
            title="Close"
            style={{
              width: 26,
              height: 26,
              flexShrink: 0,
              border: "none",
              borderRadius: 7,
              background: "transparent",
              color: theme.textFaint,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <X size={16} />
          </button>
        </div>

        <div style={{ overflowY: "auto", overflowX: "hidden" }}>
          {loading && (
            <div style={{ fontSize: 13, color: theme.textFaint, padding: 16 }}>Searching…</div>
          )}
          {!loading && query.trim().length >= 2 && results.length === 0 && (
            <div style={{ fontSize: 13, color: theme.textFaint, padding: 16 }}>
              No lots found for &ldquo;{query}&rdquo;.
            </div>
          )}
          {!loading && query.trim().length < 2 && (
            <div style={{ fontSize: 12.5, color: theme.textFaint, padding: 16 }}>
              Type at least 2 characters to search.
            </div>
          )}
          {!loading &&
            results.map((r, idx) => (
              <div
                key={r.id}
                onMouseDown={() => pick(r)}
                onMouseEnter={() => setActiveIndex(idx)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 10,
                  padding: "10px 16px",
                  cursor: "pointer",
                  background: idx === activeIndex ? theme.accentBg : "transparent",
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: theme.text }}>
                    Lot {r.lotNo ?? "—"} · {r.owner || "Unnamed owner"}
                  </div>
                  <div
                    style={{
                      fontSize: 11.5,
                      color: theme.textFaint,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {[r.barangay, r.municipality, r.province].filter(Boolean).join(", ") || "—"}
                    {r.surveyNo ? ` · Survey ${r.surveyNo}` : ""}
                    {r.patentNo ? ` · Patent ${r.patentNo}` : ""}
                  </div>
                </div>
                {idx === activeIndex && (
                  <CornerDownLeft size={13} color={theme.textFaint} style={{ flexShrink: 0 }} />
                )}
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}