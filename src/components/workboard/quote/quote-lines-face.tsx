"use client";

import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from "react";
import type { LineChange } from "@/lib/quotes/lines-server";
import { againstFirst, missingFromFirst, type QuoteLine } from "@/lib/quotes/lines";
import { stillUnknown } from "@/lib/quotes/lines-price";
import type { Fit } from "@/lib/quotes/fit";
import type { QuotePrice } from "@/lib/quotes/quote-price-server";
import { linesSteps } from "@/lib/quotes/quote-steps";
import { toConfirmOf } from "@/lib/quotes/quote-card";
import { cents2 } from "@/lib/quotes/quote-sum";
import { QuoteStepsLine, leftOn, priceState } from "./quote-parts";
import { TiffPanel } from "./tiff-panel";
import { LinesProposalPaper } from "./lines-proposal-paper";
import type { LinesProposal } from "@/lib/quotes/lines-proposal";
import type { PaymentPreset, PaymentStage } from "@/lib/quotes/payment";
import type { QuoteNote } from "@/lib/templates/settings";
import { buildProgress, type PlannedPart } from "@/lib/quotes/build-progress";
import type { Variation } from "@/lib/quotes/lines-job";
import { VariationPaper } from "./variation-paper";
import { VariationSm8 } from "./variation-sm8";
import type { VariationSendAnswer } from "@/app/actions/quote-sm8";
import { VersionPaper } from "./version-paper";
import type { QuoteVersion } from "@/lib/quotes/quote-versions";
import type { JobMediaItem } from "@/lib/workboard/job-media";
import type { Sm8Quote } from "../board/job-quote-card";
import { QuoteLineItems, groupKey, sellEachOf } from "./quote-line-items";
import { InServiceM8, QuoteCard, QuoteRail } from "./quote-rail";
import { LinesButton, QuoteActions } from "./quote-actions";
import { sm8JobUrl } from "@/lib/integrations/sm8-links";
import { Dialog } from "@/components/parts/dialog";
import { Button } from "@/components/parts/button";
import { Field, TextArea } from "@/components/parts/field";

/* THE QUOTE, IN LAYOUT B (Isaac's pick, 21 October 2026; chat first since
   2026-10-13): the conversation with Tiff fills the left, and the rail
   beside it reads like a checkout (quote-rail.tsx): where the quote is, in
   colour, what it comes to, Line items under it, which swaps the left to
   the line items (the quote by hand on its kept lines, quote-line-items.tsx)
   and Back to the conversation swaps it back, and the job in ServiceM8.
   Pinned at its foot, the quote's buttons (quote-actions.tsx): Preview
   quote lays the paper over the left, and Approve quote waits, blue, until
   the option is priced and nothing is open, then Send to ServiceM8. Where
   Tiff isn't on for the business there is no conversation: the line items
   are the left, and the rail lists what's To confirm.

   This file holds the quote's state, read once and after every change, and
   every act on it. Each edit goes to the route with the version the line
   was read at, so two people never overwrite each other (lines-server.ts);
   the price is read again after every change. */

const ROUTE = "/api/workboard/quote-lines";

/** The quote's state word, for the line under the job's name: settle when
    something is left to settle before it's approved. */
export type QuoteStage = { word: string; settle: boolean };

export type LinesView = {
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
  /** every installed data pack's maker, for a kit's unit (lookups-server.ts) */
  packs?: { key: string; name: string }[];
  /** what marking it did to the job's own materials list */
  onJob?: { added: number; removed: number } | null;
  /** each option's labour by the business's own task hours (task-hours.ts) */
  tasks?: ({ hours: number; words: string; quoted: number } | null)[];
};

/** The quote's kept lines, read once and after every change. */
export function useQuoteLines(job: string, enabled: boolean) {
  const [view, setView] = useState<LinesView | null>(null);
  /* read again on asking: Tiff changed the lines */
  const [rev, setRev] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    fetch(`${ROUTE}?job=${encodeURIComponent(job)}`)
      .then((r) => r.json() as Promise<LinesView>)
      .then((v) => live && setView(v.ok ? v : null))
      .catch(() => live && setView(null));
    return () => {
      live = false;
    };
  }, [job, enabled, rev]);
  const post = async (body: Record<string, unknown>): Promise<LinesView | null> => {
    const r = await fetch(ROUTE, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ job, ...body }) }).catch(() => null);
    const v = r ? ((await r.json().catch(() => null)) as LinesView | null) : null;
    if (v && Array.isArray(v.lines)) setView(v);
    return v;
  };
  return { view, post, reload: () => setRev((n) => n + 1) };
}

