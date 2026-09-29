"use client";

// Target path: src/components/ExportFooter.tsx
//
// TOAST PASS: all feedback now uses the global toast (see
// src/components/notifications/Toaster.tsx) instead of inline messages in
// the modal or footer:
//   - Validation problems (missing lot fields, duplicate lots in the sheet)
//   - Save form errors (missing sheet no., tie point, invalid Drive links)
//   - Duplicate lots already in the database (409)
//   - Save failures
//   - Success: the modal closes and a success toast appears
// While a save is in flight the modal cannot be closed and the inputs are
// disabled.
//
// MOBILE PASS: the footer wraps and the four action buttons become a 2x2
// grid on phones; the Save dialog is height-capped and scrolls on its own.

import { useState } from "react";
import type { ComputedLot, ControlPoint, Lot } from "@/types";
import { downloadGeoJSON, downloadKML, downloadShapefile } from "@/lib/exporters";
import { labelCls, inputCls } from "@/components/ControlPointForm";
import { isTraceableGoogleDriveLink, PLAN_LINK_HELP_MESSAGE } from "@/lib/planLink";
import { toast } from "@/components/notifications/Toaster";

const HAIRLINE = "color-mix(in srgb, var(--sb-border) 70%, transparent)";

interface Props {
  lots: Lot[];
  computedLots: ComputedLot[];
  controlPoint: ControlPoint;
}

type SaveState = "idle" | "saving";
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

// Two lots in THIS sheet sharing the same Lot No. AND the same area
// (rounded to 2 decimals) almost always means the same corner set was
// entered twice by mistake.
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
  "whitespace-nowrap text-center rounded-full border-0 bg-[var(--sb-hover)] px-3 py-[9px] text-[12px] font-semibold text-[var(--sb-text)] transition-opacity hover:opacity-80 disabled:opacity-40 sm:py-[7px]";
const accentBtnCls =
  "whitespace-nowrap text-center rounded-full border-0 px-3 py-[9px] text-[12px] font-semibold text-[var(--sb-on-accent)] transition-opacity hover:opacity-90 disabled:opacity-40 sm:py-[7px]";

export default function ExportFooter({ lots, computedLots, controlPoint }: Props) {
  const ready = computedLots.length > 0;

  const [modalOpen, setModalOpen] = useState(false);
  const [sheetNo, setSheetNo] = useState("");
  const [planUrl, setPlanUrl] = useState("");
  const [documentsUrl, setDocumentsUrl] = useState("");
  const [surveyClass, setSurveyClass] = useState<SurveyClass>("private");
  const [saveState, setSaveState] = useState<SaveState>("idle");

  function openModal() {
    setSheetNo("");
    setPlanUrl("");
    setDocumentsUrl("");
    setSurveyClass("private");
    setSaveState("idle");
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
      toast.error("Complete the lots before saving", {
        description: problems.map((p) => `${p.label}: missing ${p.fields.join(", ")}`).join("  ·  "),
        duration: 10000,
      });
      return;
    }

    const duplicateLotNos = getDuplicateLotNos(computedLots);
    if (duplicateLotNos.length > 0) {
      toast.error("Duplicate lots in this sheet", {
        description: `Same Lot No. and Area: ${duplicateLotNos.join(", ")}`,
        duration: 10000,
      });
      return;
    }

    openModal();
  }

  function closeModal() {
    if (saveState === "saving") return;
    setModalOpen(false);
  }

  async function handleSave() {
    if (saveState === "saving") return;

    if (!sheetNo.trim()) {
      toast.error("Sheet number required", { description: "Enter a Sheet / Cadastral Lot No." });
      return;
    }
    if (controlPoint.controlPointId === null) {
      toast.error("Tie point required", { description: "Pick a tie point in step 1 before saving." });
      return;
    }

    const trimmedPlanUrl = planUrl.trim();
    if (trimmedPlanUrl && !isTraceableGoogleDriveLink(trimmedPlanUrl)) {
      toast.error("Invalid plan link", { description: PLAN_LINK_HELP_MESSAGE });
      return;
    }

    const trimmedDocumentsUrl = documentsUrl.trim();
    if (trimmedDocumentsUrl && !isTraceableGoogleDriveLink(trimmedDocumentsUrl)) {
      toast.error("Invalid documents link", { description: PLAN_LINK_HELP_MESSAGE });
      return;
    }

    setSaveState("saving");

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
        const dupes: { lotNo: string }[] = data.duplicates ?? [];
        const lotList = dupes
          .map((d) => (typeof d === "string" ? d : d.lotNo))
          .filter(Boolean)
          .join(", ");
        toast.error("Duplicate lot found", {
          description:
            (data.error || "One or more lots already exist.") + (lotList ? ` Lot: ${lotList}` : ""),
          duration: 10000,
        });
        setSaveState("idle");
        return;
      }
      if (!res.ok) throw new Error(data.error || "Save failed.");

      const savedSheetNo = sheetNo.trim();
      const count = computedLots.length;
      toast.success("Lot sheet saved", {
        description: `Sheet ${savedSheetNo} with ${count} lot${count > 1 ? "s" : ""} was added to the database.`,
      });
      setSaveState("idle");
      setModalOpen(false);
    } catch (err) {
      toast.error("Save failed", {
        description: err instanceof Error ? err.message : "Something went wrong while saving.",
      });
      setSaveState("idle");
    }
  }

  return (
    <>
      <div
        className="flex flex-shrink-0 flex-col gap-2 px-3 py-3 sm:px-5"
        style={{ borderTop: `1px solid ${HAIRLINE}`, background: "var(--sb-bg-elevated)" }}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-[12px] text-[var(--sb-text-muted)]">
            {ready ? (
              <>
                <strong className="text-[var(--sb-text)]">{computedLots.length}</strong> lot
                {computedLots.length > 1 ? "s" : ""} ready
              </>
            ) : (
              "Add 3+ corners to a lot"
            )}
          </div>

          <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:items-center">
            <button disabled={!ready} onClick={() => downloadGeoJSON(computedLots)} className={ghostBtnCls}>
              GeoJSON
            </button>
            <button disabled={!ready} onClick={() => downloadKML(computedLots)} className={ghostBtnCls}>
              KML
            </button>
            <button
              disabled={!ready}
              onClick={() => downloadShapefile(computedLots, controlPoint)}
              className={accentBtnCls}
              style={{ background: "var(--sb-text)", color: "var(--sb-bg)" }}
            >
              Shapefile
            </button>
            <button
              disabled={!ready}
              onClick={handleSaveClick}
              className={accentBtnCls}
              style={{ background: "var(--sb-accent)" }}
            >
              Save
            </button>
          </div>
        </div>
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/45 backdrop-blur-[1px]" onClick={closeModal} />
          <div
            className="relative flex max-h-[90dvh] w-[92vw] max-w-sm flex-col gap-3 overflow-y-auto rounded-[16px] p-4 shadow-2xl sm:p-5"
            style={{ background: "var(--sb-bg-elevated)", border: `1px solid ${HAIRLINE}` }}
          >
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

            <div className="flex justify-end gap-2 pt-1">
              <button onClick={closeModal} disabled={saveState === "saving"} className={ghostBtnCls}>
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saveState === "saving"}
                className={accentBtnCls}
                style={{ background: "var(--sb-accent)" }}
              >
                {saveState === "saving" ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}