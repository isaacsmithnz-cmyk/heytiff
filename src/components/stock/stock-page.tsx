"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { Button } from "@/components/parts/button";
import { Chooser } from "@/components/parts/chooser";
import { Dialog } from "@/components/parts/dialog";
import { Field, TextInput } from "@/components/parts/field";
import { Fade } from "@/components/parts/fade";
import { Dot, StateWord, type Tone } from "@/components/parts/state";
import { Tray, ViewTabs } from "@/components/parts/tabs";
import { Tick } from "@/components/parts/tick";
import { ToastProvider, useToast } from "@/components/parts/toast";
import { Icon } from "@/components/shell/icon";
import { jobPageHref } from "@/lib/shell/links";
import {
  allocate,
  dayWord,
  hadWord,
  lateOf,
  openOf,
  orderedAfter,
  needWordOf,
  type HadWhere,
  type Item,
  type JobState,
  type OrderedTo,
  type StockJob,
  type Week,
} from "@/lib/stock/stock";
import type { NeedView, StockJobView, StockView } from "@/lib/stock/stock-server";
import { stockPress } from "@/app/actions/stock";

/* STOCK (the mocks https://claude.ai/artifact/WQ1yppLgALMhXbHM5XWLDq and
   https://claude.ai/artifact/MpMUX46rk45j6dP6ZYnEsu; Isaac, 11 and 13 November
   2026: "This whole process needs to be rapid", then "Build it"). Next week
   and the week after each have the Shopping list, every item added up, with
   To order by supplier beside it, and By job, where a job with everything
   covered folds to its card. Later is what the accepted jobs need past those
   two weeks, by supplier, for a bulk order. The tick is In stock, one press
   for all of them; the item's name opens its count, the visit it's needed at,
   and Order them or Already have them. */

type Ready = Extract<StockView, { ready: true }>;
type View = "list" | "jobs";
type Back = { ok: true; view: StockView } | { ok: false; reason: string };

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** "2026-11-16 07:30:00" is Monday 7:30 am. */
export function whenOf(at: string): string {
  const d = new Date(`${at.slice(0, 10)}T12:00:00Z`);
  const [h, m] = at.slice(11, 16).split(":").map(Number) as [number, number];
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${DAYS[d.getUTCDay()]} ${hh}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}
const longDay = (day: string) => {
  const d = new Date(`${day.slice(0, 10)}T12:00:00Z`);
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
};
const shortDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-AU", { day: "numeric", month: "short", timeZone: "Australia/Sydney" }) : "");
const money = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-AU")}`;
const each = (cents: number) => `$${(cents / 100).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} each`;

const STATE: Record<JobState, { tone: Tone; word: string } | null> = {
  in: { tone: "good", word: "In stock" },
  late: { tone: "wrong", word: "Due after" },
  ordered: { tone: "info", word: "Ordered" },
  order: { tone: "look", word: "To order" },
  check: { tone: "look", word: "Check" },
  none: null,
};

/** The days an order might land: the next three weeks, and Not said. */
function arrivals(today: string): { value: string; label: string }[] {
  const out = [{ value: "", label: "Not said" }];
  for (let i = 1; i <= 21; i++) {
    const d = new Date(new Date(`${today}T12:00:00Z`).getTime() + i * 86_400_000);
    const dow = d.getUTCDay();
    if (dow === 0 || dow === 6) continue;
    const day = d.toISOString().slice(0, 10);
    out.push({ value: day, label: longDay(day) });
  }
  return out;
}

/** What to put back on Undo: each job's marks on these items as they are now. */
const snapOf = (items: readonly Item[]) =>
  items.flatMap((it) =>
    it.jobs.map((j) => ({ uuid: j.uuid, key: it.group === "duct" ? "duct" : it.key, inStock: j.inStock, ordered: j.ordered, had: j.had, orderedTo: j.orderedTo, orderedDue: j.orderedDue, orderRef: j.orderRef, hadWhere: j.hadWhere, hadWho: j.hadWho })),
  );

/** The phone's chevron at a row's end: the row opens something */
function Chev() {
  return (
    <span className="stk-ch" aria-hidden="true">
      <Icon name="chevR" size={16} />
    </span>
  );
}

function JobNumber({ job }: { job: Pick<StockJob, "hue" | "number"> }) {
  return <span className={`stk-num sc-card--${job.hue}`}>{job.number ?? "Job"}</span>;
}

type Sheet = { kind: "item"; key: string } | { kind: "order"; key: string } | { kind: "had"; key: string } | { kind: "mark"; supplier: string | null } | { kind: "bulk"; supplier: string | null } | { kind: "site"; supplier: string; name: string };

/* the page holds its own toasts, as Notes and Conversations do: no provider
   stands above a page, and without one Stock threw on opening ("This page
   didn't load", Isaac, 15 November 2026) */
export function StockPage({ initial }: { initial: StockView }) {
  return (
    <ToastProvider>
      <Stock initial={initial} />
    </ToastProvider>
  );
}

