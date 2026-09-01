"use client";

// Target path: src/components/NotificationBell.tsx
//
// Bell icon + badge showing how many activity_logs entries were created
// TODAY (local time), with a click-to-open modal listing them newest-first.
// Meant to sit next to the account footer in Sidebar.tsx, both in the
// expanded sidebar and (as a smaller icon-only variant) in the collapsed
// rail.
//
// Data comes from GET /api/activity-logs?since=<local-midnight-ISO>&limit=100.
// "Today" is computed client-side (new Date() at local midnight) since
// that's what "today" means to the person looking at the badge -- the API
// itself is timezone-agnostic and just filters created_at >= since.
//
// Polls every 60s so the badge count stays roughly live without needing a
// websocket -- cheap enough at this data volume, and stops polling while
// the modal is open (no point refetching what's already on screen mid-read;
// it refetches once when the modal closes instead so the count catches up).

import { useEffect, useRef, useState } from "react";
import { Bell, X } from "lucide-react";

interface ActivityLogRow {
  id: number;
  action: "create" | "update" | "delete";
  entity_type: string;
  entity_id: number | null;
  description: string;
  created_at: string;
  user_id: number | null;
  username: string | null;
}

const hairline = "color-mix(in srgb, var(--sb-border) 75%, transparent)";

function startOfTodayISO(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

const actionColor: Record<ActivityLogRow["action"], string> = {
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
}

export default function NotificationBell({ compact = false }: Props) {
  const [logs, setLogs] = useState<ActivityLogRow[] | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function refresh() {
    fetchTodayLogs().then(setLogs);
  }

  useEffect(() => {
    refresh();
    pollRef.current = setInterval(() => {
      // Skip polling while the modal is open -- refetch happens on close
      // instead, so the list doesn't reshuffle under the user mid-read.
      if (!modalOpen) refresh();
    }, 60_000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function openModal() {
    setModalOpen(true);
    refresh();
  }

  function closeModal() {
    setModalOpen(false);
    refresh();
  }

  const count = logs?.length ?? 0;
  const badgeText = count > 99 ? "99+" : String(count);

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        aria-label={`Notifications: ${count} today`}
        className={`relative flex flex-shrink-0 items-center justify-center rounded-[10px] border-0 bg-transparent p-0 text-[var(--sb-text-muted)] transition-colors duration-100 hover:bg-[var(--sb-hover)] hover:text-[var(--sb-text)] ${
          compact ? "h-9 w-9" : "h-8 w-8"
        }`}
      >
        <Bell size={compact ? 16 : 15} />
        {count > 0 && (
          <span
            className="absolute -right-0.5 -top-0.5 flex h-[16px] min-w-[16px] items-center justify-center rounded-full px-1 text-[9px] font-bold tabular-nums text-white"
            style={{ background: "var(--sb-accent)" }}
          >
            {badgeText}
          </span>
        )}
      </button>

      {modalOpen && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/45 backdrop-blur-[1px]" onClick={closeModal} />
          <div
            className="relative flex max-h-[80vh] w-[92vw] max-w-md flex-col rounded-[16px] shadow-2xl"
            style={{ background: "var(--sb-bg-elevated)", border: `1px solid ${hairline}` }}
          >
            <div
              className="flex flex-shrink-0 items-center justify-between px-4 py-3"
              style={{ borderBottom: `1px solid ${hairline}` }}
            >
              <h3 className="text-[14px] font-bold text-[var(--sb-text)]">Today's activity</h3>
              <button
                type="button"
                onClick={closeModal}
                className="flex h-7 w-7 items-center justify-center rounded-[8px] border-0 bg-transparent p-0 text-[var(--sb-text-muted)] hover:bg-[var(--sb-hover)]"
              >
                <X size={15} />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
              {logs === null && (
                <div className="px-2 py-6 text-center text-[12.5px] text-[var(--sb-text-faint)]">Loading…</div>
              )}
              {logs?.length === 0 && (
                <div className="px-2 py-8 text-center text-[12.5px] text-[var(--sb-text-faint)]">
                  No activity yet today.
                </div>
              )}
              <div className="flex flex-col gap-1">
                {logs?.map((log) => (
                  <div key={log.id} className="flex items-start gap-2.5 rounded-[10px] px-2.5 py-2 hover:bg-[var(--sb-hover)]">
                    <span
                      className="mt-1.5 h-[7px] w-[7px] flex-shrink-0 rounded-full"
                      style={{ background: actionColor[log.action] }}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-[12.5px] leading-snug text-[var(--sb-text)]">{log.description}</p>
                      <p className="mt-0.5 text-[10.5px] text-[var(--sb-text-faint)]">{formatTime(log.created_at)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}