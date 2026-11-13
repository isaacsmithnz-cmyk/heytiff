"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/parts/button";
import { Chooser } from "@/components/parts/chooser";
import { Dialog } from "@/components/parts/dialog";
import { Field, TextInput } from "@/components/parts/field";
import { Fade } from "@/components/parts/fade";
import { StateWord, type Tone } from "@/components/parts/state";
import { Tray, ViewTabs } from "@/components/parts/tabs";
import { Tick } from "@/components/parts/tick";
import { useToast } from "@/components/parts/toast";
import { jobPageHref } from "@/lib/shell/links";
import {
  allocate,
  dayWord,
  dropsOf,
  openOf,
  orderedAfter,
  needWordOf,
  rowWord,
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

/** "for 2845 Mon and 3449 Fri" */
function forJobs(it: Item, today: string): string {
  const words = it.jobs.map((j) => `${j.number ?? "a job"}${j.at ? ` ${dayWord(j.at, today)}` : ""}`);
  return `for ${words.length > 1 ? `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}` : words[0]}`;
}

/** What to put back on Undo: each job's marks on these items as they are now. */
const snapOf = (items: readonly Item[]) =>
  items.flatMap((it) =>
    it.jobs.map((j) => ({ uuid: j.uuid, key: it.group === "duct" ? "duct" : it.key, inStock: j.inStock, ordered: j.ordered, had: j.had, orderedTo: j.orderedTo, orderedDue: j.orderedDue, orderRef: j.orderRef, hadWhere: j.hadWhere, hadWho: j.hadWho })),
  );

function TickButton({ state, label, onPress, busy }: { state: "on" | "part" | "off"; label: string; onPress: () => void; busy: boolean }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={state === "on" ? true : state === "part" ? "mixed" : false}
      aria-label={label}
      className={`stk-tick stk-tick--${state}`}
      onClick={onPress}
      disabled={busy}
    >
      {state === "on" ? (
        <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M5 12l5 5 9-10" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : null}
    </button>
  );
}

function JobNumber({ job }: { job: Pick<StockJob, "hue" | "number"> }) {
  return <span className={`stk-num sc-card--${job.hue}`}>{job.number ?? "Job"}</span>;
}

type Sheet = { kind: "item"; key: string } | { kind: "order"; key: string } | { kind: "had"; key: string } | { kind: "mark"; supplier: string | null } | { kind: "bulk"; supplier: string | null } | { kind: "site"; supplier: string; name: string };

export function StockPage({ initial }: { initial: StockView }) {
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const [view, setView] = useState<StockView>(initial);
  const [busy, start] = useTransition();
  const [sheet, setSheet] = useState<Sheet | null>(null);
  /* the jobs in each supplier's lot sent straight to site, and each drop's day */
  const [sites, setSites] = useState<Set<string>>(new Set());
  const [due, setDue] = useState<Record<string, string>>({});
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
      </header>
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
          sites={sites}
          due={due}
          onSite={(job, on) => setSites((s) => new Set(on ? [...s, job] : [...s].filter((x) => x !== job)))}
          onDue={(k, v) => setDue((x) => ({ ...x, [k]: v }))}
          onTick={(it) => {
            const all = it.covered >= it.need && it.inStock >= it.need;
            send({ do: "instock", key: it.key, total: all ? 0 : null }, all ? `${it.title} back to order` : `${it.title} in stock`, snapOf([it]));
          }}
          onOpen={(it) => setSheet({ kind: "item", key: it.key })}
          onMark={(s) => setSheet({ kind: "mark", supplier: s })}
          onAddSite={(s, name) => setSheet({ kind: "site", supplier: s, name })}
          onTake={(j, i, name) => send({ do: "option", job: j, option: i }, `${name} accepted`)}
        />
      ) : (
        <ByJob d={d} busy={busy} onTake={(j, i, name) => send({ do: "option", job: j, option: i }, `${name} accepted`)} />
      )}

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
        <MarkDialog
          d={d}
          supplier={sheet.supplier}
          sites={sites}
          due={due}
          busy={busy}
          onClose={() => setSheet(null)}
          onSave={(supplier, name, ref, n) => {
            const o = d.orders.find((x) => x.supplierKey === supplier);
            const its = d.items.filter((i) => o?.lines.some((l) => l.key === i.key));
            const jobs = [...new Set((o?.lines ?? []).flatMap((l) => l.jobs.map((j) => j.uuid)))];
            const siteDue: Record<string, string | null> = {};
            for (const j of jobs.filter((x) => sites.has(x))) siteDue[j] = due[`${supplier}|${j}`] || null;
            send({ do: "ordered", supplier, sites: jobs.filter((x) => sites.has(x)), due: { factory: due[`${supplier}|factory`] || null, sites: siteDue }, ref }, `${n} ordered from ${name}`, snapOf(its));
          }}
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

