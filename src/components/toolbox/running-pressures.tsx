"use client";

/* Running Pressures — the Toolbox troubleshooting tool, one screen with two
   views (the original app carried a single "R32 · R410A · R22" tile here,
   not a separate fault finder, so the two live together):

   ESTIMATE (default) — pick refrigerant, duty and the AMBIENT temperature and
   read what the gauges should show. Ambient is the dial that actually moves
   the numbers on site, so the estimate tracks it rather than quoting one
   static band.

   TROUBLESHOOT — type the pressures you actually measured (kPa or psi) and
   get a plain-language breakdown of what the pattern suggests, plus the
   bullet list of what to check. Optional line temps add the superheat /
   subcooling read. Fault-finding here is pressure-driven by design. */

import { useState } from "react";
import {
  DEFAULT_AMBIENT_C,
  DEFAULT_SPACE_C,
  diagnose,
  dutiesFor,
  estimatePressures,
  type Duty,
} from "@/lib/toolbox/diagnose";
import {
  getRefrigerant,
  kpaToPsi,
  psiToKpa,
  REFRIGERANTS,
  type RefrigerantKey,
} from "@/lib/toolbox/refrigerant";

type Unit = "kPa" | "psi";
type View = "estimate" | "troubleshoot";

const LOW = "#2E68FF"; // manifold low-side hose blue
const HIGH = "#FF3366"; // manifold high-side hose red

const DUTY_LABEL: Record<Duty, string> = {
  cooling: "Cooling",
  heating: "Heating",
  refrigeration: "Refrigeration",
};
const SPACE_LABEL: Record<Duty, string> = {
  cooling: "Indoor",
  heating: "Indoor",
  refrigeration: "Box temp",
};

const fmtP = (kpa: number, unit: Unit) =>
  unit === "kPa" ? `${Math.round(kpa)}` : `${Math.round(kpaToPsi(kpa))}`;

