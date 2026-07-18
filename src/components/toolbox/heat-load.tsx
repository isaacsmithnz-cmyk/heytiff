"use client";

/* Heat Load — Toolbox quick-check calculator. ONE room, one answer: type
   length × width and the load + suggested unit class appear live. Runs the
   SAME engine as the Design Studio rooms (lib/studio/loads.ts), so a number
   quoted here always matches the studio for the same inputs.

   Flow is optimised for speed in the field: two cards up top (room size →
   answer), everything else in a full-width Advanced panel below, collapsed
   behind its one-line summary. Last-used factors are remembered per browser
   so repeat checks on the same site keep their context. */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/shell/icon";
import {
  baseWm2,
  CLIMATE_ZONES,
  CONDITION_MULT,
  DEFAULT_CLIMATE_ZONE,
  GLAZING_MULT,
  heightMult,
  ORIENT_LABELS,
  ORIENT_MULT,
  ORIENTATIONS,
  roomHeatLoadKw,
  type BuildingType,
  type GlazingLevel,
  type Orientation,
  type RoomCondition,
} from "@/lib/studio/loads";

/* ---------- option labels (mirrors the studio room modal) ---------- */

const GLAZING_OPTS: { value: GlazingLevel; label: string }[] = [
  { value: "low", label: "Low" },
  { value: "moderate", label: "Moderate" },
  { value: "high", label: "High" },
];
const CONDITION_OPTS: { value: RoomCondition; label: string }[] = [
  { value: "well_insulated", label: "Good" },
  { value: "standard", label: "Standard" },
  { value: "poor", label: "Poor" },
];
const BUILDING_OPTS: { value: BuildingType; label: string }[] = [
  { value: "residential", label: "Residential" },
  { value: "light_commercial", label: "Light comm." },
  { value: "commercial", label: "Commercial" },
];

/* info-marker copy — glazing/insulation verbatim from the studio room modal
   so both surfaces explain the factors identically */
const TIP_GLAZING =
  "Amount of glass in the room. Low (double glazed) reduces load by 20%. High (large or single glazed) increases it by 24%.";
const TIP_CONDITION =
  "Building envelope quality. Well insulated reduces load by 15%. Poor insulation increases it by 20%. Standard = no adjustment.";
const TIP_ORIENT =
  "Direction the room's main outside wall faces. West is worst (×1.30) — low afternoon sun at peak heat. South is mildest (×0.85). Internal rooms take the ×0.85 floor.";
const TIP_OVERRIDE =
  "Your own base W/m² instead of the zone table (blank = table value). Every other factor multiplies this rate.";
const TIP_BUILDING =
  "Zone-table column — light commercial and commercial carry higher base W/m² for people, equipment and door traffic.";
const TIP_HEIGHT =
  "Standard band to 2.7 m (×1.00). Taller rooms grow with volume — 3.0 m ×1.13, 3.5 m ×1.23, 4.0 m ×1.33, capped at ×1.50.";

/* ---------- state ---------- */

export interface HlState {
  areaMode: "dims" | "area";
  lengthM: string;
  widthM: string;
  areaM2: string;
  climateZone: number;
  buildingType: BuildingType;
  wm2Override: string;
  glazing: GlazingLevel;
  condition: RoomCondition;
  ceilingHeightM: string;
  orientation: Orientation;
  internal: boolean;
}

export const HL_DEFAULTS: HlState = {
  areaMode: "dims",
  lengthM: "",
  widthM: "",
  areaM2: "",
  climateZone: DEFAULT_CLIMATE_ZONE,
  buildingType: "residential",
  wm2Override: "",
  glazing: "moderate",
  condition: "standard",
  ceilingHeightM: "2.4",
  orientation: "N",
  internal: false,
};

const BUFFER_KEY = "heytiff.toolbox.heat-load.v2";

/* ---------- pure helpers (exported for tests) ---------- */

