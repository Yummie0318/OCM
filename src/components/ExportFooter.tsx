"use client";

// Target path: src/components/ExportFooter.tsx
//
// DOCUMENTS LINK + SURVEY CLASS (this pass): the Save-to-Database modal
// gains two new fields alongside the existing "Plan link":
//   - "Documents link" — optional, same shape/validation as Plan link
//     (must be a traceable Google Drive/Docs URL when non-empty, checked
//     in handleSave right next to the existing planUrl check). Can be
//     left blank, same as planUrl.
//   - "Survey class" — a required <select> (Admin / Private), unlike the
//     two link fields. There's no "leave it blank" option: the select
//     always has a value (defaults to "private"), so there's nothing to
//     validate beyond "did the POST include it" — the dropdown itself
//     guarantees the value is one of the two allowed strings.
// Both are sent in the POST /api/lot-sheets body as documentsUrl /
// surveyClass, alongside the existing planUrl.
//
// GOOGLE DRIVE VALIDATION (earlier pass): the optional "Plan link" field in
// the Save-to-Database modal is now validated the same way as
// AttributeTable's "Add link" control — it must be a traceable Google
// Drive/Docs URL (see isTraceableGoogleDriveLink in src/lib/planLink.ts)
// when non-empty. Checked in handleSave, right before the POST — an
// invalid link sets saveState to "error" with an explanatory message and
// never reaches the network, same pattern as the missing-tie-point check
// just above it. The field itself stays optional: leaving it blank still
// saves fine, matching the original behavior.

import { useState } from "react";
import type { ComputedLot, ControlPoint, Lot } from "@/types";
import { downloadGeoJSON, downloadKML, downloadShapefile } from "@/lib/exporters";
import { labelCls, inputCls } from "@/components/ControlPointForm";
import { isTraceableGoogleDriveLink, PLAN_LINK_HELP_MESSAGE } from "@/lib/planLink";

const HAIRLINE = "color-mix(in srgb, var(--sb-border) 70%, transparent)";

interface Props {
  lots: Lot[];
  computedLots: ComputedLot[];
  controlPoint: ControlPoint;
}

type SaveState = "idle" | "saving" | "saved" | "duplicate" | "error";
type SurveyClass = "admin" | "private";

function computedLotToFeature(computed: ComputedLot, lot: Lot | undefined) {
  return {
    type: "Feature" as const,
    properties: {
      lotNo: computed.lotNo,
      owner: computed.owner,
      ownerGivenName: lot?.ownerGivenName ?? "",
      ownerSurname: lot?.ownerSurname ?? "",
      location: computed.location,
      areaSqm: computed.areaSqm,
      computedAreaSqm: computed.computedAreaSqm,
      surveyNo: lot?.surveyNo ?? "",
      dateSurveyed: lot?.dateSurveyed ?? "",
    },
    geometry: { type: "Polygon" as const, coordinates: [computed.points.map((p) => [p.lon, p.lat])] },
  };
}

// Fields required before a lot can be saved. patentNo and remarks are
// intentionally excluded — they stay optional.
function getMissingFields(lot: Lot): string[] {
  const missing: string[] = [];
  if (!lot.lotNo.trim()) missing.push("Lot No.");
  if (!lot.areaSqm.trim()) missing.push("Area");
  if (!lot.ownerGivenName.trim()) missing.push("Given name");
  if (!lot.ownerSurname.trim()) missing.push("Surname");
  if (!lot.provinceId) missing.push("Province");
  if (!lot.municipalityId) missing.push("Municipality");
  if (!lot.barangayId) missing.push("Barangay");
  if (!lot.surveyorId) missing.push("Surveyor");
  if (!lot.dateSurveyed.trim()) missing.push("Date surveyed");
  return missing;
}

