"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/parts/button";
import { Dialog } from "@/components/parts/dialog";
import { Field, TextInput } from "@/components/parts/field";
import { Fade } from "@/components/parts/fade";
import { StateWord, type Tone } from "@/components/parts/state";
import { Tray, ViewTabs } from "@/components/parts/tabs";
import { useToast } from "@/components/parts/toast";
import { jobPageHref } from "@/lib/shell/links";
import { allocate, orderText, type Item, type JobState, type StockJob, type Week } from "@/lib/stock/stock";
import type { StockJobView, StockView } from "@/lib/stock/stock-server";
import { stockInStock, stockOrdered, stockPutBack, stockTakeOption } from "@/app/actions/stock";

/* STOCK (the mock https://claude.ai/artifact/WQ1yppLgALMhXbHM5XWLDq; Isaac,
   11 November 2026: "it should show you the whole shopping list ... someone
   can go through the factory and tick things off ... allocated to whoever's
   booked in first ... This whole process needs to be rapid"). Two views:
   the Shopping list, every item added up, with To order by supplier beside
   it; and By job, where a job with everything in folds to its card. The
   tick is In stock, one press for all of them; the item's name opens a
   count. The groups are white cards lifted off the page, the app's look on
   the desktop ("the app versions of everything look so much nicer"). */

type Ready = Extract<StockView, { ready: true }>;
type View = "list" | "jobs";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
/** "2026-11-16 07:30:00" is Monday 7:30 am. */
export function whenOf(at: string): string {
  const d = new Date(`${at.slice(0, 10)}T12:00:00Z`);
  const [h, m] = at.slice(11, 16).split(":").map(Number) as [number, number];
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${DAYS[d.getUTCDay()]} ${hh}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}
const dayOf = (at: string) => whenOf(at).split(" ")[0]!;
const shortDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-AU", { day: "numeric", month: "short", timeZone: "Australia/Sydney" }) : "");

const STATE: Record<JobState, { tone: Tone; word: string } | null> = {
  in: { tone: "good", word: "In stock" },
  ordered: { tone: "info", word: "Ordered" },
  order: { tone: "look", word: "To order" },
  check: { tone: "look", word: "Check" },
  none: null,
};

/** "for 3472 and 3000 Monday", "for 3000 Monday and 3479 Tuesday" */
function forJobs(it: Item): string {
  const days: [string, string[]][] = [];
  for (const j of it.jobs) {
    const d = dayOf(j.firstAt);
    const last = days[days.length - 1];
    if (last && last[0] === d) last[1].push(j.number ?? "a job");
    else days.push([d, [j.number ?? "a job"]]);
  }
  const words = days.map(([d, ns]) => `${ns.length > 1 ? `${ns.slice(0, -1).join(", ")} and ${ns[ns.length - 1]}` : ns[0]} ${d}`);
  return `for ${words.length > 1 ? `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}` : words[0]}`;
}

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

function JobNumber({ job }: { job: StockJob }) {
  return <span className={`stk-num sc-card--${job.hue}`}>{job.number ?? "Job"}</span>;
}

