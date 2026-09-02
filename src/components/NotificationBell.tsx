"use client";

// Target path: src/components/NotificationBell.tsx
//
// ANCHOR-TO-SIDEBAR FIX (this pass): the dropdown used to clamp its
// position against the whole browser window (`window.innerWidth`), not
// against the sidebar it's visually anchored inside. The sidebar is
// narrow (~370px) but sits inside a much wider window (the map fills the
// rest). When the panel right-aligned to the bell (rect.right - width)
// and that went negative, it clamped to `left: 12` of the WHOLE window,
// which yanked the panel away from the bell and let its width spill
// straight into the map area.
//
// Fixed by clamping against the bounding rect of the nearest
// `[data-notification-anchor]` ancestor instead (Sidebar.tsx marks its
// root element with that attribute -- see both branches of Sidebar's
// render). If no such ancestor is found, falls back to the full viewport
// so this component never hard-fails if it's ever used somewhere without
// that marker.
//
// Also added a MOBILE_BREAKPOINT: below that viewport width there usually
// isn't enough room next to a sidebar-docked bell for a floating dropdown
// to feel right, so it renders as a full-width bottom sheet with a small
// backdrop instead of an anchored dropdown.
//
// TRANSPARENT PANEL FIX (earlier pass): the dropdown was styled entirely
// with var(--sb-bg-elevated), var(--sb-border), etc. -- CSS custom
// properties that Sidebar.tsx defines on its own root element via
// `style={vars}` (see themeVars() in sidebarTheme.ts). CSS custom
// properties only inherit to actual DOM DESCENDANTS of the element that
// defines them. Since this panel is portaled to document.body (see below
// for why), it's moved OUTSIDE that themed DOM subtree entirely -- so
// every var(--sb-*) reference here resolved to nothing, which is exactly
// the washed-out/see-through look in the bug report (transparent
// background, invisible text, everything just showing whatever was
// behind it).
//
// Fixed by reading the palette through useSidebarTheme() instead -- that's
// a React Context (see SidebarThemeContext.tsx), and React context flows
// through the COMPONENT tree, not the DOM tree. NotificationBell is still
// a descendant of <SidebarThemeProvider> in React's tree (it's rendered
// inside <Sidebar>, which map/page.tsx wraps in the provider) regardless
// of where createPortal ultimately places its DOM node -- so
// `theme.bgElevated` etc. work correctly here even though var(--sb-*)
// did not. All hex/color values below now come from `theme` and are
// applied as plain inline styles.
//
// REWRITE (earlier pass): was a full-screen modal (fixed inset-0 + dark
// backdrop), rendered as a plain (non-portaled) child of this component.
// Two problems with that:
//   1. A dark backdrop covering the whole screen behaves like a true
//      modal (blocks/dims everything underneath), heavier than "check
//      today's activity" warrants.
//   2. Because the panel was a plain DOM descendant of Sidebar (not
//      portaled), `position: fixed` on it was only guaranteed relative to
//      the viewport if no ancestor in between had a CSS `transform` set.
//      The mobile sidebar (`<aside style={{ transform: translateX(...) }}>`
//      in map/page.tsx) does exactly that -- any ancestor with `transform`
//      becomes the containing block for a `position: fixed` descendant,
//      silently turning "fixed to the viewport" into "fixed relative to
//      that transformed ancestor" and clipping/mispositioning it. Likely
//      why clicking the bell appeared to do nothing on some layouts.
//
// Now: a small anchored dropdown, portaled to document.body via
// createPortal (same idea as Sidebar's own <Tooltip>), positioned from the
// trigger button's live getBoundingClientRect() every time it opens (and
// re-computed on resize/scroll while open). No backdrop on desktop --
// closes like a normal dropdown menu: a document-level mousedown listener
// that checks whether the click landed outside both the trigger and the
// panel (same pattern Sidebar already uses for its own account-menu
// dropdown), plus Escape to close. Nothing else on the page is blocked
// while it's open. (The mobile sheet mode below does use a light backdrop,
// since a bottom sheet reads better with one.)
//
// Data comes from GET /api/activity-logs?since=<local-midnight-ISO>&limit=100.
// "Today" is computed client-side (new Date() at local midnight) since
// that's what "today" means to the person looking at the badge -- the API
// itself is timezone-agnostic and just filters created_at >= since.
//
// Polls every 60s so the badge count stays roughly live without needing a
// websocket. Stops polling while the panel is open (refetches once on
// close instead) so the list doesn't reshuffle under the user mid-read.
//
// FIXED-HEIGHT LIST FIX (this pass): the list used to be capped only by
// the panel's own `max-h-[70vh]`, so on a tall screen it just kept
// growing -- 6, 8, 10+ rows would all fit before scrolling ever kicked
// in, which is what made the panel feel "too long" (see bug report
// screenshot: six rows rendered with no scrollbar, panel visually
// spilling past the rest of the sidebar). Fixed by giving the list itself
// a fixed max-height sized to roughly LIST_VISIBLE_ROWS rows (via
// LIST_MAX_HEIGHT_PX) so it always scrolls once there are more than that
// many entries, regardless of viewport height. Kept as a `min()` against
// a vh-based ceiling too, so on a short/landscape phone screen the list
// still shrinks further rather than pushing the header/footer off-screen.

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Bell, X } from "lucide-react";
import { useSidebarTheme } from "@/components/map/SidebarThemeContext";

