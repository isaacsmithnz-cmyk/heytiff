"use client";

import { useEffect, useId, useState, type KeyboardEvent } from "react";
import { fmtAud } from "@/lib/workboard/project-money";
import { againstFirst, isProvisional, missingFromFirst, PROVISIONAL, type LineFields, type QuoteLine } from "@/lib/quotes/lines";
import { offerFor, type BookHit } from "@/lib/quotes/lookups";
import type { Offer } from "@/lib/quotes/price-book";
import type { OptionPrice, QuotePrice } from "@/lib/quotes/quote-price-server";
import { OLD_PIPES, PIPE_SIZES } from "@/lib/quotes/kits";
import { cents2 } from "@/lib/quotes/quote-sum";
import { unitPartOf } from "@/lib/quotes/brands";
import { visitSummary, withHours, withoutTask, withTask, type LineVisit } from "@/lib/quotes/line-visit";
import type { Variation } from "@/lib/quotes/lines-job";
import { Icon } from "@/components/shell/icon";
import { Globe } from "./tiff-panel";
import { CompareCard } from "./compare-card";
import type { LinesView } from "./quote-lines-face";

/* THE LINE ITEMS: the quote by hand, on its kept lines (the engine rebuild,
   slice 2.3, to the mock-ups Isaac shaped on 7 October), the main column's
   second tab since the chat-first page (2026-10-13). Each system a card
   with its total, each group a band with its subtotal, each item one row
   with its code under its name and a dot for where it came from. Qty, cost
   each and sell each are typed in place on every line; the total is always
   qty × sell. A line is added from the business's own book (searched as it
   buys: lookups.ts) or by hand, and taken off with its ×. At the foot, the
   versions kept and every change with who made it, and Undo; the total and
   its parts are the rail's card now (quote-rail.tsx). Every group starts
   shut, its band its name and its total, and opens on a press (Isaac,
   2026-10-15: "have everything collapsed first… collapsed with the total
   next to it").

   Each edit goes to the route with the version the line was read at, so two
   people never overwrite each other (lines-server.ts); the price is read
   again after every change. */

const LOOKUP = "/api/workboard/quote-lookup";

const SOURCE_WORDS: Record<LineFields["source"], string> = {
  said: "Said",
  assumed: "Assumed",
  unknown: "Unknown",
  fitted: "Fitted",
  by_hand: "Set by hand",
};

/** A group's place on the page. Which ones are open is the page's to keep
    (quote-lines-face.tsx), so it outlives the tab; not the option's, so a
    group opened on option 1 is open on option 2, to compare the two. */
export const groupKey = (l: { system: string; group: string }) => JSON.stringify([l.system, l.group]);

/** cents to the box's dollars: a tenth of a cent shows only when there is one */
const dollars = (cents: number) => (Number.isInteger(cents) ? (cents / 100).toFixed(2) : (cents / 100).toFixed(3));
const centsOf = (typed: string): number | null => {
  const t = typed.replace(/[$,\s]/g, "");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 1000) / 10 : NaN;
};
const qtyWords = (l: QuoteLine) => `${l.qty}${l.unit ? ` ${l.unit}` : ""}`;
/** a variation's figures: the difference it makes */
const signed = (c: number) => `${c > 0 ? "+" : c < 0 ? "−" : ""}${fmtAud(Math.abs(c))}`;

/** A box that commits on Enter or leaving it, and says nothing until then. */
function Field({ value, label, onCommit, disabled }: { value: string; label: string; onCommit: (typed: string) => void; disabled: boolean }) {
  const [typed, setTyped] = useState<string | null>(null);
  const shown = typed ?? value;
  const done = () => {
    if (typed !== null && typed !== value) onCommit(typed);
    setTyped(null);
  };
  return (
    <input
      className="ql-f"
      inputMode="decimal"
      value={shown}
      aria-label={label}
      disabled={disabled}
      onChange={(e) => setTyped(e.target.value)}
      onBlur={done}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") setTyped(null);
      }}
    />
  );
}

/** A box of words that commits on Enter or leaving it. `shown`: the label on
    the page, when it's shorter than the one read aloud. */
function TextBox({
  value,
  label,
  shown,
  placeholder,
  onCommit,
  disabled,
  className,
}: {
  value: string;
  label: string;
  shown?: string;
  placeholder?: string;
  onCommit: (typed: string) => void;
  disabled: boolean;
  className: string;
}) {
  const [typed, setTyped] = useState<string | null>(null);
  const done = () => {
    if (typed !== null && typed.trim() !== value) onCommit(typed.trim());
    setTyped(null);
  };
  return (
    <label className={className}>
      <span>{shown ?? label}</span>
      <input
        className="wb2-fi"
        value={typed ?? value}
        aria-label={label}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => setTyped(e.target.value)}
        onBlur={done}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") setTyped(null);
        }}
      />
    </label>
  );
}

/** hours as typed ("5 h", "2.5"); null when they aren't any */
const hoursOf = (typed: string): number | null => {
  const n = Number(typed.replace(/[^\d.]/g, ""));
  return typed.trim() && Number.isFinite(n) && n > 0 ? n : null;
};

/** A task a person adds: its words and its hours, kept when both are there,
    on Enter or on leaving the row; Escape lets it go. */
