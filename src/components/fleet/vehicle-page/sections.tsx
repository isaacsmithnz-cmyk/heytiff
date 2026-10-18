"use client";

import { useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/parts/button";
import { Fade } from "@/components/parts/fade";
import { Initials } from "@/components/parts/initials";
import { Menu, type MenuItem } from "@/components/parts/menu";
import { Row, RowList } from "@/components/parts/row";
import { StateWord } from "@/components/parts/state";
import { Empty } from "@/components/parts/states";
import { Tooltip } from "@/components/parts/tooltip";
import { Icon } from "@/components/shell/icon";
import { documentTitle } from "@/components/record-modal/doc-rows";
import type { StoredDocument } from "@/lib/documents/query";
import { fmtDay } from "@/lib/format/day";
import { dateFromDays } from "@/lib/fleet/map";
import {
  BODY_TYPE_LABEL,
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
  policyDocuments,
  purchaseRows,
  repaymentLabel,
  specRows,
  valueNotes,
  type FactRow,
} from "../vehicle-modal/derive";
import {
  fuelHistory,
  issueGroups,
  issueLine,
  issueName,
  kmChart,
  kmPerMonth,
  latestRows,
  nextServiceHeading,
  readings,
  renewalHistory,
  serviceEvery,
  serviceHistory,
  serviceName,
  serviceSpend,
  standsRows,
  statusWord,
  type LatestRow,
  type Word,
} from "@/lib/fleet/vehicle-page";
import { KmLine } from "./km-line";

/* A VEHICLE'S SECTIONS (v2; the boards v2-board-vehicle-overview, -service,
   -issues and -km). Each is layout over what today's card already knows,
   handed down by the page; every door out of them is one of `Doors`, which
   the page points at today's own screens and forms. Nothing here writes. */

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
  driverName: string | null;
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
  assign: (staffId: string | null) => void;
  /** the kinds of paper Add › Document files */
  docItems: readonly MenuItem[];
  onDoc: (key: string) => void;
  valueWithTiff: () => void;
  valuing: boolean;
  valueError: string | null;
};

const POOL = "pool";

function Head({ heading, count, children }: { heading: string; count?: number; children?: ReactNode }) {
  return (
    <div className="vp-sechead">
      <h2 className="vp-h">
        {heading}
        {count != null && <span className="vp-h-n">{count}</span>}
      </h2>
      {children != null && <div className="vp-sechead-acts">{children}</div>}
    </div>
  );
}

function WordOf({ w }: { w: Word }) {
  return <StateWord tone={w.tone}>{w.word}</StateWord>;
}

/* ---- Overview ---- */

const logIdOf = (row: LatestRow): string | null => ("log" in row.opens ? row.opens.log : null);

function keptWord(row: LatestRow, view: PageView): ReactNode {
  const id = logIdOf(row);
  if (row.kind === "issue") {
    const log = view.logs.find((l) => l.id === id);
    return log?.status === "resolved" ? <StateWord tone="good">Fixed</StateWord> : <StateWord tone="look">Open</StateWord>;
  }
  if (!view.register) return null;
  if ("renewal" in row.opens) {
    const kind = row.opens.renewal;
    const p = view.policies.filter((x) => x.kind === kind).sort((a, b) => b.expiresOn.localeCompare(a.expiresOn))[0];
    return p && policyDocuments(view.documents, p).length > 0 ? <StateWord tone="info">Policy kept</StateWord> : null;
  }
  if (!id) return null;
  const kept = logDocuments(view.documents, { id }).length > 0 || view.logs.find((l) => l.id === id)?.hasReceipt;
  if (!kept) return null;
  return <StateWord tone="info">{row.kind === "fuel" ? "Receipt kept" : "Record kept"}</StateWord>;
}