/** An option's labour hours as the card counts them: its priced labour
    lines', and the duct contingency's. */
const hoursIn = (lines: QuoteLine[], option: number, contingencyHours: number) =>
  lines.filter((l) => l.optionIndex === option && l.kind === "labour" && !stillUnknown(l)).reduce((n, l) => n + l.qty, 0) + contingencyHours;

export function QuoteLinesFace({
  job,
  price,
  onStage,
  onPriced,
  onToast,
  send,
  sendQuote,
  meta,
  sm8 = null,
  onOpenPaper,
  money: moneyGrant = true,
  start = false,
  openAt = null,
  sendVariation: sendVariationTo,
}: {
  job: string;
  price: QuotePrice | null | undefined;
  /** told the quote's state word, for the line under the job's name */
  onStage?: (stage: QuoteStage | null) => void;
  onToast?: (message: string) => void;
  /** what goes to ServiceM8 once an option is accepted (job-quote-send.tsx) */
  send?: ReactNode;
  /** the approved quote sent to ServiceM8 as a quote, before it's accepted
      (7.3), pinned under Approve: told when it's gone, so the progress line
      says so, and when it went for real, so it says Sent and its day */
  sendQuote?: (onSent: () => void, sentAt: string | null) => ReactNode;
  /** who and where, for the proposal's heading */
  meta?: { title: string; client: string | null; site: string | null; jobNumber: string | null };
  /** ServiceM8's own quote on the job, in the rail's In ServiceM8 (Isaac,
      2026-10-03: "if a quote has been generated in sm8 it should show on
      our quote page") */
  sm8?: Sm8Quote | null;
  onOpenPaper?: (item: JobMediaItem) => void;
  /** the money grant, from the server: until the lines are read the page
      knows no better, and a tech saw the money columns, the book search and
      the corner's buttons flash up on every load */
  money?: boolean;
  /** read the price again: a line changed */
  onPriced: () => void;
  /** opened from the job card to start the quote (?start=1): the reply box takes the keys */
  start?: boolean;
  /** opened on this option (?option=N): a variation Tiff started */
  openAt?: number | null;
  /** an accepted variation's lines to ServiceM8 on the job (decision 21,
      job-quote-send.tsx); without it, nothing is sent */
  sendVariation?: (option: number) => Promise<VariationSendAnswer>;
}) {
  const { view, post, reload } = useQuoteLines(job, true);
  const [at, setAt] = useState(openAt ?? 0);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  /* the proposal, previewed in place of the left (7.1) */
  const [paper, setPaper] = useState(false);
  /* what fills the left while Tiff is on for the business: the
     conversation, or the line items, switched from the rail */
  const [tab, setTab] = useState<"chat" | "lines">("chat");
  /* whether she's on, once her thread is read (what she's cost left the
     rail with layout B, 21 October 2026) */
  const [tiff, setTiff] = useState<{ on: boolean; spentUsd: number | null } | null>(null);
  /* Tiff's questions still open (tiff-panel.tsx) */
  const [asked, setAsked] = useState(0);
  /* Update quote on an approved or accepted quote: what's changing, while it's asked */
  const [updating, setUpdating] = useState<string | null>(null);
  /* a past version, open on the paper (quote-versions.ts) */
  const [viewing, setViewing] = useState<number | null>(null);
  /* the parts she said she'd build, while she builds them (5.2) */
  const [plan, setPlan] = useState<{ option: number; parts: PlannedPart[] } | null>(null);
  /* a line to price from To confirm: its cost box, once the line items are up */
  const pricing = useRef<string | null>(null);
  const [priceAsked, setPriceAsked] = useState(0);
  /* THE LINE ITEMS' GROUPS, OPEN (Isaac, 2026-10-15: "when you hit view
     line items, I think have everything collapsed first… so it doesn't take
     up so much space. Collapsed with the total next to it"): none at
     first, and one opened stays open while the page is up. Kept here, not
     in the line items, which go when the conversation or the paper takes
     their place. */
  const [openGroups, setOpenGroups] = useState<ReadonlySet<string>>(() => new Set());
  const showGroups = (keys: string[], on: boolean) =>
    setOpenGroups((was) => {
      const next = new Set(was);
      for (const k of keys) {
        if (on) next.add(k);
        else next.delete(k);
      }
      return next;
    });

  const lines = (view?.lines ?? []).filter((l) => l.optionIndex === at);
  const options = Math.max(1, ...(view?.lines ?? []).map((l) => l.optionIndex + 1), price && price.ok ? price.options.length : 1);
  const o = price && price.ok ? price.options[at] : undefined;
  const all = view?.lines ?? [];
  /* a tech quotes too, its money hidden (Isaac, 2026-10-12): no prices,
     no pricing, no approving; the conversation and the work are theirs */
  const money = moneyGrant && view?.money !== false;
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
    approvedAt: view?.approved ? (view?.proposal?.approvedAt ?? null) : null,
  });

  /* the left: the conversation or the line items, or the line items alone */
  const chat = tiff?.on === true;
  const linesUp = tiff !== null && (!chat || tab === "lines");

  /* the quote's state word, for the line under the job's name: where it has
     got to, or what's left to settle on the way */
  const unknownNow = toConfirmOf(all, asked);
  const sentForReal = !!view?.sent && !view.sent.trial;
  const stage: QuoteStage | null = !view
    ? null
    : accepted.length > 0
      ? { word: "Accepted", settle: false }
      : sentForReal
        ? { word: "Sent", settle: false }
        : view.approved
          ? { word: "Approved", settle: false }
          : unknownNow > 0
            ? { word: `${unknownNow} to settle`, settle: true }
            : all.length > 0
              ? { word: "Draft", settle: false }
              : { word: "Not started", settle: false };
  const stageKey = stage ? `${stage.word}|${stage.settle}` : "";
  const tellStage = useEffectEvent(() => onStage?.(stage));
  useEffect(() => {
    tellStage();
  }, [stageKey]);

  const act = async (body: Record<string, unknown>) => {
    setBusy(true);
    setNote(null);
    const v = await post(body);
    setBusy(false);
    if (!v) setNote("That didn't save. Try again.");
    else if (!v.ok) setNote(v.reason ?? "That didn't save. Try again.");
    onPriced();
    return v;
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

  /* a line nobody knows the price of, from To confirm: the line items up,
     its group open, then its cost box, in view and ready to type */
  const priceOnLine = (l: QuoteLine) => {
    pricing.current = `What one ${l.name} costs you`;
    setPaper(false);
    setTab("lines");
    showGroups([groupKey(l)], true);
    setPriceAsked((n) => n + 1);
  };
  useEffect(() => {
    const label = pricing.current;
    if (!label) return;
    const box = Array.from(document.querySelectorAll<HTMLInputElement>("input")).find((i) => i.getAttribute("aria-label") === label);
    if (!box) return;
    pricing.current = null;
    box.focus();
    box.scrollIntoView?.({ block: "center" });
  }, [priceAsked]);

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
    if (op === "variation-accept" && accepting) {
      onToast?.(v.onJob?.added ? "The variation's new work is on the job's task list, and its new parts on the materials list" : "The variation's new work is on the job's task list");
      /* accepted: its lines go to ServiceM8 on the original job (decision 21) */
      await sendVariation(option);
    }
  };
  /* AN ACCEPTED VARIATION TO SERVICEM8, as extra lines on the job (Isaac,
     2026-10-18, decision 21): pressed on accepting, and again from the rail
     while it hasn't all gone; what went is kept on the variation */
  const [variationSent, setVariationSent] = useState<{ option: number; error: string | null } | null>(null);
  const sendVariation = async (option: number) => {
    if (!sendVariationTo) return;
    const a = await sendVariationTo(option).catch((): VariationSendAnswer => ({ ok: false, error: "HeyTiff couldn't send that. Nothing went; try again." }));
    setVariationSent({ option, error: a.ok ? (a.failed[0] ?? null) : a.error });
    reload();
    if (a.ok && a.said) onToast?.(a.said);
  };

  const priced = price && price.ok && o ? o : null;
  const left = priced ? leftOn(priced).length > 0 : false;
  /* a variation: every figure the difference it makes to the accepted quote */
  const variation = (view?.variations ?? []).find((v) => v.option === at) ?? null;
  const base = variation?.of ?? 0;
  const baseOpt = variation && price && price.ok ? price.options[variation.of] : undefined;

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
      ...mine.filter((l) => (view?.fits ?? []).some((f) => f.key === l.id && f.state === "misfit")).map((l) => ({ tone: "due" as const, text: `${l.name}: ${(view?.fits ?? []).find((f) => f.key === l.id)!.why}` })),
      ...(oi?.build.loadingNeedsReason ? [{ tone: "due" as const, text: "The loading isn't on the price until it says why" }] : []),
      ...(assumed.length > 0 ? [{ tone: "info" as const, text: `${assumed.length} ${assumed.length === 1 ? "line" : "lines"} assumed` }] : []),
      ...(task ? [{ tone: "info" as const, text: `Your task hours make it ${task.hours} h for ${task.words}; the quote has ${task.quoted} h` }] : []),
      /* the card says the open option's profit; the proposal's review says every option's */
      ...(paper && oi?.profit ? [{ tone: oi.profit.short ? ("due" as const) : ("ok" as const), text: `Profit ${oi.profit.pct}%${oi.profit.targetPct != null ? `, target ${oi.profit.targetPct}%` : ""}` }] : []),
    ];
  };
  /* on the proposal, every option is reviewed before it's approved; on the
     lines, the option open */
  const quoteOptions = Array.from({ length: options }, (_, i) => i).filter((i) => !(view?.variations ?? []).some((v) => v.option === i));
  /* her questions are the conversation's, and the paper stands in its
     place: the review says how many she's still waiting on */
  const hersOpen: Check[] =
    paper && chat && asked > 0 ? [{ tone: "due", text: asked === 1 ? "Tiff's question: not answered yet" : `Tiff's ${asked} questions: not answered yet` }] : [];
  const checks: Check[] = [
    ...hersOpen,
    ...(paper && !variation
      ? quoteOptions.map((i) => checksFor(i).map((c) => (quoteOptions.length > 1 ? { ...c, text: `Option ${i + 1}: ${c.text}` } : c))).flat()
      : checksFor(at)),
  ];
  const confirmTitle = paper ? "Before you approve" : "To confirm";

  /* what the page has to confirm: under Tiff's questions at the foot of the
     conversation, or in the rail where there is none */
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
            {/* confirming an estimate confirms its price: the route takes
                it out of a change from someone who doesn't see money */}
            {c.confirm && money && (
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

  /* the card's figures, for the option open */
  const contingencyHours = (b: { contingency: { hours: number } | null } | undefined) => b?.contingency?.hours ?? 0;
  const card = money ? (
    <QuoteCard
      price={price}
      option={priced ?? undefined}
      label={`${options > 1 ? `Option ${at + 1}, total` : "Total"} ex GST${left ? ", so far" : ""}`}
      left={left}
      hours={hoursIn(all, at, contingencyHours(o?.build))}
      variation={variation && baseOpt ? { n: variation.n, of: baseOpt, hours: hoursIn(all, base, contingencyHours(baseOpt.build)) } : null}
      building={building}
    />
  ) : null;

  const lineItems = (
    <QuoteLineItems
      job={job}
      view={view}
      price={price}
      at={at}
      onOption={setAt}
      options={options}
      money={money}
      busy={busy}
      open={openGroups}
      onGroups={showGroups}
      act={act}
      onCompared={() => {
        reload();
        onPriced();
      }}
      onOpenVersion={(n) => {
        setViewing(n);
        setPaper(true);
      }}
    />
  );

  /* what's left before Approve can be pressed, said once under it (layout
     B, 21 October 2026): her questions still open, and what's left to
     price; a variation is priced as the difference, and may add no labour */
  const toPrice = !priced ? 0 : variation ? priced.unpriced.length : leftOn(priced).length;
  const ready = !!priced && lines.length > 0 && toPrice === 0 && asked === 0;
  const why = [
    asked > 0 ? `${asked} ${asked === 1 ? "question" : "questions"} to answer` : "",
    price && !price.ok ? "Set Quoting to price it" : lines.length === 0 ? "Nothing on this option yet" : toPrice > 0 ? `${toPrice} ${toPrice === 1 ? "line" : "lines"} to price` : "",
  ]
    .filter(Boolean)
    .join(", ");

  /* the approved quote to ServiceM8, pinned under Approve, while nobody has
     accepted it; once it went for real, Sent and its day */
  const sentAt = sentForReal ? (view?.sent?.at ?? null) : null;
  const toSm8 = money && accepted.length === 0 && view?.approved && !variation ? (sendQuote?.(reload, sentAt) ?? null) : null;

  /* the quote's buttons, pinned at the rail's foot: the paper, and the next
     step. Approve quote is the main one (layout B) */
  const actions =
    tiff === null ? null : (
      <QuoteActions
        money={money}
        lines={all.length}
        busy={busy}
        paper={paper}
        back={chat && tab === "chat" ? "Back to the conversation" : "Back to the line items"}
        kept={!!shown}
        variation={variation}
        approved={view?.approved ?? false}
        ready={ready}
        why={why}
        send={toSm8}
        /* the paper as a PDF, once it's approved (api/workboard/quote-pdf) */
        pdf={money && view?.approved && !variation ? `/api/workboard/quote-pdf?job=${encodeURIComponent(job)}` : null}
        /* the client can say yes once it's approved, or on another option */
        acceptable={!!view?.approved || accepted.length > 0}
        update={(accepted.length > 0 || !!view?.approved) && !variation}
        options={options}
        at={at}
        accepted={accepted.includes(at)}
        onView={() => setPaper(true)}
        onBack={() => {
          setPaper(false);
          setViewing(null);
        }}
        onApprove={() => void (variation ? markVariation("variation-approve", variation.option, true) : act({ op: "approve" }))}
        onUpdate={() => setUpdating("")}
        onAccept={() => void (variation ? markVariation("variation-accept", variation.option, !variation.acceptedAt) : accept())}
      />
    );

  return (
    <>
      <div className="qc-body">
        <div className="qc-main">
          {note && <p className="wb2-sherr qc-note">{note}</p>}
          {/* mounted whatever is up: her work lands, and the page learns
              whether she's on, from here */}
          <TiffPanel
            job={job}
            hidden={paper || tab !== "chat"}
            start={start}
            onStatus={setTiff}
            onOpen={setAsked}
            onPlan={setPlan}
            /* behind the paper, the review is the rail's */
            confirm={paper ? null : confirm}
            confirmTitle={confirmTitle}
            onChanged={() => {
              reload();
              onPriced();
            }}
          />
          {paper ? (
            <div className="hd-face qp-face ql-face qc-fill">
              <div className="lp-desk">
                {shown ? (
                  <VersionPaper version={shown} jobNumber={meta?.jobNumber ?? null} client={meta?.client ?? null} />
                ) : variation && priced && baseOpt ? (
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
                ) : (
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
                )}
              </div>
            </div>
          ) : (
            linesUp && (
              <div className="qc-lines">
                <div className="hd-face qp-face ql-face">{lineItems}</div>
              </div>
            )
          )}
        </div>
        {/* UPDATE QUOTE (the old-modals mock, 27 October 2026): the v2
            Dialog, portalled to the body so it darkens the whole page */}
        <Dialog
          open={updating != null}
          heading="Update quote"
          width={560}
          onClose={() => setUpdating(null)}
          foot={
            <>
              <Button kind="quiet" disabled={busy} onClick={() => setUpdating(null)}>
                Cancel
              </Button>
              {accepted.length > 0 ? (
                <Button kind="main" disabled={busy || !updating?.trim()} onClick={() => void startVariation((updating ?? "").trim())}>
                  {`Start variation ${(view?.variations ?? []).reduce((m, v) => Math.max(m, v.n), 0) + 1}`}
                </Button>
              ) : (
                <Button kind="main" disabled={busy || !updating?.trim()} onClick={() => void startVersion((updating ?? "").trim())}>
                  {`Start version ${version + 1}`}
                </Button>
              )}
            </>
          }
        >
          <div className="ql-vbody">
            <p>
              {accepted.length > 0
                ? `${options > 1 ? `Option ${(accepted[0] ?? 0) + 1}` : "The quote"} is accepted, so this is a variation. The accepted quote stays as it is. The variation is priced as the difference, and the client approves it on its own.`
                : `The quote is approved, so this is version ${version + 1}. Version ${version} is kept as it stands, the approval comes off, and it goes back through Approve and Send.`}
            </p>
            <Field label="What's changing">
              <TextArea className="ql-vwhat" rows={3} value={updating ?? ""} data-autofocus disabled={busy} onChange={(e) => setUpdating(e.target.value)} />
            </Field>
          </div>
        </Dialog>
        <QuoteRail
          progress={<QuoteStepsLine steps={steps} />}
          actions={actions}
          lines={
            tiff !== null && chat ? (
              <LinesButton
                up={linesUp && !paper}
                onLines={() => {
                  setPaper(false);
                  setViewing(null);
                  setTab(linesUp && !paper ? "chat" : "lines");
                }}
              />
            ) : null
          }
          /* the conversation holds what's to confirm, except where there is
             none, or the paper is up in its place: before approving, the
             review stands beside the paper (11.1) */
          confirm={tiff !== null && (!chat || paper) ? confirm : null}
          confirmTitle={confirmTitle}
          card={card}
          building={building}
          send={
            <>
              {money && variation && (
                <VariationSm8
                  variation={variation}
                  error={variationSent?.option === variation.option ? variationSent.error : null}
                  onSend={() => sendVariation(variation.option)}
                />
              )}
              {money && accepted.length > 0 && !variation && send}
            </>
          }
          sm8={
            <InServiceM8
              sm8={sm8}
              href={sm8JobUrl(job)}
              ours={sentAt ? { at: sentAt, value: money && options === 1 && o ? `${cents2(o.build.incGstCents)} inc GST` : null } : null}
              onOpenPaper={onOpenPaper}
            />
          }
        />
      </div>
    </>
  );
}
