"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { Button } from "@/components/parts/button";
import { Chooser } from "@/components/parts/chooser";
import { Field, TextInput } from "@/components/parts/field";
import { SearchField } from "@/components/parts/search-field";
import { StateWord, type Tone } from "@/components/parts/state";
import { Tick } from "@/components/parts/tick";
import { Tray, ViewTabs } from "@/components/parts/tabs";
import { Empty } from "@/components/parts/states";
import { combineUnits } from "@/app/actions/library-units";
import {
  COMPARE_MOST,
  SYSTEM_NAMES,
  compareRows,
  filterUnits,
  type CombineTone,
  type Combined,
  type PackUnit,
} from "@/lib/library/data-pack";
import type { SystemType } from "@/lib/studio/packs/schema";
import "./library-covers.css";
import "./data-pack.css";

/* DATA PACK (Isaac, 16 November 2026: "Just have a Data pack section that
   displays all units to search through, filter and combine. A bit like
   system builder"; "Yep nice" to https://claude.ai/artifact/2Jvc2mQkhQscbykt7abwhM).
   Every unit in the six data books, three views as soft tabs (rule 29):
   Units, filtered down the left and ticked to compare; Compare, the ticked
   ones side by side, a row where they all match quiet so what differs
   stands out in ink; Combine, an outdoor and its heads port by port, checked
   on the server by the Studio's own multi rule. The packs are the Studio's,
   so a figure here is the one a design uses. Nothing asks Tiff. */

type View = "units" | "compare" | "combine";
type Power = "any" | "1" | "3";

const kw = (n: number) => `${Math.round(n * 10) / 10} kW`;
const systemsSaid = (u: PackUnit) => u.systems.map((s) => SYSTEM_NAMES[s]).join(", ");
const TONE: Record<CombineTone, Tone> = { good: "good", look: "look", bad: "wrong" };

/** The table's columns: an outdoor shows its heads, run and charge where an indoor shows its air. */
const INDOOR_COLS: { label: string; of: (u: PackUnit) => string; num?: boolean }[] = [
  { label: "Cooling", of: (u) => kw(u.coolKw), num: true },
  { label: "Heating", of: (u) => kw(u.heatKw), num: true },
  { label: "Airflow", of: (u) => (u.airflow != null ? `${u.airflow} L/s` : ""), num: true },
  { label: "Static", of: (u) => (u.staticPa != null ? `${u.staticPa} Pa` : ""), num: true },
  { label: "Supply opening", of: (u) => u.supply ?? "" },
  { label: "Return opening", of: (u) => u.return ?? "" },
  { label: "Unit (W x D x H)", of: (u) => u.size ?? "" },
];
const OUTDOOR_COLS: typeof INDOOR_COLS = [
  { label: "Cooling", of: (u) => kw(u.coolKw), num: true },
  { label: "Heating", of: (u) => kw(u.heatKw), num: true },
  { label: "Indoor units", of: (u) => u.heads ?? "" },
  { label: "Pipe run", of: (u) => u.run ?? "" },
  { label: "Extra charge", of: (u) => u.charge ?? "" },
  { label: "Unit (W x D x H)", of: (u) => u.size ?? "" },
];

