"use client";

// Target path: src/components/map/SummaryBar.tsx
//
// Standalone summary strip — "X lots · Y sq.m. total" — used above the
// attribute table. Pulled out of AttributeTable.tsx so the table component
// stays focused on rendering rows, and so this can be reused elsewhere
// (e.g. above the map) if needed later.
//
// `scope` is optional context appended after "total" (e.g. "on this
// sheet") so the same bar can read correctly whether it's showing the
// overall total across all sheets or just the currently expanded sheet's
// total — no separate footer row needed elsewhere in the table.
//
// `rightSlot` is an optional node rendered on the right side of this same
// row, before the truncated/error messages — this is where AttributeTable
// puts its search box, so search doesn't need its own separate full-width
// row underneath.
//
// THEME: reads the same `--sb-*` custom properties the sidebar uses, via
// useSidebarTheme() — so this bar (and by extension AttributeTable, its
// only consumer) automatically tracks the sidebar's light/dark toggle.
// Requires an ancestor <SidebarThemeProvider> (see SidebarThemeContext.tsx).
//
// MOBILE PASS (this pass): the row now wraps instead of forcing the count
// text and the rightSlot (search box) onto one line that overflows on
// narrow viewports. Below `sm:` the count/total sits on its own line and
// rightSlot gets a full-width row underneath it; at `sm:` and up it goes
// back to the original single-row, space-between layout. `min-w-0` was
// added throughout so flex children can actually shrink instead of
// forcing the row wider than the viewport.
//
// DENSITY / VISUAL PASS (prior pass): retuned to match AttributeTable's
// Apple-style pass —
//   - Type dropped from 13px to 11.5–12px, count/area now tabular-nums so
//     the number doesn't jump width as it changes.
//   - The bottom border is a hairline (color-mix against the theme's
//     border token at reduced opacity) instead of a flat 1px rule, same
//     treatment as the table's row dividers and header underline.
//   - Truncated/error notices got small dot-badge icons instead of just
//     colored text, and dropped to the same 11.5px scale so they read as
//     part of the same system rather than a louder, separate warning
//     style bolted on top.
// No prop or state logic changed — purely presentational.

import type { ReactNode } from "react";
import { useSidebarTheme } from "@/components/map/SidebarThemeContext";

interface Props {
  count: number;
  totalArea: number;
  truncated?: boolean;
  hasError?: boolean;
  scope?: string;
  rightSlot?: ReactNode;
}

function formatArea(sqm: number): string {
  return sqm.toLocaleString(undefined, { maximumFractionDigits: 1 }) + " sq.m.";
}

export default function SummaryBar({ count, totalArea, truncated, hasError, scope, rightSlot }: Props) {
  const { theme } = useSidebarTheme();

  const hairline = `color-mix(in srgb, ${theme.border} 70%, transparent)`;

  return (
    <div
      className="flex flex-shrink-0 flex-col gap-2 px-2.5 py-[7px] sm:flex-row sm:items-center sm:justify-between sm:gap-3"
      style={{
        borderBottom: `1px solid ${hairline}`,
        background: theme.bgElevated,
      }}
    >
      <span
        className="min-w-0 flex-shrink-0 truncate tabular-nums text-[12px] font-semibold"
        style={{ color: theme.text }}
      >
        {count.toLocaleString()} lot{count === 1 ? "" : "s"}
        {" "}
        <span className="font-normal opacity-40">·</span>{" "}
        <span className="font-normal" style={{ color: theme.textMuted }}>
          {formatArea(totalArea)} total{scope ? ` ${scope}` : ""}
        </span>
      </span>

      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:gap-2.5">
        {(truncated || hasError) && (
          <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
            {truncated && (
              <span className="flex min-w-0 items-center gap-1.5 text-[11.5px] font-medium text-amber-600">
                <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-amber-500" />
                <span className="min-w-0 truncate sm:whitespace-nowrap">
                  Showing first {count.toLocaleString()} — narrow your selection to see the rest
                </span>
              </span>
            )}
            {hasError && (
              <span className="flex min-w-0 items-center gap-1.5 text-[11.5px] font-medium text-red-600">
                <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-red-500" />
                <span className="min-w-0 truncate sm:whitespace-nowrap">Some selections failed to load</span>
              </span>
            )}
          </div>
        )}
        {rightSlot && <div className="min-w-0 flex-1 sm:flex-none">{rightSlot}</div>}
      </div>
    </div>
  );
}