function AddTask({ busy, onAdd, onDone }: { busy: boolean; onAdd: (task: string, hours: number) => void; onDone: () => void }) {
  const [task, setTask] = useState("");
  const [hours, setHours] = useState("");
  const keep = () => {
    const h = hoursOf(hours);
    if (task.trim() && h != null) onAdd(task.trim(), h);
    onDone();
  };
  const keys = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") keep();
    if (e.key === "Escape") onDone();
  };
  return (
    <li
      className="ql-tnew"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) keep();
      }}
    >
      <i className="ql-d by_hand" aria-hidden="true" />
      <input className="ql-f ql-tname" value={task} aria-label="The task" placeholder="The task" autoFocus disabled={busy} onChange={(e) => setTask(e.target.value)} onKeyDown={keys} />
      <input className="ql-f ql-th" inputMode="decimal" value={hours} aria-label="Its hours" placeholder="Hours" disabled={busy} onChange={(e) => setHours(e.target.value)} onKeyDown={keys} />
      <span />
    </li>
  );
}

/** A labour line's tasks under it (slice 8.2): each with its person-hours,
    typed in place, and the line's hours and days follow; a task a person
    changed says what Tiff had. */
function LabourTasks({ line, visit, busy, onChange }: { line: QuoteLine; visit: LineVisit; busy: boolean; onChange: (v: LineVisit) => void }) {
  const [adding, setAdding] = useState(false);
  return (
    <tr className="ql-tk">
      <td colSpan={6}>
        <ul className="ql-tasks" aria-label={`The tasks in ${line.name}`}>
          {visit.tasks.map((t, i) => (
            <li key={`${i}-${t.task}`}>
              <i className={`ql-d ${t.byHand ? "by_hand" : "assumed"}`} aria-hidden="true" />
              <span className="ql-tn">
                {t.task}
                {t.byHand && <em>{t.was != null ? `Changed, was ${t.was} h` : "Added"}</em>}
              </span>
              <span className="ql-th">
                <Field
                  value={`${t.hours} h`}
                  label={`Hours for ${t.task}`}
                  disabled={busy}
                  onCommit={(typed) => {
                    const h = hoursOf(typed);
                    if (h != null) onChange(withHours(visit, i, h));
                  }}
                />
              </span>
              <button type="button" className="ql-x" aria-label={`Take ${t.task} off`} disabled={busy || visit.tasks.length === 1} onClick={() => onChange(withoutTask(visit, i))}>
                ×
              </button>
            </li>
          ))}
          {adding && <AddTask busy={busy} onAdd={(task, h) => onChange(withTask(visit, task, h))} onDone={() => setAdding(false)} />}
        </ul>
        <div className="ql-tfoot">
          <button type="button" className="ql-tadd" disabled={busy || adding} onClick={() => setAdding(true)}>
            Add a task
          </button>
          <span>{visitSummary(visit)}</span>
        </div>
      </td>
    </tr>
  );
}

/** Each line's sell each, as the price build-up sold it: a part from its
    priced line, labour from its visit, in the order the lines are. */
export function sellEachOf(o: OptionPrice | undefined, lines: QuoteLine[]): Map<string, number> {
  const out = new Map<string, number>();
  if (!o) return out;
  for (const g of o.build.groups) for (const l of g.lines) if (l.qty > 0) out.set(l.key, l.sellCents / l.qty);
  const labour = lines.filter((l) => l.kind === "labour" && !(l.source === "unknown" && l.costCents <= 0 && l.sellCents == null));
  labour.forEach((l, i) => {
    const v = o.build.labour.visits[i];
    if (v && l.qty > 0) out.set(l.id, v.sellCents / l.qty);
  });
  return out;
}