/** Positive-number parse for pressures. */
function num(s: string): number | null {
  const n = Number(String(s).trim().replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
}
/** Signed parse — temperatures go below zero. */
function numSigned(s: string): number | null {
  const t = String(s).trim().replace(",", ".");
  if (t === "" || t === "-") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

const LEVEL_WORD = { low: "LOW", normal: "OK", high: "HIGH" } as const;
const LEVEL_TONE: Record<"low" | "normal" | "high", string> = {
  low: "#2E68FF",
  normal: "#00A389",
  high: "#E0244B",
};

/* ---------- estimate view ---------- */

function GaugeCard({
  side,
  kpa,
  satC,
  unit,
  label,
}: {
  side: "low" | "high";
  kpa: number | null;
  satC: number;
  unit: Unit;
  label: string;
}) {
  const low = side === "low";
  const color = low ? LOW : HIGH;
  return (
    <div className={"rp2-side " + (low ? "low" : "high")}>
      <div className="hdr">
        <span className="hose" style={{ background: color }} />
        <b>{low ? "Low side" : "High side"}</b>
        <em>{low ? "suction" : "discharge"}</em>
      </div>
      <div className="rp2-win">
        <div className="wl">{label}</div>
        <div className="big" style={{ color }}>
          {kpa !== null ? fmtP(kpa, unit) : "—"}
          <small> {unit}</small>
        </div>
        <div className="sat">
          {kpa !== null ? `saturation ${satC}°C` : "outside the chart range"}
        </div>
      </div>
    </div>
  );
}

/* ---------- troubleshoot view ---------- */

function ReadingChip({
  title,
  level,
  satC,
  expectedSatC,
  deltaK,
}: {
  title: string;
  level: "low" | "normal" | "high";
  satC: number | null;
  expectedSatC: number;
  deltaK: number | null;
}) {
  return (
    <div className="rp2-read">
      <div className="rl">{title}</div>
      <div className="rv" style={{ color: LEVEL_TONE[level] }}>
        {LEVEL_WORD[level]}
      </div>
      <div className="rd">
        {satC !== null ? `${satC}°C vs ${expectedSatC}°C expected` : "off chart"}
        {deltaK !== null && (
          <b style={{ color: LEVEL_TONE[level] }}>
            {" "}
            ({deltaK > 0 ? "+" : ""}
            {deltaK} K)
          </b>
        )}
      </div>
    </div>
  );
}

export function RunningPressures() {
  const [view, setView] = useState<View>("estimate");
  const [refKey, setRefKey] = useState<RefrigerantKey>("R32");
  const [unit, setUnit] = useState<Unit>("kPa");
  const [duty, setDuty] = useState<Duty>("cooling");
  const [ambient, setAmbient] = useState(String(DEFAULT_AMBIENT_C.cooling));
  const [space, setSpace] = useState(String(DEFAULT_SPACE_C.cooling));

  /* measured readings (troubleshoot view) */
  const [mSuction, setMSuction] = useState("");
  const [mDischarge, setMDischarge] = useState("");
  const [mSucLine, setMSucLine] = useState("");
  const [mLiqLine, setMLiqLine] = useState("");

  const r = getRefrigerant(refKey);
  const duties = dutiesFor(refKey);
  const activeDuty: Duty = duties.includes(duty) ? duty : duties[0];

  /* switching refrigerant/duty resets the temperatures to that duty's norms */
  const applyDuty = (d: Duty) => {
    setDuty(d);
    setAmbient(String(DEFAULT_AMBIENT_C[d]));
    setSpace(String(DEFAULT_SPACE_C[d]));
  };
  const applyRefrigerant = (k: RefrigerantKey) => {
    setRefKey(k);
    const next = dutiesFor(k);
    if (!next.includes(duty)) applyDuty(next[0]);
  };

  const ambientC = numSigned(ambient) ?? DEFAULT_AMBIENT_C[activeDuty];
  const spaceC = numSigned(space) ?? DEFAULT_SPACE_C[activeDuty];

  const est = estimatePressures({
    refrigerant: refKey,
    duty: activeDuty,
    ambientC,
    spaceC,
  });

  const toKpa = (v: number) => (unit === "kPa" ? v : psiToKpa(v));
  const sucKpa = num(mSuction) !== null ? toKpa(num(mSuction)!) : null;
  const disKpa = num(mDischarge) !== null ? toKpa(num(mDischarge)!) : null;

  const dx =
    sucKpa !== null && disKpa !== null
      ? diagnose({
          refrigerant: refKey,
          duty: activeDuty,
          ambientC,
          spaceC,
          suctionKpa: sucKpa,
          dischargeKpa: disKpa,
          suctionLineC: numSigned(mSucLine),
          liquidLineC: numSigned(mLiqLine),
        })
      : null;

  return (
    <>
      {/* -------- refrigerant picker -------- */}
      <div className="rp2-picker stg" role="group" aria-label="Refrigerant">
        {REFRIGERANTS.map((x) => (
          <button
            key={x.key}
            type="button"
            className={"rp2-card" + (x.key === refKey ? " on" : "")}
            style={{ "--rc": x.color } as React.CSSProperties}
            onClick={() => applyRefrigerant(x.key)}
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

      <div className="rp2-facts stg">
        <b style={{ color: r.color }}>{r.key}</b>
        <span>{r.uses}</span>
        <span className="sep">·</span>
        <span>{r.safety}</span>
        {r.glideK >= 1 && (
          <>
            <span className="sep">·</span>
            <span className="glide">glide ~{r.glideK} K — two-column chart</span>
          </>
        )}
      </div>

      {/* -------- view switch + conditions -------- */}
      <div className="rp2-bar2 stg">
        <div className="tseg rp2-view" role="group" aria-label="View">
          <button
            type="button"
            className={view === "estimate" ? "on" : ""}
            onClick={() => setView("estimate")}
          >
            Estimate
          </button>
          <button
            type="button"
            className={view === "troubleshoot" ? "on" : ""}
            onClick={() => setView("troubleshoot")}
          >
            Troubleshoot
          </button>
        </div>

        {duties.length > 1 && (
          <div className="tseg" role="group" aria-label="Duty">
            {duties.map((d) => (
              <button
                key={d}
                type="button"
                className={activeDuty === d ? "on" : ""}
                onClick={() => applyDuty(d)}
              >
                {DUTY_LABEL[d]}
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

        <div className="rp2-temps">
          <label className="tt">
            <span>Ambient</span>
            <div className="tunit">
              <input
                className="tin"
                inputMode="decimal"
                aria-label="Ambient temperature in °C"
                value={ambient}
                onChange={(e) => setAmbient(e.target.value)}
              />
              <span className="u">°C</span>
            </div>
          </label>
          <label className="tt">
            <span>{SPACE_LABEL[activeDuty]}</span>
            <div className="tunit">
              <input
                className="tin"
                inputMode="decimal"
                aria-label={`${SPACE_LABEL[activeDuty]} temperature in °C`}
                value={space}
                onChange={(e) => setSpace(e.target.value)}
              />
              <span className="u">°C</span>
            </div>
          </label>
        </div>
      </div>

      {view === "estimate" ? (
        <div className="tcols stgp">
          <div>
            <section className="tcard rp2-gauges">
              <h2 className="tct">
                Expected at {ambientC}°C ambient — {r.key} · {DUTY_LABEL[activeDuty].toLowerCase()}
              </h2>
              <p className="tcs">
                What the gauges should read once the system has run 10–15 minutes. Inverters
                modulate, so treat these as the middle of a sane range, not a spec.
              </p>
              <div className="rp2-sides">
                <GaugeCard
                  side="low"
                  kpa={est.suctionKpa}
                  satC={est.evapSatC}
                  unit={unit}
                  label="Suction"
                />
                <GaugeCard
                  side="high"
                  kpa={est.dischargeKpa}
                  satC={est.condSatC}
                  unit={unit}
                  label="Discharge"
                />
              </div>
              <p className="rp2-basis">{est.basis}</p>
              {est.offChart && (
                <p className="rp2-basis warn">
                  One side falls outside this refrigerant&apos;s chart range — check the duty and
                  temperatures.
                </p>
              )}
            </section>

            {/* PT chart */}
            <section className="tcard">
              <h2 className="tct">PT chart — {r.key}</h2>
              <p className="tcs">
                Saturation pressure, {unit} gauge.
                {r.glideK >= 1
                  ? " Subcool from the Liquid column, superheat from the Vapor column."
                  : ""}
              </p>
              <div className="rp-tablewrap">
                <table className="rp-table">
                  <thead>
                    <tr>
                      <th>Sat temp °C</th>
                      {r.glideK >= 1 ? (
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
                      const near = (t: number) => Math.abs(row.c - t) <= 2.5;
                      const band = near(est.evapSatC) ? "evap" : near(est.condSatC) ? "cond" : "";
                      return (
                        <tr key={row.c} className={band}>
                          <td>{row.c}°</td>
                          {r.glideK >= 1 ? (
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
                  <i style={{ background: LOW }} /> expected evaporating
                </span>
                <span>
                  <i style={{ background: HIGH }} /> expected condensing
                </span>
              </div>
            </section>
          </div>

          <div className="tstick">
            <section className="tcard rp2-cta">
              <h2 className="tct">Gauges not matching?</h2>
              <p className="tcs">
                Type what you actually measured and this will work through what the pattern
                suggests.
              </p>
              <button type="button" className="tbtn" onClick={() => setView("troubleshoot")}>
                Troubleshoot my readings
              </button>
            </section>

            <section className="tcard">
              <h2 className="tct">Field notes</h2>
              <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 8 }}>
                {[
                  "Blue = low side (suction), red = high side (discharge) — the panels match your hoses.",
                  "Purge hoses before reading; measure at the service ports; let it stabilise 10–15 min.",
                  "Typical AC targets: superheat ~4–10 K, subcooling ~5–8 K. Manufacturer figures override these.",
                  "R32 (A2L) and R290 (A3) are flammable — no open flame, ventilate, use rated recovery gear.",
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
      ) : (
        /* ---------------- troubleshoot ---------------- */
        <div className="tcols stgp">
          <div>
            <section className="tcard">
              <h2 className="tct">Your readings</h2>
              <p className="tcs">
                Gauge pressures in {unit}. Line temperatures are optional — add them and you also
                get superheat and subcooling.
              </p>
              <div className="rp2-inputs">
                <div>
                  <label className="tlab" htmlFor="rp-suc">
                    Suction pressure
                  </label>
                  <div className="tunit">
                    <input
                      id="rp-suc"
                      className="tin rp2-big"
                      inputMode="decimal"
                      placeholder={est.suctionKpa !== null ? fmtP(est.suctionKpa, unit) : ""}
                      aria-label={`Measured suction pressure in ${unit}`}
                      value={mSuction}
                      onChange={(e) => setMSuction(e.target.value)}
                    />
                    <span className="u">{unit}</span>
                  </div>
                </div>
                <div>
                  <label className="tlab" htmlFor="rp-dis">
                    Discharge pressure
                  </label>
                  <div className="tunit">
                    <input
                      id="rp-dis"
                      className="tin rp2-big"
                      inputMode="decimal"
                      placeholder={est.dischargeKpa !== null ? fmtP(est.dischargeKpa, unit) : ""}
                      aria-label={`Measured discharge pressure in ${unit}`}
                      value={mDischarge}
                      onChange={(e) => setMDischarge(e.target.value)}
                    />
                    <span className="u">{unit}</span>
                  </div>
                </div>
                <div>
                  <label className="tlab" htmlFor="rp-sl">
                    Suction line temp
                  </label>
                  <div className="tunit">
                    <input
                      id="rp-sl"
                      className="tin"
                      inputMode="decimal"
                      placeholder="optional"
                      aria-label="Suction line temperature in °C"
                      value={mSucLine}
                      onChange={(e) => setMSucLine(e.target.value)}
                    />
                    <span className="u">°C</span>
                  </div>
                </div>
                <div>
                  <label className="tlab" htmlFor="rp-ll">
                    Liquid line temp
                  </label>
                  <div className="tunit">
                    <input
                      id="rp-ll"
                      className="tin"
                      inputMode="decimal"
                      placeholder="optional"
                      aria-label="Liquid line temperature in °C"
                      value={mLiqLine}
                      onChange={(e) => setMLiqLine(e.target.value)}
                    />
                    <span className="u">°C</span>
                  </div>
                </div>
              </div>
              <p className="rp2-basis">
                Compared against {r.key} · {DUTY_LABEL[activeDuty].toLowerCase()} at {ambientC}°C
                ambient. {est.basis}
              </p>
            </section>

            {dx ? (
              <section className={"tcard rp2-dx " + dx.severity}>
                <div className="rp2-reads">
                  <ReadingChip
                    title="Low side"
                    level={dx.suction.level}
                    satC={dx.suction.satC}
                    expectedSatC={dx.suction.expectedSatC}
                    deltaK={dx.suction.deltaK}
                  />
                  <ReadingChip
                    title="High side"
                    level={dx.discharge.level}
                    satC={dx.discharge.satC}
                    expectedSatC={dx.discharge.expectedSatC}
                    deltaK={dx.discharge.deltaK}
                  />
                </div>

                <h3 className="rp2-head">{dx.headline}</h3>
                <p className="rp2-expl">{dx.explanation}</p>

                {(dx.superheatK !== null || dx.subcoolingK !== null) && (
                  <div className="rp2-shsc">
                    {dx.superheatK !== null && (
                      <span>
                        Superheat <b>{dx.superheatK} K</b>
                      </span>
                    )}
                    {dx.subcoolingK !== null && (
                      <span>
                        Subcooling <b>{dx.subcoolingK} K</b>
                      </span>
                    )}
                  </div>
                )}
                {dx.chargeNote && <p className="rp2-charge">{dx.chargeNote}</p>}

                <div className="rp2-checks">
                  <div className="ct">What to check</div>
                  <ul>
                    {dx.checks.map((c) => (
                      <li key={c}>{c}</li>
                    ))}
                  </ul>
                </div>
              </section>
            ) : (
              <section className="tcard">
                <p className="tnote" style={{ margin: 0 }}>
                  Enter both pressures to get a diagnosis. The placeholders show what this
                  refrigerant and duty should read at {ambientC}°C ambient.
                </p>
              </section>
            )}
          </div>

          <div className="tstick">
            <section className="tcard rp2-cta">
              <h2 className="tct">Expected readings</h2>
              <div className="rp2-mini">
                <div>
                  <span className="ml" style={{ color: LOW }}>
                    Low
                  </span>
                  <b>{est.suctionKpa !== null ? `${fmtP(est.suctionKpa, unit)} ${unit}` : "—"}</b>
                </div>
                <div>
                  <span className="ml" style={{ color: HIGH }}>
                    High
                  </span>
                  <b>
                    {est.dischargeKpa !== null ? `${fmtP(est.dischargeKpa, unit)} ${unit}` : "—"}
                  </b>
                </div>
              </div>
              <button
                type="button"
                className="tbtn ghost"
                style={{ marginTop: 14 }}
                onClick={() => setView("estimate")}
              >
                Back to the estimate
              </button>
            </section>

            <section className="tcard">
              <h2 className="tct">Before you trust it</h2>
              <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 8 }}>
                {[
                  "Let the system stabilise 10–15 minutes at a fixed demand before reading.",
                  "Check the ambient and indoor figures above match what you actually measured.",
                  "This reads pressures only — it can't see controls, sensors or error states.",
                  "Confirm anything that condemns a component on a second set of gauges.",
                  "Electrical and refrigerant work is licensed work.",
                ].map((n) => (
                  <li key={n} className="tnote" style={{ margin: 0 }}>
                    {n}
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </div>
      )}
    </>
  );
}
