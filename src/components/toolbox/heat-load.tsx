"use client";

/* Heat Load calculator — Toolbox field tool. Room-by-room rule-of-thumb
   sizing on the SAME engine as the Design Studio rooms (lib/studio/loads.ts:
   area × zone W/m² × glazing × condition × height × orientation), so a number
   quoted from the Toolbox always matches the studio for the same inputs.

   Job-level context (climate zone, building type, optional W/m² override)
   applies to every room; each room owns its dimensions + factors. State is
   buffered to localStorage so a page hop doesn't lose a survey in progress. */

import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/shell/icon";
import {
  baseWm2,
  CLIMATE_ZONES,
  CONDITION_MULT,
  DEFAULT_CLIMATE_ZONE,
  GLAZING_MULT,
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
  { value: "low", label: "Low — double glazed" },
  { value: "moderate", label: "Moderate" },
  { value: "high", label: "High — large / single" },
];
const CONDITION_OPTS: { value: RoomCondition; label: string }[] = [
  { value: "well_insulated", label: "Well insulated" },
  { value: "standard", label: "Standard" },
  { value: "poor", label: "Poor insulation" },
];
const BUILDING_OPTS: { value: BuildingType; label: string }[] = [
  { value: "residential", label: "Residential" },
  { value: "light_commercial", label: "Light commercial" },
  { value: "commercial", label: "Commercial" },
];

/* ---------- state ---------- */

export interface HlRoom {
  id: string;
  name: string;
  areaMode: "dims" | "area";
  lengthM: string;
  widthM: string;
  areaM2: string;
  glazing: GlazingLevel;
  condition: RoomCondition;
  ceilingHeightM: string;
  orientation: Orientation;
  internal: boolean;
}

export interface HlJob {
  climateZone: number;
  buildingType: BuildingType;
  wm2Override: string;
}

const BUFFER_KEY = "heytiff.toolbox.heat-load.v1";

function uid(): string {
  return "r" + Math.random().toString(36).slice(2, 9);
}

/** The pre-hydration first room must have a DETERMINISTIC id — Math.random()
    in the initial render breaks SSR hydration. uid() is for client adds only. */
function newRoom(n: number, id: string = uid()): HlRoom {
  return {
    id,
    name: `Room ${n}`,
    areaMode: "dims",
    lengthM: "",
    widthM: "",
    areaM2: "",
    glazing: "moderate",
    condition: "standard",
    ceilingHeightM: "2.4",
    orientation: "N",
    internal: false,
  };
}

const DEFAULT_JOB: HlJob = {
  climateZone: DEFAULT_CLIMATE_ZONE,
  buildingType: "residential",
  wm2Override: "",
};

/* ---------- pure helpers (exported for tests) ---------- */