export function DataPack({
  units,
  brands,
  kinds,
}: {
  /** every unit, smallest first */
  units: PackUnit[];
  brands: { brand: string; name: string; count: number }[];
  kinds: { kind: string; name: string; count: number }[];
}) {
  const [view, setView] = useState<View>("units");
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<string | null>("ducted");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [brandIds, setBrandIds] = useState<string[]>([]);
  const [systems, setSystems] = useState<SystemType[]>([]);
  const [power, setPower] = useState<Power>("any");
  const [ticked, setTicked] = useState<string[]>([]);

  const num = (s: string) => (s.trim() && Number.isFinite(Number(s)) ? Number(s) : null);
  const shown = useMemo(
    () =>
      filterUnits(units, {
        q,
        kind,
        coolFrom: num(from),
        coolTo: num(to),
        brands: brandIds,
        systems,
        phase: power === "any" ? null : power,
      }),
    [units, q, kind, from, to, brandIds, systems, power],
  );
  const byKey = useMemo(() => new Map(units.map((u) => [u.key, u])), [units]);
  const tickedUnits = ticked.map((k) => byKey.get(k)).filter((u): u is PackUnit => !!u);
  const cols = kind === "outdoor" ? OUTDOOR_COLS : INDOOR_COLS;
  const filtered = !!(q.trim() || kind || from.trim() || to.trim() || brandIds.length || systems.length || power !== "any");
  const clear = () => {
    setQ("");
    setKind(null);
    setFrom("");
    setTo("");
    setBrandIds([]);
    setSystems([]);
    setPower("any");
  };
  const tick = (key: string, on: boolean) =>
    setTicked((t) => (on ? (t.includes(key) || t.length >= COMPARE_MOST ? t : [...t, key]) : t.filter((k) => k !== key)));
  const toggle = <T,>(list: T[], v: T, on: boolean) => (on ? [...list, v] : list.filter((x) => x !== v));

  return (
    <div className="page in lb3-page">
      <div className="wrap lb2 dp">
        <Link href="/dashboard/tiff/library" className="dp-back">
          ‹ Library
        </Link>
        <header className="lb2-head">
          <div className="lb2-id">
            <h1 className="lb2-title">Data pack</h1>
            <p className="lb3-under">
              {units.length.toLocaleString("en-AU")} units from {brands.length} brands’ data books
            </p>
          </div>
        </header>
        <ViewTabs
          ariaLabel="Data pack"
          idPrefix="dp-v"
          panelPrefix="dp-panel"
          current={view}
          onGo={(k) => setView(k as View)}
          items={[
            { key: "units", label: "Units" },
            { key: "compare", label: "Compare" },
            { key: "combine", label: "Combine" },
          ]}
        />

        {view === "units" && (
          <div id="dp-panel-units" role="tabpanel" aria-labelledby="dp-v-units" className="dp-units">
            <aside className="dp-filters" aria-label="Filters">
              <Field label="Kind">
                <Chooser
                  options={[{ value: "", label: "Any kind" }, ...kinds.map((k) => ({ value: k.kind, label: k.name }))]}
                  value={kind ?? ""}
                  onChange={(v) => setKind(v || null)}
                />
              </Field>
              <div className="dp-pair">
                <Field label="Cooling from">
                  <TextInput inputMode="decimal" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Cooling from, kW" />
                </Field>
                <Field label="to kW">
                  <TextInput inputMode="decimal" value={to} onChange={(e) => setTo(e.target.value)} aria-label="Cooling to, kW" />
                </Field>
              </div>
              <fieldset className="dp-set">
                <legend>Brand</legend>
                {brands.map((b) => (
                  <Tick key={b.brand} label={b.name} checked={brandIds.includes(b.brand)} onChange={(on) => setBrandIds((l) => toggle(l, b.brand, on))} />
                ))}
              </fieldset>
              <fieldset className="dp-set">
                <legend>System</legend>
                {(Object.keys(SYSTEM_NAMES) as SystemType[]).map((s) => (
                  <Tick key={s} label={SYSTEM_NAMES[s]} checked={systems.includes(s)} onChange={(on) => setSystems((l) => toggle(l, s, on))} />
                ))}
              </fieldset>
              <fieldset className="dp-set">
                <legend>Power</legend>
                <Tray
                  ariaLabel="Power"
                  value={power}
                  onChange={setPower}
                  options={[
                    { value: "any", label: "Any" },
                    { value: "1", label: "Single" },
                    { value: "3", label: "Three" },
                  ]}
                />
              </fieldset>
              {filtered && (
                <Button kind="quiet" onClick={clear}>
                  Clear the filters
                </Button>
              )}
            </aside>
            <div className="dp-main">
              <SearchField value={q} onChange={setQ} label="Search a model, a brand or a size" className="dp-search" />
              {shown.length === 0 ? (
                <Empty
                  what="No unit fits all of those"
                  action={
                    <Button kind="second" onClick={clear}>
                      Clear the filters
                    </Button>
                  }
                />
              ) : (
                <div className="dp-scroll">
                  <table className="dp-table">
                    <thead>
                      <tr>
                        <th className="dp-tickcol">
                          <span className="sr-only">Compare</span>
                        </th>
                        <th>Model</th>
                        <th>Brand</th>
                        <th>System</th>
                        {cols.map((c) => (
                          <th key={c.label} className={c.num ? "dp-num" : undefined}>
                            {c.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {shown.map((u) => {
                        const on = ticked.includes(u.key);
                        return (
                          <tr key={u.key} className={on ? "dp-on" : undefined}>
                            <td className="dp-tickcol">
                              <Tick
                                label={<span className="sr-only">Compare {u.model}</span>}
                                checked={on}
                                disabled={!on && ticked.length >= COMPARE_MOST}
                                onChange={(v) => tick(u.key, v)}
                              />
                            </td>
                            <td className="dp-model">{u.model}</td>
                            <td>{u.brandName}</td>
                            <td>{systemsSaid(u)}</td>
                            {cols.map((c) => (
                              <td key={c.label} className={c.num ? "dp-num" : undefined}>
                                {c.of(u)}
                              </td>
                            ))}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            {tickedUnits.length > 0 && (
              <div className="dp-foot">
                <p className="dp-foot-t">
                  {and(tickedUnits.map((u) => u.model))} ticked
                </p>
                <Button kind="quiet" onClick={() => setTicked([])}>
                  Clear
                </Button>
                <Button kind="main" onClick={() => setView("compare")}>
                  Compare units
                </Button>
              </div>
            )}
          </div>
        )}

        {view === "compare" && (
          <div id="dp-panel-compare" role="tabpanel" aria-labelledby="dp-v-compare">
            {tickedUnits.length === 0 ? (
              <Empty
                what="Nothing ticked to compare"
                action={
                  <Button kind="main" onClick={() => setView("units")}>
                    Tick some units
                  </Button>
                }
              />
            ) : (
              <Compare units={tickedUnits} onRemove={(k) => tick(k, false)} />
            )}
          </div>
        )}

        {view === "combine" && (
          <div id="dp-panel-combine" role="tabpanel" aria-labelledby="dp-v-combine">
            <Combine units={units} byKey={byKey} />
          </div>
        )}
      </div>
    </div>
  );
}

const and = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/* ── compare ─────────────────────────────────────────────────────────────── */

function Compare({ units, onRemove }: { units: PackUnit[]; onRemove: (key: string) => void }) {
  const rows = compareRows(units);
  return (
    <div className="dp-scroll dp-card">
      <table className="dp-table dp-compare">
        <thead>
          <tr>
            <th>
              <span className="sr-only">Figure</span>
            </th>
            {units.map((u) => (
              <th key={u.key}>
                <span className="dp-ch">
                  <b>{u.model}</b>
                  <span>{u.brandName}</span>
                  <Button kind="quiet" size={32} onClick={() => onRemove(u.key)}>
                    Remove
                  </Button>
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className={r.same ? "dp-same" : undefined}>
              <th scope="row">{r.label}</th>
              {r.values.map((v, i) => (
                <td key={units[i].key}>{v}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── combine ─────────────────────────────────────────────────────────────── */

function Combine({ units, byKey }: { units: PackUnit[]; byKey: Map<string, PackUnit> }) {
  const outdoors = useMemo(() => units.filter((u) => u.side === "outdoor" && u.combinable), [units]);
  const [odu, setOdu] = useState<string | null>(null);
  const [heads, setHeads] = useState<string[]>([]);
  const [got, setGot] = useState<Combined | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();

  useEffect(() => {
    if (!odu) return;
    let live = true;
    start(async () => {
      const res = await combineUnits(odu, heads);
      if (!live) return;
      if (res.ok) {
        setGot(res.combined);
        setError(null);
      } else setError(res.error);
    });
    return () => {
      live = false;
    };
  }, [odu, heads]);

  const now = got && odu && got.outdoor.key === odu ? got : null;
  const offered = (now?.offered ?? []).map((k) => byKey.get(k)).filter((u): u is PackUnit => !!u);
  const full = now?.most != null && heads.length >= now.most;
  const oduSaid = (u: PackUnit) => `${u.model}, ${u.brandName} ${SYSTEM_NAMES[u.systems[0]].toLowerCase()}, ${kw(u.coolKw)}${u.heads ? `, ${u.heads}` : ""}`;

  return (
    <div className="dp-combine">
      <div className="dp-build">
        <Field label="Outdoor unit">
          <Chooser
            options={outdoors.map((u) => ({ value: u.key, label: oduSaid(u) }))}
            value={odu}
            placeholder="Choose an outdoor unit"
            onChange={(v) => {
              setOdu(v);
              setHeads([]);
            }}
          />
        </Field>
        {odu && (
          <section className="dp-heads" aria-label="Indoor units">
            <h2 className="lb3-sh">Indoor units</h2>
            {heads.length > 0 && (
              <div className="lb3-group">
                {heads.map((k, i) => {
                  const u = byKey.get(k);
                  const port = now?.ports[i];
                  return (
                    <div key={`${k}-${i}`} className="dp-head">
                      <span className="dp-port">Port {port?.port ?? i + 1}</span>
                      <span className="lb3-cw">
                        <b>{u?.model ?? k}</b>
                        <span>
                          {u ? `${u.kindName}, ${kw(u.coolKw)}` : ""}
                          {port?.pipes ? `, pipes ${port.pipes}` : ""}
                        </span>
                      </span>
                      <Button kind="quiet" size={32} onClick={() => setHeads((h) => h.filter((_, j) => j !== i))}>
                        Remove
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
            {now && !full && offered.length > 0 && (
              <Chooser
                options={offered.map((u) => ({ value: u.key, label: `${u.model}, ${u.kindName.toLowerCase()}, ${kw(u.coolKw)}` }))}
                value={null}
                placeholder="Add an indoor unit"
                onChange={(v) => setHeads((h) => [...h, v])}
              />
            )}
          </section>
        )}
      </div>
      {now && (
        <aside className="dp-verdict lb3-group" aria-label="The combination">
          {now.verdict ? (
            <>
              <StateWord tone={TONE[now.verdict.tone]}>{now.verdict.word}</StateWord>
              {now.verdict.lines.map((l) => (
                <p key={l} className="dp-line">
                  {l}
                </p>
              ))}
            </>
          ) : null}
          {now.facts.length > 0 && (
            <dl className="dp-facts">
              {now.facts.map((f) => (
                <div key={f.label}>
                  <dt>{f.label}</dt>
                  <dd>{f.value}</dd>
                </div>
              ))}
            </dl>
          )}
          {now.takes && <p className="dp-line">Heads it takes: {now.takes}.</p>}
          {now.source && <p className="dp-line">From {now.source}</p>}
        </aside>
      )}
      {error && <p className="lb3-err">{error}</p>}
    </div>
  );
}
