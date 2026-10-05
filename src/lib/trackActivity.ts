export interface TrackPayload {
  action: "project" | "preview" | "report";
  entityType: "projection" | "lot" | "lot_sheet";
  entityId?: number | string | null;
  label: string;
  extra?: Record<string, unknown>;
}

// Fire-and-forget: logging must never block or break the UI.
export async function trackActivity(payload: TrackPayload) {
  try {
    const res = await fetch("/api/activity-logs/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    // Tells the notification bell to refresh its badge right away.
    if (res.ok) window.dispatchEvent(new Event("activity-logged"));
  } catch {
    // ignore
  }
}