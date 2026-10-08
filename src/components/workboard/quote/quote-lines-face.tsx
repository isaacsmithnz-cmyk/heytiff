"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { fmtAud } from "@/lib/workboard/project-money";
import type { LineChange } from "@/lib/quotes/lines-server";
import { againstFirst, isProvisional, missingFromFirst, PROVISIONAL, type LineFields, type QuoteLine } from "@/lib/quotes/lines";
import { offerFor, type BookHit } from "@/lib/quotes/lookups";
import type { Offer } from "@/lib/quotes/price-book";
import type { Fit } from "@/lib/quotes/fit";
import type { OptionPrice, QuotePrice } from "@/lib/quotes/quote-price-server";
import { linesSteps } from "@/lib/quotes/quote-steps";
import { unsetWords } from "@/lib/quotes/build-settings";
import { OLD_PIPES, PIPE_SIZES } from "@/lib/quotes/kits";
import { QuoteStepsLine, leftOn, priceState } from "./quote-parts";
import { TiffPanel } from "./tiff-panel";
import { CompareCard } from "./compare-card";
import { LinesProposalPaper } from "./lines-proposal-paper";
import type { LinesProposal } from "@/lib/quotes/lines-proposal";
import type { PaymentPreset, PaymentStage } from "@/lib/quotes/payment";
import type { QuoteNote } from "@/lib/templates/settings";
import { unitPartOf } from "@/lib/quotes/brands";

/* THE QUOTE BY HAND, ON ITS KEPT LINES (the engine rebuild, slice 2.3, to
   the mock-ups Isaac shaped on 7 October): the total in its own card, pinned
   with the column heads while the lines scroll; each system a card with its
   total, each group a band with its subtotal, each item one row with its
   code under its name and a dot for where it came from. Qty, cost each and
   sell each are typed in place on every line; the total is always qty ×
   sell. A line is added from the business's own book (searched as it buys:
   lookups.ts) or by hand, and taken off with its ×. On the right, every
   change with who made it, and Undo.

   Each edit goes to the route with the version the line was read at, so two
   people never overwrite each other (lines-server.ts); the price is read
   again after every change. */

const ROUTE = "/api/workboard/quote-lines";
const LOOKUP = "/api/workboard/quote-lookup";

type View = {
  ok: boolean;
  reason?: string;
  stale?: boolean;
  engine: "old" | "lines";
  lines: QuoteLine[];
  changes: LineChange[];
  names: Record<string, string>;
  me: string;
  /** each checked part against its system's outdoor unit (fit.ts) */
  fits?: Fit[];
  /** the option the client took, marked by a person (lines-job.ts) */
  accepted?: number[];
  /** each option's name, and its loading on labour (lines-job.ts) */
  optionNames?: string[];
  loading?: Record<number, { pct: number; reason: string }>;
  /** the proposal's words, whether an approval of them stands, and the
      business's notes and payment terms (7.1) */
  proposal?: LinesProposal | null;
  approved?: boolean;
  noteLibrary?: QuoteNote[];
  paymentTerms?: Record<PaymentPreset, { label: string; stages: PaymentStage[] }> | null;
  /** the supplier the whole job buys from, and the business's suppliers */
  supplier?: string | null;
  suppliers?: { key: string; name: string }[];
  /** what marking it did to the job's own materials list */
  onJob?: { added: number; removed: number } | null;
  /** each option's labour by the business's own task hours (task-hours.ts) */
  tasks?: ({ hours: number; words: string; quoted: number } | null)[];
};

/** The quote's kept lines, read once and after every change. */
export function useQuoteLines(job: string, enabled: boolean) {
  const [view, setView] = useState<View | null>(null);
  /* read again on asking: Tiff changed the lines */
  const [rev, setRev] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    fetch(`${ROUTE}?job=${encodeURIComponent(job)}`)
      .then((r) => r.json() as Promise<View>)
      .then((v) => live && setView(v.ok ? v : null))
      .catch(() => live && setView(null));
    return () => {
      live = false;
    };
  }, [job, enabled, rev]);
  const post = async (body: Record<string, unknown>): Promise<View | null> => {
    const r = await fetch(ROUTE, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ job, ...body }) }).catch(() => null);
    const v = r ? ((await r.json().catch(() => null)) as View | null) : null;
    if (v && Array.isArray(v.lines)) setView(v);
    return v;
  };
  return { view, post, reload: () => setRev((n) => n + 1) };
}