function ShoppingList({
  d,
  busy,
  sites,
  due,
  onSite,
  onDue,
  onTick,
  onOpen,
  onMark,
  onAddSite,
  onTake,
}: {
  d: Ready;
  busy: boolean;
  sites: ReadonlySet<string>;
  due: Record<string, string>;
  onSite: (job: string, on: boolean) => void;
  onDue: (key: string, day: string) => void;
  onTick: (it: Item) => void;
  onOpen: (it: Item) => void;
  onMark: (supplier: string | null) => void;
  onAddSite: (supplier: string, name: string) => void;
  onTake: (job: string, option: number, name: string) => void;
}) {
  const groups: [string, Item[]][] = [
    ["Units", d.items.filter((i) => i.group === "unit")],
    ["Controls and zoning", d.items.filter((i) => i.group === "control")],
    ["Ductwork, suggested", d.items.filter((i) => i.group === "duct")],
  ];
  const choose = d.jobs.filter((j) => j.choose);
  const jobOf = new Map(d.jobs.map((j) => [j.job.uuid, j.job]));
  const days = arrivals(d.today);
  const nothing = !d.items.length && !choose.length && !d.noQuote.length && !d.noUnits.length;
  if (nothing) return <p className="stk-note">{d.jobs.length ? "Nothing’s needed that week: what’s booked needs it at a later visit." : "Nothing’s booked that week."}</p>;
  return (
    <div className="stk-cols">
      <div className="stk-col">
        {groups.map(([name, items]) =>
          items.length ? (
            <section key={name} className="stk-sec">
              <h2>{name}</h2>
              <ul className="stk-card">
                {items.map((it) => {
                  const all = it.inStock >= it.need;
                  const part = !all && it.inStock + it.had > 0;
                  const word = rowWord(it, d.today);
                  return (
                    <li key={it.key} className="stk-row">
                      <TickButton state={all ? "on" : part ? "part" : "off"} label={`${it.title}: ${all ? "in stock" : "mark all in stock"}`} onPress={() => onTick(it)} busy={busy} />
                      <button type="button" className="stk-mid" onClick={() => onOpen(it)} disabled={busy}>
                        <Fade className="stk-t">{it.title}</Fade>
                        <Fade className="stk-s">{it.group === "duct" ? it.detail : `${it.code ?? it.detail}${part && it.open > 0 ? `, ${it.inStock + it.had} in` : ""}, ${forJobs(it, d.today)}`}</Fade>
                      </button>
                      {word ? <StateWord tone={word.tone}>{word.word}</StateWord> : <span className="stk-n">{it.need}</span>}
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null,
        )}
      </div>
      <div className="stk-col stk-col--side">
        {d.orders.length ? (
          <section className="stk-sec">
            <h2>To order</h2>
            {d.orders.map((o) => {
              const jobs = [...new Set(o.lines.flatMap((l) => l.jobs.map((j) => j.uuid)))];
              const sk = o.supplierKey ?? "none";
              return (
                <div key={sk} className="stk-card stk-order">
                  <div className="stk-sup">{o.supplierName}</div>
                  {dropsOf(o, sites).map((drop) => {
                    const job = drop.site ? jobOf.get(drop.site) : null;
                    const dk = `${o.supplierKey}|${drop.site ?? "factory"}`;
                    return (
                      <div key={dk} className="stk-drop">
                        <div className="stk-droph">
                          <span className="stk-t">{job ? `To site, ${job.number ?? "a job"}` : "To the factory"}</span>
                          <Chooser size={32} aria-label="Arrives" options={days} value={due[dk] ?? ""} onChange={(v) => onDue(dk, v)} placeholder="Arrives" />
                        </div>
                        {job?.address ? <div className="stk-s stk-dropa">{job.address}</div> : null}
                        <ul className="stk-lines">
                          {drop.lines.map((l) => (
                            <li key={l.key}>
                              <span className="stk-n stk-n--s">{l.qty}</span>
                              <Fade className="stk-li">
                                {l.code ?? l.title} {drop.site ? null : <span className="stk-q">for {l.jobs.map((j) => j.number ?? "a job").join(", ")}</span>}
                              </Fade>
                            </li>
                          ))}
                        </ul>
                      </div>
                    );
                  })}
                  <ul className="stk-where">
                    {jobs.map((u) => {
                      const job = jobOf.get(u);
                      return (
                        <li key={u}>
                          <span className="stk-s">{job ? `${job.number ?? "A job"}, ${job.suburb ?? "its site"}` : "A job"}</span>
                          <Tray<OrderedTo>
                            ariaLabel={`Where ${job?.number ?? "this job"}'s part goes`}
                            value={sites.has(u) ? "site" : "factory"}
                            onChange={(v) => onSite(u, v === "site")}
                            options={[
                              { value: "factory", label: "Factory" },
                              { value: "site", label: "Site" },
                            ]}
                          />
                        </li>
                      );
                    })}
                  </ul>
                  <div className="stk-foot">
                    {o.orderUrl ? (
                      <Button kind="second" size={32} href={o.orderUrl} target="_blank" rel="noreferrer">
                        Open their site
                      </Button>
                    ) : o.supplierKey ? (
                      <Button kind="second" size={32} onClick={() => onAddSite(o.supplierKey!, o.supplierName)}>
                        Add their site
                      </Button>
                    ) : null}
                    <Button kind="second" size={32} disabled={busy} onClick={() => onMark(o.supplierKey)}>
                      Mark ordered
                    </Button>
                  </div>
                </div>
              );
            })}
          </section>
        ) : null}
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
      </div>
    </div>
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
  return (
    <div className="stk-masonry">
      {d.jobs.map((j) => {
        /* a covered job says how: In stock, or the first that isn't, To site, Thu or In Luke's van */
        const short = j.needs.find((n) => n.group !== "duct" && n.inStock < n.need);
        const state = j.state === "in" && short ? needWordOf(short, d.today) : STATE[j.state];
        const folded = j.state === "in" && !open.has(j.job.uuid);
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
                  {[j.job.kind, j.job.firstAt ? whenOf(j.job.firstAt) : null].filter(Boolean).join(", ")}, {j.job.crew} booked
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
                <div className="stk-jf">
                  <span>{j.from ? FROM[j.from] : ""}</span>
                  <Link className="stk-jl" href={jobPageHref(j.job.uuid)}>
                    Open job
                  </Link>
                </div>
              </>
            )}
          </section>
        );
      })}
      {d.noUnits.length ? (
        <section className="stk-card stk-job">
          <JobsLine what="No units on its quote" jobs={d.noUnits} />
        </section>
      ) : null}
      {d.noQuote.length ? (
        <section className="stk-card stk-job">
          <JobsLine what="No quote in HeyTiff" jobs={d.noQuote} />
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

function MarkDialog({
  d,
  supplier,
  sites,
  due,
  busy,
  onClose,
  onSave,
}: {
  d: Ready;
  supplier: string | null;
  sites: ReadonlySet<string>;
  due: Record<string, string>;
  busy: boolean;
  onClose: () => void;
  onSave: (supplier: string | null, name: string, ref: string | null, n: number) => void;
}) {
  const [ref, setRef] = useState("");
  const o = d.orders.find((x) => x.supplierKey === supplier);
  if (!o) return null;
  const jobOf = new Map(d.jobs.map((j) => [j.job.uuid, j.job]));
  const drops = dropsOf(o, sites);
  const n = o.lines.reduce((s, l) => s + l.qty, 0);
  return (
    <Dialog
      heading={`Mark ordered from ${o.supplierName}`}
      onClose={onClose}
      width={400}
      foot={
        <>
          <Button kind="second" size={36} onClick={onClose}>
            Cancel
          </Button>
          <Button kind="main" size={36} disabled={busy} onClick={() => onSave(supplier, o.supplierName, ref || null, n)}>
            {`Mark ${n} ordered`}
          </Button>
        </>
      }
    >
      <ul className="stk-share">
        {drops.map((drop) => {
          const job = drop.site ? jobOf.get(drop.site) : null;
          const day = due[`${supplier}|${drop.site ?? "factory"}`];
          const count = drop.lines.reduce((s, l) => s + l.qty, 0);
          return (
            <li key={drop.site ?? "factory"} className="stk-share--2">
              <span className="stk-mid stk-mid--static">
                <span className="stk-t">{job ? `To site, ${job.address ?? job.suburb ?? "its address"}` : "To the factory"}</span>
                <span className="stk-s">{`${count} for ${[...new Set(drop.lines.flatMap((l) => l.jobs.map((j) => j.number ?? "a job")))].join(", ")}`}</span>
              </span>
              <StateWord tone="info">{day ? dayWord(day, d.today) : "Not said"}</StateWord>
            </li>
          );
        })}
      </ul>
      <Field label="Their order number">
        <TextInput value={ref} onChange={(e) => setRef(e.currentTarget.value.slice(0, 60))} autoFocus />
      </Field>
    </Dialog>
  );
}

function Later({ d, busy, onBulk, onSite }: { d: Ready; busy: boolean; onBulk: (supplier: string | null) => void; onSite: (supplier: string, name: string) => void }) {
  if (!d.later.length) return <p className="stk-note">Nothing accepted is waiting past the next two weeks.</p>;
  const jobOf = new Map(d.jobs.map((j) => [j.job.uuid, j.job]));
  return (
    <div className="stk-col">
      {d.later.map((s) => {
        const jobs = [...new Set(s.lines.flatMap((l) => l.jobs.map((j) => j.uuid)))].map((u) => jobOf.get(u)!).filter(Boolean);
        return (
          <section key={s.supplierKey ?? "none"} className="stk-card stk-lat">
            <div className="stk-lath">
              <span className="stk-sup">{s.supplierName}</span>
              <span className="stk-s">{`${s.units} ${s.units === 1 ? "unit" : "units"}, ${s.jobs} ${s.jobs === 1 ? "job" : "jobs"}, ${money(s.cents)} at the price book${s.unpriced ? `, ${s.unpriced} not in it` : ""}`}</span>
              <span className="stk-lata">
                {s.orderUrl ? (
                  <Button kind="second" size={32} href={s.orderUrl} target="_blank" rel="noreferrer">
                    Open their site
                  </Button>
                ) : s.supplierKey ? (
                  <Button kind="second" size={32} onClick={() => onSite(s.supplierKey!, s.supplierName)}>
                    Add their site
                  </Button>
                ) : null}
                <Button kind="second" size={32} disabled={busy} onClick={() => onBulk(s.supplierKey)}>
                  Order for these jobs
                </Button>
              </span>
            </div>
            <div className="stk-grid-wrap">
              <table className="stk-grid">
                <thead>
                  <tr>
                    <th scope="col">Model</th>
                    {jobs.map((j) => (
                      <th key={j.uuid} scope="col">
                        <Link className="stk-jl" href={jobPageHref(j.uuid)}>
                          {j.number ?? "A job"}
                        </Link>
                        <span className="stk-s">{j.suburb ?? ""}</span>
                        <span className="stk-s">{laterWhen(d, j.uuid, s.lines)}</span>
                      </th>
                    ))}
                    <th scope="col" className="stk-num-c">
                      All
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {s.lines.map((l) => (
                    <tr key={l.key}>
                      <th scope="row">
                        <span className="stk-t">{l.code ?? l.title}</span>
                        <span className="stk-s">{l.code ? l.title : ""}</span>
                      </th>
                      {jobs.map((j) => (
                        <td key={j.uuid} className="stk-num-c">
                          {l.jobs.find((x) => x.uuid === j.uuid)?.qty ?? ""}
                        </td>
                      ))}
                      <td className="stk-num-c stk-num-c--all">{l.qty}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
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
