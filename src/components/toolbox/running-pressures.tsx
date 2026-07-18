"use client";

/* Running Pressures — Toolbox troubleshooting reference. Standard R32/R410A
   saturation data (lib/toolbox/refrigerant.ts) presented three ways:
   typical operating windows per mode, the full PT chart, and a live
   superheat / subcooling calculator. Windows are sanity bands for a
   stabilised system — inverters modulate, so they're deliberately wide. */

import { useState } from "react";
import { Icon } from "@/components/shell/icon";
import {
  COOLING_WINDOWS,
  HEATING_WINDOWS,
  kpaToPsi,
  psiToKpa,
  R32_SAT,
  R410A_SAT,
  REFRIGERANTS,
  satTempC,
  subcoolingK,
  superheatK,
  windowPressures,
  type OperatingWindow,
  type Refrigerant,
} from "@/lib/toolbox/refrigerant";

type Unit = "kPa" | "psi";

const fmtP = (kpa: number, unit: Unit) =>
  unit === "kPa" ? `${Math.round(kpa)}` : `${Math.round(kpaToPsi(kpa))}`;

/** Lenient positive-number parse (matches heat-load's input behaviour). */
function num(s: string): number | null {
  const n = Number(String(s).trim().replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
}
/** Temps can legitimately be negative (heating mode suction lines). */
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

function WindowRow({
  w,
  refrigerant,
  unit,
}: {
  w: OperatingWindow;
  refrigerant: Refrigerant;
  unit: Unit;
}) {
  const p = windowPressures(refrigerant, w);
  const suction = w.side === "suction";
  return (
    <div className="rp-win">
      <div
        className="ic"
        style={{
          background: suction ? "rgba(46,104,255,0.1)" : "rgba(255,138,0,0.12)",
          color: suction ? "#2E68FF" : "#E07800",
        }}
      >
        <Icon name={suction ? "arrowDown" : "arrowUp"} size={16} />
      </div>
      <div className="bd">
        <b>{w.label}</b>
        <em>{w.note}</em>
      </div>
      <div className="pv">
        {p && (
          <b>
            {fmtP(p.lo, unit)}–{fmtP(p.hi, unit)} {unit}
          </b>
        )}
        <em>
          sat {w.satLoC}…{w.satHiC}°C
        </em>
      </div>
    </div>
  );
}

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
  const [refrigerant, setRefrigerant] = useState<Refrigerant>("R32");
  const [unit, setUnit] = useState<Unit>("kPa");

  /* superheat inputs */
  const [shP, setShP] = useState("");
  const [shT, setShT] = useState("");
  /* subcool inputs */
  const [scP, setScP] = useState("");
  const [scT, setScT] = useState("");

  const toKpa = (v: number) => (unit === "kPa" ? v : psiToKpa(v));

  const shPk = num(shP) !== null ? toKpa(num(shP)!) : null;
  const shTemp = numSigned(shT);
  const sh = shPk !== null && shTemp !== null ? superheatK(refrigerant, shPk, shTemp) : null;
  const shSat = shPk !== null ? satTempC(refrigerant, shPk) : null;

  const scPk = num(scP) !== null ? toKpa(num(scP)!) : null;
  const scTemp = numSigned(scT);
  const sc = scPk !== null && scTemp !== null ? subcoolingK(refrigerant, scPk, scTemp) : null;
  const scSat = scPk !== null ? satTempC(refrigerant, scPk) : null;

  const offChart = (p: number | null, entered: string) =>
    entered.trim() !== "" && num(entered) !== null && p !== null && satTempC(refrigerant, p) === null;

  return (
    <>
      <div className="rp-ctl stg">
        <div className="tseg" role="group" aria-label="Refrigerant">
          {REFRIGERANTS.map((r) => (
            <button
              key={r}
              type="button"
              className={refrigerant === r ? "on" : ""}
              onClick={() => setRefrigerant(r)}
            >
              {r}
            </button>
          ))}
        </div>
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
          {/* -------- typical windows -------- */}
          <section className="tcard">
            <h2 className="tct">Typical running pressures — {refrigerant}</h2>
            <p className="tcs">
              Gauge pressure at the service ports, system stabilised 10–15 minutes. Inverters modulate —
              treat these as sanity windows, not a spec.
            </p>
            <h3 className="tlab" style={{ marginTop: 4 }}>Cooling mode</h3>
            {COOLING_WINDOWS.map((w) => (
              <WindowRow key={w.key} w={w} refrigerant={refrigerant} unit={unit} />
            ))}
            <h3 className="tlab" style={{ marginTop: 22 }}>Heating mode</h3>
            {HEATING_WINDOWS.map((w) => (
              <WindowRow key={w.key} w={w} refrigerant={refrigerant} unit={unit} />
            ))}
          </section>

          {/* -------- PT chart -------- */}
          <section className="tcard">
            <h2 className="tct">Pressure–temperature chart</h2>
            <p className="tcs">Saturation pressure, {unit} gauge. Standard published data (±1%).</p>
            <div className="rp-legend">
              <span>
                <i style={{ background: "#2e68ff" }} /> typical evaporating band (0–12°C)
              </span>
              <span>
                <i style={{ background: "#ff8a00" }} /> typical condensing band (40–55°C)
              </span>
            </div>
            <div className="rp-tablewrap">
              <table className="rp-table">
                <thead>
                  <tr>
                    <th>Sat temp °C</th>
                    <th>R32 ({unit})</th>
                    <th>R410A ({unit})</th>
                  </tr>
                </thead>
                <tbody>
                  {R32_SAT.map((row, i) => {
                    const band =
                      row.c >= 0 && row.c <= 12 ? "evap" : row.c >= 40 && row.c <= 55 ? "cond" : "";
                    return (
                      <tr key={row.c} className={band}>
                        <td>{row.c}°</td>
                        <td className={refrigerant === "R32" ? "sel" : ""}>{fmtP(row.kpa, unit)}</td>
                        <td className={refrigerant === "R410A" ? "sel" : ""}>
                          {fmtP(R410A_SAT[i].kpa, unit)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        {/* -------- calculator rail -------- */}
        <div className="tstick">
          <section className="tcard">
            <h2 className="tct">Superheat</h2>
            <p className="tcs">Suction pressure + suction line temperature at the outdoor unit.</p>
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
                  ? `${fmtP(shPk!, unit)} ${unit} → sat ${shSat.toFixed(1)}°C`
                  : offChart(shPk, shP)
                    ? "Pressure is off the chart range"
                    : null
              }
            />
          </section>

          <section className="tcard">
            <h2 className="tct">Subcooling</h2>
            <p className="tcs">Liquid pressure + liquid line temperature.</p>
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
                  ? `${fmtP(scPk!, unit)} ${unit} → sat ${scSat.toFixed(1)}°C`
                  : offChart(scPk, scP)
                    ? "Pressure is off the chart range"
                    : null
              }
            />
          </section>

          <section className="tcard">
            <h2 className="tct">Field notes</h2>
            <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 8 }}>
              {[
                "Purge hoses before reading; measure at the service ports.",
                "Let the system stabilise 10–15 min at a fixed demand before judging.",
                "R32 runs slightly higher pressure than R410A at the same temperature — never mix charts.",
                "Typical targets: superheat ~4–10 K, subcooling ~5–8 K. Manufacturer figures override these.",
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
