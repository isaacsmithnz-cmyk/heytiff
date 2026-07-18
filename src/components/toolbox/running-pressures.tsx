"use client";

/* Running Pressures — Toolbox troubleshooting reference, rebuilt around the
   original app's toolbox identity (the tile always promised "R32 · R410A ·
   R22"): a colour-coded refrigerant picker with those three leading, then
   every refrigerant an Australian tech meets.

   Reads like a manifold: LOW side panel is BLUE, HIGH side panel is RED
   (hose colours), each showing the expected pressure band big, with a bar
   showing where the band sits on the refrigerant's full chart scale. Below,
   the PT chart for the selected refrigerant — one column for pure fluids,
   liquid/vapor columns for glide blends (R407C) — and live superheat /
   subcooling calculators that automatically read the correct column. */

import { useState } from "react";
import {
  getRefrigerant,
  kpaToPsi,
  psiToKpa,
  REFRIGERANTS,
  satTempC,
  subcoolingK,
  superheatK,
  windowPressures,
  type OperatingWindow,
  type RefrigerantKey,
} from "@/lib/toolbox/refrigerant";

type Unit = "kPa" | "psi";
type Mode = "cooling" | "heating";

const LOW = "#2E68FF"; // manifold low-side hose blue
const HIGH = "#FF3366"; // manifold high-side hose red

const fmtP = (kpa: number, unit: Unit) =>
  unit === "kPa" ? `${Math.round(kpa)}` : `${Math.round(kpaToPsi(kpa))}`;