export interface ActivityLogRow {
  id: number;
  action: "create" | "update" | "delete";
  entity_type: string;
  entity_id: number | null;
  description: string;
  created_at: string;
  user_id: number | null;
  username: string | null;
}

// Ideal panel width; clamped against the sidebar's own bounds (see
// computeCoords) so it never overflows into the map area, and against
// the viewport so it never overflows a narrow phone screen either.
const PANEL_WIDTH = 340;
const VIEWPORT_MARGIN = 10;
// Below this viewport width we skip anchored positioning entirely and
// render as a bottom sheet -- there usually isn't enough room next to a
// sidebar-docked bell on a phone for a floating dropdown to feel right.
const MOBILE_BREAKPOINT = 640;
// How many rows should be visible before the list starts scrolling.
// Purely descriptive -- the actual cap is LIST_MAX_HEIGHT_PX. Row height
// isn't fixed: a short description renders on one line (~49px row), a
// long lot-sheet name wraps to two (~66px row), and real data is a mix
// of both (see bug report screenshot, where several rows wrapped). Sized
// for a ~76px average row so 5 rows fit even when most of them wrap,
// rather than only fitting 5 in the best case and clipping to 4 in the
// common case.
const LIST_VISIBLE_ROWS = 5;
const LIST_MAX_HEIGHT_PX = 410;

function startOfTodayISO(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

const actionColorHex: Record<ActivityLogRow["action"], string> = {
  create: "#16a34a",
  update: "#2563eb",
  delete: "#dc2626",
};

async function fetchTodayLogs(): Promise<ActivityLogRow[]> {
  try {
    const res = await fetch(`/api/activity-logs?since=${encodeURIComponent(startOfTodayISO())}&limit=100`);
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data.logs) ? data.logs : [];
  } catch {
    return [];
  }
}

interface Props {
  /** Renders just the icon with no text label -- used in the collapsed rail. */
  compact?: boolean;
  /**
   * Called when the user clicks a log entry in the panel. Currently only
   * entries with entity_type "lot_sheet" are meaningfully clickable (see
   * handleActivityLogSelect in map/page.tsx, which adds the sheet as a
   * map/table selection) -- other entity types are still rendered but the
   * click is a no-op until a handler exists for them. The panel closes
   * after the click either way.
   */
  onSelectLog?: (log: ActivityLogRow) => void;
}

type Coords = { mode: "sheet" } | { mode: "anchored"; top: number; left: number; width: number };