// Catches two lots in THIS sheet (not the DB — that's the separate 409
// duplicate check in handleSave) that share the same Lot No. AND the same
// area. That combination almost always means the same corner set got
// entered/computed twice by mistake (e.g. a copy-paste lot that was never
// edited), so it's worth blocking the save modal over rather than letting
// it silently create two identical-looking lot rows.
//
// Area is rounded to 2 decimals before comparing so two lots that are
// "the same" but differ only by floating-point noise from the area
// calculation still count as duplicates.
function getDuplicateLotNos(computedLots: ComputedLot[]): string[] {
  const seen = new Map<string, number>();
  const dupes = new Set<string>();

  computedLots.forEach((c) => {
    const lotNo = c.lotNo.trim();
    if (!lotNo) return;
    const area = Number(c.computedAreaSqm ?? c.areaSqm ?? 0);
    const key = `${lotNo.toLowerCase()}|${area.toFixed(2)}`;
    if (seen.has(key)) {
      dupes.add(lotNo);
    } else {
      seen.set(key, area);
    }
  });

  return Array.from(dupes);
}

const ghostBtnCls =
  "rounded-full border-0 bg-[var(--sb-hover)] px-3 py-[7px] text-[12px] font-semibold text-[var(--sb-text)] transition-opacity hover:opacity-80 disabled:opacity-40";
const accentBtnCls =
  "rounded-full border-0 px-3 py-[7px] text-[12px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40";