function Stock({ initial }: { initial: StockView }) {
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const [view, setView] = useState<StockView>(initial);
  const [busy, start] = useTransition();
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const p = params.get("week");
  const week: Week = p === "after" ? "after" : p === "later" ? "later" : "next";
  const tab: View = params.get("view") === "jobs" ? "jobs" : "list";

  const go = (next: { week?: Week; view?: View }) => {
    const q = new URLSearchParams(params.toString());
    if (next.week === "next") q.delete("week");
    else if (next.week) q.set("week", next.week);
    if (next.view === "list") q.delete("view");
    else if (next.view) q.set("view", next.view);
    const s = q.toString();
    router.replace(s ? `/dashboard/stock?${s}` : "/dashboard/stock");
  };

  const send = (body: Record<string, unknown>, text: string, undo?: Record<string, unknown>[]) =>
    start(async () => {
      const r: Back = await stockPress({ week, ...body }).catch(() => ({ ok: false as const, reason: "Couldn't save that. Try again." }));
      if (!r.ok) {
        toast({ text: r.reason });
        return;
      }
      setView(r.view);
      setSheet(null);
      toast({ text, undo: undo ? () => send({ do: "back", rows: undo }, "Put back") : undefined });
    });

  const d = view.ready && view.week === week ? view : null;
  const item = (key: string) => d?.items.find((i) => i.key === key) ?? null;

  return (
    <div className="stk">
      <header className="stk-head">
        <h1>Stock</h1>
        <div className="stk-bar">
          {week !== "later" ? (
            <ViewTabs
              ariaLabel="Views of stock"
              idPrefix="stk-view"
              current={tab}
              onGo={(k) => go({ view: k as View })}
              items={[
                { key: "list", label: "Shopping list" },
                { key: "jobs", label: "By job" },
              ]}
            />
          ) : null}
          <span className="stk-weeks">
            <Tray
              ariaLabel="Which weeks"
              value={week}
              onChange={(w) => go({ week: w })}
              options={[
                { value: "next", label: "Next week" },
                { value: "after", label: "Week after" },
                { value: "later", label: "Later" },
              ]}
            />
          </span>
        </div>
      </header>
      <div className="stk-ground">
      {!view.ready ? (
        <p className="stk-note">Stock goes live once its table is on the database.</p>
      ) : !d ? (
        <p className="stk-note">Reading the week</p>
      ) : week === "later" ? (
        <Later d={d} busy={busy} onBulk={(s) => setSheet({ kind: "bulk", supplier: s })} onSite={(s, name) => setSheet({ kind: "site", supplier: s, name })} />
      ) : tab === "list" ? (
        <ShoppingList
          d={d}
          busy={busy}
          onTick={(it) => send({ do: "instock", key: it.key, total: null }, `${it.title} in stock`, snapOf([it]))}
          onTakeOff={(it) =>
            send(
              { do: "back", rows: snapOf([it]).map((r) => ({ ...r, inStock: 0, had: 0, hadWhere: null, hadWho: null })) },
              `${it.title} taken off`,
              snapOf([it]),
            )
          }
          onOpen={(it) => setSheet({ kind: "item", key: it.key })}
          onOrder={(s) => setSheet({ kind: "mark", supplier: s })}
          onTake={(j, i, name) => send({ do: "option", job: j, option: i }, `${name} accepted`)}
        />
      ) : (
        <ByJob d={d} busy={busy} onTake={(j, i, name) => send({ do: "option", job: j, option: i }, `${name} accepted`)} />
      )}
      </div>

      {d && sheet?.kind === "item" && item(sheet.key) ? (
        <ItemDialog
          d={d}
          it={item(sheet.key)!}
          busy={busy}
          onClose={() => setSheet(null)}
          onCount={(it, n) => send({ do: "instock", key: it.key, total: n }, `${n} in stock`, snapOf([it]))}
          onNeeded={(job, key, visit, label) => send({ do: "needed", job, key, visit }, `Needed at ${label}`)}
          onOrder={(it) => setSheet({ kind: "order", key: it.key })}
          onHad={(it) => setSheet({ kind: "had", key: it.key })}
        />
      ) : null}
      {d && sheet?.kind === "order" && item(sheet.key) ? (
        <OrderDialog d={d} it={item(sheet.key)!} busy={busy} onClose={() => setSheet(null)} onSave={(it, how, qty) => send({ do: "order", key: it.key, ...how }, `${qty} ordered`, snapOf([it]))} />
      ) : null}
      {d && sheet?.kind === "had" && item(sheet.key) ? (
        <HadDialog it={item(sheet.key)!} busy={busy} onClose={() => setSheet(null)} onSave={(it, where, who) => send({ do: "had", key: it.key, where, who }, "Saved", snapOf([it]))} />
      ) : null}
      {d && sheet?.kind === "mark" ? (
        <OrderFromDialog
          d={d}
          supplier={sheet.supplier}
          busy={busy}
          onClose={() => setSheet(null)}
          onAddSite={(s, name) => setSheet({ kind: "site", supplier: s, name })}
          onSave={(body, text, its) => send(body, text, snapOf(its))}
        />
      ) : null}
      {d && sheet?.kind === "bulk" ? (
        <BulkDialog
          d={d}
          supplier={sheet.supplier}
          busy={busy}
          onClose={() => setSheet(null)}
          onSave={(supplier, name, jobs, how, n) => {
            const s = d.later.find((x) => x.supplierKey === supplier);
            const its = d.items.filter((i) => s?.lines.some((l) => l.key === i.key));
            send({ do: "bulk", supplier, jobs, ...how }, `${n} ordered from ${name}`, snapOf(its));
          }}
        />
      ) : null}
      {d && sheet?.kind === "site" ? <SiteDialog name={sheet.name} busy={busy} onClose={() => setSheet(null)} onSave={(url) => send({ do: "site", supplier: sheet.supplier, url }, url ? "Their site saved" : "Their site taken off")} /> : null}
    </div>
  );
}

/* THE SHOPPING LIST AS THE OFFICE READS IT (Isaac, 22 November 2026: "an
   office person would look at this page and be very confused", then "Build
   it" to https://claude.ai/artifact/UXdFUjx4mcwNsY3CSzh5Jc). Every unit and
   control is in one place by what's left to do with it: To order, a lot for
   each supplier with its one button; Ordered; In stock. A row's words open
   its count; its one button says what it does. The panel beside it says
   where the week is up to, and each job's word. */