export function Overview({ view, doors }: { view: PageView; doors: Doors }) {
  const rows = latestRows(view.logs, view.register ? view.policies : [], view.eco);
  const v = view.full;
  const details: FactRow[] = [
    { label: "Make and model", value: [view.vehicle.make, view.vehicle.model].filter(Boolean).join(" ") + (view.vehicle.year ? `, ${view.vehicle.year}` : "") },
    { label: "Plate", value: [view.vehicle.plate, view.vehicle.plateState].filter(Boolean).join(", ") },
    ...(v?.bodyType ? [{ label: "Body", value: [BODY_TYPE_LABEL[v.bodyType], v.colour?.toLowerCase()].filter(Boolean).join(", ") }] : []),
    ...(v ? specRows(v).filter((s) => !(v.bodyType && s.label === "Colour")).map((s) => ({ label: s.label, value: s.value })) : []),
  ];
  return (
    <div className="vp-two">
      <div className="vp-col">
        <section className="vp-sec" aria-labelledby="vp-latest">
          <div className="vp-sechead">
            <h2 className="vp-h" id="vp-latest">
              Latest <span className="vp-h-sub">one of each</span>
            </h2>
          </div>
          {rows.length === 0 ? (
            <Empty
              what="Nothing logged yet"
              action={
                <Button kind="second" icon="plus" onClick={() => doors.log("issue")}>
                  Report an issue
                </Button>
              }
            />
          ) : (
            <RowList label="The latest of each kind">
              {rows.map((r) => {
                const id = logIdOf(r);
                const log = id ? view.logs.find((l) => l.id === id) : undefined;
                const renewal = "renewal" in r.opens ? r.opens.renewal : null;
                const open = log ? doors.entry(log) : renewal && view.register ? () => doors.renew(renewal) : null;
                return (
                  <Row
                    key={r.kind}
                    lead={<span className="vp-lead">{r.label}</span>}
                    name={r.name}
                    line={r.line}
                    end={keptWord(r, view)}
                    onClick={open ?? undefined}
                  />
                );
              })}
            </RowList>
          )}
        </section>

        <section className="vp-sec" aria-labelledby="vp-details">
          <div className="vp-sechead">
            <h2 className="vp-h" id="vp-details">
              Details
            </h2>
            {view.register && (
              <Button kind="quiet" onClick={doors.edit}>
                Edit details
              </Button>
            )}
          </div>
          <dl className="vp-facts">
            {details.map((d) => (
              <div key={d.label} className="vp-fact">
                <dt>{d.label}</dt>
                <dd>{d.value}</dd>
              </div>
            ))}
          </dl>
          {v?.notes && <p className="vp-notes">{v.notes}</p>}
        </section>
      </div>
      <Stands view={view} doors={doors} />
    </div>
  );
}

/* ---- Where it stands ---- */