/** Lenient numeric input parse — null unless a finite positive number. */
export function parseNum(s: string): number | null {
  const n = Number(String(s).trim().replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Floor area in m², from L×W or the direct area field. */
export function hlArea(s: Pick<HlState, "areaMode" | "lengthM" | "widthM" | "areaM2">): number | null {
  if (s.areaMode === "area") return parseNum(s.areaM2);
  const l = parseNum(s.lengthM);
  const w = parseNum(s.widthM);
  return l && w ? Math.round(l * w * 100) / 100 : null;
}

/** Design load in kW via the studio engine, or null while size is incomplete. */
export function hlLoadKw(s: HlState): number | null {
  const areaM2 = hlArea(s);
  if (!areaM2) return null;
  return roomHeatLoadKw({
    areaM2,
    climateZone: s.climateZone,
    buildingType: s.buildingType,
    baseWm2Override: parseNum(s.wm2Override),
    glazing: s.glazing,
    condition: s.condition,
    ceilingHeightM: parseNum(s.ceilingHeightM) ?? 2.4,
    orientation: s.orientation,
    hasExternalWalls: !s.internal,
  });
}

/** Typical high-wall split capacity classes (generic industry steps, not a
    manufacturer table). Null → beyond single-split territory. */
export const UNIT_CLASSES = [2.0, 2.5, 3.5, 5.0, 6.0, 7.1, 8.0] as const;

export function suggestClassKw(loadKw: number): number | null {
  for (const c of UNIT_CLASSES) if (c >= loadKw - 1e-9) return c;
  return null;
}

const fmtKw = (kw: number) => (Math.round(kw * 10) / 10).toFixed(1);
const fmtArea = (a: number) => (Math.round(a * 10) / 10).toString();

/* ---------- component ---------- */

export function HeatLoadCalculator() {
  const [s, setS] = useState<HlState>(HL_DEFAULTS);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const hydrated = useRef(false);
  const lenRef = useRef<HTMLInputElement>(null);

  /* restore last-used factors once on mount (size fields start blank — a
     quick check always begins with the room in front of you) */
  useEffect(() => {
    try {
      const raw = localStorage.getItem(BUFFER_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as { v: number; s: Partial<HlState> };
        if (saved && saved.v === 2 && saved.s) {
          // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage is client-only; must diverge from the SSR-safe initial render (rate-calculator pattern)
          setS({ ...HL_DEFAULTS, ...saved.s, lengthM: "", widthM: "", areaM2: "" });
        }
      }
    } catch {
      /* corrupt buffer — start fresh */
    }
    hydrated.current = true;
    lenRef.current?.focus();
  }, []);

  /* remember factor changes (not the size — that's per-check) */
  useEffect(() => {
    if (!hydrated.current) return;
    const t = setTimeout(() => {
      try {
        const factors: Partial<HlState> = { ...s };
        delete factors.lengthM;
        delete factors.widthM;
        delete factors.areaM2;
        localStorage.setItem(BUFFER_KEY, JSON.stringify({ v: 2, s: factors }));
      } catch {
        /* storage full/unavailable — non-fatal */
      }
    }, 300);
    return () => clearTimeout(t);
  }, [s]);

  const patch = (p: Partial<HlState>) => setS((prev) => ({ ...prev, ...p }));

  const zone = CLIMATE_ZONES[s.climateZone] ?? CLIMATE_ZONES[DEFAULT_CLIMATE_ZONE];
  const zoneWm2 = baseWm2({ climateZone: s.climateZone, buildingType: s.buildingType });
  const effectiveWm2 = parseNum(s.wm2Override) ?? zoneWm2;

  const areaM2 = hlArea(s);
  const kw = hlLoadKw(s);
  const cls = kw !== null ? suggestClassKw(kw) : null;
  const hMult = heightMult(parseNum(s.ceilingHeightM) ?? 2.4);

  /* one-line recap of the factors driving the number */
  const summary = [
    zone.label.split(" — ")[0],
    BUILDING_OPTS.find((b) => b.value === s.buildingType)?.label,
    parseNum(s.wm2Override) ? `${effectiveWm2} W/m² override` : null,
    `${GLAZING_OPTS.find((g) => g.value === s.glazing)?.label.toLowerCase()} glass`,
    `${CONDITION_OPTS.find((c) => c.value === s.condition)?.label.toLowerCase()} insulation`,
    hMult > 1 ? `high ceiling ×${hMult.toFixed(2)}` : null,
    s.internal ? "internal room" : `${s.orientation}-facing`,
  ]
    .filter(Boolean)
    .join(" · ");

  /* height lives in the size card — it's a room dimension, not a factor */
  const heightInput = (
    <div className="dim1">
      <div className="tunit">
        <input
          id="hl-ch"
          className="tin hl2-in"
          inputMode="decimal"
          aria-label="Ceiling height in metres"
          value={s.ceilingHeightM}
          onChange={(e) => patch({ ceilingHeightM: e.target.value })}
        />
        <span className="u">m</span>
      </div>
      <div className="hl2-cap">
        height{" "}
        <i className="htip" data-tip={TIP_HEIGHT}>
          i
        </i>
      </div>
    </div>
  );

  return (
    <div className="hl2 stgp">
      {/* -------- size — the only required input -------- */}
      <section className="tcard hl2-size">
        <label className="tlab" htmlFor="hl-len">Room size</label>
        {s.areaMode === "dims" ? (
          <div className="hl2-dims">
            <div className="dim1">
              <div className="tunit">
                <input
                  id="hl-len"
                  ref={lenRef}
                  className="tin hl2-in"
                  inputMode="decimal"
                  placeholder="5"
                  aria-label="Length in metres"
                  value={s.lengthM}
                  onChange={(e) => patch({ lengthM: e.target.value })}
                />
                <span className="u">m</span>
              </div>
              <div className="hl2-cap">length</div>
            </div>
            <span className="x">×</span>
            <div className="dim1">
              <div className="tunit">
                <input
                  className="tin hl2-in"
                  inputMode="decimal"
                  placeholder="4"
                  aria-label="Width in metres"
                  value={s.widthM}
                  onChange={(e) => patch({ widthM: e.target.value })}
                />
                <span className="u">m</span>
              </div>
              <div className="hl2-cap">width</div>
            </div>
            <span className="x">×</span>
            {heightInput}
          </div>
        ) : (
          <div className="hl2-dims">
            <div className="dim1 wide">
              <div className="tunit">
                <input
                  id="hl-len"
                  ref={lenRef}
                  className="tin hl2-in"
                  inputMode="decimal"
                  placeholder="20"
                  aria-label="Floor area in square metres"
                  value={s.areaM2}
                  onChange={(e) => patch({ areaM2: e.target.value })}
                />
                <span className="u">m²</span>
              </div>
              <div className="hl2-cap">floor area</div>
            </div>
            <span className="x">×</span>
            {heightInput}
          </div>
        )}
        <button
          type="button"
          className="hl2-mode"
          onClick={() => patch({ areaMode: s.areaMode === "dims" ? "area" : "dims" })}
        >
          {s.areaMode === "dims" ? "Know the area? Enter m² instead" : "Enter length × width instead"}
        </button>
      </section>

      {/* -------- the answer -------- */}
      <section className="hl2-hero" aria-live="polite">
        <span className="gl" />
        <div className="lab">Design load</div>
        {/* dim 0.0 placeholder — an em-dash under the glow reads as a teal bar */}
        <div className={"big" + (kw === null ? " empty" : "")}>
          {kw !== null ? fmtKw(kw) : "0.0"}
          <small>kW</small>
        </div>
        {kw !== null ? (
          <div className="cls">
            {cls !== null ? (
              <>
                Size for a <b>{cls.toFixed(1)} kW class</b> unit or larger
              </>
            ) : (
              <>
                Beyond single-split territory —{" "}
                <Link href="/dashboard/studio">design it in the Studio</Link>
              </>
            )}
          </div>
        ) : (
          <div className="cls dim">Type the room size for an instant answer</div>
        )}
        {areaM2 !== null && (
          <div className="meta">
            {fmtArea(areaM2)} m² × {effectiveWm2} W/m² and factors
          </div>
        )}
        <div className="meta dim2">
          Rule-of-thumb — same engine as Studio rooms. Verify borderline picks.
        </div>
      </section>

      {/* -------- advanced — full width, collapsed behind its summary -------- */}
      <section className="tcard hl2-adv">
        <div className="hl2-advbar">
          <button
            type="button"
            className="hl2-advhead"
            aria-expanded={adjustOpen}
            onClick={() => setAdjustOpen((o) => !o)}
          >
            <b>Advanced</b>
            <span className="sum">{summary}</span>
            <span className={"chev" + (adjustOpen ? " open" : "")}>
              <Icon name="chevR" size={16} />
            </span>
          </button>
          {adjustOpen && (
            <button
              type="button"
              className="hl2-mode reset"
              onClick={() => {
                const { lengthM, widthM, areaM2: a, areaMode, ceilingHeightM } = s;
                setS({ ...HL_DEFAULTS, lengthM, widthM, areaM2: a, areaMode, ceilingHeightM });
              }}
            >
              Reset factors
            </button>
          )}
        </div>

        {adjustOpen && (
          <div className="hl2-fpanel">
            <div className="row3">
              <div>
                <label className="tlab" htmlFor="hl-zone">
                  Climate zone{" "}
                  <i
                    className="htip tip-l"
                    data-tip={`Sets the base rate from the NCC climate-zone table. This zone covers: ${zone.cities}.`}
                  >
                    i
                  </i>
                </label>
                <div className="tselwrap">
                  <select
                    id="hl-zone"
                    className="tin"
                    value={s.climateZone}
                    onChange={(e) => patch({ climateZone: Number(e.target.value) })}
                  >
                    {Object.entries(CLIMATE_ZONES).map(([num, z]) => (
                      <option key={num} value={num}>
                        {z.label}
                      </option>
                    ))}
                  </select>
                  <Icon name="chevD" size={16} />
                </div>
              </div>
              <div>
                <label className="tlab" htmlFor="hl-wm2">
                  Base rate override{" "}
                  <i className="htip" data-tip={TIP_OVERRIDE}>
                    i
                  </i>
                </label>
                <div className="tunit">
                  <input
                    id="hl-wm2"
                    className="tin"
                    inputMode="decimal"
                    placeholder={`${zoneWm2} (zone table)`}
                    value={s.wm2Override}
                    onChange={(e) => patch({ wm2Override: e.target.value })}
                  />
                  <span className="u">W/m²</span>
                </div>
              </div>
              <div>
                <label className="tlab">
                  Building type{" "}
                  <i className="htip tip-r" data-tip={TIP_BUILDING}>
                    i
                  </i>
                </label>
                <div className="tseg" role="group" aria-label="Building type">
                  {BUILDING_OPTS.map((b) => (
                    <button
                      key={b.value}
                      type="button"
                      className={s.buildingType === b.value ? "on" : ""}
                      onClick={() => patch({ buildingType: b.value })}
                    >
                      {b.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="row3">
              <div>
                <label className="tlab">
                  Glazing{" "}
                  <i className="htip tip-l" data-tip={TIP_GLAZING}>
                    i
                  </i>
                </label>
                <div className="tseg" role="group" aria-label="Glazing">
                  {GLAZING_OPTS.map((g) => (
                    <button
                      key={g.value}
                      type="button"
                      className={s.glazing === g.value ? "on" : ""}
                      title={`×${GLAZING_MULT[g.value].toFixed(2)}`}
                      onClick={() => patch({ glazing: g.value })}
                    >
                      {g.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="tlab">
                  Insulation{" "}
                  <i className="htip" data-tip={TIP_CONDITION}>
                    i
                  </i>
                </label>
                <div className="tseg" role="group" aria-label="Insulation">
                  {CONDITION_OPTS.map((c) => (
                    <button
                      key={c.value}
                      type="button"
                      className={s.condition === c.value ? "on" : ""}
                      title={`×${CONDITION_MULT[c.value].toFixed(2)}`}
                      onClick={() => patch({ condition: c.value })}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="tlab">
                  Primary exposed wall faces{" "}
                  <i className="htip tip-r" data-tip={TIP_ORIENT}>
                    i
                  </i>
                </label>
                <div className="tchips" role="group" aria-label="Orientation">
                  {ORIENTATIONS.map((o) => (
                    <button
                      key={o}
                      type="button"
                      className={"tchip" + (s.orientation === o && !s.internal ? " on" : "")}
                      disabled={s.internal}
                      title={`${ORIENT_LABELS[o]} ×${ORIENT_MULT[o].toFixed(2)}`}
                      onClick={() => patch({ orientation: o })}
                    >
                      {o}
                    </button>
                  ))}
                </div>
                <label className="ttog" style={{ marginTop: 8 }}>
                  <input
                    type="checkbox"
                    checked={s.internal}
                    onChange={(e) => patch({ internal: e.target.checked })}
                  />
                  <span className="tr" />
                  <span className="tl">Internal room — no external walls</span>
                </label>
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