/** Lenient numeric input parse — null unless a finite positive number. */
export function parseNum(s: string): number | null {
  const n = Number(String(s).trim().replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Room floor area in m², from L×W or the direct area field. */
export function hlRoomArea(room: Pick<HlRoom, "areaMode" | "lengthM" | "widthM" | "areaM2">): number | null {
  if (room.areaMode === "area") return parseNum(room.areaM2);
  const l = parseNum(room.lengthM);
  const w = parseNum(room.widthM);
  return l && w ? Math.round(l * w * 100) / 100 : null;
}

/** Room design load in kW via the studio engine, or null while inputs are incomplete. */
export function hlRoomLoadKw(room: HlRoom, job: HlJob): number | null {
  const areaM2 = hlRoomArea(room);
  if (!areaM2) return null;
  return roomHeatLoadKw({
    areaM2,
    climateZone: job.climateZone,
    buildingType: job.buildingType,
    baseWm2Override: parseNum(job.wm2Override),
    glazing: room.glazing,
    condition: room.condition,
    ceilingHeightM: parseNum(room.ceilingHeightM) ?? 2.4,
    orientation: room.orientation,
    hasExternalWalls: !room.internal,
  });
}

const fmtKw = (kw: number) => (Math.round(kw * 10) / 10).toFixed(1);
const fmtArea = (a: number) => (Math.round(a * 10) / 10).toString();

/* ---------- component ---------- */

export function HeatLoadCalculator() {
  const [job, setJob] = useState<HlJob>(DEFAULT_JOB);
  const [rooms, setRooms] = useState<HlRoom[]>(() => [newRoom(1, "r-first")]);
  const hydrated = useRef(false);

  /* restore a buffered survey once on mount */
  useEffect(() => {
    try {
      const raw = localStorage.getItem(BUFFER_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as { v: number; job: HlJob; rooms: HlRoom[] };
        if (saved && saved.v === 1 && Array.isArray(saved.rooms) && saved.rooms.length > 0 && saved.job) {
          // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage is client-only; must diverge from the SSR-safe initial render (rate-calculator pattern)
          setJob({ ...DEFAULT_JOB, ...saved.job });
          setRooms(saved.rooms);
        }
      }
    } catch {
      /* corrupt buffer — start fresh */
    }
    hydrated.current = true;
  }, []);

  /* debounce-buffer changes */
  useEffect(() => {
    if (!hydrated.current) return;
    const t = setTimeout(() => {
      try {
        localStorage.setItem(BUFFER_KEY, JSON.stringify({ v: 1, job, rooms }));
      } catch {
        /* storage full/unavailable — non-fatal */
      }
    }, 400);
    return () => clearTimeout(t);
  }, [job, rooms]);

  const zone = CLIMATE_ZONES[job.climateZone] ?? CLIMATE_ZONES[DEFAULT_CLIMATE_ZONE];
  const zoneWm2 = baseWm2({ climateZone: job.climateZone, buildingType: job.buildingType });
  const effectiveWm2 = parseNum(job.wm2Override) ?? zoneWm2;

  const loads = useMemo(
    () => rooms.map((r) => ({ room: r, areaM2: hlRoomArea(r), kw: hlRoomLoadKw(r, job) })),
    [rooms, job]
  );
  const sized = loads.filter((l) => l.kw !== null) as { room: HlRoom; areaM2: number; kw: number }[];
  const totalKw = sized.reduce((s, l) => s + l.kw, 0);
  const totalArea = sized.reduce((s, l) => s + l.areaM2, 0);

  const patchRoom = (id: string, patch: Partial<HlRoom>) =>
    setRooms((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const addRoom = () => setRooms((rs) => [...rs, newRoom(rs.length + 1)]);
  const removeRoom = (id: string) => setRooms((rs) => rs.filter((r) => r.id !== id));
  const resetAll = () => {
    setJob(DEFAULT_JOB);
    setRooms([newRoom(1)]);
  };

  return (
    <div className="tcols stgp">
      <div>
        {/* -------- job settings -------- */}
        <section className="tcard">
          <h2 className="tct">Job settings</h2>
          <p className="tcs">Applies to every room below.</p>
          <div className="hl-grid">
            <div>
              <label className="tlab" htmlFor="hl-zone">Climate zone</label>
              <div className="tselwrap">
                <select
                  id="hl-zone"
                  className="tin"
                  value={job.climateZone}
                  onChange={(e) => setJob({ ...job, climateZone: Number(e.target.value) })}
                >
                  {Object.entries(CLIMATE_ZONES).map(([num, z]) => (
                    <option key={num} value={num}>
                      {z.label}
                    </option>
                  ))}
                </select>
                <Icon name="chevD" size={16} />
              </div>
              <p className="tnote">{zone.cities}. {zone.note}</p>
            </div>
            <div>
              <label className="tlab" htmlFor="hl-wm2">Base rate override</label>
              <div className="tunit">
                <input
                  id="hl-wm2"
                  className="tin"
                  inputMode="decimal"
                  placeholder={String(zoneWm2)}
                  value={job.wm2Override}
                  onChange={(e) => setJob({ ...job, wm2Override: e.target.value })}
                />
                <span className="u">W/m²</span>
              </div>
              <p className="tnote">
                Zone table gives {zoneWm2} W/m² — type a value to override it.
              </p>
            </div>
          </div>
          <div style={{ marginTop: 16 }}>
            <label className="tlab">Building type</label>
            <div className="tseg" role="group" aria-label="Building type">
              {BUILDING_OPTS.map((b) => (
                <button
                  key={b.value}
                  type="button"
                  className={job.buildingType === b.value ? "on" : ""}
                  onClick={() => setJob({ ...job, buildingType: b.value })}
                >
                  {b.label}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* -------- rooms -------- */}
        <section className="tcard">
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
            <div>
              <h2 className="tct">Rooms</h2>
              <p className="tcs">Dimensions and factors per room.</p>
            </div>
            <button type="button" className="tbtn ghost" onClick={resetAll} style={{ padding: "9px 14px", fontSize: 13 }}>
              Reset
            </button>
          </div>

          {rooms.map((room) => {
            const kw = hlRoomLoadKw(room, job);
            return (
              <div key={room.id} className="hl-room">
                <div className="hl-rhead">
                  <div className="nm">
                    <input
                      className="tin"
                      value={room.name}
                      aria-label="Room name"
                      placeholder="Living / Dining"
                      onChange={(e) => patchRoom(room.id, { name: e.target.value })}
                    />
                  </div>
                  <span className="hl-kw">{kw !== null ? `${fmtKw(kw)} kW` : "— kW"}</span>
                  {rooms.length > 1 && (
                    <button
                      type="button"
                      className="ticon danger"
                      aria-label={`Remove ${room.name}`}
                      onClick={() => removeRoom(room.id)}
                    >
                      <Icon name="x" size={16} />
                    </button>
                  )}
                </div>

                {/* dimensions */}
                <div className="hl-grid">
                  <div>
                    <label className="tlab">Size</label>
                    <div className="tseg" role="group" aria-label="Size entry mode">
                      <button
                        type="button"
                        className={room.areaMode === "dims" ? "on" : ""}
                        onClick={() => patchRoom(room.id, { areaMode: "dims" })}
                      >
                        Length × width
                      </button>
                      <button
                        type="button"
                        className={room.areaMode === "area" ? "on" : ""}
                        onClick={() => patchRoom(room.id, { areaMode: "area" })}
                      >
                        Area
                      </button>
                    </div>
                  </div>
                  <div>
                    {room.areaMode === "dims" ? (
                      <div style={{ display: "flex", gap: 10 }}>
                        <div className="tunit" style={{ flex: 1 }}>
                          <input
                            className="tin"
                            inputMode="decimal"
                            placeholder="Length"
                            aria-label="Length in metres"
                            value={room.lengthM}
                            onChange={(e) => patchRoom(room.id, { lengthM: e.target.value })}
                          />
                          <span className="u">m</span>
                        </div>
                        <div className="tunit" style={{ flex: 1 }}>
                          <input
                            className="tin"
                            inputMode="decimal"
                            placeholder="Width"
                            aria-label="Width in metres"
                            value={room.widthM}
                            onChange={(e) => patchRoom(room.id, { widthM: e.target.value })}
                          />
                          <span className="u">m</span>
                        </div>
                      </div>
                    ) : (
                      <div className="tunit">
                        <input
                          className="tin"
                          inputMode="decimal"
                          placeholder="Floor area"
                          aria-label="Floor area in square metres"
                          value={room.areaM2}
                          onChange={(e) => patchRoom(room.id, { areaM2: e.target.value })}
                        />
                        <span className="u">m²</span>
                      </div>
                    )}
                    {room.areaMode === "dims" && hlRoomArea(room) !== null && (
                      <p className="tnote">= {fmtArea(hlRoomArea(room)!)} m²</p>
                    )}
                  </div>
                </div>

                {/* factors */}
                <div className="hl-frow">
                  <div>
                    <label className="tlab" htmlFor={`hl-gl-${room.id}`}>Glazing</label>
                    <div className="tselwrap">
                      <select
                        id={`hl-gl-${room.id}`}
                        className="tin"
                        value={room.glazing}
                        onChange={(e) => patchRoom(room.id, { glazing: e.target.value as GlazingLevel })}
                      >
                        {GLAZING_OPTS.map((g) => (
                          <option key={g.value} value={g.value}>
                            {g.label} (×{GLAZING_MULT[g.value].toFixed(2)})
                          </option>
                        ))}
                      </select>
                      <Icon name="chevD" size={16} />
                    </div>
                  </div>
                  <div>
                    <label className="tlab" htmlFor={`hl-in-${room.id}`}>Insulation</label>
                    <div className="tselwrap">
                      <select
                        id={`hl-in-${room.id}`}
                        className="tin"
                        value={room.condition}
                        onChange={(e) => patchRoom(room.id, { condition: e.target.value as RoomCondition })}
                      >
                        {CONDITION_OPTS.map((c) => (
                          <option key={c.value} value={c.value}>
                            {c.label} (×{CONDITION_MULT[c.value].toFixed(2)})
                          </option>
                        ))}
                      </select>
                      <Icon name="chevD" size={16} />
                    </div>
                  </div>
                  <div>
                    <label className="tlab" htmlFor={`hl-ch-${room.id}`}>Ceiling height</label>
                    <div className="tunit">
                      <input
                        id={`hl-ch-${room.id}`}
                        className="tin"
                        inputMode="decimal"
                        value={room.ceilingHeightM}
                        onChange={(e) => patchRoom(room.id, { ceilingHeightM: e.target.value })}
                      />
                      <span className="u">m</span>
                    </div>
                    <p className="tnote">Over 2.7 m adds 10%.</p>
                  </div>
                </div>

                {/* orientation */}
                <div className="hl-orow">
                  <div>
                    <label className="tlab">Primary exposed wall faces</label>
                    <div className="tchips" role="group" aria-label="Orientation">
                      {ORIENTATIONS.map((o) => (
                        <button
                          key={o}
                          type="button"
                          className={"tchip" + (room.orientation === o && !room.internal ? " on" : "")}
                          disabled={room.internal}
                          title={`${ORIENT_LABELS[o]} ×${ORIENT_MULT[o].toFixed(2)}`}
                          onClick={() => patchRoom(room.id, { orientation: o })}
                        >
                          {o}
                        </button>
                      ))}
                    </div>
                  </div>
                  <label className="ttog">
                    <input
                      type="checkbox"
                      checked={room.internal}
                      onChange={(e) => patchRoom(room.id, { internal: e.target.checked })}
                    />
                    <span className="tr" />
                    <span className="tl">Internal room — no external walls</span>
                  </label>
                </div>
              </div>
            );
          })}

          <div style={{ marginTop: 16 }}>
            <button type="button" className="tbtn ghost" onClick={addRoom}>
              <Icon name="plus" size={16} />
              Add room
            </button>
          </div>
        </section>
      </div>

      {/* -------- summary rail -------- */}
      <div className="tstick">
        <div className="hl-total">
          <span className="gl" />
          <div className="lab">Total design load</div>
          <div className="big">
            {sized.length > 0 ? fmtKw(totalKw) : "0.0"}
            <small>kW</small>
          </div>
          <div className="meta">
            <div>
              <b>{sized.length}</b>
              <em>{sized.length === 1 ? "room" : "rooms"}</em>
            </div>
            <div>
              <b>{fmtArea(totalArea)} m²</b>
              <em>floor area</em>
            </div>
            <div>
              <b>{effectiveWm2} W/m²</b>
              <em>base rate</em>
            </div>
          </div>
        </div>

        <div className="tcard" style={{ marginTop: 20 }}>
          <h2 className="tct">By room</h2>
          <div className="hl-rows">
            {sized.length === 0 ? (
              <p className="tnote" style={{ marginTop: 0 }}>
                Enter a room&apos;s dimensions to see its load.
              </p>
            ) : (
              sized.map(({ room, areaM2, kw }) => (
                <div key={room.id} className="hl-rrow">
                  <span className="dot" />
                  <b>{room.name.trim() || "Room"}</b>
                  <em>{fmtArea(areaM2)} m²</em>
                  <strong>{fmtKw(kw)} kW</strong>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="tcard" style={{ marginTop: 20 }}>
          <p className="tnote" style={{ margin: 0 }}>
            Rule-of-thumb estimate (area × zone W/m² × factors) — the same
            engine as Design Studio rooms. For borderline or commercial
            selections, verify with a full heat-load calculation.
          </p>
        </div>
      </div>
    </div>
  );
}