const SOURCE_WORDS: Record<LineFields["source"], string> = {
  said: "Said",
  assumed: "Assumed",
  unknown: "Unknown",
  fitted: "Fitted",
  by_hand: "Set by hand",
};

/** cents to the box's dollars: a tenth of a cent shows only when there is one */
const dollars = (cents: number) => (Number.isInteger(cents) ? (cents / 100).toFixed(2) : (cents / 100).toFixed(3));
const centsOf = (typed: string): number | null => {
  const t = typed.replace(/[$,\s]/g, "");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 1000) / 10 : NaN;
};
/** every figure in the lines to the cent, so the column reads as one */
const cents2 = (c: number) => `$${(c / 100).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const qtyWords = (l: QuoteLine) => `${l.qty}${l.unit ? ` ${l.unit}` : ""}`;

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

/** A box of words that commits on Enter or leaving it. */
function TextBox({ value, label, onCommit, disabled, className }: { value: string; label: string; onCommit: (typed: string) => void; disabled: boolean; className: string }) {
  const [typed, setTyped] = useState<string | null>(null);
  const done = () => {
    if (typed !== null && typed.trim() !== value) onCommit(typed.trim());
    setTyped(null);
  };
  return (
    <label className={className}>
      <span>{label}</span>
      <input
        className="wb2-fi"
        value={typed ?? value}
        aria-label={label}
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

/** Each line's sell each, as the price build-up sold it: a part from its
    priced line, labour from its visit, in the order the lines are. */
function sellEachOf(o: OptionPrice | undefined, lines: QuoteLine[]): Map<string, number> {
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

export function QuoteLinesFace({
  job,
  price,
  actionsEl,
  onPriced,
  onSwitchBack,
  onToast,
  send,
  meta,
}: {
  job: string;
  price: QuotePrice | null | undefined;
  actionsEl: HTMLDivElement | null;
  onToast?: (message: string) => void;
  /** what goes to ServiceM8 once an option is accepted (job-quote-send.tsx) */
  send?: ReactNode;
  /** who and where, for the proposal's heading */
  meta?: { title: string; client: string | null; site: string | null; jobNumber: string | null };
  /** read the price again: a line changed */
  onPriced: () => void;
  onSwitchBack: () => void;
}) {
  const { view, post, reload } = useQuoteLines(job, true);
  const [at, setAt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [hits, setHits] = useState<BookHit[] | null>(null);
  const [system, setSystem] = useState("");
  const [kitOpen, setKitOpen] = useState(false);
  /* the line whose pick list is open (Select preferred item, slice 2.4) */
  const [swapping, setSwapping] = useState<string | null>(null);
  /* the proposal, previewed in place of the lines (7.1) */
  const [paper, setPaper] = useState(false);
  /* the unit line whose compare is open (compare-card.tsx) */
  const [comparing, setComparing] = useState<string | null>(null);
  /* Tiff's questions still open (tiff-panel.tsx) */
  const [asked, setAsked] = useState(0);

  const lines = (view?.lines ?? []).filter((l) => l.optionIndex === at);
  const options = Math.max(1, ...(view?.lines ?? []).map((l) => l.optionIndex + 1), price && price.ok ? price.options.length : 1);
  const o = price && price.ok ? price.options[at] : undefined;
  const sells = sellEachOf(o, lines);
  const systems = [...new Set(lines.map((l) => l.system))];
  const fitOf = new Map((view?.fits ?? []).map((f) => [f.key, f]));
  const all = view?.lines ?? [];
  const accepted = view?.accepted ?? [];
  const steps = linesSteps({
    accepted,
    approved: view?.approved ?? false,
    lines: all.length,
    /* the lines nobody knows yet, and Tiff's questions still open */
    unknown: all.filter((l) => l.source === "unknown" && l.costCents <= 0 && l.sellCents == null).length + asked,
    price: priceState(price),
  });

  const act = async (body: Record<string, unknown>) => {
    setBusy(true);
    setNote(null);
    const v = await post(body);
    setBusy(false);
    if (!v) setNote("That didn't save. Try again.");
    else if (!v.ok) setNote(v.reason ?? "That didn't save. Try again.");
    onPriced();
  };

  /* the client's choice: its parts go on the job's own materials list */
  const accept = async () => {
    const marking = !accepted.includes(at);
    setBusy(true);
    setNote(null);
    const v = await post({ op: "accept", option: at });
    setBusy(false);
    if (!v?.ok) return setNote(v?.reason ?? "That didn't save. Try again.");
    onPriced();
    if (marking && v.onJob) {
      onToast?.(v.onJob.added || v.onJob.removed ? "The accepted option's parts are on the job's materials list" : "The job's materials list already has the accepted option's parts");
    }
  };

  const change = (l: QuoteLine, patch: Partial<LineFields>) => void act({ op: "change", id: l.id, version: l.version, patch });

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
    void act({
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
    void act({
      op: "add",
      line: { optionIndex: at, system, group: PROVISIONAL, name: search.trim() || "Provisional sum", kind: "material", qty: 1, costCents: 0, sellCents: null, source: "unknown", why: "Its price to set" },
    });

  const addByHand = (kind: "material" | "labour") =>
    void act({
      op: "add",
      line:
        kind === "labour"
          ? { optionIndex: at, system: "", group: "Labour", name: "Install", kind: "labour", qty: 0, unit: "h", costCents: o?.profit?.hourCostCents ?? 0, source: "by_hand" }
          : { optionIndex: at, system, group: "Materials", name: search.trim() || "A line by hand", kind: "material", qty: 1, costCents: 0, source: "by_hand" },
    });

  /* ── the total, in its own card ── */
  let total: ReactNode = null;
  if (price && !price.ok) {
    total = (
      <div className="ql-tot unset">
        <span>Price</span>
        <b>Not set</b>
        <small>{unsetWords(price.unset)}</small>
      </div>
    );
  } else if (o) {
    const left = leftOn(o).length > 0;
    total = (
      <div className="ql-tot">
        <span>{`Total ex GST${left ? ", so far" : ""}`}</span>
        <b>{fmtAud(o.build.exGstCents)}</b>
        <small>{`${fmtAud(o.build.incGstCents)} inc GST`}</small>
        {o.profit && <em>{`Profit ${fmtAud(o.profit.profitCents)}, ${o.profit.pct}%`}</em>}
      </div>
    );
  }
  /* who approved the proposal, in words */
  const approvedBy = view?.proposal?.approvedBy ?? "";
  const approver = !approvedBy ? "someone" : approvedBy === view?.me ? "you" : (view?.names[approvedBy] ?? "someone");
  const units = o ? o.build.groups.filter((g) => g.lines.some((l) => l.kind === "unit")).reduce((n, g) => n + g.sellCents, 0) : 0;
  const materials = o ? o.build.exGstCents - units - o.build.labour.sellCents : 0;
  const hours = lines.filter((l) => l.kind === "labour").reduce((n, l) => n + l.qty, 0);
  /* the job's supplier: a line it doesn't sell says where it comes from */
  const buyFrom = view?.supplier ?? null;
  const supplierName = (key: string) => view?.suppliers?.find((s) => s.key === key)?.name ?? key;
  /* a hard job's loading on this option's labour (slice 9.2): the last line
     of its Labour group, in the price, never a line the customer sees */
  const loading = view?.loading?.[at] ?? null;
  const labourAt = lines.find((l) => l.group === "Labour");
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

  const flow = (
    <>
      <div className="ql-sum">
        <div className="ql-sum-l">
          {options > 1 ? (
            <div className="ql-opts" role="tablist" aria-label="Options">
              {Array.from({ length: options }, (_, i) => (
                <button key={i} type="button" role="tab" aria-selected={i === at} className={i === at ? "ql-opt on" : "ql-opt"} onClick={() => setAt(i)}>
                  <span>{`Option ${i + 1}`}</span>
                  <b>{price && price.ok && price.options[i] ? fmtAud(price.options[i]!.build.exGstCents) : "–"}</b>
                </button>
              ))}
            </div>
          ) : (
            <dl className="ql-stats">
              <div>
                <dt>Units</dt>
                <dd>{fmtAud(units)}</dd>
              </div>
              <div>
                <dt>Materials</dt>
                <dd>{fmtAud(Math.max(0, materials))}</dd>
              </div>
              <div>
                <dt>{`Labour, ${hours} h`}</dt>
                <dd>{o ? fmtAud(o.build.labour.sellCents) : "–"}</dd>
              </div>
            </dl>
          )}
          <div className="ql-sumrow">
            {all.length > 0 && (
              <TextBox
                key={`${at}|${view?.optionNames?.[at] ?? ""}`}
                label={`Option ${at + 1}, as the proposal names it`}
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
        </div>
        {total}
      </div>
      {o?.profit?.short && leftOn(o).length === 0 && (
        <p className="qp-short" role="status">
          {`Profit ${o.profit.pct}%, under your ${o.profit.targetPct}% target by ${fmtAud(o.profit.short.cents)}. ${fmtAud(o.profit.short.priceCents)} ex GST would meet it.`}
        </p>
      )}
      {note && <p className="wb2-sherr">{note}</p>}

      {comparing && lines.some((l) => l.id === comparing) && (
        <CompareCard
          key={comparing}
          job={job}
          lineId={comparing}
          onClose={() => setComparing(null)}
          onChanged={() => {
            reload();
            onPriced();
          }}
        />
      )}

      <table className="ql-lt ql-colh">
        <Cols />
        <thead>
          <tr>
            <th>Item</th>
            <th className="n">Qty</th>
            <th className="n">Cost each</th>
            <th className="n">Sell each</th>
            <th className="n">Total</th>
            <th aria-label="Take off" />
          </tr>
        </thead>
      </table>

      {systems.length === 0 && <p className="qp-none">No lines yet.</p>}
      {systems.map((sys) => {
        const mine = lines.filter((l) => l.system === sys);
        const groups = [...new Set(mine.map((l) => l.group))];
        const sysTotal = mine.reduce((n, l) => n + Math.round((sells.get(l.id) ?? 0) * l.qty), 0);
        return (
          <section key={sys || "_"} className="ql-sys" aria-label={sys || "Quote"}>
            <header className="ql-sys-h">
              <h3>{sys || "Quote"}</h3>
              <b>{cents2(sysTotal)}</b>
            </header>
            <table className="ql-lt">
              <Cols />
              <tbody>
                {groups.map((g) => {
                  const rows = mine.filter((l) => l.group === g);
                  const sub = rows.reduce((n, l) => n + Math.round((sells.get(l.id) ?? 0) * l.qty), 0);
                  return [
                    <tr key={`g-${g}`} className="ql-sg">
                      <td colSpan={4}>{g}</td>
                      <td className="n">{cents2(sub)}</td>
                      <td />
                    </tr>,
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
                                {l.kind !== "labour" ? (
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
                                {at > 0 && againstFirst(l, all) !== "same" && (
                                  <em className="ql-vs">{againstFirst(l, all) === "added" ? " Added" : " Changed"}</em>
                                )}
                              </span>
                              {l.code && (
                                <span className="cd">
                                  {l.code}
                                  {buyFrom && l.supplierKey && l.supplierKey !== buyFrom && (
                                    <em className="ql-not">{`Not at ${supplierName(buyFrom)}: ${supplierName(l.supplierKey)}`}</em>
                                  )}
                                  {l.kind === "unit" && unitPartOf(l.name, l.code) !== "outdoor" && (
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
                            <Field
                              value={qtyWords(l)}
                              label={`Quantity of ${l.name}`}
                              disabled={busy}
                              onCommit={(t) => {
                                const n = Number(t.replace(/[^\d.]/g, ""));
                                if (Number.isFinite(n) && n >= 0) change(l, { qty: n });
                              }}
                            />
                          </td>
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
                          <td className="n">{unknown ? "—" : cents2(Math.round((each ?? 0) * l.qty))}</td>
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
                    g === "Labour" && labourAt && sys === labourAt.system ? loadingRow : null,
                  ];
                })}
              </tbody>
            </table>
          </section>
        );
      })}

      {at > 0 && missingFromFirst(at, all).length > 0 && (
        <p className="qp-none">{`Not in this option: ${missingFromFirst(at, all)
          .map((l) => l.name)
          .join(", ")}`}</p>
      )}

      <section className="ql-add" aria-label="Add a line">
        <div className="ql-addrow">
          <input
            className="wb2-fi"
            value={search}
            placeholder="Add a line from your book"
            aria-label="Search your book for a line to add"
            onChange={(e) => void find(e.target.value)}
          />
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
          <button type="button" className="pbtn ghost sm" disabled={busy} onClick={addProvisional}>
            Add a provisional sum
          </button>
          {labourAt && !loading && (
            /* 10%: the low end of Isaac's own "10 to 15%"; not applied until it says why */
            <button type="button" className="pbtn ghost sm" disabled={busy} onClick={() => setLoad({ pct: 10, reason: "" })}>
              Add a loading
            </button>
          )}
          <button type="button" className="pbtn ghost sm" disabled={busy} onClick={() => setKitOpen((v) => !v)} aria-expanded={kitOpen}>
            Add a kit
          </button>
          <button type="button" className="pbtn ghost sm" disabled={busy} onClick={() => setAt(options)}>
            Add an option
          </button>
          {all.some((l) => l.optionIndex === 0) && (
            <button
              type="button"
              className="pbtn ghost sm"
              disabled={busy}
              onClick={() => {
                const to = options;
                void act({ op: "copy", from: 0, to }).then(() => setAt(to));
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
            onAdd={(k) => {
              setKitOpen(false);
              void act({ op: "kit", optionIndex: at, ...k });
            }}
          />
        )}
      </section>
    </>
  );

  /* what to look at before it goes: the non-Tiff half of the review (slice
     11.1) — what isn't known, what doesn't fit, and the profit */
  const unknownHere = lines.filter((l) => l.source === "unknown" && l.costCents <= 0 && l.sellCents == null);
  const misfits = lines.filter((l) => fitOf.get(l.id)?.state === "misfit");
  const assumedHere = lines.filter((l) => l.source === "assumed");
  const checks: { tone: "due" | "info" | "ok"; text: string }[] = [
    ...unknownHere.map((l) => ({ tone: "due" as const, text: `${l.name}: not known yet` })),
    ...misfits.map((l) => ({ tone: "due" as const, text: `${l.name}: ${fitOf.get(l.id)!.why}` })),
    ...(o?.build.loadingNeedsReason ? [{ tone: "due" as const, text: "The loading isn't on the price until it says why" }] : []),
    ...(assumedHere.length > 0 ? [{ tone: "info" as const, text: `${assumedHere.length} ${assumedHere.length === 1 ? "line" : "lines"} assumed` }] : []),
    ...(view?.tasks?.[at]
      ? [{ tone: "info" as const, text: `Your task hours make it ${view.tasks[at]!.hours} h for ${view.tasks[at]!.words}; the quote has ${view.tasks[at]!.quoted} h` }]
      : []),
    ...(o?.profit
      ? [{ tone: o.profit.short ? ("due" as const) : ("ok" as const), text: `Profit ${o.profit.pct}%${o.profit.targetPct != null ? `, target ${o.profit.targetPct}%` : ""}` }]
      : []),
  ];

  const rail = (
    <div className="ql-rail">
      {checks.length > 0 && (
        <>
          <h2 className="hd-ls-grp">To check</h2>
          <ul className="ql-checks">
            {checks.map((c, i) => (
              <li key={i} className={c.tone}>
                <i aria-hidden="true" />
                <span>{c.text}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {accepted.length > 0 && send}
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
    </div>
  );

  return (
    <>
      {actionsEl &&
        createPortal(
          <>
            {paper ? (
              <>
                <button type="button" className="pbtn ghost" onClick={() => setPaper(false)}>
                  Back to the lines
                </button>
                {view?.approved ? (
                  <span className="qp-approved">{`Approved by ${approver}`}</span>
                ) : (
                  <button type="button" className="pbtn primary" disabled={busy || all.length === 0} onClick={() => void act({ op: "approve" })}>
                    Approve
                  </button>
                )}
              </>
            ) : (
              <>
                <button type="button" className="pbtn ghost" onClick={onSwitchBack}>
                  Use Tiff&apos;s builder
                </button>
                {all.length > 0 && (
                  <button type="button" className="pbtn ghost" onClick={() => setPaper(true)}>
                    Preview proposal
                  </button>
                )}
              </>
            )}
            {all.length > 0 && (
              <button
                type="button"
                className={accepted.includes(at) ? "pbtn ghost wb2-jqacc on" : "pbtn ghost"}
                aria-pressed={accepted.includes(at)}
                disabled={busy}
                onClick={() => void accept()}
              >
                {accepted.includes(at) ? (options > 1 ? `Option ${at + 1} accepted` : "Accepted") : options > 1 ? `Mark option ${at + 1} accepted` : "Mark accepted"}
              </button>
            )}
          </>,
          actionsEl
        )}
      <section className="hd-day" aria-label="Where the quote is">
        <QuoteStepsLine steps={steps} />
      </section>
      <div className="hd-body">
        <div className="hd-fx">
          <div className="hd-main">
            <div className="hd-col">
              <div className="hd-face qp-face ql-face">
                {paper ? (
                  <div className="lp-desk">
                    <LinesProposalPaper
                      proposal={view?.proposal ?? null}
                      lines={all}
                      price={price}
                      optionNames={view?.optionNames ?? []}
                      noteLibrary={view?.noteLibrary ?? []}
                      paymentTerms={view?.paymentTerms ?? null}
                      title={meta?.title ?? "Quote"}
                      client={meta?.client ?? null}
                      site={meta?.site ?? null}
                      jobNumber={meta?.jobNumber ?? null}
                      preparedBy={view?.names[view?.me ?? ""] ?? null}
                      busy={busy}
                      onSave={(patch) => void act({ op: "proposal", patch })}
                    />
                  </div>
                ) : (
                  flow
                )}
              </div>
            </div>
            <aside className="hd-list qp-rail" aria-label="Changes">
              <TiffPanel
                job={job}
                onOpen={setAsked}
                onChanged={() => {
                  reload();
                  onPriced();
                }}
              >
                {rail}
              </TiffPanel>
            </aside>
          </div>
        </div>
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

type KitAsk = { kit: "split" | "ducted"; system: string; brand: string; model: string; facts: Record<string, string> };

/** What a kit needs to know: the unit (its pipe and current read off its
    data pack when blank), the runs, and the outlets for a ducted one. A run
    left blank leaves its part on the quote as not known yet. */
function KitForm({ busy, system, onAdd }: { busy: boolean; system: string; onAdd: (k: KitAsk) => void }) {
  const [kit, setKit] = useState<"split" | "ducted">("split");
  const [sys, setSys] = useState(system || "");
  const [brand, setBrand] = useState("mitsubishi-electric");
  const [model, setModel] = useState("");
  const [f, setF] = useState<Record<string, string>>({ pipe: "", pipeM: "", powerM: "", amps: "", mount: "ground", trunkingM: "", drainM: "", outlets: "", outletMm: "", replacing: "", keptPipe: "", underfloor: "" });
  const set = (k: string) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const num = (k: string, label: string, unit: string) => (
    <label className="ql-kf">
      <span>{label}</span>
      <span className="ql-kin">
        <input className="wb2-fi" inputMode="decimal" value={f[k]} onChange={set(k)} aria-label={label} />
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
            <option value="mitsubishi-electric">Mitsubishi Electric</option>
            <option value="">None</option>
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
      </div>
      <div className="wb2-jqacts">
        <button type="button" className="pbtn primary sm" disabled={busy} onClick={() => onAdd({ kit, system: sys.trim(), brand, model: model.trim(), facts: f })}>
          Add the kit
        </button>
      </div>
    </div>
  );
}

function Cols() {
  return (
    <colgroup>
      <col />
      <col className="cq" />
      <col className="cc" />
      <col className="ce" />
      <col className="ct" />
      <col className="cx" />
    </colgroup>
  );
}