/** Lenient positive-number parse (matches heat-load's input behaviour). */
function num(s: string): number | null {
  const n = Number(String(s).trim().replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
}
/** Temps can legitimately be negative (heating mode, cold rooms). */
function numSigned(s: string): number | null {
  const t = String(s).trim().replace(",", ".");
  if (t === "" || t === "-") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/* generic field bands — manufacturer targets win when known */
function shStatus(sh: number): { label: string; tone: "ok" | "low" | "high" } {
  if (sh < 2) return { label: "Low — flood-back risk", tone: "low" };
  if (sh > 12) return { label: "High — check charge / restriction", tone: "high" };
  return { label: "Within typical range", tone: "ok" };
}
function scStatus(sc: number): { label: string; tone: "ok" | "low" | "high" } {
  if (sc < 2) return { label: "Low — undercharge / flash gas", tone: "low" };
  if (sc > 10) return { label: "High — overcharge / restriction", tone: "high" };
  return { label: "Within typical range", tone: "ok" };
}

const TONE_STYLE: Record<"ok" | "low" | "high", React.CSSProperties> = {
  ok: { background: "rgba(0,229,192,0.14)", color: "#00A389" },
  low: { background: "rgba(46,104,255,0.12)", color: "#2E68FF" },
  high: { background: "rgba(255,51,102,0.12)", color: "#E0244B" },
};

/* ---------- pressure band bar: where the window sits on the chart scale ---------- */

function BandBar({
  refKey,
  w,
  color,
}: {
  refKey: RefrigerantKey;
  w: OperatingWindow;
  color: string;
}) {
  const r = getRefrigerant(refKey);
  const band = windowPressures(refKey, w);
  if (!band) return null;
  const side = w.side === "suction" ? "vapor" : "liquid";
  const max = r.table[r.table.length - 1][side];
  const lo = Math.max(0, (band.lo / max) * 100);
  const hi = Math.min(100, (band.hi / max) * 100);
  return (
    <div className="rp2-bar" aria-hidden="true">
      <span
        className="fill"
        style={{ left: `${lo}%`, width: `${Math.max(hi - lo, 2)}%`, background: color }}
      />
    </div>
  );
}

function SidePanel({
  refKey,
  windows,
  side,
  unit,
}: {
  refKey: RefrigerantKey;
  windows: OperatingWindow[];
  side: "suction" | "discharge";
  unit: Unit;
}) {
  const low = side === "suction";
  const color = low ? LOW : HIGH;
  const ws = windows.filter((w) => w.side === side);
  return (
    <div className={"rp2-side " + (low ? "low" : "high")}>
      <div className="hdr">
        <span className="hose" style={{ background: color }} />
        <b>{low ? "Low side" : "High side"}</b>
        <em>{low ? "suction · vapor" : "discharge · liquid"}</em>
      </div>
      {ws.map((w) => {
        const band = windowPressures(refKey, w);
        return (
          <div key={w.key} className="rp2-win">
            <div className="wl">{w.label}</div>
            {band && (
              <div className="big" style={{ color }}>
                {fmtP(band.lo, unit)}–{fmtP(band.hi, unit)}
                <small> {unit}</small>
              </div>
            )}
            <div className="sat">
              sat {w.satLoC}…{w.satHiC}°C
            </div>
            <BandBar refKey={refKey} w={w} color={color} />
            <p className="note">{w.note}</p>
          </div>
        );
      })}
    </div>
  );
}

/* ---------- calculators ---------- */

function CalcResult({
  value,
  unitLabel,
  status,
  satLine,
}: {
  value: number | null;
  unitLabel: string;
  status: { label: string; tone: "ok" | "low" | "high" } | null;
  satLine: string | null;
}) {
  return (
    <div className="rp-res">
      <div className="val">
        {value !== null ? value.toFixed(1) : "—"}
        <small>{unitLabel}</small>
      </div>
      {satLine && <div className="rp-sat">{satLine}</div>}
      {value !== null && status && (
        <span className="st" style={TONE_STYLE[status.tone]}>
          {status.label}
        </span>
      )}
    </div>
  );
}

export function RunningPressures() {
  const [refKey, setRefKey] = useState<RefrigerantKey>("R32");
  const [unit, setUnit] = useState<Unit>("kPa");
  const [mode, setMode] = useState<Mode>("cooling");

  /* superheat / subcool inputs */
  const [shP, setShP] = useState("");
  const [shT, setShT] = useState("");
  const [scP, setScP] = useState("");
  const [scT, setScT] = useState("");

  const r = getRefrigerant(refKey);
  const hasHeating = r.heating.length > 0;
  const activeMode: Mode = hasHeating ? mode : "cooling";
  const windows = activeMode === "cooling" ? r.cooling : r.heating;
  const glide = r.glideK >= 1;

  const toKpa = (v: number) => (unit === "kPa" ? v : psiToKpa(v));

  const shPk = num(shP) !== null ? toKpa(num(shP)!) : null;
  const shTemp = numSigned(shT);
  const sh = shPk !== null && shTemp !== null ? superheatK(refKey, shPk, shTemp) : null;
  const shSat = shPk !== null ? satTempC(refKey, shPk, "vapor") : null;

  const scPk = num(scP) !== null ? toKpa(num(scP)!) : null;
  const scTemp = numSigned(scT);
  const sc = scPk !== null && scTemp !== null ? subcoolingK(refKey, scPk, scTemp) : null;
  const scSat = scPk !== null ? satTempC(refKey, scPk, "liquid") : null;

  return (
    <>
      {/* -------- refrigerant picker — colour-coded, most relevant first -------- */}
      <div className="rp2-picker stg" role="group" aria-label="Refrigerant">
        {REFRIGERANTS.map((x) => (
          <button
            key={x.key}
            type="button"
            className={"rp2-card" + (x.key === refKey ? " on" : "")}
            style={{ "--rc": x.color } as React.CSSProperties}
            onClick={() => setRefKey(x.key)}
            aria-pressed={x.key === refKey}
          >
            <span className="dot" />
            <b>{x.key}</b>
            <em>{x.status}</em>
            {x.flammable && (
              <span className="fl">{x.safety.startsWith("A3") ? "A3" : "A2L"}</span>
            )}
          </button>
        ))}
      </div>

      {/* facts strip for the selected refrigerant */}
      <div className="rp2-facts stg">
        <b style={{ color: r.color }}>{r.key}</b>
        <span>{r.name}</span>
        <span className="sep">·</span>
        <span>{r.uses}</span>
        <span className="sep">·</span>
        <span>{r.safety}</span>
        {glide && (
          <>
            <span className="sep">·</span>
            <span className="glide">glide ~{r.glideK} K — two-column chart</span>
          </>
        )}
      </div>

      <div className="rp-ctl stg">
        {hasHeating && (
          <div className="tseg" role="group" aria-label="Mode">
            {(["cooling", "heating"] as Mode[]).map((m) => (
              <button
                key={m}
                type="button"
                className={activeMode === m ? "on" : ""}
                onClick={() => setMode(m)}
              >
                {m === "cooling" ? "Cooling" : "Heating"}
              </button>
            ))}
          </div>
        )}
        <div className="tseg" role="group" aria-label="Pressure unit">
          {(["kPa", "psi"] as Unit[]).map((u) => (
            <button key={u} type="button" className={unit === u ? "on" : ""} onClick={() => setUnit(u)}>
              {u}
            </button>
          ))}
        </div>
      </div>

      <div className="tcols stgp">
        <div>
          {/* -------- the manifold view: low blue, high red -------- */}
          <section className="tcard rp2-gauges">
            <h2 className="tct">
              Typical running pressures — {r.key}
              {activeMode === "heating" ? " · heating" : ""}
            </h2>
            <p className="tcs">
              Gauge pressure at the service ports, system stabilised 10–15 minutes. Inverters
              modulate — sanity windows, not a spec.
            </p>
            <div className="rp2-sides">
              <SidePanel refKey={refKey} windows={windows} side="suction" unit={unit} />
              <SidePanel refKey={refKey} windows={windows} side="discharge" unit={unit} />
            </div>
          </section>

          {/* -------- PT chart for the selected refrigerant -------- */}
          <section className="tcard">
            <h2 className="tct">PT chart — {r.key}</h2>
            <p className="tcs">
              Saturation pressure, {unit} gauge. Standard published data (±1–3%).
              {glide ? " Subcool from the Liquid column, superheat from the Vapor column." : ""}
            </p>
            <div className="rp-tablewrap">
              <table className="rp-table">
                <thead>
                  <tr>
                    <th>Sat temp °C</th>
                    {glide ? (
                      <>
                        <th>Liquid ({unit})</th>
                        <th>Vapor ({unit})</th>
                      </>
                    ) : (
                      <th>Pressure ({unit})</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {r.table.map((row) => {
                    const suction = windows.find((w) => w.side === "suction");
                    const discharge = windows.find((w) => w.side === "discharge");
                    const band =
                      suction && row.c >= suction.satLoC && row.c <= suction.satHiC
                        ? "evap"
                        : discharge && row.c >= discharge.satLoC && row.c <= discharge.satHiC
                          ? "cond"
                          : "";
                    return (
                      <tr key={row.c} className={band}>
                        <td>{row.c}°</td>
                        {glide ? (
                          <>
                            <td>{fmtP(row.liquid, unit)}</td>
                            <td>{fmtP(row.vapor, unit)}</td>
                          </>
                        ) : (
                          <td>{fmtP(row.vapor, unit)}</td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="rp-legend" style={{ marginTop: 12, marginBottom: 0 }}>
              <span>
                <i style={{ background: LOW }} /> typical evaporating band
              </span>
              <span>
                <i style={{ background: HIGH }} /> typical condensing band
              </span>
            </div>
          </section>
        </div>

        {/* -------- calculator rail -------- */}
        <div className="tstick">
          <section className="tcard">
            <h2 className="tct">Superheat</h2>
            <p className="tcs">
              Suction pressure + suction line temperature{glide ? " (vapor column)" : ""}.
            </p>
            <div style={{ display: "flex", gap: 10 }}>
              <div className="tunit" style={{ flex: 1 }}>
                <input
                  className="tin"
                  inputMode="decimal"
                  placeholder="Suction"
                  aria-label={`Suction pressure in ${unit}`}
                  value={shP}
                  onChange={(e) => setShP(e.target.value)}
                />
                <span className="u">{unit}</span>
              </div>
              <div className="tunit" style={{ flex: 1 }}>
                <input
                  className="tin"
                  inputMode="decimal"
                  placeholder="Line temp"
                  aria-label="Suction line temperature in °C"
                  value={shT}
                  onChange={(e) => setShT(e.target.value)}
                />
                <span className="u">°C</span>
              </div>
            </div>
            <CalcResult
              value={sh}
              unitLabel="K superheat"
              status={sh !== null ? shStatus(sh) : null}
              satLine={
                shSat !== null
                  ? `${fmtP(shPk!, unit)} ${unit} → sat ${shSat.toFixed(1)}°C${glide ? " (dew)" : ""}`
                  : shPk !== null
                    ? "Pressure is off the chart range"
                    : null
              }
            />
          </section>

          <section className="tcard">
            <h2 className="tct">Subcooling</h2>
            <p className="tcs">
              Liquid pressure + liquid line temperature{glide ? " (liquid column)" : ""}.
            </p>
            <div style={{ display: "flex", gap: 10 }}>
              <div className="tunit" style={{ flex: 1 }}>
                <input
                  className="tin"
                  inputMode="decimal"
                  placeholder="Liquid"
                  aria-label={`Liquid pressure in ${unit}`}
                  value={scP}
                  onChange={(e) => setScP(e.target.value)}
                />
                <span className="u">{unit}</span>
              </div>
              <div className="tunit" style={{ flex: 1 }}>
                <input
                  className="tin"
                  inputMode="decimal"
                  placeholder="Line temp"
                  aria-label="Liquid line temperature in °C"
                  value={scT}
                  onChange={(e) => setScT(e.target.value)}
                />
                <span className="u">°C</span>
              </div>
            </div>
            <CalcResult
              value={sc}
              unitLabel="K subcooling"
              status={sc !== null ? scStatus(sc) : null}
              satLine={
                scSat !== null
                  ? `${fmtP(scPk!, unit)} ${unit} → sat ${scSat.toFixed(1)}°C${glide ? " (bubble)" : ""}`
                  : scPk !== null
                    ? "Pressure is off the chart range"
                    : null
              }
            />
          </section>

          <section className="tcard">
            <h2 className="tct">Field notes</h2>
            <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 8 }}>
              {[
                "Blue hose = low side (suction), red = high side (discharge) — the panels above match.",
                "Purge hoses before reading; measure at the service ports; let it stabilise 10–15 min.",
                "Typical AC targets: superheat ~4–10 K, subcooling ~5–8 K. Manufacturer figures override these.",
                "R32 (A2L) and R290 (A3) are flammable — no open flame, ventilate, use rated recovery gear.",
                "R407C glides ~5.5 K — always use the two-column chart, never a single-value app for it.",
                "Pressures alone don't confirm charge — weigh refrigerant for anything beyond top-up diagnosis.",
              ].map((n) => (
                <li key={n} className="tnote" style={{ margin: 0 }}>
                  {n}
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </>
  );
}