const and = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}` : (xs[0] ?? ""));
const uniq = <T,>(xs: T[]) => [...new Set(xs)];
const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;
/** "for 2798 Tue and 3517 Wed", the jobs given, by when each wants it */
function forOf(it: Item, uuids: readonly string[], today: string): string {
  const words = it.jobs.filter((j) => uuids.includes(j.uuid)).map((j) => `${j.number ?? "a job"}${j.at ? ` ${dayWord(j.at, today)}` : ""}`);
  return `for ${and(words)}`;
}

function ShoppingList({
  d,
  busy,
  onTick,
  onTakeOff,
  onOpen,
  onOrder,
  onTake,
}: {
  d: Ready;
  busy: boolean;
  onTick: (it: Item) => void;
  onTakeOff: (it: Item) => void;
  onOpen: (it: Item) => void;
  onOrder: (supplier: string | null) => void;
  onTake: (job: string, option: number, name: string) => void;
}) {
  const firm = d.items.filter((i) => i.group !== "duct");
  const ducts = d.items.filter((i) => i.group === "duct");
  const ordered = firm.filter((i) => i.ordered > 0);
  const got = firm.filter((i) => i.inStock + i.had > 0);
  const choose = d.jobs.filter((j) => j.choose);
  const item = (key: string) => d.items.find((i) => i.key === key);
  const nothing = !d.items.length && !choose.length && !d.noQuote.length && !d.noUnits.length;
  if (nothing) return <p className="stk-note">{d.jobs.length ? "Nothing’s needed that week: what’s booked needs it at a later visit." : "Nothing’s booked that week."}</p>;
  const toOrder = d.orders.reduce((s, o) => s + o.lines.reduce((t, l) => t + l.qty, 0), 0);
  const onOrderCount = ordered.reduce((s, i) => s + i.ordered, 0);
  const inCount = got.reduce((s, i) => s + i.inStock + i.had, 0);
  return (
    <div className="stk-cols">
      <div className="stk-col">
        {choose.length || d.noUnits.length || d.noQuote.length ? (
          <section className="stk-sec">
            <h2 className="stk-h--look">To check before it’s on the list</h2>
            <div className="stk-card">
              {choose.map((j) => (
                <Choose key={j.job.uuid} j={j} busy={busy} onTake={onTake} />
              ))}
              {d.noUnits.length ? <JobsLine what="No units on its quote" jobs={d.noUnits} /> : null}
              {d.noQuote.length ? <JobsLine what="No quote in HeyTiff" jobs={d.noQuote} /> : null}
            </div>
          </section>
        ) : null}
        {firm.length ? (
          <section className="stk-sec">
            <h2 className="stk-h--look">
              <Dot hue="orange" />
              To order
            </h2>
            {d.orders.length ? (
              d.orders.map((o) => {
                const n = o.lines.reduce((s, l) => s + l.qty, 0);
                const jobs = uniq(o.lines.flatMap((l) => l.jobs.map((j) => j.number ?? "a job")));
                return (
                  <div key={o.supplierKey ?? "none"} className="stk-card">
                    <div className="stk-sup">
                      <span className="stk-w">
                        <Fade className="stk-t">{o.supplierKey ? o.supplierName : "No supplier in the price book"}</Fade>
                        <span className="stk-s">{`${plural(n, "item")} for ${and(jobs)}`}</span>
                      </span>
                      <Button kind="main" size={44} disabled={busy} onClick={() => onOrder(o.supplierKey)}>
                        {o.supplierKey ? `Order from ${o.supplierName}` : "Order them"}
                      </Button>
                    </div>
                    <ul>
                      {o.lines.map((l) => {
                        const it = item(l.key);
                        return it ? (
                          <Line key={l.key} n={l.qty} name={l.title} sub={`${l.code ? `${l.code}, ` : ""}${forOf(it, l.jobs.map((j) => j.uuid), d.today)}`} busy={busy} onOpen={() => onOpen(it)}>
                            <Button kind="quiet" size={32} disabled={busy} onClick={() => onTick(it)}>
                              Mark in stock
                            </Button>
                          </Line>
                        ) : null;
                      })}
                    </ul>
                  </div>
                );
              })
            ) : (
              <p className="stk-card stk-done">Nothing left to order for that week.</p>
            )}
          </section>
        ) : null}
        {ordered.length ? (
          <section className="stk-sec">
            <h2>
              <Dot hue="grey" />
              Ordered
            </h2>
            <ul className="stk-card">
              {ordered.map((it) => {
                const on = it.jobs.filter((j) => orderedAfter(j.need, j.inStock, j.ordered, j.had) > 0);
                const late = it.jobs.find((j) => lateOf(j));
                const dues = uniq(on.map((j) => j.orderedDue).filter((x): x is string => !!x)).sort();
                const refs = uniq(on.map((j) => j.orderRef).filter((x): x is string => !!x));
                const site = on.some((j) => j.orderedTo === "site");
                const sub = [it.code, forOf(it, on.map((j) => j.uuid), d.today), refs.length ? `no. ${refs.join(", ")}` : null, site ? "to the site" : "to the factory"].filter(Boolean).join(", ");
                return (
                  <Line key={it.key} n={it.ordered} name={it.title} sub={sub} busy={busy} onOpen={() => onOpen(it)}>
                    {late?.at ? (
                      <StateWord tone="wrong">{`Due after ${dayWord(late.at, d.today)}`}</StateWord>
                    ) : (
                      <StateWord tone="info">{dues.length ? `Arrives ${dayWord(dues[dues.length - 1]!, d.today)}` : "Ordered"}</StateWord>
                    )}
                    <Button kind="quiet" size={32} disabled={busy} onClick={() => onTick(it)}>
                      Mark in stock
                    </Button>
                  </Line>
                );
              })}
            </ul>
          </section>
        ) : null}
        {got.length ? (
          <section className="stk-sec">
            <h2 className="stk-h--good">
              <Dot hue="green" />
              In stock
            </h2>
            <ul className="stk-card">
              {got.map((it) => {
                const had = it.jobs.find((j) => j.had > 0 && j.hadWhere);
                const holders = it.jobs.filter((j) => j.inStock + j.had > 0).map((j) => j.uuid);
                return (
                  <Line key={it.key} n={it.inStock + it.had} name={it.title} sub={`${it.code ? `${it.code}, ` : ""}${forOf(it, holders, d.today)}`} busy={busy} onOpen={() => onOpen(it)}>
                    <StateWord tone="good">{had && !it.inStock ? hadWord(had.hadWhere!, had.hadWho) : "In stock"}</StateWord>
                    <Button kind="quiet" size={32} disabled={busy} onClick={() => onTakeOff(it)}>
                      Take off
                    </Button>
                  </Line>
                );
              })}
            </ul>
          </section>
        ) : null}
        {ducts.length ? (
          <section className="stk-sec">
            <h2>Ductwork, suggested</h2>
            <ul className="stk-card">
              {ducts.map((it) => {
                const done = it.inStock >= it.need;
                return (
                  <Line key={it.key} n={null} name={it.title} sub={it.detail} busy={busy}>
                    {done ? <StateWord tone="good">In stock</StateWord> : null}
                    <Button kind="quiet" size={32} disabled={busy} onClick={() => (done ? onTakeOff(it) : onTick(it))}>
                      {done ? "Take off" : "Mark in stock"}
                    </Button>
                  </Line>
                );
              })}
            </ul>
          </section>
        ) : null}
      </div>
      <div className="stk-col stk-col--side">
        <section className="stk-sec">
          <h2>{d.week === "after" ? "The week after" : "Next week"}</h2>
          <ul className="stk-card">
            <li className="stk-state">
              <Dot hue="orange" />
              <b>To order</b>
              <strong>{toOrder}</strong>
            </li>
            <li className="stk-state">
              <Dot hue="grey" />
              <b>Ordered</b>
              <strong>{onOrderCount}</strong>
            </li>
            <li className="stk-state">
              <Dot hue="green" />
              <b>In stock</b>
              <strong>{inCount}</strong>
            </li>
          </ul>
        </section>
        {d.jobs.length ? (
          <section className="stk-sec">
            <h2>The jobs</h2>
            <ul className="stk-card">
              {d.jobs.map((j) => {
                const short = j.needs.find((n) => n.group !== "duct" && n.inStock < n.need);
                const state = j.state === "in" && short ? needWordOf(short, d.today) : STATE[j.state];
                return (
                  <li key={j.job.uuid}>
                    <Link className="stk-jobrow" href={jobPageHref(j.job.uuid)}>
                      <JobNumber job={j.job} />
                      <span className="stk-w">
                        <Fade className="stk-t">{j.job.client ?? j.job.suburb ?? "A job"}</Fade>
                        <Fade className="stk-s">{[j.job.kind, j.job.firstAt ? whenOf(j.job.firstAt) : "not booked"].filter(Boolean).join(", ")}</Fade>
                      </span>
                      {state ? <StateWord tone={state.tone}>{state.word}</StateWord> : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}
      </div>
    </div>
  );
}

/** A row on the list: how many, its name and line (which open its count), then its word and one button. */
function Line({ n, name, sub, busy, onOpen, children }: { n: number | null; name: string; sub: string; busy: boolean; onOpen?: () => void; children: ReactNode }) {
  const words = (
    <>
      {n === null ? null : <span className="stk-n">{n}</span>}
      <span className="stk-w">
        <Fade className="stk-t">{name}</Fade>
        <Fade className="stk-s">{sub}</Fade>
      </span>
    </>
  );
  return (
    <li className="stk-row stk-line">
      {onOpen ? (
        <button type="button" className="stk-mid stk-open" onClick={onOpen} disabled={busy}>
          {words}
        </button>
      ) : (
        <span className="stk-mid stk-mid--static stk-open">{words}</span>
      )}
      {children}
    </li>
  );
}

function JobsLine({ what, jobs }: { what: string; jobs: StockJob[] }) {
  return (
    <div className="stk-row stk-row--plain">
      <div className="stk-mid stk-mid--static">
        <span className="stk-t">{what}</span>
        <span className="stk-s stk-wrap">
          {jobs.map((j, i) => (
            <span key={j.uuid}>
              {i ? ", " : ""}
              <Link className="stk-jl" href={jobPageHref(j.uuid)}>
                {j.number ?? "a job"}
              </Link>
            </span>
          ))}
        </span>
      </div>
    </div>
  );
}

function Choose({ j, busy, onTake }: { j: StockJobView; busy: boolean; onTake: (job: string, option: number, name: string) => void }) {
  return (
    <div className="stk-ask">
      <div className="stk-t">
        {j.job.number} {j.job.client ?? ""}
        {j.job.firstAt ? `, ${DAYS[new Date(`${j.job.firstAt.slice(0, 10)}T12:00:00Z`).getUTCDay()]}` : ""}
      </div>
      <div className="stk-s stk-q--look">Which option did they take?</div>
      <div className="stk-askrow">
        {(j.choose ?? []).map((o) => (
          <Button key={o.index} kind="second" size={32} disabled={busy} onClick={() => onTake(j.job.uuid, o.index, `Option ${o.index + 1}`)}>
            {`Option ${o.index + 1}, ${o.name.replace(/^option \d+,?\s*/i, "")}`}
          </Button>
        ))}
      </div>
    </div>
  );
}

const FROM: Record<NonNullable<StockJobView["from"]>, string> = {
  accepted: "From the quote, the option accepted",
  only: "From the quote",
  servicem8: "From the quote, the option left in ServiceM8",
};


function needSub(n: NeedView, today: string): string {
  if (n.inStock >= n.need) return `In stock${n.inStockName ? `, ${n.inStockName}` : ""}${n.inStockAt ? `, ${shortDate(n.inStockAt)}` : ""}`;
  if (n.ordered > 0)
    return [n.inStock ? `${n.inStock} of ${n.need} in` : "", `Ordered${n.orderedName ? ` by ${n.orderedName}` : ""}`, n.orderedDue ? `due ${dayWord(n.orderedDue, today)}` : "", n.orderRef ? `no. ${n.orderRef}` : ""].filter(Boolean).join(", ");
  if (n.inStock) return `${n.inStock} of ${n.need} in`;
  return n.detail;
}

function ByJob({ d, busy, onTake }: { d: Ready; busy: boolean; onTake: (job: string, option: number, name: string) => void }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  if (!d.jobs.length && !d.noQuote.length) return <p className="stk-note">Nothing’s booked that week.</p>;
  /* the jobs under their day, as the phone has them */
  const days: { day: string; jobs: StockJobView[] }[] = [];
  for (const j of d.jobs) {
    const day = j.job.firstAt ? j.job.firstAt.slice(0, 10) : "";
    const last = days[days.length - 1];
    if (last && last.day === day) last.jobs.push(j);
    else days.push({ day, jobs: [j] });
  }
  return (
    <div className="stk-days">
      {days.map(({ day, jobs }) => (
        <section key={day || "none"} className="stk-sec">
          <h2>{day ? longDay(day) : "Not booked"}</h2>
          <div className="stk-jobs">
      {jobs.map((j) => {
        /* a covered job says how: In stock, or the first that isn't, To site, Thu or In Luke's van */
        const short = j.needs.find((n) => n.group !== "duct" && n.inStock < n.need);
        const state = j.state === "in" && short ? needWordOf(short, d.today) : STATE[j.state];
        const folded = j.state === "in" && !open.has(j.job.uuid);
        /* the visit on that day, where the quote plans them: "Rough-in, ground floor" */
        const stage = j.visits.find((v) => v.at && j.job.firstAt && v.at.slice(0, 10) === j.job.firstAt.slice(0, 10))?.stage ?? j.job.kind;
        return (
          <section key={j.job.uuid} className="stk-card stk-job">
            <button
              type="button"
              className="stk-jh"
              aria-expanded={j.state === "in" ? !folded : undefined}
              onClick={() => j.state === "in" && setOpen((s) => new Set(s.has(j.job.uuid) ? [...s].filter((x) => x !== j.job.uuid) : [...s, j.job.uuid]))}
            >
              <JobNumber job={j.job} />
              <span className="stk-mid stk-mid--static">
                <Fade className="stk-t">{j.job.client ?? "A job"}</Fade>
                {j.job.suburb ? <Fade className="stk-s">{j.job.suburb}</Fade> : null}
                <span className="stk-s">
                  {[stage, j.job.firstAt ? whenOf(j.job.firstAt).split(" ").slice(1).join(" ") : null].filter(Boolean).join(", ")}, {j.job.crew} booked
                </span>
              </span>
              {state ? <StateWord tone={state.tone}>{state.word}</StateWord> : null}
            </button>
            {folded ? null : j.choose ? (
              <Choose j={j} busy={busy} onTake={onTake} />
            ) : (
              <>
                {j.needs.length ? (
                  <ul>
                    {j.needs.map((n) => {
                      const w = needWordOf(n, d.today);
                      return (
                        <li key={n.key} className="stk-row stk-row--plain">
                          <span className="stk-n stk-n--s">{n.group === "duct" ? "" : n.need}</span>
                          <span className="stk-mid stk-mid--static">
                            <Fade className="stk-t">{n.title}</Fade>
                            <Fade className="stk-s">{needSub(n, d.today)}</Fade>
                          </span>
                          {w ? <StateWord tone={w.tone}>{w.word}</StateWord> : n.group === "duct" ? null : <StateWord tone="look">To order</StateWord>}
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
                {j.later.length ? <LaterFoot later={j.later} /> : null}
                <Link className="stk-jf" href={jobPageHref(j.job.uuid)}>
                  <span className="stk-w">
                    <span className="stk-t stk-t--plain">Open job</span>
                    {j.from ? <span className="stk-s">{FROM[j.from]}</span> : null}
                  </span>
                  <Chev />
                </Link>
              </>
            )}
          </section>
        );
      })}
          </div>
        </section>
      ))}
      {d.noUnits.length || d.noQuote.length ? (
        <section className="stk-sec">
          <div className="stk-card stk-checks">
            {d.noUnits.length ? <JobsLine what="No units on its quote" jobs={d.noUnits} /> : null}
            {d.noQuote.length ? <JobsLine what="No quote in HeyTiff" jobs={d.noQuote} /> : null}
          </div>
        </section>
      ) : null}
    </div>
  );
}

/** "For Install, Monday 7 December: VRF outdoor, 3 ducted heads" — what's wanted at a later visit. */
function LaterFoot({ later }: { later: NeedView[] }) {
  const by = new Map<string, NeedView[]>();
  for (const n of later) {
    const k = `${n.visit?.stage ?? "Later"}|${n.at ?? ""}`;
    by.set(k, [...(by.get(k) ?? []), n]);
  }
  return (
    <div className="stk-later">
      {[...by].map(([k, ns]) => {
        const [stage, at] = k.split("|") as [string, string];
        return (
          <p key={k} className="stk-s stk-wrap">
            <b>{`For ${stage}, ${at ? longDay(at) : "not booked yet"}:`}</b> {ns.map((n) => `${n.need > 1 ? `${n.need} x ` : ""}${n.title}`).join(", ")}
            {ns.some((n) => n.ordered > 0) ? `, ${ns.filter((n) => n.ordered > 0).length} ordered` : ""}
          </p>
        );
      })}
    </div>
  );
}

function ItemDialog({
  d,
  it,
  busy,
  onClose,
  onCount,
  onNeeded,
  onOrder,
  onHad,
}: {
  d: Ready;
  it: Item;
  busy: boolean;
  onClose: () => void;
  onCount: (it: Item, n: number) => void;
  onNeeded: (job: string, key: string, visit: number | null, label: string) => void;
  onOrder: (it: Item) => void;
  onHad: (it: Item) => void;
}) {
  const wants = it.jobs.map((j) => Math.max(0, j.need - j.had));
  const [raw, setRaw] = useState(String(it.inStock || wants.reduce((s, n) => s + n, 0)));
  const n = Math.max(0, Math.min(10_000, Math.round(Number(raw)) || 0));
  const share = allocate(n, wants);
  const views = new Map(d.jobs.map((j) => [j.job.uuid, j]));
  const left = it.jobs.map((j, i) => ({ j, left: Math.max(0, j.need - j.had - share[i]! - orderedAfter(j.need, share[i]!, j.ordered, j.had)) })).filter((x) => x.left > 0);
  const leftCount = left.reduce((s, x) => s + x.left, 0);
  return (
    <Dialog
      heading={it.title}
      onClose={onClose}
      width={400}
      foot={
        <>
          <Button kind="second" size={36} onClick={onClose}>
            Cancel
          </Button>
          <Button kind="main" size={36} disabled={busy} onClick={() => onCount(it, n)}>
            {`Mark ${n} in stock`}
          </Button>
        </>
      }
    >
      <p className="stk-dsub">
        {it.code ?? it.detail}, {it.need} needed
      </p>
      <Field label="How many have we got?">
        <TextInput inputMode="numeric" value={raw} onChange={(e) => setRaw(e.currentTarget.value.replace(/[^0-9]/g, ""))} autoFocus />
      </Field>
      <ul className="stk-share">
        {it.jobs.map((j, i) => {
          const v = views.get(j.uuid);
          return (
            <li key={j.uuid}>
              <span className="stk-t">{j.number ?? "A job"}</span>
              <span className="stk-s">{j.at ? whenOf(j.at) : "Not booked"}</span>
              <StateWord tone={share[i]! + j.had >= j.need ? "good" : "look"}>{`${share[i]! + j.had} of ${j.need}`}</StateWord>
              {v && v.visits.length > 1 && it.group !== "duct" ? (
                <span className="stk-need">
                  <Chooser
                    size={32}
                    aria-label={`Needed at, ${j.number ?? "this job"}`}
                    value={String(j.visit?.n ?? "")}
                    onChange={(val) => {
                      const visit = v.visits.find((x) => String(x.n) === val);
                      if (visit) onNeeded(j.uuid, it.key, visit.n, visit.stage);
                    }}
                    options={v.visits.map((x) => ({ value: String(x.n), label: `${x.stage}, ${x.at ? longDay(x.at) : "not booked"}` }))}
                  />
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
      {leftCount > 0 && it.group !== "duct" ? (
        <div className="stk-left">
          <span className="stk-t">{`The ${leftCount} for ${[...new Set(left.map((x) => x.j.number ?? "a job"))].join(", ")}`}</span>
          <div className="stk-askrow">
            <Button kind="second" size={36} disabled={busy} onClick={() => onOrder(it)}>
              Order them
            </Button>
            <Button kind="second" size={36} disabled={busy} onClick={() => onHad(it)}>
              Already have them
            </Button>
          </div>
        </div>
      ) : null}
    </Dialog>
  );
}

function OrderDialog({ d, it, busy, onClose, onSave }: { d: Ready; it: Item; busy: boolean; onClose: () => void; onSave: (it: Item, how: { supplier: string | null; to: OrderedTo; due: string | null; ref: string | null }, qty: number) => void }) {
  const prices = it.code ? d.prices[it.code.toUpperCase()] ?? [] : [];
  const opts = prices.length ? prices.map((p, i) => ({ value: p.supplierKey, label: `${p.name}, ${each(p.cents)}${i === 0 ? ", the cheapest" : ""}` })) : it.supplierKey ? [{ value: it.supplierKey, label: it.supplierKey }] : [];
  const [supplier, setSupplier] = useState<string | null>(opts[0]?.value ?? null);
  const [to, setTo] = useState<OrderedTo>("factory");
  const [due, setDue] = useState("");
  const [ref, setRef] = useState("");
  const qty = it.jobs.reduce((s, j) => s + openOf(j), 0);
  const jobs = it.jobs.filter((j) => openOf(j) > 0);
  return (
    <Dialog
      heading={`Order ${qty}`}
      onClose={onClose}
      width={400}
      foot={
        <>
          <Button kind="second" size={36} onClick={onClose}>
            Cancel
          </Button>
          <Button kind="main" size={36} disabled={busy || qty === 0} onClick={() => onSave(it, { supplier, to, due: due || null, ref: ref || null }, qty)}>
            {`Mark ${qty} ordered`}
          </Button>
        </>
      }
    >
      <p className="stk-dsub">
        {it.title}, for {jobs.map((j) => `${j.number ?? "a job"}${j.at ? ` ${dayWord(j.at, d.today)}` : ""}`).join(", ")}
      </p>
      {opts.length ? (
        <Field label="From">
          <Chooser options={opts} value={supplier} onChange={setSupplier} />
        </Field>
      ) : null}
      <div className="stk-fld">
        <span className="stk-lbl">Deliver to</span>
        <Tray<OrderedTo>
          ariaLabel="Deliver to"
          value={to}
          onChange={setTo}
          options={[
            { value: "factory", label: "The factory" },
            { value: "site", label: "The site" },
          ]}
        />
      </div>
      <Field label="Arrives">
        <Chooser options={arrivals(d.today)} value={due} onChange={setDue} />
      </Field>
      <Field label="Their order number">
        <TextInput value={ref} onChange={(e) => setRef(e.currentTarget.value.slice(0, 60))} />
      </Field>
    </Dialog>
  );
}

function HadDialog({ it, busy, onClose, onSave }: { it: Item; busy: boolean; onClose: () => void; onSave: (it: Item, where: HadWhere, who: string | null) => void }) {
  const [where, setWhere] = useState<HadWhere>("van");
  const [who, setWho] = useState("");
  const jobs = it.jobs.filter((j) => openOf(j) > 0);
  const qty = jobs.reduce((s, j) => s + openOf(j), 0);
  return (
    <Dialog
      heading="Already have them"
      onClose={onClose}
      width={400}
      foot={
        <>
          <Button kind="second" size={36} onClick={onClose}>
            Cancel
          </Button>
          <Button kind="main" size={36} disabled={busy || qty === 0} onClick={() => onSave(it, where, where === "van" ? who || null : null)}>
            Save
          </Button>
        </>
      }
    >
      <p className="stk-dsub">
        {qty} {it.title}, for {jobs.map((j) => j.number ?? "a job").join(", ")}
      </p>
      <div className="stk-fld">
        <span className="stk-lbl">Where are they?</span>
        <Tray<HadWhere>
          ariaLabel="Where are they?"
          value={where}
          onChange={setWhere}
          options={[
            { value: "site", label: "On site" },
            { value: "van", label: "In a van" },
            { value: "customer", label: "The customer’s" },
          ]}
        />
      </div>
      {where === "van" ? (
        <Field label="Whose van">
          <TextInput value={who} onChange={(e) => setWho(e.currentTarget.value.slice(0, 80))} />
        </Field>
      ) : null}
    </Dialog>
  );
}

/** Order from a supplier: one sheet for its whole lot. What's ordered (all
    ticked to begin with), where each job's part goes, the day it lands and
    their order number, then Mark ordered. A lot with no supplier in the price
    book asks who it's from first. */
function OrderFromDialog({
  d,
  supplier,
  busy,
  onClose,
  onAddSite,
  onSave,
}: {
  d: Ready;
  supplier: string | null;
  busy: boolean;
  onClose: () => void;
  onAddSite: (supplier: string, name: string) => void;
  onSave: (body: Record<string, unknown>, text: string, undo: Item[]) => void;
}) {
  const o = d.orders.find((x) => x.supplierKey === supplier);
  const [pick, setPick] = useState<Set<string>>(() => new Set(o?.lines.map((l) => l.key) ?? []));
  const [sites, setSites] = useState<Set<string>>(new Set());
  const [due, setDue] = useState("");
  const [ref, setRef] = useState("");
  const [from, setFrom] = useState("");
  if (!o) return null;
  const jobOf = new Map(d.jobs.map((j) => [j.job.uuid, j.job]));
  const lines = o.lines.filter((l) => pick.has(l.key));
  const n = lines.reduce((s, l) => s + l.qty, 0);
  const jobs = uniq(lines.flatMap((l) => l.jobs.map((j) => j.uuid)));
  const all = uniq(o.lines.flatMap((l) => l.jobs.map((j) => j.number ?? "a job")));
  /* who it could be from: every supplier the week's price book and lots name */
  const known = new Map<string, string>();
  for (const x of d.orders) if (x.supplierKey) known.set(x.supplierKey, x.supplierName);
  for (const ps of Object.values(d.prices)) for (const p of ps) known.set(p.supplierKey, p.name);
  const fromName = supplier ? o.supplierName : known.get(from) ?? null;
  return (
    <Dialog
      heading={supplier ? `Order from ${o.supplierName}` : "Order them"}
      onClose={onClose}
      width={560}
      foot={
        <>
          <Button kind="second" size={36} onClick={onClose}>
            Cancel
          </Button>
          <Button
            kind="main"
            size={36}
            disabled={busy || n === 0}
            onClick={() => {
              const toSite = jobs.filter((u) => sites.has(u));
              const siteDue: Record<string, string | null> = {};
              for (const u of toSite) siteDue[u] = due || null;
              onSave(
                { do: "ordered", supplier, keys: lines.map((l) => l.key), from: supplier ? null : from || null, sites: toSite, due: { factory: due || null, sites: siteDue }, ref: ref || null },
                `${n} ordered${fromName ? ` from ${fromName}` : ""}`,
                d.items.filter((i) => pick.has(i.key)),
              );
            }}
          >
            {`Mark ${n} ordered`}
          </Button>
        </>
      }
    >
      <div className="stk-ofd">
      <p className="stk-dsub">{`${plural(o.lines.reduce((s, l) => s + l.qty, 0), "item")} for ${and(all)}`}</p>
      {supplier ? null : (
        <Field label="From">
          <Chooser options={[{ value: "", label: "Not said" }, ...[...known].map(([value, label]) => ({ value, label }))]} value={from} onChange={setFrom} />
        </Field>
      )}
      <div className="stk-fld">
        <span className="stk-lbl">What you’re ordering</span>
        <ul className="stk-share">
          {o.lines.map((l) => (
            <li key={l.key} className="stk-share--2">
              <Tick
                checked={pick.has(l.key)}
                onChange={(on) => setPick((p) => new Set(on ? [...p, l.key] : [...p].filter((x) => x !== l.key)))}
                label={
                  <span className="stk-mid stk-mid--static">
                    <span className="stk-t">{`${l.qty} x ${l.code ?? l.title}`}</span>
                    <span className="stk-s">{`${l.code ? `${l.title}, ` : ""}for ${and(l.jobs.map((j) => j.number ?? "a job"))}`}</span>
                  </span>
                }
              />
            </li>
          ))}
        </ul>
      </div>
      {jobs.length ? (
        <div className="stk-fld">
          <span className="stk-lbl">Deliver to</span>
          <ul className="stk-share">
            {jobs.map((u) => {
              const job = jobOf.get(u);
              return (
                <li key={u} className="stk-share--2">
                  <span className="stk-mid stk-mid--static">
                    <span className="stk-t">{job?.number ?? "A job"}</span>
                    <span className="stk-s">{job?.address ?? job?.suburb ?? ""}</span>
                  </span>
                  <Tray<OrderedTo>
                    ariaLabel={`Where ${job?.number ?? "this job"}'s part goes`}
                    value={sites.has(u) ? "site" : "factory"}
                    onChange={(v) => setSites((s) => new Set(v === "site" ? [...s, u] : [...s].filter((x) => x !== u)))}
                    options={[
                      { value: "factory", label: "Factory" },
                      { value: "site", label: "Site" },
                    ]}
                  />
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
      <Field label="Arrives">
        <Chooser options={arrivals(d.today)} value={due} onChange={setDue} />
      </Field>
      <Field label="Their order number">
        <TextInput value={ref} onChange={(e) => setRef(e.currentTarget.value.slice(0, 60))} />
      </Field>
      {o.orderUrl ? (
        <div className="stk-askrow stk-site">
          <Button kind="second" size={36} href={o.orderUrl} target="_blank" rel="noreferrer">
            {`Open ${o.supplierName}’s site`}
          </Button>
        </div>
      ) : supplier ? (
        <div className="stk-askrow stk-site">
          <Button kind="second" size={36} onClick={() => onAddSite(supplier, o.supplierName)}>
            Add their site
          </Button>
        </div>
      ) : null}
      </div>
    </Dialog>
  );
}