export function QuoteLineItems({
  job,
  view,
  price,
  at,
  onOption,
  options,
  money,
  busy,
  open,
  onGroups,
  act,
  onCompared,
  onOpenVersion,
}: {
  job: string;
  view: LinesView | null;
  price: QuotePrice | null | undefined;
  /** the option open, and opening another */
  at: number;
  onOption: (i: number) => void;
  options: number;
  money: boolean;
  busy: boolean;
  /** the groups open (groupKey), and opening or shutting some */
  open: ReadonlySet<string>;
  onGroups: (keys: string[], open: boolean) => void;
  /** a change to the quote, through the route, the price read again after
      it; what the route said back, the lines as they now stand */
  act: (body: Record<string, unknown>) => Promise<LinesView | null>;
  /** compare changed the line: read the lines and the price again */
  onCompared: () => void;
  /** a version kept at an approval, opened on the paper */
  onOpenVersion: (n: number) => void;
}) {
  const [search, setSearch] = useState("");
  const [hits, setHits] = useState<BookHit[] | null>(null);
  const [system, setSystem] = useState("");
  const [kitOpen, setKitOpen] = useState(false);
  /* the line whose pick list is open (Select preferred item, slice 2.4) */
  const [swapping, setSwapping] = useState<string | null>(null);
  /* the unit line whose compare is open (compare-card.tsx) */
  const [comparing, setComparing] = useState<string | null>(null);
  /* each group's rows carry an id its band's button names */
  const uid = useId();

  const all = view?.lines ?? [];
  const lines = all.filter((l) => l.optionIndex === at);
  const o = price && price.ok ? price.options[at] : undefined;
  const sells = sellEachOf(o, lines);
  const systems = [...new Set(lines.map((l) => l.system))];
  const fitOf = new Map((view?.fits ?? []).map((f) => [f.key, f]));
  const versions = view?.versions ?? [];
  /* a variation: its lines against the accepted option's */
  const variation: Variation | null = (view?.variations ?? []).find((v) => v.option === at) ?? null;
  const base = variation?.of ?? 0;

  const change = (l: QuoteLine, patch: Partial<LineFields>) => void act({ op: "change", id: l.id, version: l.version, patch });

  /* A LINE JUST ADDED OPENS ITS GROUP: the groups start shut, so a line
     added by hand, from the book or with a kit would land out of sight.
     Whatever the change brought that wasn't here before is shown. Tiff's
     lines, and a line that wants looking at, leave the groups as they are:
     To confirm lists those. */
  const adding = async (body: Record<string, unknown>) => {
    const had = new Set(all.map((l) => l.id));
    const v = await act(body);
    const fresh = (v?.lines ?? []).filter((l) => !had.has(l.id));
    if (fresh.length > 0) onGroups(fresh.map(groupKey), true);
  };

  const find = async (q: string) => {
    setSearch(q);
    if (q.trim().length < 2) return setHits(null);
    const r = await fetch(`${LOOKUP}?q=${encodeURIComponent(q)}`).catch(() => null);
    const a = r ? ((await r.json().catch(() => null)) as { ok: boolean; hits?: BookHit[] } | null) : null;
    setHits(a?.ok ? (a.hits ?? []) : []);
  };

  const addFromBook = (h: BookHit) => {
    const offer = offerFor(h.product, view?.supplier ?? null);
    const unit = h.product.category === "units";
    void adding({
      op: "add",
      line: {
        optionIndex: at,
        system,
        group: unit ? "Units" : "Materials",
        name: h.product.name,
        code: offer?.code ?? null,
        supplierKey: offer?.supplierKey ?? null,
        kind: unit ? "unit" : "material",
        qty: 1,
        costCents: offer?.netCents ?? 0,
        source: "by_hand",
      },
    });
    setSearch("");
    setHits(null);
  };

  const addProvisional = () =>
    void adding({
      op: "add",
      line: { optionIndex: at, system, group: PROVISIONAL, name: search.trim() || "Provisional sum", kind: "material", qty: 1, costCents: 0, sellCents: null, source: "unknown", why: "Its price to set" },
    });

  const addByHand = (kind: "material" | "labour") =>
    void adding({
      op: "add",
      line:
        kind === "labour"
          ? { optionIndex: at, system: "", group: "Labour", name: "Install", kind: "labour", qty: 0, unit: "h", costCents: o?.profit?.hourCostCents ?? 0, source: "by_hand" }
          : { optionIndex: at, system, group: "Materials", name: search.trim() || "A line by hand", kind: "material", qty: 1, costCents: 0, source: "by_hand" },
    });

  /* the job's supplier: a line it doesn't sell says where it comes from */
  const buyFrom = view?.supplier ?? null;
  const supplierName = (key: string) => view?.suppliers?.find((s) => s.key === key)?.name ?? key;
  /* a hard job's loading on this option's labour (slice 9.2): the last line
     of its Labour group, in the price, never a line the customer sees */
  const loading = view?.loading?.[at] ?? null;
  const labourAt = lines.find((l) => l.group === "Labour");
  const compared = comparing ? lines.find((l) => l.id === comparing) : undefined;
  const setLoad = (next: { pct: number | null; reason: string }) => void act({ op: "loading", option: at, ...next });
  const loadingRow = loading ? (
    <tr key="loading" className="ql-it ql-load">
      <td>
        <span className="ql-n">
          <i className="ql-d by_hand" aria-hidden="true" />
          <span className="nm">
            Loading on labour<em className="ql-hid">Hidden from the customer</em>
          </span>
          <TextBox
            key={loading.reason}
            label="Why the loading"
            value={loading.reason}
            disabled={busy}
            className="ql-why"
            onCommit={(reason) => setLoad({ pct: loading.pct, reason })}
          />
        </span>
      </td>
      <td className="n">
        <span className="ql-pct">
          <Field value={String(loading.pct)} label="Loading on labour, percent" disabled={busy} onCommit={(t) => setLoad({ pct: Number(t) || null, reason: loading.reason })} />%
        </span>
      </td>
      <td />
      <td />
      <td className="n">{o?.build.loading ? cents2(o.build.loading.sellCents) : "—"}</td>
      <td className="x">
        <button type="button" className="ql-x" aria-label="Take the loading off" disabled={busy} onClick={() => setLoad({ pct: null, reason: "" })}>
          ×
        </button>
      </td>
    </tr>
  ) : null;

  return (
    <>
      {options > 1 && (
        <div className="ql-opts" role="tablist" aria-label="Options">
          {Array.from({ length: options }, (_, i) => {
            const v = (view?.variations ?? []).find((x) => x.option === i);
            const mine = price && price.ok ? price.options[i] : undefined;
            const of = v && price && price.ok ? price.options[v.of] : undefined;
            return (
              <button key={i} type="button" role="tab" aria-selected={i === at} className={i === at ? "ql-opt on" : "ql-opt"} onClick={() => onOption(i)}>
                <span>{v ? `Variation ${v.n}` : view?.optionNames?.[i] ? `${i + 1}. ${view.optionNames[i]}` : `Option ${i + 1}`}</span>
                {money && <b>{mine ? (v && of ? signed(mine.build.exGstCents - of.build.exGstCents) : fmtAud(mine.build.exGstCents)) : "–"}</b>}
              </button>
            );
          })}
        </div>
      )}
      <div className="ql-sumrow">
        {all.length > 0 && !variation && (
          <TextBox
            key={`${at}|${view?.optionNames?.[at] ?? ""}`}
            label={`Option ${at + 1}, as the proposal names it`}
            shown={`Option ${at + 1}`}
            placeholder="Name it for the proposal"
            value={view?.optionNames?.[at] ?? ""}
            disabled={busy}
            className="ql-oname"
            onCommit={(name) => void act({ op: "name", option: at, name })}
          />
        )}
        {(view?.suppliers ?? []).length > 0 && (
          /* the whole job from one supplier where it sells the item
             (Isaac, 2026-10-08) */
          <label className="ql-sup">
            <span>Buy from, for this job</span>
            <select className="wb2-fi" value={view?.supplier ?? ""} disabled={busy} onChange={(e) => void act({ op: "supplier", key: e.target.value })}>
              <option value="">Any supplier</option>
              {(view?.suppliers ?? []).map((s) => (
                <option key={s.key} value={s.key}>{`${s.name}, else the lowest`}</option>
              ))}
            </select>
          </label>
        )}
      </div>

      {/* a line's compare is its group's: shut, the group hides it too */}
      {compared && open.has(groupKey(compared)) && (
        <CompareCard key={compared.id} job={job} lineId={compared.id} onClose={() => setComparing(null)} onChanged={onCompared} />
      )}

      <table className="ql-lt ql-colh">
        <Cols money={money} />
        <thead>
          <tr>
            <th>Item</th>
            <th className="n">Qty</th>
            {money && <th className="n">Cost each</th>}
            {money && <th className="n">Sell each</th>}
            {money && <th className="n">Total</th>}
            <th aria-label="Take off" />
          </tr>
        </thead>
      </table>

      {systems.length === 0 && <p className="qp-none">No lines yet.</p>}
      {systems.map((sys, si) => {
        const mine = lines.filter((l) => l.system === sys);
        const groups = [...new Set(mine.map((l) => l.group))];
        const sysTotal = mine.reduce((n, l) => n + Math.round((sells.get(l.id) ?? 0) * l.qty), 0);
        return (
          <section key={sys || "_"} className="ql-sys" aria-label={sys || "Quote"}>
            <header className="ql-sys-h">
              <h3>{sys || "Quote"}</h3>
              {money && <b>{cents2(sysTotal)}</b>}
            </header>
            <table className="ql-lt">
              <Cols money={money} />
              {groups.map((g, gi) => {
                const rows = mine.filter((l) => l.group === g);
                const sub = rows.reduce((n, l) => n + Math.round((sells.get(l.id) ?? 0) * l.qty), 0);
                const key = groupKey({ system: sys, group: g });
                const shown = open.has(key);
                const body = `${uid}-${si}-${gi}`;
                return [
                  <tbody key={`g-${g}`}>
                    {/* the whole band takes the press; its button is the
                        keyboard's and a screen reader's way in, and its
                        click is the band's. A tech, who sees no money, sees
                        how many lines it holds where the total stands */}
                    <tr className="ql-sg" onClick={() => onGroups([key], !shown)}>
                      <td colSpan={money ? 4 : 1}>
                        <button type="button" className="ql-sgbtn" aria-expanded={shown} aria-controls={body}>
                          <Icon name={shown ? "chevD" : "chevR"} size={16} />
                          {g}
                        </button>
                      </td>
                      <td className="n">{money ? cents2(sub) : `${rows.length} ${rows.length === 1 ? "line" : "lines"}`}</td>
                      <td />
                    </tr>
                  </tbody>,
                  /* shut, its rows and what hangs off them (a labour line's
                     tasks, a pick list, the loading) are not drawn */
                  <tbody key={`r-${g}`} id={body}>
                    {shown && [
                      ...rows.map((l) => {
                        const unknown = l.source === "unknown" && l.costCents <= 0 && l.sellCents == null;
                        const each = sells.get(l.id);
                        return [
                          <tr key={l.id} className="ql-it">
                            <td>
                              <span className="ql-n">
                                <i
                                  className={`ql-d ${fitOf.get(l.id)?.state === "fitted" ? "fitted" : l.source}`}
                                  title={
                                    fitOf.get(l.id)
                                      ? `${fitOf.get(l.id)!.state === "fitted" ? "Fitted" : fitOf.get(l.id)!.state === "misfit" ? "Doesn't fit" : "Not checked"}: ${fitOf.get(l.id)!.why}`
                                      : `${SOURCE_WORDS[l.source]}${l.why ? `: ${l.why}` : ""}`
                                  }
                                />
                                <span className="nm">
                                  {l.kind !== "labour" && money ? (
                                    <button
                                      type="button"
                                      className="ql-nmbtn"
                                      title="Select preferred item"
                                      aria-expanded={swapping === l.id}
                                      onClick={() => setSwapping(swapping === l.id ? null : l.id)}
                                    >
                                      {l.name}
                                    </button>
                                  ) : (
                                    l.name
                                  )}
                                  {view?.researched?.[l.id] && (
                                    <a className="ql-web" href={view.researched[l.id]!.url} target="_blank" rel="noopener noreferrer" title={`From the web: ${view.researched[l.id]!.title}`} aria-label={`From the web: ${view.researched[l.id]!.title}`}>
                                      <Globe />
                                    </a>
                                  )}
                                  {l.estimate && <em className="ql-vs ql-est"> Estimate</em>}
                                  {at !== base && againstFirst(l, all, base) !== "same" && (
                                    <em className="ql-vs">{againstFirst(l, all, base) === "added" ? " Added" : " Changed"}</em>
                                  )}
                                </span>
                                {l.code && (
                                  <span className="cd">
                                    {l.code}
                                    {buyFrom && l.supplierKey && l.supplierKey !== buyFrom && (
                                      <em className="ql-not">{`Not at ${supplierName(buyFrom)}: ${supplierName(l.supplierKey)}`}</em>
                                    )}
                                    {money && l.kind === "unit" && unitPartOf(l.name, l.code) !== "outdoor" && (
                                      <button type="button" className="ql-cmpbtn" aria-expanded={comparing === l.id} onClick={() => setComparing(comparing === l.id ? null : l.id)}>
                                        Compare
                                      </button>
                                    )}
                                  </span>
                                )}
                                {fitOf.get(l.id)?.state === "misfit" && <span className="ql-misfit">{fitOf.get(l.id)!.why}</span>}
                              </span>
                            </td>
                            <td className="n">
                              {l.visit ? (
                                /* its hours are its tasks', changed below */
                                <span className="ql-fq">{qtyWords(l)}</span>
                              ) : (
                                <Field
                                  value={qtyWords(l)}
                                  label={`Quantity of ${l.name}`}
                                  disabled={busy}
                                  onCommit={(t) => {
                                    const n = Number(t.replace(/[^\d.]/g, ""));
                                    if (Number.isFinite(n) && n >= 0) change(l, { qty: n });
                                  }}
                                />
                              )}
                            </td>
                            {money && (
                              <td className="n">
                                <Field
                                  value={dollars(l.costCents)}
                                  label={`What one ${l.name} costs you`}
                                  disabled={busy}
                                  onCommit={(t) => {
                                    const c = centsOf(t);
                                    if (c != null && Number.isFinite(c)) change(l, { costCents: c });
                                  }}
                                />
                              </td>
                            )}
                            {money && (
                              <td className="n">
                                <Field
                                  value={
                                    l.sellCents != null
                                      ? dollars(l.sellCents)
                                      : each == null
                                        ? ""
                                        : /* by the metre a tenth of a cent is real (20.741 × 10 m = 207.41); a counted item is to the cent */
                                          l.unit === "m"
                                          ? dollars(Math.round(each * 10) / 10)
                                          : dollars(Math.round(each))
                                  }
                                  label={`What one ${l.name} sells for`}
                                  disabled={busy}
                                  onCommit={(t) => {
                                    const c = centsOf(t);
                                    /* a provisional sum sells at what it costs: no markup on top */
                                    if (isProvisional(l)) {
                                      if (c != null && Number.isFinite(c)) change(l, { sellCents: c, costCents: c });
                                    } else if (c === null) change(l, { sellCents: null });
                                    else if (Number.isFinite(c)) change(l, { sellCents: c });
                                  }}
                                />
                              </td>
                            )}
                            {money && <td className="n">{unknown ? "—" : cents2(Math.round((each ?? 0) * l.qty))}</td>}
                            <td className="x">
                              <button
                                type="button"
                                className="ql-x"
                                aria-label={`Take ${l.name} off`}
                                disabled={busy}
                                onClick={() => void act({ op: "remove", id: l.id, version: l.version })}
                              >
                                ×
                              </button>
                            </td>
                          </tr>,
                          l.visit ? <LabourTasks key={`${l.id}-tasks`} line={l} visit={l.visit} busy={busy} onChange={(visit) => change(l, { visit })} /> : null,
                          swapping === l.id ? (
                            <tr key={`${l.id}-pick`} className="ql-pickrow">
                              <td colSpan={6}>
                                <PickList
                                  line={l}
                                  busy={busy}
                                  onCancel={() => setSwapping(null)}
                                  onPick={(h, prefer, offer) => {
                                    setSwapping(null);
                                    void act({
                                      op: "change",
                                      id: l.id,
                                      version: l.version,
                                      patch: { name: h.product.name, code: offer.code, supplierKey: offer.supplierKey, costCents: offer.netCents, sellCents: null },
                                      why: "Select preferred item",
                                    }).then(() => {
                                      if (prefer)
                                        void fetch("/api/quoting/preferred", {
                                          method: "POST",
                                          headers: { "Content-Type": "application/json" },
                                          body: JSON.stringify({ ref: `${offer.supplierKey}|${offer.code}`, on: true, was: l.name }),
                                        }).catch(() => undefined);
                                    });
                                  }}
                                />
                              </td>
                            </tr>
                          ) : null,
                        ];
                      }),
                      money && g === "Labour" && labourAt && sys === labourAt.system ? loadingRow : null,
                    ]}
                  </tbody>,
                ];
              })}
            </table>
          </section>
        );
      })}

      {at !== base && missingFromFirst(at, all, base).length > 0 && (
        <p className="qp-none">{`Not in this option: ${missingFromFirst(at, all, base)
          .map((l) => l.name)
          .join(", ")}`}</p>
      )}

      <section className="ql-add" aria-label="Add a line">
        <div className="ql-addrow">
          {/* the book carries prices: its search is for those who see money */}
          {money && (
            <input
              className="wb2-fi"
              value={search}
              placeholder="Add a line from your book"
              aria-label="Search your book for a line to add"
              onChange={(e) => void find(e.target.value)}
            />
          )}
          <select className="wb2-fi ql-sysin" value={system} onChange={(e) => setSystem(e.target.value)} aria-label="The system it goes in">
            <option value="">No system</option>
            {systems.filter(Boolean).map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        {hits && (
          <ul className="ql-hits">
            {hits.length === 0 && <li className="none">Nothing in your book like that.</li>}
            {hits.map((h) => (
              <li key={h.product.key}>
                <button type="button" disabled={busy} onClick={() => addFromBook(h)}>
                  <span>
                    {h.product.name}
                    <small>{`${offerFor(h.product, view?.supplier ?? null)?.code ?? ""}, ${h.why.toLowerCase()}`}</small>
                  </span>
                  <b>{offerFor(h.product, view?.supplier ?? null) ? fmtAud(offerFor(h.product, view?.supplier ?? null)!.netCents) : "–"}</b>
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="wb2-jqacts">
          <button type="button" className="pbtn ghost sm" disabled={busy} onClick={() => addByHand("material")}>
            Add a line by hand
          </button>
          <button type="button" className="pbtn ghost sm" disabled={busy} onClick={() => addByHand("labour")}>
            Add labour
          </button>
          {money && (
            <button type="button" className="pbtn ghost sm" disabled={busy} onClick={addProvisional}>
              Add a provisional sum
            </button>
          )}
          {money && labourAt && !loading && (
            /* 10%: the low end of Isaac's own "10 to 15%"; not applied until
               it says why, typed on its row: Labour opens to show it */
            <button
              type="button"
              className="pbtn ghost sm"
              disabled={busy}
              onClick={() => {
                onGroups([groupKey(labourAt)], true);
                setLoad({ pct: 10, reason: "" });
              }}
            >
              Add a loading
            </button>
          )}
          <button type="button" className="pbtn ghost sm" disabled={busy} onClick={() => setKitOpen((v) => !v)} aria-expanded={kitOpen}>
            Add a kit
          </button>
          <button type="button" className="pbtn ghost sm" disabled={busy} onClick={() => onOption(options)}>
            Add an option
          </button>
          {all.some((l) => l.optionIndex === 0) && (
            <button
              type="button"
              className="pbtn ghost sm"
              disabled={busy}
              onClick={() => {
                const to = options;
                void act({ op: "copy", from: 0, to }).then(() => onOption(to));
              }}
            >
              Copy option 1 to a new option
            </button>
          )}
        </div>
        {kitOpen && (
          <KitForm
            busy={busy}
            system={system}
            packs={view?.packs ?? []}
            onAdd={(k) => {
              setKitOpen(false);
              void adding({ op: "kit", optionIndex: at, ...k });
            }}
          />
        )}
      </section>

      {/* the quote's history, under its lines: it was the rail's, beside Tiff */}
      <div className="ql-hist">
        {versions.length > 0 && (
          <section>
            <h2 className="hd-ls-grp">Versions</h2>
            <ul className="ql-chg" aria-label="Versions">
              {versions.map((v) => (
                <li key={v.n}>
                  <span>
                    <b>{`Version ${v.n}`}</b>
                    <small>{v.options.map((x) => `${x.name}: ${fmtAud(x.incGstCents)} inc GST`).join(", ")}</small>
                  </span>
                  <button type="button" className="ql-undo" onClick={() => onOpenVersion(v.n)}>
                    Open
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
        <section>
          <h2 className="hd-ls-grp">Changes</h2>
          {(view?.changes ?? []).length === 0 && <p className="qp-none">Nothing changed yet.</p>}
          <ul className="ql-chg">
            {(view?.changes ?? []).slice(0, 30).map((c) => {
              const who = c.madeBy === view?.me ? "You" : c.madeBy === "tiff" ? "Tiff" : (view?.names[c.madeBy] ?? "Someone");
              const name = (c.after?.name ?? c.before?.name ?? "a line") as string;
              const what =
                c.action === "add"
                  ? `added ${name}`
                  : c.action === "remove"
                    ? `took off ${name}`
                    : `changed ${Object.keys(c.after ?? {})
                        .filter((k) => k !== "source")
                        .map((k) => (k === "qty" ? "qty" : k === "costCents" ? "cost" : k === "sellCents" ? "sell" : k))
                        .join(", ")}`;
              return (
                <li key={c.id}>
                  <span>
                    <b>{who}</b> {what}
                    {c.why ? <small>{c.why}</small> : null}
                  </span>
                  <button type="button" className="ql-undo" disabled={busy} onClick={() => void act({ op: "undo", change: c.id })}>
                    Undo
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </>
  );
}

/** SELECT PREFERRED ITEM (slice 2.4): every item of the line's kind and size
    in the business's book, as it buys them, at its cost and as it would
    land on this quote. The one chosen goes on the line at once and, unless
    unticked, is the business's preferred from the next quote. */
function PickList({
  line,
  busy,
  onPick,
  onCancel,
}: {
  line: QuoteLine;
  busy: boolean;
  onPick: (h: BookHit, prefer: boolean, offer: Offer) => void;
  onCancel: () => void;
}) {
  const size = /(\d{3})\s*(?:mm|MM)?\b/.exec(line.name)?.[1] ?? null;
  const words = line.name
    .replace(/[^A-Za-z ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .slice(0, 2)
    .join(" ");
  const [q, setQ] = useState(words);
  const [hits, setHits] = useState<BookHit[] | null>(null);
  const [prefer, setPrefer] = useState(true);
  useEffect(() => {
    let live = true;
    const t = setTimeout(() => {
      fetch(`${LOOKUP}?q=${encodeURIComponent(q)}${size ? `&size=${size}` : ""}`)
        .then((r) => r.json() as Promise<{ ok: boolean; hits?: BookHit[] }>)
        .then((a) => live && setHits(a.ok ? (a.hits ?? []) : []))
        .catch(() => live && setHits([]));
    }, 200);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q, size]);
  return (
    <div className="ql-pop">
      <div className="ql-addrow">
        <input className="wb2-fi" value={q} onChange={(e) => setQ(e.target.value)} aria-label={`Search your book for another ${line.name}`} />
        <label className="ql-prefer">
          <input type="checkbox" checked={prefer} onChange={(e) => setPrefer(e.target.checked)} />
          Your preferred from the next quote
        </label>
      </div>
      <ul className="ql-hits">
        {hits && hits.length === 0 && <li className="none">Nothing in your book like that.</li>}
        {(hits ?? []).flatMap((h) => {
          const offer = h.product.preferred ?? h.product.cheapest;
          const isOn = (o: Offer | null) => !!o && o.code === line.code && (line.supplierKey == null || o.supplierKey === line.supplierKey);
          /* the same item at the business's other suppliers, lowest first:
             its own pick over the one HeyTiff would take (slice 3.2) */
          const others = h.product.offers.filter((o) => o.netCents > 0 && !(o.supplierKey === offer?.supplierKey && o.code === offer?.code));
          return [
            <li key={h.product.key}>
              <button type="button" disabled={busy || isOn(offer) || !offer} onClick={() => offer && onPick(h, prefer, offer)}>
                <span>
                  {h.product.name}
                  <small>{`${offer ? `${offer.supplierName}, ${offer.code}` : ""}, ${isOn(offer) ? "on this quote now" : h.why.toLowerCase()}`}</small>
                </span>
                <b>{offer ? `${fmtAud(offer.netCents)} each` : "–"}</b>
              </button>
            </li>,
            ...others.map((o) => (
              <li key={`${h.product.key}|${o.supplierKey}|${o.code}`} className="ql-alt">
                <button type="button" disabled={busy || isOn(o)} onClick={() => onPick(h, prefer, o)}>
                  <span>
                    {`From ${o.supplierName}`}
                    <small>{`${o.code}${isOn(o) ? ", on this quote now" : ""}`}</small>
                  </span>
                  <b>{`${fmtAud(o.netCents)} each`}</b>
                </button>
              </li>
            )),
          ];
        })}
      </ul>
      <div className="wb2-jqacts">
        <button type="button" className="pbtn ghost sm" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

type KitAsk = { kit: "split" | "ducted"; system: string; brand: string; model: string; facts: Record<string, unknown> };

/** What a kit needs to know: the unit (its pipe and current read off its
    data pack when blank), the runs, and the outlets for a ducted one, and
    its zones. A run left blank leaves its part on the quote as not known
    yet. Its data pack starts on none: every installed pack is offered, and
    none is any business's default (2026-10-15: it started everyone on
    Mitsubishi Electric). */
function KitForm({ busy, system, packs, onAdd }: { busy: boolean; system: string; packs: { key: string; name: string }[]; onAdd: (k: KitAsk) => void }) {
  const [kit, setKit] = useState<"split" | "ducted">("split");
  const [sys, setSys] = useState(system || "");
  const [brand, setBrand] = useState("");
  const [model, setModel] = useState("");
  const [f, setF] = useState<Record<string, string>>({
    pipe: "",
    pipeM: "",
    powerM: "",
    amps: "",
    mount: "ground",
    trunkingM: "",
    drainM: "",
    outlets: "",
    outletMm: "",
    replacing: "",
    keptPipe: "",
    underfloor: "",
    zones: "",
    zoneControl: "temperature",
    wifi: "",
  });
  /* zoned, as Tiff's add_kit gives them (tools.ts kitAskOf, 2026-10-13):
     the zones a whole number, the control by its word, WiFi yes or no; a
     split has none */
  const factsOf = (): Record<string, unknown> => {
    const { zones, zoneControl, wifi, ...runs } = f;
    if (kit !== "ducted") return runs;
    const n = Number(zones);
    return { ...runs, ...(zones.trim() && Number.isFinite(n) && n >= 1 ? { zones: Math.round(n) } : {}), zoneControl, wifi: wifi === "yes" };
  };
  const set = (k: string) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const num = (k: string, label: string, unit: string, mode: "decimal" | "numeric" = "decimal") => (
    <label className="ql-kf">
      <span>{label}</span>
      <span className="ql-kin">
        <input className="wb2-fi" inputMode={mode} value={f[k]} onChange={set(k)} aria-label={label} />
        <em>{unit}</em>
      </span>
    </label>
  );
  return (
    <div className="ql-kit">
      <div className="ql-kgrid">
        <label className="ql-kf">
          <span>Kit</span>
          <select className="wb2-fi" value={kit} onChange={(e) => setKit(e.target.value === "ducted" ? "ducted" : "split")} aria-label="Kit">
            <option value="split">Split install</option>
            <option value="ducted">Ducted install</option>
          </select>
        </label>
        <label className="ql-kf">
          <span>System</span>
          <input className="wb2-fi" value={sys} onChange={(e) => setSys(e.target.value)} aria-label="The system it's for" />
        </label>
        <label className="ql-kf">
          <span>Outdoor model</span>
          <input className="wb2-fi" value={model} onChange={(e) => setModel(e.target.value)} aria-label="Outdoor model" />
        </label>
        <label className="ql-kf">
          <span>Its data pack</span>
          <select className="wb2-fi" value={brand} onChange={(e) => setBrand(e.target.value)} aria-label="The outdoor's data pack">
            <option value="">None</option>
            {packs.map((p) => (
              <option key={p.key} value={p.key}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="ql-kf">
          <span>Pipe</span>
          <select className="wb2-fi" value={f.pipe} onChange={set("pipe")} aria-label="Pipe size">
            <option value="">From the unit</option>
            {PIPE_SIZES.map((p) => (
              <option key={p} value={p}>
                {p.replace("+", " + ")}
              </option>
            ))}
          </select>
        </label>
        {num("amps", "It draws", "A")}
        {num("pipeM", "Pipe run", "m")}
        {num("powerM", "Power run", "m")}
        {num("drainM", "Drain", "m")}
        {num("trunkingM", "Trunking outside", "m")}
        <label className="ql-kf">
          <span>Outdoor on</span>
          <select className="wb2-fi" value={f.mount} onChange={set("mount")} aria-label="What the outdoor sits on">
            <option value="ground">Feet on the ground</option>
            <option value="wall">A wall bracket</option>
          </select>
        </label>
        <label className="ql-kf">
          <span>An old system</span>
          <select className="wb2-fi" value={f.replacing} onChange={set("replacing")} aria-label="An old system comes out">
            <option value="">None to take out</option>
            <option value="yes">Comes out</option>
            <option value="keep">Comes out, its pipe kept</option>
          </select>
        </label>
        {f.replacing === "keep" && (
          <label className="ql-kf">
            <span>Old pipe</span>
            <select className="wb2-fi" value={f.keptPipe} onChange={set("keptPipe")} aria-label="The old pipe's size">
              <option value="">Its size</option>
              {OLD_PIPES.map((p) => (
                <option key={p} value={p}>
                  {p.replace("+", " + ")}
                </option>
              ))}
            </select>
          </label>
        )}
        {kit === "ducted" && (
          <label className="ql-kf">
            <span>Indoor goes</span>
            <select className="wb2-fi" value={f.underfloor} onChange={set("underfloor")} aria-label="Where the indoor goes">
              <option value="">In the roof</option>
              <option value="yes">Under the floor</option>
            </select>
          </label>
        )}
        {kit === "ducted" && num("outlets", "Outlets", "")}
        {kit === "ducted" && num("outletMm", "Outlet size", "mm")}
        {kit === "ducted" && num("zones", "Zones", "", "numeric")}
        {kit === "ducted" && (
          <label className="ql-kf">
            <span>Zone control</span>
            <select className="wb2-fi" value={f.zoneControl} onChange={set("zoneControl")} aria-label="Zone control">
              <option value="temperature">By temperature</option>
              <option value="on_off">On and off</option>
            </select>
          </label>
        )}
        {kit === "ducted" && (
          <label className="ql-kf">
            <span>WiFi</span>
            <select className="wb2-fi" value={f.wifi} onChange={set("wifi")} aria-label="WiFi">
              <option value="">No</option>
              <option value="yes">Yes</option>
            </select>
          </label>
        )}
      </div>
      <div className="wb2-jqacts">
        <button type="button" className="pbtn ghost sm qp-go" disabled={busy} onClick={() => onAdd({ kit, system: sys.trim(), brand, model: model.trim(), facts: factsOf() })}>
          Add the kit
        </button>
      </div>
    </div>
  );
}

/** The line table's columns; without money access, the work alone. */
function Cols({ money = true }: { money?: boolean }) {
  return (
    <colgroup>
      <col />
      <col className="cq" />
      {money && <col className="cc" />}
      {money && <col className="ce" />}
      {money && <col className="ct" />}
      <col className="cx" />
    </colgroup>
  );
}
