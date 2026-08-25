"use client";

import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import type { ControlPointRow } from "@/app/api/control-points/route";

const HAIRLINE = "color-mix(in srgb, var(--sb-border) 70%, transparent)";

interface Props {
  onSelect: (row: ControlPointRow) => void;
}

export default function ControlPointPicker({ onSelect }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ControlPointRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      setError(null);
      return;
    }
    setLoading(true);
    const handle = setTimeout(() => {
      fetch(`/api/control-points?q=${encodeURIComponent(query.trim())}`)
        .then((r) => r.json())
        .then((data) => {
          setResults(data.rows || []);
          setError(data.error || null);
          setOpen(true);
        })
        .catch(() => setError("Search failed."))
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(handle);
  }, [query]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  return (
    <div className="relative" ref={boxRef}>
      <div className="relative">
        <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--sb-text-faint)]" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          placeholder="Search tie point, municipality, or province"
          className="w-full rounded-[8px] border border-[var(--sb-border)] bg-[var(--sb-bg)] py-[7px] pl-8 pr-2.5 text-[12.5px] text-[var(--sb-text)] outline-none transition-colors focus:border-[var(--sb-accent)]"
        />
      </div>

      {open && (
        <div
          className="absolute left-0 right-0 top-[calc(100%+4px)] z-30 max-h-56 overflow-y-auto rounded-[10px] p-1"
          style={{ background: "var(--sb-bg-elevated)", boxShadow: "0 8px 24px rgba(0,0,0,0.18)", border: `1px solid ${HAIRLINE}` }}
        >
          {loading && <div className="px-2.5 py-2 text-[11.5px] text-[var(--sb-text-faint)]">Searching…</div>}
          {!loading && error && <div className="px-2.5 py-2 text-[11.5px] text-red-500">{error}</div>}
          {!loading && !error && results.length === 0 && query.trim().length >= 2 && (
            <div className="px-2.5 py-2 text-[11.5px] text-[var(--sb-text-faint)]">No matches.</div>
          )}
          {!loading &&
            results.map((row) => (
              <button
                key={row.id}
                type="button"
                onClick={() => {
                  onSelect(row);
                  setQuery(`${row.tie_point_name} - ${row.municipality_name}`);
                  setOpen(false);
                }}
                className="flex w-full flex-col items-start gap-0.5 rounded-[8px] border-0 bg-transparent px-2.5 py-[7px] text-left transition-colors hover:bg-[var(--sb-hover)]"
              >
                <strong className="text-[12.5px] font-semibold text-[var(--sb-text)]">{row.tie_point_name}</strong>
                <span className="text-[11px] text-[var(--sb-text-faint)]">
                  {row.municipality_name}, {row.province_name}
                </span>
              </button>
            ))}
        </div>
      )}
    </div>
  );
}