function Later({ d, busy, onBulk, onSite }: { d: Ready; busy: boolean; onBulk: (supplier: string | null) => void; onSite: (supplier: string, name: string) => void }) {
  if (!d.later.length) return <p className="stk-note">Nothing accepted is waiting past the next two weeks.</p>;
  const and = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}` : (xs[0] ?? ""));
  return (
    <div className="stk-lats">
      {d.later.map((s) => (
        <section key={s.supplierKey ?? "none"} className="stk-sec">
          <h2 className="stk-h2">
            <Fade>{s.supplierName}</Fade>
            <span>{`${s.units} ${s.units === 1 ? "unit" : "units"}, ${s.jobs} ${s.jobs === 1 ? "job" : "jobs"}`}</span>
          </h2>
          <div className="stk-card">
            <ul>
              {s.lines.map((l) => (
                <li key={l.key} className="stk-row stk-row--plain">
                  <span className="stk-w">
                    <Fade className="stk-t">{l.title}</Fade>
                    <Fade className="stk-s">{`${l.code ? `${l.code}, ` : ""}for ${and(l.jobs.map((j) => j.number ?? "a job"))}`}</Fade>
                  </span>
                  <span className="stk-n">{l.qty}</span>
                </li>
              ))}
            </ul>
            <div className="stk-latf">
              <span className="stk-s">{`${money(s.cents)} at the price book${s.unpriced ? `, and ${s.unpriced} not in it` : ""}`}</span>
              <div className="stk-foot stk-foot--in">
                {s.orderUrl ? (
                  <Button kind="second" size={44} href={s.orderUrl} target="_blank" rel="noreferrer">
                    Open their site
                  </Button>
                ) : s.supplierKey ? (
                  <Button kind="second" size={44} onClick={() => onSite(s.supplierKey!, s.supplierName)}>
                    Add their site
                  </Button>
                ) : null}
                <Button kind="second" size={44} disabled={busy} onClick={() => onBulk(s.supplierKey)}>
                  Order for these jobs
                </Button>
              </div>
            </div>
          </div>
        </section>
      ))}
    </div>
  );
}

/** "Not booked", or the day of the visit its units are for. */
function laterWhen(d: Ready, job: string, lines: Ready["later"][number]["lines"]): string {
  const at = lines.flatMap((l) => l.jobs.filter((j) => j.uuid === job).map((j) => j.at)).find((a) => !!a) ?? null;
  return at ? dayWord(at, d.today) : "Not booked";
}

function BulkDialog({
  d,
  supplier,
  busy,
  onClose,
  onSave,
}: {
  d: Ready;
  supplier: string | null;
  busy: boolean;
  onClose: () => void;
  onSave: (supplier: string | null, name: string, jobs: string[], how: { to: OrderedTo; due: string | null; ref: string | null }, n: number) => void;
}) {
  const s = d.later.find((x) => x.supplierKey === supplier);
  const jobOf = new Map(d.jobs.map((j) => [j.job.uuid, j.job]));
  const all = s ? [...new Set(s.lines.flatMap((l) => l.jobs.map((j) => j.uuid)))] : [];
  const [pick, setPick] = useState<Set<string>>(new Set(all));
  const [to, setTo] = useState<OrderedTo>("factory");
  const [due, setDue] = useState("");
  const [ref, setRef] = useState("");
  if (!s) return null;
  const countOf = (u: string) => s.lines.reduce((n, l) => n + (l.jobs.find((j) => j.uuid === u)?.qty ?? 0), 0);
  const n = [...pick].reduce((t, u) => t + countOf(u), 0);
  return (
    <Dialog
      heading={`Order from ${s.supplierName}`}
      onClose={onClose}
      width={400}
      foot={
        <>
          <Button kind="second" size={36} onClick={onClose}>
            Cancel
          </Button>
          <Button kind="main" size={36} disabled={busy || n === 0} onClick={() => onSave(supplier, s.supplierName, [...pick], { to, due: due || null, ref: ref || null }, n)}>
            {`Mark ${n} ordered`}
          </Button>
        </>
      }
    >
      <p className="stk-dsub">The jobs it’s for</p>
      <ul className="stk-share">
        {all.map((u) => {
          const j = jobOf.get(u);
          return (
            <li key={u} className="stk-share--2">
              <Tick
                checked={pick.has(u)}
                onChange={(on) => setPick((p) => new Set(on ? [...p, u] : [...p].filter((x) => x !== u)))}
                label={
                  <span className="stk-mid stk-mid--static">
                    <span className="stk-t">{`${j?.number ?? "A job"} ${j?.client ?? ""}`}</span>
                    <span className="stk-s">{`${j?.suburb ?? ""}${j?.suburb ? ", " : ""}${laterWhen(d, u, s.lines)}`}</span>
                  </span>
                }
              />
              <span className="stk-n stk-n--s">{countOf(u)}</span>
            </li>
          );
        })}
      </ul>
      <div className="stk-fld">
        <span className="stk-lbl">Deliver to</span>
        <Tray<OrderedTo>
          ariaLabel="Deliver to"
          value={to}
          onChange={setTo}
          options={[
            { value: "factory", label: "The factory" },
            { value: "site", label: "The site" },
          ]}
        />
      </div>
      <Field label="Arrives">
        <Chooser options={arrivals(d.today)} value={due} onChange={setDue} />
      </Field>
      <Field label="Their order number">
        <TextInput value={ref} onChange={(e) => setRef(e.currentTarget.value.slice(0, 60))} />
      </Field>
    </Dialog>
  );
}

function SiteDialog({ name, busy, onClose, onSave }: { name: string; busy: boolean; onClose: () => void; onSave: (url: string) => void }) {
  const [url, setUrl] = useState("");
  return (
    <Dialog
      heading={`${name}’s ordering site`}
      onClose={onClose}
      width={400}
      foot={
        <>
          <Button kind="second" size={36} onClick={onClose}>
            Cancel
          </Button>
          <Button kind="main" size={36} disabled={busy || !url.trim()} onClick={() => onSave(url.trim())}>
            Save their site
          </Button>
        </>
      }
    >
      <Field label="Its web address">
        <TextInput type="url" value={url} onChange={(e) => setUrl(e.currentTarget.value)} autoFocus />
      </Field>
    </Dialog>
  );
}