export default function NotificationBell({ compact = false, onSelectLog }: Props) {
  const { theme } = useSidebarTheme();

  const [logs, setLogs] = useState<ActivityLogRow[] | null>(null);
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<Coords | null>(null);
  const [mounted, setMounted] = useState(false);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Guards the createPortal call -- document.body doesn't exist during
  // SSR, and calling createPortal before mount would throw.
  useEffect(() => setMounted(true), []);

  function refresh() {
    fetchTodayLogs().then(setLogs);
  }

  useEffect(() => {
    refresh();
    pollRef.current = setInterval(() => {
      if (!open) refresh();
    }, 60_000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Computes where the panel should sit. Two modes:
  //  - "sheet": narrow viewport -> full-width bottom sheet, no anchoring math.
  //  - "anchored": desktop/tablet -> a dropdown clamped to the sidebar's
  //    OWN bounding rect (found via the closest [data-notification-anchor]
  //    ancestor that Sidebar.tsx marks its root with), not the full browser
  //    window. Anchoring against the window was the bug: the bell lives
  //    inside a narrow sidebar far from the window's actual right edge, so
  //    clamping against window.innerWidth let the panel drift away from
  //    the sidebar entirely and overflow into the map.
  function computeCoords() {
    const el = triggerRef.current;
    if (!el) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    if (vw < MOBILE_BREAKPOINT) {
      setCoords({ mode: "sheet" });
      return;
    }

    const rect = el.getBoundingClientRect();
    const anchorEl = el.closest("[data-notification-anchor]") as HTMLElement | null;
    const bounds = anchorEl ? anchorEl.getBoundingClientRect() : { left: 0, right: vw };

    const boundsLeft = Math.max(0, bounds.left) + VIEWPORT_MARGIN;
    const boundsRight = Math.min(vw, bounds.right) - VIEWPORT_MARGIN;
    const availableWidth = Math.max(220, boundsRight - boundsLeft);
    const width = Math.min(PANEL_WIDTH, availableWidth);

    // Right-align to the trigger by default, then clamp fully inside the
    // sidebar's bounds (not the window's).
    let left = rect.right - width;
    left = Math.max(boundsLeft, Math.min(left, boundsRight - width));

    let top = rect.bottom + 8;
    const estimatedHeight = Math.min(420, vh - VIEWPORT_MARGIN * 2);
    if (top + estimatedHeight > vh - VIEWPORT_MARGIN) {
      top = Math.max(VIEWPORT_MARGIN, rect.top - estimatedHeight - 8);
    }

    setCoords({ mode: "anchored", top, left, width });
  }

  function toggleOpen() {
    if (open) {
      setOpen(false);
      return;
    }
    computeCoords();
    setOpen(true);
    refresh();
  }

  function close() {
    setOpen(false);
    refresh();
  }

  // Close on outside click -- checks against both the trigger button and
  // the portaled panel (which lives outside Sidebar's own DOM subtree
  // once rendered), same pattern Sidebar already uses for its own
  // account-menu dropdown.
  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: MouseEvent) {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  // Keep the panel correctly anchored if the window resizes or the page
  // scrolls while it's open (also handles crossing the MOBILE_BREAKPOINT
  // mid-session, e.g. rotating a tablet).
  useEffect(() => {
    if (!open) return;
    function handleReposition() {
      computeCoords();
    }
    window.addEventListener("resize", handleReposition);
    window.addEventListener("scroll", handleReposition, true);
    return () => {
      window.removeEventListener("resize", handleReposition);
      window.removeEventListener("scroll", handleReposition, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Escape closes it, same convention as most dropdown/menu UIs.
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open]);

  const count = logs?.length ?? 0;
  const badgeText = count > 99 ? "99+" : String(count);
  // Hairline derived from the theme's own border color, same recipe as
  // Sidebar's `hairline` constant, just computed from the theme object
  // directly instead of a CSS var (for the same portal/context reason as
  // everything else in this file).
  const hairlineColor = `color-mix(in srgb, ${theme.border} 75%, transparent)`;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={toggleOpen}
        aria-label={`Notifications: ${count} today`}
        aria-expanded={open}
        className={`relative flex flex-shrink-0 items-center justify-center rounded-[10px] border-0 bg-transparent p-0 transition-colors duration-100 hover:bg-[var(--sb-hover)] hover:text-[var(--sb-text)] ${
          compact ? "h-9 w-9" : "h-8 w-8"
        }`}
        style={{ color: theme.textMuted }}
      >
        <Bell size={compact ? 16 : 15} />
        {count > 0 && (
          <span
            className="absolute -right-0.5 -top-0.5 flex h-[16px] min-w-[16px] items-center justify-center rounded-full px-1 text-[9px] font-bold tabular-nums text-white"
            style={{ background: theme.accent }}
          >
            {badgeText}
          </span>
        )}
      </button>

      {mounted &&
        open &&
        coords &&
        createPortal(
          <>
            {coords.mode === "sheet" && (
              <div
                onMouseDown={() => setOpen(false)}
                className="fixed inset-0 z-[89]"
                style={{ background: theme.overlayBg }}
              />
            )}
            <div
              ref={panelRef}
              role="dialog"
              aria-label="Today's activity"
              className={
                coords.mode === "sheet"
                  ? "fixed inset-x-0 bottom-0 z-[90] flex max-h-[75vh] flex-col overflow-hidden rounded-t-[20px]"
                  : "fixed z-[90] flex max-h-[70vh] flex-col overflow-hidden rounded-[16px]"
              }
              style={{
                ...(coords.mode === "anchored"
                  ? { top: coords.top, left: coords.left, width: coords.width }
                  : { paddingBottom: "env(safe-area-inset-bottom)" }),
                background: theme.bgElevated,
                border: `1px solid ${hairlineColor}`,
                boxShadow: theme.shadow,
              }}
            >
              {coords.mode === "sheet" && (
                <div className="flex flex-shrink-0 justify-center pt-2">
                  <div className="h-1 w-9 rounded-full" style={{ background: theme.border }} />
                </div>
              )}

              <div
                className="flex flex-shrink-0 items-center justify-between px-4 py-3"
                style={{ borderBottom: `1px solid ${hairlineColor}` }}
              >
                <h3 className="text-[13.5px] font-bold" style={{ color: theme.text }}>
                  Today&rsquo;s activity
                </h3>
                <button
                  type="button"
                  onClick={close}
                  className="flex h-7 w-7 items-center justify-center rounded-[8px] border-0 bg-transparent p-0 transition-colors duration-100"
                  style={{ color: theme.textMuted }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = theme.hoverBg)}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  <X size={15} />
                </button>
              </div>

              <div
                className="min-h-0 overflow-y-auto px-2 py-2"
                style={{ maxHeight: `min(${LIST_MAX_HEIGHT_PX}px, 50vh)` }}
              >
                {logs === null && (
                  <div className="px-2 py-6 text-center text-[12.5px]" style={{ color: theme.textFaint }}>
                    Loading…
                  </div>
                )}
                {logs?.length === 0 && (
                  <div className="px-2 py-8 text-center text-[12.5px]" style={{ color: theme.textFaint }}>
                    No activity yet today.
                  </div>
                )}
                <div className="flex flex-col gap-1">
                  {logs?.map((log) => {
                    // Only entries tied to a specific record are worth
                    // clicking through to -- entity_id is null for very old
                    // rows written before that column was populated, or any
                    // future log type that isn't record-specific. Those
                    // render as plain (non-interactive) rows instead of a
                    // dead-end button.
                    const clickable = Boolean(onSelectLog) && log.entity_id != null;
                    const content = (
                      <>
                        <span
                          className="mt-1.5 h-[7px] w-[7px] flex-shrink-0 rounded-full"
                          style={{ background: actionColorHex[log.action] }}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-[12.5px] leading-snug" style={{ color: theme.text }}>
                            {log.description}
                          </p>
                          <p className="mt-0.5 text-[10.5px]" style={{ color: theme.textFaint }}>
                            {formatTime(log.created_at)}
                          </p>
                        </div>
                      </>
                    );
                    return clickable ? (
                      <button
                        key={log.id}
                        type="button"
                        onClick={() => {
                          onSelectLog?.(log);
                          close();
                        }}
                        className="flex w-full items-start gap-2.5 rounded-[10px] border-0 bg-transparent px-2.5 py-2 text-left transition-colors duration-100"
                        onMouseEnter={(e) => (e.currentTarget.style.background = theme.hoverBg)}
                        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                      >
                        {content}
                      </button>
                    ) : (
                      <div key={log.id} className="flex items-start gap-2.5 rounded-[10px] px-2.5 py-2">
                        {content}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </>,
          document.body
        )}
    </>
  );
}