export function StockPage({ initial }: { initial: StockView }) {
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const [view, setView] = useState<StockView>(initial);
  const [busy, start] = useTransition();
  const [counting, setCounting] = useState<Item | null>(null);
  const week: Week = params.get("week") === "after" ? "after" : "next";
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

  const run = (press: () => Promise<{ ok: true; view: StockView } | { ok: false; reason: string }>, text: string, undo?: () => void) =>
    start(async () => {
      const r = await press().catch(() => ({ ok: false as const, reason: "Couldn't save that. Try again." }));
      if (!r.ok) {
        toast({ text: r.reason });
        return;
      }
      setView(r.view);
      toast({ text, undo });
    });

  const setCount = (it: Item, total: number | null, text: string) => {
    const before = it.inStock;
    run(() => stockInStock(week, it.key, total), text, () => run(() => stockInStock(week, it.key, before), "Put back"));
  };

  const ordered = (supplierKey: string | null, name: string, d: Ready) => {
    const o = d.orders.find((x) => x.supplierKey === supplierKey);
    const back = (o?.lines ?? []).flatMap((l) => {
      const it = d.items.find((i) => i.key === l.key);
      return l.jobs.map((j) => {
        const had = it?.jobs.find((x) => x.uuid === j.uuid);
        return { uuid: j.uuid, key: l.key, inStock: had?.inStock ?? 0, ordered: had?.ordered ?? 0 };
      });
    });
    run(() => stockOrdered(week, supplierKey), `Ordered from ${name}`, () => run(() => stockPutBack(week, back), "Put back"));
  };

  const copy = (text: string) => {
    void navigator.clipboard
      .writeText(text)
      .then(() => toast({ text: "Order copied" }))
      .catch(() => toast({ text: "Couldn't copy it here" }));
  };

  return (
    <div className="stk">
      <header className="stk-head">
        <h1>Stock</h1>
        <Tray
          ariaLabel="Which week"
          value={week}
          onChange={(w) => go({ week: w })}
          options={[
            { value: "next", label: "Next week" },
            { value: "after", label: "Week after" },
          ]}
        />
      </header>
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
      {!view.ready ? (
        <p className="stk-note">Stock goes live once its table is on the database.</p>
      ) : view.week !== week ? (
        <p className="stk-note">Reading the week</p>
      ) : tab === "list" ? (
        <ShoppingList d={view} busy={busy} onTick={(it) => setCount(it, it.inStock >= it.need ? 0 : null, it.inStock >= it.need ? `${it.title} back to order` : `${it.title} in stock`)} onCount={setCounting} onOrdered={(k, n) => ordered(k, n, view)} onCopy={copy} onTake={(j, i, name) => run(() => stockTakeOption(week, j, i), `${name} accepted`)} />
      ) : (
        <ByJob d={view} busy={busy} onTake={(j, i, name) => run(() => stockTakeOption(week, j, i), `${name} accepted`)} />
      )}
      {counting && view.ready ? (
        <CountDialog
          item={counting}
          onClose={() => setCounting(null)}
          onSave={(n) => {
            setCounting(null);
            setCount(counting, n, `${n} in stock`);
          }}
        />
      ) : null}
    </div>
  );
}

