"use client";

import { Fragment, useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { Lot, Corner } from "@/types";
import { localRing } from "@/lib/computeLots";
import ShapePreview from "@/components/ShapePreview";
import { labelCls, inputCls, SectionHeader } from "@/components/ControlPointForm";

const HAIRLINE = "color-mix(in srgb, var(--sb-border) 70%, transparent)";

function uid(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2);
}

export function newCorner(station: string): Corner {
  return { id: uid(), station, northing: "", easting: "" };
}

export function newLot(): Lot {
  return {
    id: uid(),
    lotNo: "",
    owner: "",
    ownerGivenName: "",
    ownerSurname: "",
    location: "",
    provinceId: null,
    municipalityId: null,
    barangayId: null,
    surveyNo: "",
    dateSurveyed: "",
    patentNo: "",
    remarks: "",
    surveyorId: null,
    areaSqm: "",
    corners: [newCorner("1"), newCorner("2"), newCorner("3")],
  };
}

interface ProvinceOption { id: number; name: string }
interface MunicipalityOption { id: number; name: string; type: string }
interface BarangayOption { id: number; name: string }
interface SurveyorOption { id: number; name: string; position: string }

interface Props {
  lots: Lot[];
  onChange: (lots: Lot[]) => void;
}

export default function LotEditor({ lots, onChange }: Props) {
  const [provinces, setProvinces] = useState<ProvinceOption[]>([]);
  const [surveyors, setSurveyors] = useState<SurveyorOption[]>([]);

  useEffect(() => {
    fetch("/api/provinces").then((r) => r.json()).then(setProvinces).catch(() => setProvinces([]));
    fetch("/api/surveyors").then((r) => r.json()).then(setSurveyors).catch(() => setSurveyors([]));
  }, []);

  function updateLot(id: string, patch: Partial<Lot>) {
    onChange(lots.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }

  function updateCorner(lotId: string, cornerId: string, patch: Partial<Corner>) {
    onChange(lots.map((l) => (l.id !== lotId ? l : { ...l, corners: l.corners.map((c) => (c.id === cornerId ? { ...c, ...patch } : c)) })));
  }

  function addCorner(lotId: string) {
    onChange(lots.map((l) => (l.id !== lotId ? l : { ...l, corners: [...l.corners, newCorner(String(l.corners.length + 1))] })));
  }

  function removeCorner(lotId: string, cornerId: string) {
    onChange(lots.map((l) => (l.id !== lotId ? l : { ...l, corners: l.corners.filter((c) => c.id !== cornerId) })));
  }

  function addLot() {
    const prev = lots[lots.length - 1];
    const copiedLot: Lot = prev
      ? {
          ...newLot(),
          lotNo: prev.lotNo,
          areaSqm: prev.areaSqm,
          ownerGivenName: prev.ownerGivenName,
          ownerSurname: prev.ownerSurname,
          owner: prev.owner,
          location: prev.location,
          provinceId: prev.provinceId,
          municipalityId: prev.municipalityId,
          barangayId: prev.barangayId,
          surveyorId: prev.surveyorId,
          surveyNo: prev.surveyNo,
          dateSurveyed: prev.dateSurveyed,
          patentNo: prev.patentNo,
        }
      : newLot();
    onChange([...lots, copiedLot]);
  }

  function removeLot(id: string) {
    onChange(lots.filter((l) => l.id !== id));
  }

  return (
    <section
      className="flex flex-col gap-3 rounded-[14px] p-4"
      style={{ border: `1px solid ${HAIRLINE}`, background: "var(--sb-bg-elevated)" }}
    >
      <SectionHeader index={2} title="Lot Data" />

      <div className="flex flex-col gap-3">
        {lots.map((lot, lotIdx) => (
          <div
            key={lot.id}
            className="flex flex-col gap-3 rounded-[12px] p-3"
            style={{ border: `1px solid ${HAIRLINE}`, background: "var(--sb-bg)" }}
          >
            <div className="flex items-center justify-between">
              <span className="text-[12px] font-bold text-[var(--sb-text)]">Lot #{lotIdx + 1}</span>
              {lots.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeLot(lot.id)}
                  className="flex h-6 w-6 items-center justify-center rounded-[7px] border-0 bg-transparent p-0 text-red-500 transition-colors hover:bg-red-500/10"
                >
                  <Trash2 size={12} />
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_220px]">
              <div className="flex flex-col gap-2.5">
                <div className="grid grid-cols-2 gap-2.5">
                  <label className={labelCls}>
                    Lot No.
                    <input className={inputCls} type="text" value={lot.lotNo} onChange={(e) => updateLot(lot.id, { lotNo: e.target.value })} placeholder="8208-B" />
                  </label>
                  <label className={labelCls}>
                    Area (sq.m.)
                    <input className={inputCls} type="text" value={lot.areaSqm} onChange={(e) => updateLot(lot.id, { areaSqm: e.target.value })} placeholder="121.00" />
                  </label>
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <label className={labelCls}>
                    Given name
                    <input
                      className={inputCls}
                      type="text"
                      value={lot.ownerGivenName}
                      onChange={(e) => {
                        const ownerGivenName = e.target.value;
                        updateLot(lot.id, { ownerGivenName, owner: [lot.ownerSurname, ownerGivenName].filter(Boolean).join(", ") });
                      }}
                      placeholder="Juan"
                    />
                  </label>
                  <label className={labelCls}>
                    Surname
                    <input
                      className={inputCls}
                      type="text"
                      value={lot.ownerSurname}
                      onChange={(e) => {
                        const ownerSurname = e.target.value;
                        updateLot(lot.id, { ownerSurname, owner: [ownerSurname, lot.ownerGivenName].filter(Boolean).join(", ") });
                      }}
                      placeholder="Dela Cruz"
                    />
                  </label>
                </div>

                <LotLocationFields lot={lot} provinces={provinces} surveyors={surveyors} onPatch={(patch) => updateLot(lot.id, patch)} />

                <div className="grid grid-cols-2 gap-2.5">
                  <label className={labelCls}>
                    Survey No.
                    <input className={inputCls} type="text" value={lot.surveyNo} onChange={(e) => updateLot(lot.id, { surveyNo: e.target.value })} placeholder="Csd-02-012345-D" />
                  </label>
                  <label className={labelCls}>
                    Date surveyed
                    <input className={inputCls} type="date" value={lot.dateSurveyed} onChange={(e) => updateLot(lot.id, { dateSurveyed: e.target.value })} />
                  </label>
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <label className={labelCls}>
                    Patent No.
                    <input className={inputCls} type="text" value={lot.patentNo} onChange={(e) => updateLot(lot.id, { patentNo: e.target.value })} placeholder="P-12345" />
                  </label>
                  <label className={labelCls}>
                    Remarks
                    <input className={inputCls} type="text" value={lot.remarks} onChange={(e) => updateLot(lot.id, { remarks: e.target.value })} />
                  </label>
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <span className="text-[10.5px] font-semibold text-[var(--sb-text-muted)]">Preview</span>
                <div className="overflow-hidden rounded-[10px]" style={{ border: `1px solid ${HAIRLINE}` }}>
                  <ShapePreview
                    shapes={[{ id: lot.id, label: lot.lotNo || "Lot", points: localRing(lot), complete: localRing(lot).length >= 3 }]}
                    height={160}
                    emptyMessage="No corners yet"
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-[46px_1fr_1fr_24px] items-center gap-1.5">
              <span className="text-[9.5px] font-bold uppercase tracking-wide text-[var(--sb-text-faint)]">Sta</span>
              <span className="text-[9.5px] font-bold uppercase tracking-wide text-[var(--sb-text-faint)]">Northing</span>
              <span className="text-[9.5px] font-bold uppercase tracking-wide text-[var(--sb-text-faint)]">Easting</span>
              <span />

              {lot.corners.map((corner) => (
                <Fragment key={corner.id}>
                  <input
                    className={`${inputCls} text-center`}
                    type="text"
                    value={corner.station}
                    maxLength={2}
                    onChange={(e) => updateCorner(lot.id, corner.id, { station: e.target.value })}
                  />
                  <input className={inputCls} type="number" step="any" value={corner.northing} onChange={(e) => updateCorner(lot.id, corner.id, { northing: e.target.value })} />
                  <input className={inputCls} type="number" step="any" value={corner.easting} onChange={(e) => updateCorner(lot.id, corner.id, { easting: e.target.value })} />
                  <div className="flex items-center justify-center">
                    {lot.corners.length > 3 && (
                      <button
                        type="button"
                        onClick={() => removeCorner(lot.id, corner.id)}
                        className="flex h-5 w-5 items-center justify-center rounded-[6px] border-0 bg-transparent p-0 text-red-500 transition-colors hover:bg-red-500/10"
                      >
                        <Trash2 size={11} />
                      </button>
                    )}
                  </div>
                </Fragment>
              ))}
            </div>

            <button
              type="button"
              onClick={() => addCorner(lot.id)}
              className="flex w-fit items-center gap-1 rounded-full border-0 bg-[var(--sb-hover)] px-2.5 py-1 text-[10.5px] font-semibold text-[var(--sb-text)] transition-opacity hover:opacity-80"
            >
              <Plus size={11} /> Corner
            </button>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={addLot}
        className="flex items-center justify-center gap-1.5 rounded-full border-0 px-3 py-[9px] text-[12.5px] font-semibold text-white transition-opacity hover:opacity-90"
        style={{ background: "var(--sb-accent)" }}
      >
        <Plus size={13} /> Add lot
      </button>
    </section>
  );
}

function LotLocationFields({
  lot,
  provinces,
  surveyors,
  onPatch,
}: {
  lot: Lot;
  provinces: ProvinceOption[];
  surveyors: SurveyorOption[];
  onPatch: (patch: Partial<Lot>) => void;
}) {
  const [municipalities, setMunicipalities] = useState<MunicipalityOption[]>([]);
  const [barangays, setBarangays] = useState<BarangayOption[]>([]);

  useEffect(() => {
    if (!lot.provinceId) { setMunicipalities([]); return; }
    fetch(`/api/municipalities?province_id=${lot.provinceId}`).then((r) => r.json()).then(setMunicipalities).catch(() => setMunicipalities([]));
  }, [lot.provinceId]);

  useEffect(() => {
    if (!lot.municipalityId) { setBarangays([]); return; }
    fetch(`/api/barangays?municipality_id=${lot.municipalityId}`).then((r) => r.json()).then(setBarangays).catch(() => setBarangays([]));
  }, [lot.municipalityId]);

  function buildLocationString(
    provinceId: number | null,
    municipalityId: number | null,
    barangayId: number | null,
    munList: MunicipalityOption[],
    brgyList: BarangayOption[]
  ) {
    const province = provinces.find((p) => p.id === provinceId)?.name ?? "";
    const municipality = munList.find((m) => m.id === municipalityId)?.name ?? "";
    const barangay = brgyList.find((b) => b.id === barangayId)?.name ?? "";
    return [barangay, municipality, province].filter(Boolean).join(", ");
  }

  return (
    <div className="grid grid-cols-2 gap-2.5">
      <label className={labelCls}>
        Province
        <select
          className={inputCls}
          value={lot.provinceId ?? ""}
          onChange={(e) => {
            const provinceId = e.target.value ? Number(e.target.value) : null;
            onPatch({ provinceId, municipalityId: null, barangayId: null, location: buildLocationString(provinceId, null, null, [], []) });
          }}
        >
          <option value="">Select…</option>
          {provinces.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </label>

      <label className={labelCls}>
        Municipality
        <select
          className={inputCls}
          value={lot.municipalityId ?? ""}
          disabled={!lot.provinceId}
          onChange={(e) => {
            const municipalityId = e.target.value ? Number(e.target.value) : null;
            onPatch({ municipalityId, barangayId: null, location: buildLocationString(lot.provinceId, municipalityId, null, municipalities, []) });
          }}
        >
          <option value="">Select…</option>
          {municipalities.map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>
      </label>

      <label className={labelCls}>
        Barangay
        <select
          className={inputCls}
          value={lot.barangayId ?? ""}
          disabled={!lot.municipalityId}
          onChange={(e) => {
            const barangayId = e.target.value ? Number(e.target.value) : null;
            onPatch({ barangayId, location: buildLocationString(lot.provinceId, lot.municipalityId, barangayId, municipalities, barangays) });
          }}
        >
          <option value="">Select…</option>
          {barangays.map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>
      </label>

      <label className={labelCls}>
        Surveyor
        <select className={inputCls} value={lot.surveyorId ?? ""} onChange={(e) => onPatch({ surveyorId: e.target.value ? Number(e.target.value) : null })}>
          <option value="">Select…</option>
          {surveyors.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </label>
    </div>
  );
}