export default function ExportFooter({ lots, computedLots, controlPoint }: Props) {
  const ready = computedLots.length > 0;

  const [modalOpen, setModalOpen] = useState(false);
  const [sheetNo, setSheetNo] = useState("");
  const [planUrl, setPlanUrl] = useState("");
  const [documentsUrl, setDocumentsUrl] = useState("");
  // Always has a value — the dropdown has no blank option, so
  // surveyClass is guaranteed to be "admin" or "private" by the time
  // handleSave reads it. Defaults to "private" (the more common case).
  const [surveyClass, setSurveyClass] = useState<SurveyClass>("private");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [duplicates, setDuplicates] = useState<{ lotNo: string; surveyNo: string }[]>([]);
  const [validationError, setValidationError] = useState<string | null>(null);

  function openModal() {
    setSheetNo("");
    setPlanUrl("");
    setDocumentsUrl("");
    setSurveyClass("private");
    setSaveState("idle");
    setSaveMessage(null);
    setDuplicates([]);
    setModalOpen(true);
  }

  function handleSaveClick() {
    const problems: { label: string; fields: string[] }[] = [];

    lots.forEach((lot, idx) => {
      const missing = getMissingFields(lot);
      if (missing.length > 0) {
        problems.push({ label: lot.lotNo.trim() || `Lot #${idx + 1}`, fields: missing });
      }
    });

    if (problems.length > 0) {
      setValidationError(
        problems.map((p) => `${p.label}: missing ${p.fields.join(", ")}`).join("  ·  ")
      );
      return;
    }

    // Same Lot No. + same Area within this sheet -> almost certainly an
    // accidental duplicate lot. Block the modal here, same as a missing
    // required field, instead of letting it reach the DB duplicate check
    // (which only compares lotNo + surveyNo, not area, and only against
    // already-saved rows).
    const duplicateLotNos = getDuplicateLotNos(computedLots);
    if (duplicateLotNos.length > 0) {
      setValidationError(
        `Duplicate lot${duplicateLotNos.length > 1 ? "s" : ""} with the same Lot No. and Area: ${duplicateLotNos.join(", ")}`
      );
      return;
    }

    setValidationError(null);
    openModal();
  }

  function closeModal() {
    if (saveState === "saving") return;
    setModalOpen(false);
  }

  async function handleSave() {
    if (!sheetNo.trim()) {
      setSaveState("error");
      setSaveMessage("Enter a Sheet / Cadastral Lot No.");
      return;
    }
    if (controlPoint.controlPointId === null) {
      setSaveState("error");
      setSaveMessage("Pick a tie point in step 1 before saving.");
      return;
    }

    // The plan link is optional, but if one was entered it has to be a
    // traceable Google Drive/Docs link — same rule enforced by
    // AttributeTable's "Add link" control and the PATCH route, so a
    // sheet can never end up with an untraceable link regardless of
    // which screen it was set from.
    const trimmedPlanUrl = planUrl.trim();
    if (trimmedPlanUrl && !isTraceableGoogleDriveLink(trimmedPlanUrl)) {
      setSaveState("error");
      setSaveMessage(PLAN_LINK_HELP_MESSAGE);
      return;
    }

    // Documents link — same deal as planUrl: optional, but must be a
    // traceable Google Drive/Docs link if the user typed one in.
    const trimmedDocumentsUrl = documentsUrl.trim();
    if (trimmedDocumentsUrl && !isTraceableGoogleDriveLink(trimmedDocumentsUrl)) {
      setSaveState("error");
      setSaveMessage(PLAN_LINK_HELP_MESSAGE);
      return;
    }

    // surveyClass has no blank state to check for — the <select> always
    // holds "admin" or "private" — so there's nothing to validate here
    // beyond what TypeScript already guarantees at compile time.

    setSaveState("saving");
    setSaveMessage(null);
    setDuplicates([]);

    const payloadLots = computedLots.map((computed) => {
      const lot = lots.find((l) => l.id === computed.id);
      return {
        lotNo: computed.lotNo,
        ownerGivenName: lot?.ownerGivenName ?? "",
        ownerSurname: lot?.ownerSurname ?? "",
        provinceId: lot?.provinceId ?? null,
        municipalityId: lot?.municipalityId ?? null,
        barangayId: lot?.barangayId ?? null,
        surveyNo: lot?.surveyNo ?? "",
        dateSurveyed: lot?.dateSurveyed || null,
        surveyorId: lot?.surveyorId ?? null,
        areaSqm: computed.computedAreaSqm,
        geojson: computedLotToFeature(computed, lot),
      };
    });

    try {
      const res = await fetch("/api/lot-sheets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sheetNo: sheetNo.trim(),
          controlPointId: controlPoint.controlPointId,
          lpcsNorthing: controlPoint.lpcsNorthing,
          lpcsEasting: controlPoint.lpcsEasting,
          ppcsNorthing: controlPoint.ppcsNorthing,
          ppcsEasting: controlPoint.ppcsEasting,
          zone: controlPoint.zone,
          planUrl: trimmedPlanUrl || null,
          documentsUrl: trimmedDocumentsUrl || null,
          surveyClass,
          lots: payloadLots,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (res.status === 409) {
        setSaveState("duplicate");
        setDuplicates(data.duplicates ?? []);
        setSaveMessage(data.error || "One or more lots already exist.");
        return;
      }
      if (!res.ok) throw new Error(data.error || "Save failed.");
      setSaveState("saved");
    } catch (err) {
      setSaveState("error");
      setSaveMessage(err instanceof Error ? err.message : "Save failed.");
    }
  }

  return (
    <>
      <div className="flex flex-shrink-0 flex-col gap-2 px-5 py-3" style={{ borderTop: `1px solid ${HAIRLINE}`, background: "var(--sb-bg-elevated)" }}>
        <div className="flex items-center justify-between gap-3">
          <div className="text-[12px] text-[var(--sb-text-muted)]">
            {ready ? (
              <>
                <strong className="text-[var(--sb-text)]">{computedLots.length}</strong> lot{computedLots.length > 1 ? "s" : ""} ready
              </>
            ) : (
              "Add 3+ corners to a lot"
            )}
          </div>

          <div className="flex items-center gap-2">
            <button disabled={!ready} onClick={() => downloadGeoJSON(computedLots)} className={ghostBtnCls}>GeoJSON</button>
            <button disabled={!ready} onClick={() => downloadKML(computedLots)} className={ghostBtnCls}>KML</button>
            <button disabled={!ready} onClick={() => downloadShapefile(computedLots, controlPoint)} className={accentBtnCls} style={{ background: "var(--sb-text)" }}>
              Shapefile
            </button>
            <button disabled={!ready} onClick={handleSaveClick} className={accentBtnCls} style={{ background: "var(--sb-accent)" }}>
              Save
            </button>
          </div>
        </div>

        {validationError && (
          <p className="rounded-[8px] px-2.5 py-1.5 text-[11.5px] text-red-500" style={{ background: "rgba(239,68,68,0.08)" }}>
            Please complete before saving — {validationError}
          </p>
        )}
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/45 backdrop-blur-[1px]" onClick={closeModal} />
          <div
            className="relative flex w-[92vw] max-w-sm flex-col gap-3 rounded-[16px] p-5 shadow-2xl"
            style={{ background: "var(--sb-bg-elevated)", border: `1px solid ${HAIRLINE}` }}
          >
            {saveState === "saved" ? (
              <>
                <h3 className="text-[14px] font-bold text-[var(--sb-text)]">Saved ✓</h3>
                <p className="text-[12px] text-[var(--sb-text-faint)]">
                  Sheet {sheetNo.trim()} · {computedLots.length} lot{computedLots.length > 1 ? "s" : ""}
                </p>
                <button onClick={closeModal} className={`${accentBtnCls} self-end`} style={{ background: "var(--sb-accent)" }}>
                  Close
                </button>
              </>
            ) : (
              <>
                <h3 className="text-[14px] font-bold text-[var(--sb-text)]">Save to Database</h3>

                <label className={labelCls}>
                  Sheet / Cadastral Lot No.
                  <input
                    className={inputCls}
                    type="text"
                    autoFocus
                    value={sheetNo}
                    disabled={saveState === "saving"}
                    onChange={(e) => setSheetNo(e.target.value)}
                    placeholder="8208"
                  />
                </label>

                <label className={labelCls}>
                  Plan link (optional — must be Google Drive)
                  <input
                    className={inputCls}
                    type="url"
                    value={planUrl}
                    disabled={saveState === "saving"}
                    onChange={(e) => setPlanUrl(e.target.value)}
                    placeholder="https://drive.google.com/file/d/…"
                  />
                </label>

                <label className={labelCls}>
                  Documents link (optional — must be Google Drive)
                  <input
                    className={inputCls}
                    type="url"
                    value={documentsUrl}
                    disabled={saveState === "saving"}
                    onChange={(e) => setDocumentsUrl(e.target.value)}
                    placeholder="https://drive.google.com/file/d/…"
                  />
                </label>

                <label className={labelCls}>
                  Survey class
                  <select
                    className={inputCls}
                    value={surveyClass}
                    disabled={saveState === "saving"}
                    onChange={(e) => setSurveyClass(e.target.value as SurveyClass)}
                  >
                    <option value="admin">Admin</option>
                    <option value="private">Private</option>
                  </select>
                </label>

                {saveState === "duplicate" && (
                  <div className="rounded-[8px] px-2.5 py-2 text-[11.5px] text-red-500" style={{ background: "rgba(239,68,68,0.08)" }}>
                    <p>{saveMessage}</p>
                    {duplicates.length > 0 && (
                      <ul className="mt-1 list-disc pl-4">
                        {duplicates.map((d, i) => (
                          <li key={i}>Lot {d.lotNo} — {d.surveyNo || "no survey no."}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}

                {saveState === "error" && saveMessage && (
                  <p className="rounded-[8px] px-2.5 py-2 text-[11.5px] text-red-500" style={{ background: "rgba(239,68,68,0.08)" }}>
                    {saveMessage}
                  </p>
                )}

                <div className="flex justify-end gap-2 pt-1">
                  <button onClick={closeModal} disabled={saveState === "saving"} className={ghostBtnCls}>Cancel</button>
                  <button onClick={handleSave} disabled={saveState === "saving"} className={accentBtnCls} style={{ background: "var(--sb-accent)" }}>
                    {saveState === "saving" ? "Saving…" : "Save"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}