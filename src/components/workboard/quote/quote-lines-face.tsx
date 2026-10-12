"use client";

import { useEffect, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { fmtAud } from "@/lib/workboard/project-money";
import type { LineChange } from "@/lib/quotes/lines-server";
import { againstFirst, isProvisional, missingFromFirst, PROVISIONAL, type LineFields, type QuoteLine } from "@/lib/quotes/lines";
import { offerFor, type BookHit } from "@/lib/quotes/lookups";
import type { Offer } from "@/lib/quotes/price-book";
import type { Fit } from "@/lib/quotes/fit";
import type { OptionPrice, QuotePrice } from "@/lib/quotes/quote-price-server";
import { linesSteps } from "@/lib/quotes/quote-steps";
import { toConfirmOf } from "@/lib/quotes/quote-card";
import { unsetWords } from "@/lib/quotes/build-settings";
import { OLD_PIPES, PIPE_SIZES } from "@/lib/quotes/kits";
import { QuoteStepsLine, leftOn, priceState } from "./quote-parts";
import { Globe, TiffPanel } from "./tiff-panel";
import { CompareCard } from "./compare-card";
import { LinesProposalPaper } from "./lines-proposal-paper";
import type { LinesProposal } from "@/lib/quotes/lines-proposal";
import type { PaymentPreset, PaymentStage } from "@/lib/quotes/payment";
import type { QuoteNote } from "@/lib/templates/settings";
import { unitPartOf } from "@/lib/quotes/brands";
import { buildProgress, type PlannedPart } from "@/lib/quotes/build-progress";
import { visitSummary, withHours, withoutTask, withTask, type LineVisit } from "@/lib/quotes/line-visit";
import type { Variation } from "@/lib/quotes/lines-job";
import { VariationPaper } from "./variation-paper";
import { VersionPaper } from "./version-paper";
import type { QuoteVersion } from "@/lib/quotes/quote-versions";

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
  /** whether this person sees the quote's money; without it the server took it out (money-hidden.ts) */
  money?: boolean;
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
  /** changes after it was accepted, each an option of its own (lines-job.ts) */
  variations?: Variation[];
  /** a variation just started: the option to open */
  opened?: number | null;
  /** the quote as it stood at each approval before this one, newest first (quote-versions.ts) */
  versions?: QuoteVersion[];
  /** sent to ServiceM8 as a quote (7.3), or a trial run of it */
  sent?: { at: string; by: string; trial: boolean } | null;
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
  /** lines priced from the web, by id: the page each rests on (12.2) */
  researched?: Record<string, { url: string; title: string }>;
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
  sendQuote,
  meta,
}: {
  job: string;
  price: QuotePrice | null | undefined;
  actionsEl: HTMLDivElement | null;
  onToast?: (message: string) => void;
  /** what goes to ServiceM8 once an option is accepted (job-quote-send.tsx) */
  send?: ReactNode;
  /** the approved quote sent to ServiceM8 as a quote, before it's accepted
      (7.3); told when it's gone, so the progress line says so */
  sendQuote?: (onSent: () => void) => ReactNode;
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
  /* Update quote on an approved or accepted quote: what's changing, while it's asked */
  const [updating, setUpdating] = useState<string | null>(null);
  /* a past version, open on the paper (quote-versions.ts) */
  const [viewing, setViewing] = useState<number | null>(null);
  /* the parts she said she'd build, while she builds them (5.2) */
  const [plan, setPlan] = useState<{ option: number; parts: PlannedPart[] } | null>(null);

  const lines = (view?.lines ?? []).filter((l) => l.optionIndex === at);
  const options = Math.max(1, ...(view?.lines ?? []).map((l) => l.optionIndex + 1), price && price.ok ? price.options.length : 1);
  const o = price && price.ok ? price.options[at] : undefined;
  const sells = sellEachOf(o, lines);
  const systems = [...new Set(lines.map((l) => l.system))];
  const fitOf = new Map((view?.fits ?? []).map((f) => [f.key, f]));
  const all = view?.lines ?? [];
  /* a tech quotes too, its money hidden (Isaac, 2026-10-12): no prices,
     no pricing, no approving; the conversation and the work are theirs */
  const money = view?.money !== false;
  const accepted = view?.accepted ?? [];
  const versions = view?.versions ?? [];
  /* the version the quote is at: one more than the last kept */
  const version = (versions[0]?.n ?? 0) + 1;
  const shown = viewing == null ? null : (versions.find((v) => v.n === viewing) ?? null);
  const steps = linesSteps({
    accepted,
    approved: view?.approved ?? false,
    version,
    sent: view?.sent ?? null,
    lines: all.length,
    /* the lines nobody knows yet, and Tiff's questions still open */
    unknown: toConfirmOf(all, asked),
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

  /* a line nobody knows the price of, from To confirm: its cost box, in view and ready to type */
  const priceOnLine = (l: QuoteLine) => {
    const box = Array.from(document.querySelectorAll<HTMLInputElement>("input")).find((i) => i.getAttribute("aria-label") === `What one ${l.name} costs you`);
    box?.focus();
    box?.scrollIntoView?.({ block: "center" });
  };

  /* A VARIATION (Isaac, 2026-10-10): started from Update quote on an
     accepted quote, opened at once; approved, then accepted, on its own */
  const startVariation = async (what: string) => {
    setBusy(true);
    setNote(null);
    const v = await post({ op: "variation", what });
    setBusy(false);
    if (!v?.ok) return setNote(v?.reason ?? "That didn't save. Try again.");
    setUpdating(null);
    if (typeof v.opened === "number") setAt(v.opened);
    onPriced();
  };
  /* VERSION 2 (quote-versions.ts): Update quote on an approved quote nobody
     has accepted keeps it as it stood; the approval comes off */
  const startVersion = async (what: string) => {
    setBusy(true);
    setNote(null);
    const v = await post({ op: "version", what });
    setBusy(false);
    if (!v?.ok) return setNote(v?.reason ?? "That didn't save. Try again.");
    setUpdating(null);
    setPaper(false);
    onPriced();
    onToast?.(`Version ${version} kept. This is version ${version + 1}, to approve again`);
  };
  const markVariation = async (op: "variation-approve" | "variation-accept", option: number, accepting: boolean) => {
    setBusy(true);
    setNote(null);
    const v = await post({ op, option });
    setBusy(false);
    if (!v?.ok) return setNote(v?.reason ?? "That didn't save. Try again.");
    onPriced();
    if (op === "variation-accept" && accepting)
      onToast?.(v.onJob?.added ? "The variation's new work is on the job's task list, and its new parts on the materials list" : "The variation's new work is on the job's task list");
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

  /* ── the head: every figure on one ledger (Isaac, 2026-10-10: "remove the
     dark money header… the analytics pages does it well", then variant A):
     the parts, the total, the profit, each label over value over note; the
     parts' split under them in the chart colours; the profit's state in
     words while anything is left to confirm ── */
  const units = o ? o.build.groups.filter((g) => g.lines.some((l) => l.kind === "unit")).reduce((n, g) => n + g.sellCents, 0) : 0;
  const materials = o ? o.build.exGstCents - units - o.build.labour.sellCents : 0;
  const hours = lines.filter((l) => l.kind === "labour").reduce((n, l) => n + l.qty, 0);
  const priced = price && price.ok && o ? o : null;
  const left = priced ? leftOn(priced).length > 0 : false;
  const toConfirm = lines.filter((l) => (l.source === "unknown" && l.costCents <= 0 && l.sellCents == null) || l.estimate).length + asked;
  const labourCents = priced ? priced.build.labour.sellCents : 0;
  const whole = units + Math.max(0, materials) + labourCents;
  const share = (c: number) => (whole > 0 ? Math.round((c / whole) * 100) : 0);
  const parts = [
    { key: "units", label: "Units", colour: "var(--chart-1)", cents: units, note: `${share(units)}%` },
    { key: "materials", label: "Materials", colour: "var(--chart-3)", cents: Math.max(0, materials), note: `${share(Math.max(0, materials))}%` },
    { key: "labour", label: "Labour", colour: "var(--chart-2)", cents: labourCents, note: `${hours} h, ${share(labourCents)}%` },
  ];
  const profit = priced?.profit ?? null;
  /* a variation: every figure the difference it makes to the accepted quote */
  const variation = (view?.variations ?? []).find((v) => v.option === at) ?? null;
  const base = variation?.of ?? 0;
  const baseOpt = variation && price && price.ok ? price.options[variation.of] : undefined;
  const signed = (c: number) => `${c > 0 ? "+" : c < 0 ? "−" : ""}${fmtAud(Math.abs(c))}`;
  const unitsIn = (x: OptionPrice) => x.build.groups.filter((g) => g.lines.some((l) => l.kind === "unit")).reduce((n, g) => n + g.sellCents, 0);
  const delta =
    priced && baseOpt
      ? {
          units: units - unitsIn(baseOpt),
          materials: materials - (baseOpt.build.exGstCents - unitsIn(baseOpt) - baseOpt.build.labour.sellCents),
          labour: labourCents - baseOpt.build.labour.sellCents,
          hours: hours - all.filter((l) => l.optionIndex === base && l.kind === "labour").reduce((n, l) => n + l.qty, 0),
          ex: priced.build.exGstCents - baseOpt.build.exGstCents,
          profit: profit && baseOpt.profit ? profit.profitCents - baseOpt.profit.profitCents : null,
        }
      : null;
  const profitNote = !profit
    ? null
    : toConfirm > 0
      ? { words: `${profit.pct}%, ${toConfirm} to confirm`, tone: "warn" }
      : profit.short
        ? { words: `${profit.pct}%, under your ${profit.targetPct}%`, tone: "warn" }
        : profit.targetPct != null
          ? { words: `${profit.pct}%, ${profit.pct > profit.targetPct ? "over" : "at"} your ${profit.targetPct}%`, tone: "ok" }
          : { words: `${profit.pct}%`, tone: "" };
  const ledger = delta ? (
    <div className="ql-led" aria-label={`Variation ${variation!.n}`}>
      {(
        [
          ["Units", "var(--chart-1)", delta.units, ""],
          ["Materials", "var(--chart-3)", delta.materials, ""],
          ["Labour", "var(--chart-2)", delta.labour, `${delta.hours > 0 ? "+" : ""}${Math.round(delta.hours * 100) / 100} h`],
        ] as const
      ).map(([label, colour, cents, note]) => (
        <div key={label} className="ql-lc">
          <span className="ql-ll">
            <i className="ql-key" style={{ background: colour }} aria-hidden="true" />
            {label}
          </span>
          <b>{signed(cents)}</b>
          <em>{note}</em>
        </div>
      ))}
      <div className="ql-lc tot">
        <span className="ql-ll">{`Variation ${variation!.n}, ex GST`}</span>
        <b>{signed(delta.ex)}</b>
        <em>{`New total ${fmtAud(priced!.build.exGstCents)}`}</em>
      </div>
      <div className="ql-lc">
        <span className="ql-ll">Profit</span>
        <b>{delta.profit != null ? signed(delta.profit) : "–"}</b>
        <em className={toConfirm > 0 ? "warn" : undefined}>
          {toConfirm > 0 ? `${toConfirm} to confirm` : delta.profit != null && delta.ex !== 0 ? `${Math.round((delta.profit / delta.ex) * 1000) / 10}% of it` : ""}
        </em>
      </div>
    </div>
  ) : (
    <div className="ql-led" aria-label="The price">
      {parts.map((p) => (
        <div key={p.key} className="ql-lc">
          <span className="ql-ll">
            <i className="ql-key" style={{ background: p.colour }} aria-hidden="true" />
            {p.label}
          </span>
          <b>{priced ? fmtAud(p.cents) : "–"}</b>
          <em>{priced ? p.note : ""}</em>
        </div>
      ))}
      <div className="ql-lc tot">
        <span className="ql-ll">{price && !price.ok ? "Price" : `Total ex GST${left ? ", so far" : ""}`}</span>
        <b>{price && !price.ok ? "Not set" : priced ? fmtAud(priced.build.exGstCents) : "–"}</b>
        <em>{price && !price.ok ? unsetWords(price.unset) : priced ? `${fmtAud(priced.build.incGstCents)} inc GST` : ""}</em>
      </div>
      <div className="ql-lc">
        <span className="ql-ll">Profit</span>
        <b>{profit ? fmtAud(profit.profitCents) : "–"}</b>
        <em className={profitNote?.tone || undefined}>{profitNote?.words ?? ""}</em>
      </div>
      {priced && whole > 0 && (
        <div className="ql-split" aria-hidden="true">
          {parts.map((p) => (
            <span key={p.key} style={{ flexGrow: p.cents, background: p.colour }} />
          ))}
        </div>
      )}
    </div>
  );
  /* ── watching her build it, under the total (5.2, mock-up screen 2) ── */
  let building: ReactNode = null;
  if (plan && plan.parts.length > 0) {
    const theirs = (view?.lines ?? []).filter((l) => l.optionIndex === plan.option);
    const each = sellEachOf(price && price.ok ? price.options[plan.option] : undefined, theirs);
    const { parts, done } = buildProgress(plan.parts, theirs, (l) => Math.round((each.get(l.id) ?? 0) * l.qty));
    building = (
      <section className="qb" aria-label="Building the quote">
        <header>
          <b>Building the quote</b>
          <span>{`${done} of ${parts.length} ${parts.length === 1 ? "part" : "parts"} done`}</span>
        </header>
        <div className="qb-bar" aria-hidden="true">
          <i style={{ width: `${Math.round((done / parts.length) * 100)}%` }} />
        </div>
        <ol>
          {parts.map((p) => {
            /* "Downstairs units"; a system named for its group says it once */
            const name = !p.system || p.system.toLowerCase() === p.group.toLowerCase() ? p.group : `${p.system} ${p.group.charAt(0).toLowerCase()}${p.group.slice(1)}`;
            const small = p.state === "now" ? [p.detail, p.items ? `${p.items} ${p.items === 1 ? "item" : "items"} so far` : "Starting"].filter(Boolean).join(", ") : p.detail;
            return (
              <li key={`${p.system}|${p.group}`} className={p.state === "todo" ? undefined : p.state}>
                <i aria-hidden="true" />
                <span>
                  <b>{name}</b>
                  {small && <small>{small}</small>}
                </span>
                <em>{p.sellCents && p.state !== "todo" ? cents2(p.sellCents) : ""}</em>
              </li>
            );
          })}
        </ol>
      </section>
    );
  }

  /* who approved the proposal, in words */
  const approvedBy = view?.proposal?.approvedBy ?? "";
  const approver = !approvedBy ? "someone" : approvedBy === view?.me ? "you" : (view?.names[approvedBy] ?? "someone");
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
      <div className={options > 1 ? "ql-sum many" : "ql-sum"}>
        {options > 1 && (
          <div className="ql-opts" role="tablist" aria-label="Options">
            {Array.from({ length: options }, (_, i) => (
              <button key={i} type="button" role="tab" aria-selected={i === at} className={i === at ? "ql-opt on" : "ql-opt"} onClick={() => setAt(i)}>
                {(() => {
                  const v = (view?.variations ?? []).find((x) => x.option === i);
                  const mine = price && price.ok ? price.options[i] : undefined;
                  const of = v && price && price.ok ? price.options[v.of] : undefined;
                  return (
                    <>
                      <span>{v ? `Variation ${v.n}` : view?.optionNames?.[i] ? `${i + 1}. ${view.optionNames[i]}` : `Option ${i + 1}`}</span>
                      {money && <b>{mine ? (v && of ? signed(mine.build.exGstCents - of.build.exGstCents) : fmtAud(mine.build.exGstCents)) : "–"}</b>}
                    </>
                  );
                })()}
              </button>
            ))}
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
        {money && ledger}
      </div>
      {o?.profit?.short && leftOn(o).length === 0 && (
        <p className="qp-short" role="status">
          {`Profit ${o.profit.pct}%, under your ${o.profit.targetPct}% target by ${fmtAud(o.profit.short.cents)}. ${fmtAud(o.profit.short.priceCents)} ex GST would meet it.`}
        </p>
      )}
      {note && <p className="wb2-sherr">{note}</p>}
      {building}

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

      <table className={options > 1 ? "ql-lt ql-colh many" : "ql-lt ql-colh"}>
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
      {systems.map((sys) => {
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
              <tbody>
                {groups.map((g) => {
                  const rows = mine.filter((l) => l.group === g);
                  const sub = rows.reduce((n, l) => n + Math.round((sells.get(l.id) ?? 0) * l.qty), 0);
                  return [
                    <tr key={`g-${g}`} className="ql-sg">
                      <td colSpan={money ? 4 : 2}>{g}</td>
                      {money && <td className="n">{cents2(sub)}</td>}
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
                          {money && <td className="n">
                            <Field
                              value={dollars(l.costCents)}
                              label={`What one ${l.name} costs you`}
                              disabled={busy}
                              onCommit={(t) => {
                                const c = centsOf(t);
                                if (c != null && Number.isFinite(c)) change(l, { costCents: c });
                              }}
                            />
                          </td>}
                          {money && <td className="n">
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
                          </td>}
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
                  ];
                })}
              </tbody>
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
  /** a thing to confirm; an estimate is confirmed from the list itself, and
      a line nobody knows the price of is priced on the line */
  type Check = { tone: "due" | "info" | "ok"; text: string; confirm?: QuoteLine; price?: QuoteLine };
  const checksFor = (i: number): Check[] => {
    const mine = all.filter((l) => l.optionIndex === i);
    const oi = price && price.ok ? price.options[i] : undefined;
    const assumed = mine.filter((l) => l.source === "assumed");
    const task = view?.tasks?.[i];
    return [
      ...mine.filter((l) => l.source === "unknown" && l.costCents <= 0 && l.sellCents == null).map((l) => ({ tone: "due" as const, text: `${l.name}: not known yet`, price: l })),
      ...mine.filter((l) => l.estimate).map((l) => ({ tone: "due" as const, text: `${l.name}: ${l.why || "an estimate"}`, confirm: l })),
      ...mine.filter((l) => fitOf.get(l.id)?.state === "misfit").map((l) => ({ tone: "due" as const, text: `${l.name}: ${fitOf.get(l.id)!.why}` })),
      ...(oi?.build.loadingNeedsReason ? [{ tone: "due" as const, text: "The loading isn't on the price until it says why" }] : []),
      ...(assumed.length > 0 ? [{ tone: "info" as const, text: `${assumed.length} ${assumed.length === 1 ? "line" : "lines"} assumed` }] : []),
      ...(task ? [{ tone: "info" as const, text: `Your task hours make it ${task.hours} h for ${task.words}; the quote has ${task.quoted} h` }] : []),
      /* the head says the open option's profit; the proposal's review says every option's */
      ...(paper && oi?.profit ? [{ tone: oi.profit.short ? ("due" as const) : ("ok" as const), text: `Profit ${oi.profit.pct}%${oi.profit.targetPct != null ? `, target ${oi.profit.targetPct}%` : ""}` }] : []),
    ];
  };
  /* on the proposal, every option is reviewed before it's approved; on the
     lines, the option open */
  const quoteOptions = Array.from({ length: options }, (_, i) => i).filter((i) => !(view?.variations ?? []).some((v) => v.option === i));
  const checks: Check[] =
    paper && !variation
      ? quoteOptions.map((i) => checksFor(i).map((c) => (quoteOptions.length > 1 ? { ...c, text: `Option ${i + 1}: ${c.text}` } : c))).flat()
      : checksFor(at);

  /* what the page has to confirm: under Tiff's questions, one list (Isaac,
     2026-10-11: the conversation runs down to the message box) */
  const confirm =
    checks.length > 0 ? (
      <ul className="ql-checks">
        {checks.map((c, i) => (
          <li key={i} className={c.tone}>
            <i aria-hidden="true" />
            <span>{c.text}</span>
            {c.price && !paper && money && (
              <span className="ql-chkacts">
                <button type="button" className="pbtn ghost sm" onClick={() => priceOnLine(c.price!)}>
                  Price it
                </button>
              </span>
            )}
            {c.confirm && (
              <span className="ql-chkacts">
                <button
                  type="button"
                  className="pbtn ghost sm"
                  disabled={busy}
                  onClick={() => void act({ op: "change", id: c.confirm!.id, version: c.confirm!.version, patch: { estimate: false }, why: "Confirmed the estimate" })}
                >
                  Confirm
                </button>
              </span>
            )}
          </li>
        ))}
      </ul>
    ) : null;

  const rail = (
    <div className="ql-rail">
      {money && accepted.length > 0 && send}
      {money && accepted.length === 0 && view?.approved && sendQuote?.(reload)}
      {versions.length > 0 && (
        <>
          <h2 className="hd-ls-grp">Versions</h2>
          <ul className="ql-chg" aria-label="Versions">
            {versions.map((v) => (
              <li key={v.n}>
                <span>
                  <b>{`Version ${v.n}`}</b>
                  <small>{v.options.map((x) => `${x.name}: ${fmtAud(x.incGstCents)} inc GST`).join(", ")}</small>
                </span>
                <button
                  type="button"
                  className="ql-undo"
                  onClick={() => {
                    setViewing(v.n);
                    setPaper(true);
                  }}
                >
                  Open
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
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
                <button
                  type="button"
                  className="pbtn ghost"
                  onClick={() => {
                    setPaper(false);
                    setViewing(null);
                  }}
                >
                  Back to the lines
                </button>
                {shown ? null : variation ? (
                  variation.approvedAt ? (
                    <span className="qp-approved">{`Variation ${variation.n} approved`}</span>
                  ) : (
                    <button type="button" className="pbtn primary" disabled={busy} onClick={() => void markVariation("variation-approve", variation.option, true)}>
                      Approve
                    </button>
                  )
                ) : view?.approved ? (
                  <span className="qp-approved">{`Approved by ${approver}`}</span>
                ) : (
                  <button type="button" className="pbtn primary" disabled={busy || all.length === 0} onClick={() => void act({ op: "approve" })}>
                    Approve
                  </button>
                )}
              </>
            ) : (
              <>
                {money && (
                  <button type="button" className="pbtn ghost" onClick={onSwitchBack}>
                    Use Tiff&apos;s builder
                  </button>
                )}
                {money && all.length > 0 && (
                  <button type="button" className="pbtn ghost" onClick={() => setPaper(true)}>
                    {variation ? "Preview variation" : "Preview proposal"}
                  </button>
                )}
                {money && (accepted.length > 0 || view?.approved) && !variation && (
                  <button type="button" className="pbtn ghost" disabled={busy} onClick={() => setUpdating("")}>
                    Update quote
                  </button>
                )}
              </>
            )}
            {money &&
              all.length > 0 &&
              !shown &&
              (variation ? (
                <button
                  type="button"
                  className={variation.acceptedAt ? "pbtn ghost wb2-jqacc on" : "pbtn ghost"}
                  aria-pressed={!!variation.acceptedAt}
                  disabled={busy}
                  onClick={() => void markVariation("variation-accept", variation.option, !variation.acceptedAt)}
                >
                  {variation.acceptedAt ? `Variation ${variation.n} accepted` : `Mark variation ${variation.n} accepted`}
                </button>
              ) : (
                <button
                  type="button"
                  className={accepted.includes(at) ? "pbtn ghost wb2-jqacc on" : "pbtn ghost"}
                  aria-pressed={accepted.includes(at)}
                  disabled={busy}
                  onClick={() => void accept()}
                >
                  {accepted.includes(at) ? (options > 1 ? `Option ${at + 1} accepted` : "Accepted") : options > 1 ? `Mark option ${at + 1} accepted` : "Mark accepted"}
                </button>
              ))}
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
                {paper && shown ? (
                  <div className="lp-desk">
                    <VersionPaper version={shown} jobNumber={meta?.jobNumber ?? null} client={meta?.client ?? null} />
                  </div>
                ) : paper && variation && priced && baseOpt ? (
                  <div className="lp-desk">
                    <VariationPaper
                      n={variation.n}
                      what={variation.what}
                      startedAt={variation.startedAt}
                      jobNumber={meta?.jobNumber ?? null}
                      client={meta?.client ?? null}
                      acceptedExCents={baseOpt.build.exGstCents}
                      newExCents={priced.build.exGstCents}
                      newIncCents={priced.build.incGstCents}
                      changes={{
                        added: lines.filter((l) => againstFirst(l, all, base) === "added").map((l) => l.name),
                        changed: lines.filter((l) => againstFirst(l, all, base) === "changed").map((l) => l.name),
                        removed: missingFromFirst(at, all, base).map((l) => l.name),
                      }}
                    />
                  </div>
                ) : paper ? (
                  <div className="lp-desk">
                    <LinesProposalPaper
                      proposal={view?.proposal ?? null}
                      /* the quote's own options: a variation is its own paper */
                      lines={all.filter((l) => !(view?.variations ?? []).some((v) => v.option === l.optionIndex))}
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
            {updating != null && (
              <>
                <div className="ql-vscrim" onClick={() => setUpdating(null)} />
                <div className="ql-vdlg" role="dialog" aria-modal="true" aria-label="Update quote">
                  <h3>Update quote</h3>
                  <p>
                    {accepted.length > 0
                      ? `${options > 1 ? `Option ${(accepted[0] ?? 0) + 1}` : "The quote"} is accepted, so this is a variation. The accepted quote stays as it is. The variation is priced as the difference, and the client approves it on its own.`
                      : `The quote is approved, so this is version ${version + 1}. Version ${version} is kept as it stands, the approval comes off, and it goes back through Approve and Send.`}
                  </p>
                  <label className="ql-vwhat">
                    <span>What&apos;s changing</span>
                    <textarea className="wb2-fi" rows={3} value={updating} autoFocus disabled={busy} onChange={(e) => setUpdating(e.target.value)} />
                  </label>
                  <div className="wb2-jqacts">
                    <button type="button" className="pbtn ghost" disabled={busy} onClick={() => setUpdating(null)}>
                      Cancel
                    </button>
                    {accepted.length > 0 ? (
                      <button type="button" className="pbtn primary" disabled={busy || !updating.trim()} onClick={() => void startVariation(updating.trim())}>
                        {`Start variation ${(view?.variations ?? []).reduce((m, v) => Math.max(m, v.n), 0) + 1}`}
                      </button>
                    ) : (
                      <button type="button" className="pbtn primary" disabled={busy || !updating.trim()} onClick={() => void startVersion(updating.trim())}>
                        {`Start version ${version + 1}`}
                      </button>
                    )}
                  </div>
                </div>
              </>
            )}
            <aside className="hd-list qp-rail" aria-label="Changes">
              <TiffPanel
                job={job}
                onOpen={setAsked}
                onPlan={setPlan}
                confirm={confirm}
                confirmTitle={paper ? "Before you approve" : "To confirm"}
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