function ShoppingList({
  d,
  busy,
  onTick,
  onCount,
  onOrdered,
  onCopy,
  onTake,
}: {
  d: Ready;
  busy: boolean;
  onTick: (it: Item) => void;
  onCount: (it: Item) => void;
  onOrdered: (supplierKey: string | null, name: string) => void;
  onCopy: (text: string) => void;
  onTake: (job: string, option: number, name: string) => void;
}) {
  const groups: [string, Item[]][] = [
    ["Units", d.items.filter((i) => i.group === "unit")],
    ["Controls and zoning", d.items.filter((i) => i.group === "control")],
    ["Ductwork, suggested", d.items.filter((i) => i.group === "duct")],
  ];
  const choose = d.jobs.filter((j) => j.choose);
  const nothing = !d.items.length && !choose.length && !d.noQuote.length && !d.noUnits.length;
  if (nothing) return <p className="stk-note">Nothing’s booked that week.</p>;
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
                  const part = !all && it.inStock > 0;
                  const left = it.need - it.inStock - it.ordered;
                  return (
                    <li key={it.key} className="stk-row">
                      <TickButton state={all ? "on" : part ? "part" : "off"} label={`${it.title}: ${all ? "in stock" : "mark all in stock"}`} onPress={() => onTick(it)} busy={busy} />
                      <button type="button" className="stk-mid" onClick={() => onCount(it)} disabled={busy}>
                        <Fade className="stk-t">{it.title}</Fade>
                        <Fade className="stk-s">
                          {it.group === "duct" ? it.detail : `${it.code ?? it.detail}${part ? `, ${it.inStock} in` : ""}, ${forJobs(it)}`}
                        </Fade>
                      </button>
                      {all ? (
                        <StateWord tone="good">In stock</StateWord>
                      ) : left <= 0 ? (
                        <StateWord tone="info">Ordered</StateWord>
                      ) : part || it.ordered > 0 ? (
                        <StateWord tone="look">{`${left} to order`}</StateWord>
                      ) : (
                        <span className="stk-n">{it.need}</span>
                      )}
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
            {d.orders.map((o) => (
              <div key={o.supplierKey ?? "none"} className="stk-card stk-order">
                <div className="stk-sup">{o.supplierName}</div>
                <ul className="stk-lines">
                  {o.lines.map((l) => (
                    <li key={l.key}>
                      <span className="stk-n stk-n--s">{l.qty}</span>
                      <Fade className="stk-li">
                        {l.code ?? l.title} <span className="stk-q">for {l.jobs.map((j) => j.number ?? "a job").join(", ")}</span>
                      </Fade>
                    </li>
                  ))}
                </ul>
                <div className="stk-foot">
                  <Button kind="second" size={32} onClick={() => onCopy(orderText(o))}>
                    Copy the order
                  </Button>
                  <Button kind="second" size={32} disabled={busy} onClick={() => onOrdered(o.supplierKey, o.supplierName)}>
                    Mark ordered
                  </Button>
                </div>
              </div>
            ))}
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
        {j.job.number} {j.job.client ?? ""}, {dayOf(j.job.firstAt)}
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

function ByJob({ d, busy, onTake }: { d: Ready; busy: boolean; onTake: (job: string, option: number, name: string) => void }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  if (!d.jobs.length && !d.noQuote.length) return <p className="stk-note">Nothing’s booked that week.</p>;
  return (
    <div className="stk-masonry">
      {d.jobs.map((j) => {
        const state = STATE[j.state];
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
                  {[j.job.kind, whenOf(j.job.firstAt)].filter(Boolean).join(", ")}, {j.job.crew} booked
                </span>
              </span>
              {state ? <StateWord tone={state.tone}>{state.word}</StateWord> : null}
            </button>
            {folded ? null : j.choose ? (
              <Choose j={j} busy={busy} onTake={onTake} />
            ) : (
              <>
                <ul>
                  {j.needs.map((n) => {
                    const inAll = n.inStock >= n.need;
                    const left = n.need - n.inStock - Math.min(n.ordered, n.need - n.inStock);
                    const sub = inAll
                      ? `In stock${n.inStockName ? `, ${n.inStockName}` : ""}${n.inStockAt ? `, ${shortDate(n.inStockAt)}` : ""}`
                      : n.ordered > 0
                        ? `${n.inStock ? `${n.inStock} of ${n.need} in, ` : ""}ordered${n.orderedName ? ` by ${n.orderedName}` : ""}${n.orderedAt ? `, ${shortDate(n.orderedAt)}` : ""}`
                        : n.inStock
                          ? `${n.inStock} of ${n.need} in`
                          : n.detail;
                    return (
                      <li key={n.key} className="stk-row stk-row--plain">
                        <span className="stk-n stk-n--s">{n.group === "duct" ? "" : n.need}</span>
                        <span className="stk-mid stk-mid--static">
                          <Fade className="stk-t">{n.title}</Fade>
                          <Fade className="stk-s">{sub}</Fade>
                        </span>
                        {inAll ? <StateWord tone="good">In stock</StateWord> : left <= 0 ? <StateWord tone="info">Ordered</StateWord> : n.group === "duct" ? null : <StateWord tone="look">To order</StateWord>}
                      </li>
                    );
                  })}
                </ul>
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

function CountDialog({ item, onClose, onSave }: { item: Item; onClose: () => void; onSave: (n: number) => void }) {
  const [raw, setRaw] = useState(String(item.inStock || item.need));
  const n = Math.max(0, Math.min(10_000, Math.round(Number(raw)) || 0));
  const share = allocate(n, item.jobs.map((j) => j.need));
  return (
    <Dialog
      heading={item.title}
      onClose={onClose}
      width={400}
      foot={
        <>
          <Button kind="second" size={36} onClick={onClose}>
            Cancel
          </Button>
          <Button kind="main" size={36} onClick={() => onSave(n)}>
            {`Mark ${n} in stock`}
          </Button>
        </>
      }
    >
      <p className="stk-dsub">
        {item.code ?? item.detail}, {item.need} needed
      </p>
      <Field label="How many have we got?">
        <TextInput inputMode="numeric" value={raw} onChange={(e) => setRaw(e.currentTarget.value.replace(/[^0-9]/g, ""))} autoFocus />
      </Field>
      <ul className="stk-share">
        {item.jobs.map((j, i) => (
          <li key={j.uuid}>
            <span className="stk-t">{j.number ?? "A job"}</span>
            <span className="stk-s">{whenOf(j.firstAt)}</span>
            <StateWord tone={share[i]! >= j.need ? "good" : "look"}>{`${share[i]} of ${j.need}`}</StateWord>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
