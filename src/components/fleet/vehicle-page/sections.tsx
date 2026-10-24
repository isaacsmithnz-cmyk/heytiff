"use client";

import { useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/parts/button";
import { Fade } from "@/components/parts/fade";
import { Initials } from "@/components/parts/initials";
import { Menu, type MenuItem } from "@/components/parts/menu";
import { Row, RowList } from "@/components/parts/row";
import { StateWord } from "@/components/parts/state";
import { Empty } from "@/components/parts/states";
import { documentTitle } from "@/components/record-modal/doc-rows";
import type { StoredDocument } from "@/lib/documents/query";
import { fmtDay } from "@/lib/format/day";
import { dateFromDays } from "@/lib/fleet/map";
import {
  FUEL_PAYER_LABEL,
  fmtCost,
  fmtKm,
  fmtMoney,
  serviceDueKm,
  type AiValuation,
  type FleetStaff,
  type LogKind,
  type RenewalKind,
  type Vehicle,
  type VehicleFinance,
  type VehicleLog,
  type VehiclePolicy,
  type VehicleWithFacts,
} from "../logic";
import {
  costToRun,
  currentFinance,
  financePosition,
  financeRows,
  logDocuments,
  purchaseRows,
  repaymentLabel,
  valueNotes,
  type FactRow as MoneyRow,
} from "../vehicle-modal/derive";
import {
  fuelHistory,
  issueGroups,
  issueLine,
  issueName,
  kmChart,
  kmPerMonth,
  lastFuel,
  nextServiceHeading,
  readings,
  renewalHistory,
  renewalRows,
  serviceEvery,
  serviceHistory,
  serviceName,
  serviceRows,
  serviceSpend,
  type FactRow,
  type Word,
} from "@/lib/fleet/vehicle-page";
import { KmLine } from "./km-line";

/* A VEHICLE'S SECTIONS (v2; simplified on Isaac's mock of 24 October 2026,
   "each fact once"). Each is layout over what today's card already knows,
   handed down by the page; every door out of them is one of `Doors`, which
   the page points at today's own screens and forms. Nothing here writes.

     Overview   Renewals (rego, green slip, insurance, each with Renew or
                Add); beside them Service (the odometer, the next service,
                the last) and the last fill
     Service    the next one, the history, then the kilometres: the line
                and every reading (Kilometres was its own tab until
                24 October 2026)
     Fuel, Issues, Documents, Money   as they were */

export type PageView = {
  /** the register's lens (`assets_all`); false is the driver's own vehicle */
  register: boolean;
  vehicle: VehicleWithFacts;
  /** the register's record, with its money and specs; null for the driver */
  full: Vehicle | null;
  logs: VehicleLog[];
  documents: StoredDocument[];
  policies: VehiclePolicy[];
  finance: VehicleFinance[];
  valuation: AiValuation | null;
  valuationIsStale: boolean;
  staff: FleetStaff[];
  eco: Record<string, number>;
  today: string;
  warnDays: number;
};

export type Doors = {
  /** what opening this entry does, or null when this viewer can't open it */
  entry: (log: VehicleLog) => (() => void) | null;
  /** a new entry of this kind, through today's logging screen */
  log: (kind: LogKind) => void;
  /** whether a new entry of this kind can be logged now, and why not */
  canLog: (kind: LogKind) => { ok: boolean; why?: string };
  renew: (kind: RenewalKind) => void;
  financials: () => void;
  edit: () => void;
  /** the kinds of paper Add › Document files */
  docItems: readonly MenuItem[];
  onDoc: (key: string) => void;
  valueWithTiff: () => void;
  valuing: boolean;
  valueError: string | null;
};

function Head({ heading, count, sub, children }: { heading: string; count?: number; sub?: string | null; children?: ReactNode }) {
  return (
    <div className="vp-sechead">
      <h2 className="vp-h">
        {heading}
        {count != null && <span className="vp-h-n">{count}</span>}
        {sub && <span className="vp-h-sub">{sub}</span>}
      </h2>
      {children != null && <div className="vp-sechead-acts">{children}</div>}
    </div>
  );
}

function WordOf({ w }: { w: Word }) {
  return <StateWord tone={w.tone}>{w.word}</StateWord>;
}

/* ---- Overview ---- */

/** A label, what it says, and on the right a word or one button (rule 39). */
function Facts({ rows }: { rows: { key: string; label: string; body: ReactNode; end?: ReactNode }[] }) {
  return (
    <dl className="vp-kv">
      {rows.map((r) => (
        <div key={r.key} className="vp-kv-row">
          <dt>{r.label}</dt>
          <dd>
            {r.body}
            {r.end != null && <span className="vp-kv-end">{r.end}</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

const factBody = (r: FactRow) => <span className={r.quiet ? "vp-quiet" : undefined}>{r.value}</span>;

export function Overview({ view, doors }: { view: PageView; doors: Doors }) {
  const renewals = renewalRows(view.vehicle, view.policies, view.today, view.warnDays);
  const service = serviceRows(view.vehicle, view.logs, view.today, view.warnDays, view.full?.lastServiceDays ?? null);
  const fuel = view.vehicle.motorised ? lastFuel(view.logs) : null;
  return (
    <div className="vp-two">
      <section className="vp-sec" aria-labelledby="vp-renewals">
        <div className="vp-sechead">
          <h2 className="vp-h" id="vp-renewals">
            Renewals
          </h2>
        </div>
        <Facts
          rows={renewals.map((r) => {
            const door = r.onFile ? "Renew" : "Add";
            return {
              key: r.kind,
              label: r.label,
              body: (
                <>
                  <WordOf w={r.word} />
                  {r.date && <span>{r.date}</span>}
                </>
              ),
              /* the renewals are the register's; a driver reads them */
              end: view.register ? (
                <Button kind="second" size={32} aria-label={`${door} ${r.label.toLowerCase()}`} onClick={() => doors.renew(r.kind)}>
                  {door}
                </Button>
              ) : undefined,
            };
          })}
        />
      </section>
      <div className="vp-col">
        <section className="vp-sec" aria-labelledby="vp-service">
          <div className="vp-sechead">
            <h2 className="vp-h" id="vp-service">
              Service
            </h2>
          </div>
          <Facts
            rows={service.map((r) => ({ key: r.key, label: r.label, body: factBody(r), end: r.word ? <WordOf w={r.word} /> : undefined }))}
          />
        </section>
        {view.vehicle.motorised && (
          <section className="vp-sec" aria-labelledby="vp-lastfuel">
            <div className="vp-sechead">
              <h2 className="vp-h" id="vp-lastfuel">
                Last fuel
              </h2>
            </div>
            {fuel ? (
              <Facts rows={[{ key: fuel.log.id, label: fuel.when, body: <span>{fuel.line}</span> }]} />
            ) : (
              <p className="vp-none">No fills logged yet.</p>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

/* ---- Service ---- */

export function Service({ view, doors }: { view: PageView; doors: Doors }) {
  const rows = serviceHistory(view.logs, view.today);
  const heading = nextServiceHeading(view.vehicle, view.today);
  const every = serviceEvery(view.vehicle, view.warnDays);
  const spend = serviceSpend(view.logs);
  const can = doors.canLog("service");
  return (
    <div className="vp-col">
      <div className="vp-next">
        <div className="vp-next-text">
          <p className="vp-next-label">Next service</p>
          <h2 className="vp-next-h">{heading ?? "No cycle set"}</h2>
          {every && <p className="vp-next-line">{every}</p>}
        </div>
        {view.register && (
          <div className="vp-next-acts">
            <Button kind="quiet" onClick={doors.edit}>
              Edit schedule
            </Button>
            <Button kind="main" icon="plus" disabled={!can.ok} onClick={() => doors.log("service")}>
              Log a service
            </Button>
          </div>
        )}
      </div>
      {rows.length === 0 ? (
        <Empty
          what="No service logged yet"
          action={
            view.register ? (
              <Button kind="second" icon="plus" disabled={!can.ok} onClick={() => doors.log("service")}>
                Log a service
              </Button>
            ) : null
          }
        />
      ) : (
        <table className="vp-table" aria-label="Services">
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">Odometer</th>
              <th scope="col">What was done</th>
              <th scope="col">Workshop</th>
              <th scope="col" className="vp-num">
                Cost
              </th>
              <th scope="col">Logged by</th>
              {view.register && <th scope="col">Paper</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((l) => {
              const open = doors.entry(l);
              const kept = logDocuments(view.documents, l).length > 0;
              return (
                <tr key={l.id} className={open ? "vp-tr vp-tr--open" : "vp-tr"}>
                  <td>
                    {open ? (
                      <button type="button" className="vp-hit" onClick={open}>
                        {l.on}
                      </button>
                    ) : (
                      l.on
                    )}
                  </td>
                  <td>{typeof l.odo === "number" ? `${fmtKm(l.odo)} km` : ""}</td>
                  <td>
                    <span className="vp-cell-name">{serviceName(l)}</span>
                    {l.workDone && <span className="vp-cell-line">{l.workDone.split("\n").filter(Boolean).join("; ")}</span>}
                  </td>
                  <td>{l.station ?? ""}</td>
                  <td className="vp-num">{typeof l.cost === "number" ? fmtCost(l.cost) : ""}</td>
                  <td>{l.staffName ? <Initials name={l.staffName} size={24} /> : <span className="vp-quiet">Imported</span>}</td>
                  {view.register && (
                    <td className="vp-raise">
                      {kept ? (
                        <span className="vp-quiet">Record kept</span>
                      ) : open ? (
                        <Button kind="second" size={32} onClick={open}>
                          Attach record
                        </Button>
                      ) : null}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {spend != null && <p className="vp-foot">{fmtCost(spend)} on service in the last 12 months.</p>}
      {view.vehicle.motorised && <Kilometres view={view} doors={doors} />}
    </div>
  );
}

/* The kilometres, under the service they count towards: how far it goes a
   month, the line, and every reading. The odometer itself is Overview's. */
function Kilometres({ view, doors }: { view: PageView; doors: Doors }) {
  const rs = readings(view.logs, view.today);
  const rate = kmPerMonth(rs);
  const chart = kmChart(rs, view.today, serviceDueKm(view.vehicle));
  const can = doors.canLog("odo");
  return (
    <section className="vp-sec" aria-label="Kilometres">
      <Head
        heading="Kilometres"
        sub={rate ? `${fmtKm(rate.perMonth)} km ${rate.spanDays >= 330 ? "a month over the last 12 months" : `a month since ${fmtDay(rate.sinceIso)}`}` : null}
      >
        <Button kind="second" icon="plus" disabled={!can.ok} onClick={() => doors.log("odo")}>
          Add a reading
        </Button>
      </Head>
      {!can.ok && can.why && <p className="vp-none">{can.why}</p>}
      {chart && <KmLine chart={chart} label={`The odometer over the last 12 months, now ${fmtKm(view.vehicle.odometer)} km`} />}
      {rs.length === 0 ? (
        <p className="vp-none">No readings yet.</p>
      ) : (
        <table className="vp-table" aria-label="Readings">
          <thead>
            <tr>
              <th scope="col">Read</th>
              <th scope="col">Odometer</th>
              <th scope="col">Since the last</th>
              <th scope="col">From</th>
              <th scope="col">By</th>
            </tr>
          </thead>
          <tbody>
            {rs.map((r) => {
              const open = doors.entry(r.log);
              return (
                <tr key={r.log.id} className={open ? "vp-tr vp-tr--open" : "vp-tr"}>
                  <td>
                    {open ? (
                      <button type="button" className="vp-hit" onClick={open}>
                        {fmtDay(r.on)}
                      </button>
                    ) : (
                      fmtDay(r.on)
                    )}
                  </td>
                  <td>{fmtKm(r.odo)} km</td>
                  <td className="vp-quiet">{r.since == null ? "" : `${r.since >= 0 ? "+" : ""}${fmtKm(r.since)}`}</td>
                  <td>
                    <Fade>{r.from}</Fade>
                  </td>
                  <td>{r.by}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

/* ---- Issues ---- */

export function Issues({ view, doors }: { view: PageView; doors: Doors }) {
  const { open, fixed } = issueGroups(view.logs);
  const rowOf = (l: VehicleLog) => (
    <Row
      key={l.id}
      name={issueName(l)}
      line={issueLine(l)}
      end={l.status === "resolved" ? <StateWord tone="good">Fixed</StateWord> : <StateWord tone="look">Open</StateWord>}
      onClick={doors.entry(l) ?? undefined}
    />
  );
  return (
    <div className="vp-col">
      <section className="vp-sec" aria-label="Open issues">
        <Head heading="Open" count={open.length}>
          <Button kind="second" icon="plus" onClick={() => doors.log("issue")}>
            Report an issue
          </Button>
        </Head>
        {open.length === 0 ? <p className="vp-none">Nothing open on this vehicle.</p> : <RowList label="Open issues">{open.map(rowOf)}</RowList>}
      </section>
      {fixed.length > 0 && (
        <section className="vp-sec" aria-label="Fixed issues">
          <Head heading="Fixed" count={fixed.length} />
          <RowList label="Fixed issues">{fixed.map(rowOf)}</RowList>
        </section>
      )}
    </div>
  );
}

/* ---- Fuel ---- */

export function Fuel({ view, doors }: { view: PageView; doors: Doors }) {
  const rows = fuelHistory(view.logs, view.today);
  const can = doors.canLog("fuel");
  return (
    <div className="vp-col">
      <Head heading="Fuel" count={rows.length}>
        <Button kind="second" icon="plus" disabled={!can.ok} onClick={() => doors.log("fuel")}>
          Log fuel
        </Button>
      </Head>
      {!can.ok && can.why && <p className="vp-none">{can.why}</p>}
      {rows.length === 0 ? (
        <p className="vp-none">No fills logged yet.</p>
      ) : (
        <table className="vp-table">
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col" className="vp-num">
                Litres
              </th>
              <th scope="col" className="vp-num">
                Cost
              </th>
              <th scope="col">Station</th>
              <th scope="col">Odometer</th>
              <th scope="col">Economy</th>
              <th scope="col">Paid with</th>
              <th scope="col">Receipt</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((l) => {
              const open = doors.entry(l);
              const eco = view.eco[l.id];
              return (
                <tr key={l.id} className={open ? "vp-tr vp-tr--open" : "vp-tr"}>
                  <td>
                    {open ? (
                      <button type="button" className="vp-hit" onClick={open}>
                        {l.on}
                      </button>
                    ) : (
                      l.on
                    )}
                  </td>
                  <td className="vp-num">{typeof l.litres === "number" ? `${l.litres} L` : ""}</td>
                  <td className="vp-num">{typeof l.cost === "number" ? fmtCost(l.cost) : ""}</td>
                  <td>{l.station ?? ""}</td>
                  <td>{typeof l.odo === "number" ? `${fmtKm(l.odo)} km` : ""}</td>
                  <td>{typeof eco === "number" ? `${eco} L/100 km` : ""}</td>
                  <td>{l.paidWith ? FUEL_PAYER_LABEL[l.paidWith] : ""}</td>
                  <td className="vp-quiet">{l.hasReceipt ? "Kept" : ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

/* ---- Documents ---- */

export function Documents({ view, doors }: { view: PageView; doors: Doors }) {
  const addRef = useRef<HTMLButtonElement>(null);
  const [adding, setAdding] = useState(false);
  const renewals = renewalHistory(view.policies);
  const scans = [...view.documents].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return (
    <div className="vp-col">
      <section className="vp-sec" aria-label="Renewals">
        <Head heading="Renewals" count={renewals.length}>
          <Button ref={addRef} kind="second" icon="plus" aria-haspopup="menu" aria-expanded={adding} onClick={() => setAdding((a) => !a)}>
            Add a document
          </Button>
          <Menu
            open={adding}
            anchor={addRef}
            label="Add a document"
            items={doors.docItems}
            align="end"
            onClose={() => setAdding(false)}
            onSelect={(key) => {
              setAdding(false);
              doors.onDoc(key);
            }}
          />
        </Head>
        {renewals.length === 0 ? (
          <p className="vp-none">No renewal filed yet.</p>
        ) : (
          <RowList label="Renewals">
            {renewals.map((r) => (
              <Row
                key={r.policy.id}
                name={r.name}
                line={r.line || undefined}
                end={r.current ? <StateWord tone="good">In force</StateWord> : <StateWord tone="info">Replaced</StateWord>}
                onClick={() => doors.renew(r.policy.kind)}
              />
            ))}
          </RowList>
        )}
      </section>
      <section className="vp-sec" aria-label="Stored scans">
        <Head heading="Stored scans" count={scans.length} />
        {scans.length === 0 ? (
          <p className="vp-none">Nothing stored yet.</p>
        ) : (
          <RowList label="Stored scans">
            {scans.map((d) => (
              <Row
                key={d.id}
                name={documentTitle(d)}
                line={`${d.fileName}, ${fmtDay(d.createdAt)}`}
                end={
                  d.url ? (
                    <a className="vp-link" href={d.url} target="_blank" rel="noopener noreferrer">
                      Open the file
                    </a>
                  ) : (
                    <span className="vp-quiet">No link</span>
                  )
                }
              />
            ))}
          </RowList>
        )}
      </section>
    </div>
  );
}

/* ---- Money ---- */

function MoneyFacts({ rows }: { rows: MoneyRow[] }) {
  return (
    <dl className="vp-facts">
      {rows.map((r) => (
        <div key={r.label} className="vp-fact">
          <dt>{r.label}</dt>
          <dd className={r.faint ? "vp-quiet" : undefined}>{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Money({ view, doors }: { view: PageView; doors: Doors }) {
  const v = view.full;
  if (!v) return null;
  const fin = currentFinance(view.finance);
  const pos = fin ? financePosition(fin, view.today) : null;
  const costs = costToRun(v, view.logs, view.policies, view.finance, view.today);
  const notes = valueNotes(view.valuation ?? undefined, v, view.valuationIsStale);
  return (
    <div className="vp-col">
      <div className="vp-sechead">
        <p className="vp-bigline">
          <span className="vp-big">{fmtMoney(view.valuation ? view.valuation.point : v.value)}</span>
          <span className="vp-big-sub">
            {view.valuation
              ? `Tiff's value, ${fmtMoney(view.valuation.low)} to ${fmtMoney(view.valuation.high)}. Book value ${fmtMoney(v.value)}.`
              : "Book value, as entered"}
          </span>
        </p>
        <div className="vp-sechead-acts">
          <Button kind="second" disabled={doors.valuing} onClick={doors.valueWithTiff}>
            {doors.valuing ? "Tiff is valuing the fleet" : "Value with Tiff"}
          </Button>
          <Button kind="second" onClick={doors.financials}>
            Edit the money
          </Button>
        </div>
      </div>
      {doors.valueError && <p className="vp-err">{doors.valueError}</p>}
      {notes.length > 0 && <p className="vp-none">{notes.join(". ")}.</p>}

      <section className="vp-sec" aria-label="Purchase">
        <Head heading="Purchase" />
        <MoneyFacts rows={purchaseRows(v, view.today, fin)} />
        {v.purchaseDateDays > 0 && <p className="vp-foot">Bought {fmtDay(dateFromDays(-v.purchaseDateDays, view.today))}.</p>}
      </section>

      <section className="vp-sec" aria-label="Finance">
        <Head heading="Finance" />
        {fin && pos ? (
          <>
            <MoneyFacts rows={financeRows(fin)} />
            <p className="vp-foot">
              {pos.ended
                ? "The schedule has ended."
                : `${pos.made} of ${pos.total} repayments fallen due${repaymentLabel(fin) ? `, ${repaymentLabel(fin)}` : ""}. Assumes every payment made as scheduled; the lender has the payout figure.`}
            </p>
          </>
        ) : (
          <p className="vp-none">No finance agreement recorded.</p>
        )}
      </section>

      <section className="vp-sec" aria-label="Cost to run">
        <Head heading="Cost to run" />
        <dl className="vp-facts">
          {costs.items.map((i) => (
            <div key={i.key} className="vp-fact">
              <dt>{i.label}</dt>
              <dd className={i.value == null ? "vp-quiet" : undefined}>{i.value == null ? "Nothing logged" : fmtCost(i.value)}</dd>
            </div>
          ))}
          {costs.known > 0 && (
            <div className="vp-fact">
              <dt>A year, from what is known</dt>
              <dd>
                {fmtCost(costs.total)}
                {costs.perKm != null ? `, ${fmtCost(costs.perKm)} a km` : ""}
              </dd>
            </div>
          )}
        </dl>
      </section>
    </div>
  );
}