export function Stands({ view, doors }: { view: PageView; doors: Doors }) {
  const driverRef = useRef<HTMLButtonElement>(null);
  const [picking, setPicking] = useState(false);
  const rows = standsRows(view.vehicle, view.policies, view.logs, view.today, view.warnDays);
  const renew: Partial<Record<string, { label: string; kind: RenewalKind; main: boolean }>> = view.register
    ? {
        rego: { label: "Renew rego", kind: "rego", main: true },
        ctp: { label: "Renew slip", kind: "ctp", main: false },
        insurance: { label: "Renew insurance", kind: "insurance", main: false },
      }
    : {};
  const v = view.full;
  const drivers: MenuItem[] = [
    { key: POOL, label: "Pool, no driver" },
    ...view.staff.filter((s) => s.status === "Active" || s.id === v?.assignedTo).map((s) => ({ key: s.id, label: s.name })),
  ];
  const status = statusWord(view.vehicle.status);
  return (
    <section className="vp-sec vp-stands" aria-labelledby="vp-stands">
      <div className="vp-sechead">
        <h2 className="vp-h" id="vp-stands">
          Where it stands
        </h2>
      </div>
      <dl className="vp-st">
        {rows.map((r) => {
          const act = renew[r.key];
          return (
            <div key={r.key} className="vp-st-row">
              <dt>{r.label}</dt>
              <dd>
                {r.key === "odo" ? <span className="vp-st-fig">{r.word.word}</span> : <WordOf w={r.word} />}
                {r.line && <span className="vp-st-line">{r.line}</span>}
              </dd>
              {act && (
                <span className="vp-st-act">
                  <Button kind={act.main ? "main" : "second"} onClick={() => doors.renew(act.kind)}>
                    {act.label}
                  </Button>
                </span>
              )}
            </div>
          );
        })}
        <div className="vp-st-row">
          <dt>{view.vehicle.motorised ? "Driver" : "Towed by"}</dt>
          <dd>
            {view.register ? (
              view.driverName ? (
                <span className="vp-st-who">
                  <Initials name={view.driverName} size={24} beside />
                  {view.driverName}
                </span>
              ) : (
                <span className="vp-st-fig">Pool, no driver</span>
              )
            ) : (
              <span className="vp-st-fig">You</span>
            )}
          </dd>
          {view.register && (
            <span className="vp-st-act">
              <Button ref={driverRef} kind="quiet" aria-haspopup="listbox" aria-expanded={picking} onClick={() => setPicking((p) => !p)}>
                Change driver
              </Button>
              <Menu
                open={picking}
                anchor={driverRef}
                kind="listbox"
                label="Driver"
                items={drivers}
                chosen={v?.assignedTo ?? POOL}
                align="end"
                onClose={() => setPicking(false)}
                onSelect={(key) => {
                  setPicking(false);
                  doors.assign(key === POOL ? null : key);
                }}
              />
            </span>
          )}
        </div>
        <div className="vp-st-row">
          <dt>Status</dt>
          <dd>
            <WordOf w={status} />
          </dd>
        </div>
        {view.register && v && (
          <div className="vp-st-row">
            <dt>Value</dt>
            <dd>
              <span className="vp-st-fig">{fmtMoney(v.value)}</span>
              <span className="vp-st-line">
                {view.valuation ? (
                  <>
                    Book value; Tiff puts it near {fmtMoney(view.valuation.point)}
                    <Tooltip
                      label={[`${fmtMoney(view.valuation.low)} to ${fmtMoney(view.valuation.high)}`, ...valueNotes(view.valuation, v, view.valuationIsStale)].join(". ")}
                    >
                      <span className="vp-info" tabIndex={0} role="img" aria-label="How Tiff priced it">
                        <Icon name="info" size={14} />
                      </span>
                    </Tooltip>
                  </>
                ) : (
                  "Book value"
                )}
              </span>
            </dd>
          </div>
        )}
      </dl>
    </section>
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
        <table className="vp-table">
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
    </div>
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

/* ---- Kilometres ---- */

export function Kilometres({ view, doors }: { view: PageView; doors: Doors }) {
  const rs = readings(view.logs, view.today);
  const rate = kmPerMonth(rs);
  const chart = kmChart(rs, view.today, serviceDueKm(view.vehicle));
  const can = doors.canLog("odo");
  return (
    <div className="vp-two">
      <div className="vp-col">
        <div className="vp-sechead">
          <p className="vp-bigline">
            {rate ? (
              <>
                <span className="vp-big">{fmtKm(rate.perMonth)} km</span>
                <span className="vp-big-sub">
                  {rate.spanDays >= 330 ? "a month over the last 12 months" : `a month since ${fmtDay(rate.sinceIso)}`}
                </span>
              </>
            ) : (
              <span className="vp-big">{fmtKm(view.vehicle.odometer)} km</span>
            )}
          </p>
          <div className="vp-sechead-acts">
            <Button kind="second" icon="plus" disabled={!can.ok} onClick={() => doors.log("odo")}>
              Add a reading
            </Button>
          </div>
        </div>
        {!can.ok && can.why && <p className="vp-none">{can.why}</p>}
        {chart && <KmLine chart={chart} label={`The odometer over the last 12 months, now ${fmtKm(view.vehicle.odometer)} km`} />}
        {rs.length === 0 ? (
          <p className="vp-none">No readings yet.</p>
        ) : (
          <table className="vp-table">
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
      </div>
      <Stands view={view} doors={doors} />
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

function Facts({ rows }: { rows: FactRow[] }) {
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
        <Facts rows={purchaseRows(v, view.today, fin)} />
        {v.purchaseDateDays > 0 && <p className="vp-foot">Bought {fmtDay(dateFromDays(-v.purchaseDateDays, view.today))}.</p>}
      </section>

      <section className="vp-sec" aria-label="Finance">
        <Head heading="Finance" />
        {fin && pos ? (
          <>
            <Facts rows={financeRows(fin)} />
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
