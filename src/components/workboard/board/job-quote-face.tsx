"use client";

import { fmtAud } from "@/lib/workboard/project-money";
import Link from "next/link";
import { Fragment, useEffect, useEffectEvent, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { NoteToken } from "@/components/notes/note-token";
import { Waiting } from "@/components/ui/orb";
import { Icon } from "@/components/shell/icon";
import { fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import type { JobMediaItem } from "@/lib/workboard/job-media";
import { DocRow } from "./job-documents-face";
import {
  MAX_CREW,
  MAX_UNIT_QTY,
  MAX_UNITS,
  MAX_VISIT_DAYS,
  MAX_VISITS,
  PRICING_WORDS,
  UNIT_ROLES,
  acceptedAfterRemoving,
  blankUnit,
  optionHeading,
  proposalTitle,
  removeUnit,
  setUnitRole,
  statusAfterChange,
  toggleAccepted,
  unitPlace,
  unitWords,
  type OptionLabour,
  type ProposalDraft,
  type ProposalOption,
  type UnitLine,
  type UnitRole,
} from "@/lib/quotes/proposal";
import { VISIT_STAGES, type Visit, type VisitStage } from "@/lib/quotes/buildup";
import type { QuoteLabour } from "@/lib/quotes/quote-labour-server";
import {
  CHECKLIST,
  asksByImpact,
  type CheckItem,
  type ChecklistKey,
} from "@/lib/quotes/checklist";
import {
  PAYMENT_PRESET_KEYS,
  paymentProblems,
  suggestedDeposit,
  type PaymentPreset,
  type PaymentStage,
} from "@/lib/quotes/payment";
import type { StoredProposal } from "@/lib/quotes/proposal-writer";
import type { QuotePrice } from "@/lib/quotes/quote-price-server";
import { quoteSteps, type StepKey } from "@/lib/quotes/quote-steps";
import { PriceLines, PriceSummary, QuoteStepsLine, leftOn, priceState } from "../quote/quote-parts";
import { STANDARD_NOTES, standardTemplates, type PaymentTerms, type QuoteNote } from "@/lib/templates/settings";
import { withCleanup } from "@/lib/ui/with-cleanup";

/* THE QUOTE FACE — a proposal draft on the skeleton, with Tiff as supervisor.

   THE SITE CHECKLIST STANDS FIRST. It is what has to be settled before the
   proposal can go out: the drain, the covering and its colour, the power,
   the height, home or business. Tiff asks one question at a time with the
   usual answers as one press each; an answer is saved on the spot, with no
   model call, and Tiff folds the answers into the scope by itself at the
   next pause (Isaac, 2026-10-06: "Put them in shouldn't be a button"); the
   price follows each answer at once. The topics and their questions are fixed (lib/quotes/checklist),
   so every job is asked the same way.

   THE BLOCKS FOLLOW THE SKELETON (lib/quotes/proposal): title, intro, why
   this system, the options with their units room by room, pricing with its
   extras and allowances, payment, and the notes this job needs beyond the
   standard ones. Each has Edit. Nothing is copied out: the proposal goes to
   the client and to ServiceM8 as a whole, from here.

   ONE BOX DRAFTS AND ONE BOX CHANGES. Before there is a draft the box is
   what was said on site; after, it is what to change. Start again brings the
   first box back with its words in it; the draft stays until a new one
   replaces it. */

type Block = "intro" | "why" | "pricing" | "payment" | "notes" | `option-${number}`;
/** The business's own notes and payment terms (Admin → Templates → Quote). */
type QuoteTemplates = { notes: QuoteNote[]; terms: PaymentTerms };
const STANDARD = standardTemplates();
const STANDARD_QUOTE: QuoteTemplates = { notes: STANDARD.quoteNotes, terms: STANDARD.paymentTerms };

/** A note on a draft, from the business's list; a quote drafted before a
    note was taken off the list still shows it, from the standard wording. */
const noteFor = (t: QuoteTemplates, key: string): QuoteNote | null =>
  t.notes.find((n) => n.key === key) ?? STANDARD_NOTES.find((n) => n.key === key) ?? null;

type Answer =
  | {
      ok: true;
      proposal: StoredProposal | null;
      templates?: QuoteTemplates;
      sm8Brief?: string | null;
      showLines?: boolean;
      /** the brief's labour, beside each option */
      labour?: QuoteLabour | null;
    }
  /** `proposal` comes back when the draft moved on underneath the change */
  | { ok: false; reason: string; proposal?: StoredProposal | null };
/** A person's edit, applied to the draft as it stands when its turn comes. */
type Edit = (draft: ProposalDraft) => ProposalDraft;

const ROUTE = "/api/workboard/quote-draft";
/* how long after the last answer Tiff puts the answers in: at once when
   nothing is left to ask or the person stepped away from the questions,
   after a pause while they're still answering */
const APPLY_SOON_MS = 1200;
const APPLY_WHILE_ASKING_MS = 8000;

/** The labour an answer carries: a call, so a write's try/catch holds no
    value block React Compiler 1.0 can't lower. */
const labourIn = (a: Answer): QuoteLabour | null => (a.ok ? (a.labour ?? null) : null);

const whenOf = (iso: string) =>
  new Date(iso).toLocaleDateString("en-AU", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "Australia/Sydney",
  });

const linesOf = (text: string) =>
  text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

/** "Name, detail" per line, split on the first comma or spaced dash. */
const namedOf = (text: string) =>
  linesOf(text).map((l) => {
    const m = /^(.*?)\s*(?:,|\s[-–]\s)\s*(.*)$/.exec(l);
    return m ? { name: m[1]!, detail: m[2]! } : { name: l, detail: "" };
  });
const namedText = (xs: readonly { name: string; detail: string }[]) =>
  xs.map((x) => (x.detail ? `${x.name}, ${x.detail}` : x.name)).join("\n");

/** ServiceM8's own quote on the job: the PDF it generated, the day it went,
    and what it came to for a reader who sees money. */
export type Sm8Quote = {
  papers: JobMediaItem[];
  sentOn: string | null;
  /** Already worded, "$45,430 inc GST"; null without the money grant. */
  value: string | null;
  /** The same, as money, on the basis ServiceM8 holds it; null without the
      money grant. */
  quoted?: { cents: number; basis: "ex" | "inc" } | null;
};

export function JobQuoteFace({
  job,
  address,
  visible,
  onToast,
  sm8 = null,
  onOpenPaper,
  onJobMaterials,
  children,
  mode = "card",
  onVersion,
  onCancel,
  price,
  actionsEl = null,
  send = null,
}: {
  /** The job card's uuid, or the row's until the record read lands. */
  job: string;
  address: string | null;
  /** Read the stored draft only once the tab is opened. */
  visible: boolean;
  onToast: (message: string) => void;
  /** The quote ServiceM8 generated, when there is one (Isaac, 2026-10-03:
      "if a quote has been generated in sm8 it should show on our quote
      page"). */
  sm8?: Sm8Quote | null;
  onOpenPaper?: (item: JobMediaItem) => void;
  /** The builder's own sections (its labour and price), shown only while
      the quote is open. */
  children?: ReactNode;
  /** The job's own materials list changed (an accepted option went on it). */
  onJobMaterials?: () => void;
  /** "card": the job card's small face — ServiceM8's quote, where HeyTiff's
      stands, and the button into the quote page. "page": the quote page's
      builder, open from the start (Isaac, 2026-10-05: "it should have
      opened up the proper quote screen not a section below"). */
  mode?: "card" | "page";
  /** The page: the quote's version each time it changes, for the sections
      beside the builder to read it afresh. */
  onVersion?: (version: string | null) => void;
  /** The page: leaving the box that drafts one, with nothing drafted. */
  onCancel?: () => void;
  /** The page: the quote priced, read by the page for each version;
      undefined without the money grant or until it's read. */
  price?: QuotePrice | null;
  /** The page: where its corner buttons go, in the band beside the title. */
  actionsEl?: HTMLElement | null;
  /** The page: what goes to ServiceM8 once an option is accepted. */
  send?: ReactNode;
}) {
  /* THE QUOTE OPENS FROM ONE BUTTON (Isaac, 2026-10-05): "Create a quote"
     when there is none, "Continue quote" on a draft, and on a job quoted in
     ServiceM8 — whose quote shows first — "Update ServiceM8 quote", which
     starts the builder from what that quote says. */
  const sm8Quoted = !!sm8 && (sm8.papers.length > 0 || !!sm8.sentOn);
  const [open, setOpen] = useState(mode === "page");
  const [sm8Brief, setSm8Brief] = useState<string | null>(null);
  /* the business's own default for what the customer sees */
  const [linesByDefault, setLinesByDefault] = useState(false);
  /* the page: which face, which option the list reads, and which topic the
     questions are on (a topic opened from What Tiff read stays open) */
  const [tab, setTab] = useState<"build" | "proposal">("build");
  const [pick, setPick] = useState(0);
  const [on, setOn] = useState<{ key: ChecklistKey | null; chosen: boolean } | null>(null);
  const questionsAt = useRef<HTMLElement | null>(null);
  /* a question asked for from anywhere is scrolled to once its face shows:
     from the Proposal, the Build-up is still hidden when it's asked for */
  const [toQuestions, setToQuestions] = useState(0);
  useEffect(() => {
    if (toQuestions) questionsAt.current?.scrollIntoView?.({ block: "start", behavior: "smooth" });
  }, [toQuestions]);
  /* on the page, ServiceM8's quote sits beside the builder, not in it */
  const sm8Block = sm8Quoted && mode === "card" ? (
    <div className="wb2-jcsec">
      <div className="wb2-jcdhead">
        <b>Quote from ServiceM8</b>
        <em>{[sm8!.sentOn ? `Sent ${fmtAuWeekdayDayMonth(sm8!.sentOn)}` : "Not sent yet", sm8!.value].filter(Boolean).join(", ")}</em>
      </div>
      {sm8!.papers.map((p) => (
        <DocRow key={p.remoteId} item={p} onOpen={(item) => onOpenPaper?.(item)} />
      ))}
    </div>
  ) : null;
  const [loaded, setLoaded] = useState<StoredProposal | null | undefined>(undefined);
  const [readFailed, setReadFailed] = useState(false);
  const [brief, setBrief] = useState("");
  const [change, setChange] = useState("");
  const [redraft, setRedraft] = useState(false);
  const [working, setWorking] = useState<"draft" | "change" | "apply" | "labour" | null>(null);
  /* the brief's labour, read with the draft; and why a suggestion couldn't be had */
  const [labourFacts, setLabourFacts] = useState<QuoteLabour | null>(null);
  const [labourError, setLabourError] = useState<string | null>(null);
  /* the option whose Suggest labour was pressed: its row waits and says why */
  const [labourAt, setLabourAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  /* why Tiff couldn't put the answers in, and on which version */
  const [applyFailed, setApplyFailed] = useState<{ at: string | null; reason: string } | null>(null);
  const [editing, setEditing] = useState<Block | null>(null);
  const [reads, setReads] = useState(0);
  const [tpl, setTpl] = useState<QuoteTemplates>(STANDARD_QUOTE);
  const asked = useRef(-1);
  /* The draft as the server last said it is, and the saves in flight, one
     behind the other: two answers pressed in a second each build on the one
     before, rather than both on the same old copy. */
  const latest = useRef<StoredProposal | null>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  const land = (p: StoredProposal | null) => {
    /* a reply that comes back after a newer save landed is behind it: Tiff
       putting answers in while the next one was saved */
    const held = latest.current;
    if (p && held && p.cardId === held.cardId && Date.parse(p.updatedAt) < Date.parse(held.updatedAt)) return;
    latest.current = p;
    setLoaded(p);
  };

  useEffect(() => {
    if (!visible || asked.current === reads) return;
    asked.current = reads;
    fetch(`${ROUTE}?job=${encodeURIComponent(job)}`)
      .then((r) => r.json() as Promise<Answer>)
      .then((a) => {
        if (!a.ok) throw new Error(a.reason);
        setReadFailed(false);
        if (a.templates) setTpl(a.templates);
        latest.current = a.proposal;
        setLoaded(a.proposal);
        setSm8Brief(a.sm8Brief ?? null);
        setLabourFacts(a.labour ?? null);
        setLinesByDefault(a.showLines === true);
        if (a.proposal) setBrief(a.proposal.brief);
      })
      /* NOT the draft box: drafting on a read that failed would pay for a
         new proposal over the one that couldn't be read */
      .catch(() => setReadFailed(true));
  }, [visible, job, reads]);

  /* The page opens on the box that drafts one, and ServiceM8's quote is
     what a new version starts from. Filled once both are known — the draft
     read and whether ServiceM8 quoted the job land in either order — and
     never over words already typed. */
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || mode !== "page" || loaded !== null || !sm8Quoted || !sm8Brief) return;
    seeded.current = true;
    setBrief((b) => b || sm8Brief);
  }, [mode, loaded, sm8Quoted, sm8Brief]);

  const version = loaded?.updatedAt ?? null;
  useEffect(() => {
    onVersion?.(version);
  }, [version, onVersion]);

  /* Tiff's labour for each option, on a draft written before Tiff made one */
  const suggestLabour = async (at: number) => {
    if (working) return;
    setWorking("labour");
    setLabourAt(at);
    setLabourError(null);
    await withCleanup(async () => {
      try {
        const res = await fetch(ROUTE, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ job, suggestLabour: true }),
        });
        const a = (await res.json()) as Answer;
        if (!a.ok) {
          setLabourError(a.reason);
          if (a.proposal) land(a.proposal);
          return;
        }
        land(a.proposal);
        setLabourFacts(labourIn(a));
      } catch {
        setLabourError("Tiff couldn't be reached. Try again.");
      }
    }, () => setWorking(null));
  };

  const write = async (kind: "draft" | "change" | "apply") => {
    const words = kind === "draft" ? brief : change;
    if ((kind !== "apply" && !words.trim()) || working) return;
    setWorking(kind);
    setError(null);
    /* chosen out here, not inside the try below: React Compiler 1.0 cannot
       lower a ternary inside a try/catch, and gives up on the whole
       component when it meets one */
    const ask =
      kind === "draft"
        ? { job, brief: words, replace: redraft }
        : kind === "change"
          ? { job, change: words }
          : { job, apply: true };
    await withCleanup(async () => {
      /* the call alone inside the try: the compiler can't lower a logical
         expression inside a try/catch either */
      let a: Answer | null;
      try {
        const res = await fetch(ROUTE, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(ask),
        });
        a = (await res.json()) as Answer;
      } catch {
        a = null;
      }
      if (!a) {
        if (kind === "apply") setApplyFailed({ at: version, reason: "Tiff couldn't be reached." });
        else setError("Tiff couldn't be reached. Try again.");
        return;
      }
      if (!a.ok && kind === "apply") {
        /* moved on underneath (a person's edit): the next pause tries again
           on what's there now; anything else waits for the next answer */
        if (a.proposal) land(a.proposal);
        else setApplyFailed({ at: version, reason: a.reason });
        return;
      }
      if (!a.ok) {
        setError(a.reason);
        if (a.proposal) {
          land(a.proposal);
          setRedraft(false);
        }
        return;
      }
      land(a.proposal);
      setApplyFailed(null);
      /* a new brief can give labour, or stop giving it: read with the draft */
      setLabourFacts(labourIn(a));
      setLabourError(null);
      if (kind === "apply") return;
      setRedraft(false);
      setEditing(null);
      /* a new draft asks its own questions: none held open from the last */
      if (kind === "draft") setOn(null);
      if (kind === "change") setChange("");
    }, () => setWorking(null));
  };

  /* THE ANSWERS GO IN BY THEMSELVES (Isaac, 2026-10-06: "Put them in
     shouldn't be a button. It's supposed to dynamically add in the costs").
     An answer moves the price the moment it's saved; Tiff writes it into
     the scope at the next pause, and answering goes on while it writes. Not
     under an open editor, and not again on a version it already failed on. */
  const fresh = loaded ? loaded.draft.checklist.filter((i) => i.fresh).length : 0;
  const openAsks = loaded ? asksByImpact(loaded.draft.checklist).length : 0;
  const putAnswersIn = useEffectEvent(() => void write("apply"));
  useEffect(() => {
    if (mode !== "page" || redraft || fresh === 0 || working !== null || editing !== null) return;
    if (applyFailed && applyFailed.at === version) return;
    const answering = openAsks > 0 && on?.key !== null;
    const t = setTimeout(putAnswersIn, answering ? APPLY_WHILE_ASKING_MS : APPLY_SOON_MS);
    return () => clearTimeout(t);
  }, [mode, redraft, fresh, working, editing, applyFailed, version, openAsks, on]);

  /** An edit to the draft. Any edit but the quote's own status takes an
      approval back: an approval is of the version on screen. */
  const save = (edit: Edit, keepStatus = false, rebase = false): Promise<boolean> => {
    /* `rebase`: an answer is the same answer on a copy that moved on under
       it (Tiff putting the last ones in), so it's made again there once */
    const attempt = async (again: boolean): Promise<boolean> => {
      const base = latest.current;
      if (!base) return false;
      const edited = edit(base.draft);
      const next = !keepStatus && edited.status?.approvedAt ? { ...edited, status: statusAfterChange(edited.status) } : edited;
      /* the call alone inside the try: React Compiler 1.0 can't lower a
         conditional call inside a try/catch */
      let a: Answer | null;
      try {
        const res = await fetch(ROUTE, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ job, draft: next, base: base.updatedAt }),
        });
        a = (await res.json()) as Answer;
      } catch {
        a = null;
      }
      if (!a) {
        onToast("The edit couldn't be saved. Try again.");
        return false;
      }
      if (a.ok) {
        land(a.proposal);
        return true;
      }
      if (a.proposal) land(a.proposal);
      if (again && a.proposal) return attempt(false);
      onToast(a.reason);
      return false;
    };
    const run = () => attempt(rebase);
    const next = queue.current.then(run, run);
    queue.current = next;
    return next;
  };

  /* Marking an option accepted puts its materials on the job's own list
     (Isaac, 2026-10-05: "whichever one is accepted… will then turn into the
     materials list for the job"). */
  const accept = async (i: number) => {
    const marking = !(latest.current?.draft.accepted ?? []).includes(i);
    const ok = await save((d) => ({ ...d, accepted: toggleAccepted(d, i) }), true);
    if (!ok || !marking) return;
    /* the call alone inside the try: React Compiler 1.0 can't lower a
       conditional or an optional call inside a try/catch */
    let a: { ok: true; added: number; removed: number } | { ok: false; reason: string };
    try {
      const res = await fetch(ROUTE, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ job, toJob: true }) });
      a = (await res.json()) as typeof a;
    } catch {
      a = { ok: false, reason: "The job's materials couldn't be changed. Try again." };
    }
    if (!a.ok) return onToast(a.reason);
    onJobMaterials?.();
    onToast(a.added || a.removed ? "The accepted option's materials are on the job's list" : "The job's list already has the accepted option's materials");
  };

  /** A block's own Save: closes that block's editor when it lands, and
      leaves any other editor open with its words in it. */
  const saveBlock = (block: Block, edit: Edit) =>
    save(edit).then((ok) => {
      if (ok) setEditing((open) => (open === block ? null : open));
      return ok;
    });

  if (readFailed && loaded === undefined) {
    return (
      <div className={mode === "page" ? "hd-body qp-face wb2-jcsec wb2-jq" : "wb2-jcsec wb2-jq"}>
        <p className="wb2-sherr">The saved proposal couldn&rsquo;t be read.</p>
        <div className="wb2-jqacts">
          <button type="button" className="pbtn ghost" onClick={() => setReads((n) => n + 1)}>
            Try again
          </button>
        </div>
      </div>
    );
  }
  if (loaded === undefined)
    return mode === "page" ? (
      <div className="hd-body qp-face">
        <Waiting note="Reading the proposal" />
      </div>
    ) : (
      <Waiting note="Reading the proposal" />
    );

  const proposal = loaded;
  /* the card's face: the way into the page, never the builder itself */
  if (mode === "card") {
    const asks = proposal ? asksByImpact(proposal.draft.checklist).length : 0;
    return (
      <>
        {sm8Block}
        {proposal && (
          <div className="wb2-jcsec">
            <div className="wb2-jcdhead">
              <b>Quote</b>
              <em>
                {proposal.changes.length ? "Changed" : "Drafted"} {whenOf(proposal.updatedAt)}
                {asks ? `, ${asks} to ask` : ""}
              </em>
            </div>
          </div>
        )}
        <div className="wb2-jqacts">
          <Link className={proposal ? "pbtn primary" : "pbtn ghost"} href={`/dashboard/workboard/quotes/${encodeURIComponent(job)}`}>
            {!proposal && <Icon name="plus" size={15} />}
            {proposal ? "Continue quote" : sm8Quoted ? "Update ServiceM8 quote" : "Create a quote"}
          </Link>
        </div>
      </>
    );
  }
  if (!open) {
    const start = () => {
      /* ServiceM8's quote is the brief a new version starts from */
      if (!proposal && sm8Quoted) setBrief((b) => b || sm8Brief || "");
      setOpen(true);
    };
    return (
      <>
        {sm8Block}
        {proposal && (
          <div className="wb2-jcsec">
            <div className="wb2-jcdhead">
              <b>Quote</b>
              <em>
                {proposal.changes.length ? "Changed" : "Drafted"} {whenOf(proposal.updatedAt)}
              </em>
            </div>
          </div>
        )}
        <div className="wb2-jqacts">
          <button type="button" className={proposal ? "pbtn primary" : "pbtn ghost"} onClick={start}>
            {!proposal && <Icon name="plus" size={15} />}
            {proposal ? "Continue quote" : sm8Quoted ? "Update ServiceM8 quote" : "Create a quote"}
          </button>
        </div>
      </>
    );
  }
  /* ── THE QUOTE PAGE (Isaac, 2026-10-06, the mock-up he called "much
     cleaner"): Home's frame. The progress line where Home has "Your day",
     the corner button its next step, then Build-up and Proposal. Build-up
     reads down the page: what Tiff took from the brief, the questions,
     what each option is made of, its labour, and the box that changes it.
     Proposal is the client's paper, every block editable. The list on the
     right is Home's: the price at its top, then what's left to answer and to
     price, in their colours. ── */
  const draftNow = !proposal || redraft ? null : proposal.draft;
  const names = draftNow ? draftNow.options.map((_, i) => optionHeading(draftNow, i)) : [];
  const at = draftNow && pick < draftNow.options.length ? pick : 0;
  const priced = price?.ok ? price.options[at] : undefined;
  /* starting again leaves the quote where it is until the new draft lands */
  const { steps, next } = quoteSteps({
    draft: proposal?.draft ?? null,
    drafted: proposal ? { at: proposal.updatedAt, changed: proposal.changes.length > 0 } : null,
    price: priceState(price),
    when: whenOf,
  });
  const busy = working !== null;
  /* Tiff putting answers in never stops the questions */
  const asking = working !== null && working !== "apply";

  /* approved and sent, by hand; Undo takes back the last one marked */
  const mark = (step: "approve" | "sent") =>
    save((d) => {
      const now = new Date().toISOString();
      const was = d.status ?? { approvedAt: null, sentAt: null };
      return { ...d, status: step === "approve" ? { ...was, approvedAt: now } : { ...was, sentAt: now } };
    }, true).then((ok) => ok && onToast(step === "approve" ? "Quote approved" : "Quote marked sent"));
  const undo = (key: StepKey) =>
    void save((d) => {
      const was = d.status ?? { approvedAt: null, sentAt: null };
      const left = key === "approved" ? { ...was, approvedAt: null } : { ...was, sentAt: null };
      return { ...d, status: left.approvedAt || left.sentAt ? left : null };
    }, true);
  /* a question opened from anywhere: the topic, on the Build-up, in view */
  const choose = (key: ChecklistKey) => {
    setOn({ key, chosen: true });
    setTab("build");
    setToQuestions((n) => n + 1);
  };

  const sm8Group = sm8Quoted ? (
    <section className="hd-ls-g" aria-label="Quote from ServiceM8">
      <h2 className="hd-ls-grp">Quote from ServiceM8</h2>
      <p className="qp-sm8">{[sm8!.sentOn ? `Sent ${fmtAuWeekdayDayMonth(sm8!.sentOn)}` : "Not sent yet", sm8!.value].filter(Boolean).join(", ")}</p>
      {sm8!.papers.map((p) => (
        <DocRow key={p.remoteId} item={p} onOpen={(item) => onOpenPaper?.(item)} />
      ))}
    </section>
  ) : null;

  const frame = (flow: ReactNode, paper: ReactNode, rail: ReactNode, actions: ReactNode) => (
    <>
      {actionsEl && actions ? createPortal(actions, actionsEl) : null}
      <section className="hd-day" aria-label="Where the quote is">
        <QuoteStepsLine steps={steps} onUndo={draftNow ? undo : undefined} />
      </section>
      <div className="hd-body">
        {paper && (
          <div className="hd-tabs" role="tablist" aria-label="Quote">
            {(["build", "proposal"] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                className={tab === t ? "hd-tab on" : "hd-tab"}
                onClick={() => setTab(t)}
              >
                {t === "build" ? "Build-up" : "Proposal"}
                <span className="hd-tabw" aria-hidden="true">
                  {t === "build" ? "Build-up" : "Proposal"}
                </span>
              </button>
            ))}
          </div>
        )}
        <div className="hd-fx">
          <div className="hd-main">
            <div className="hd-col">
              <div className="hd-face qp-face" role={paper ? "tabpanel" : undefined} aria-label="Build-up" hidden={!!paper && tab !== "build"}>
                {flow}
              </div>
              {paper && (
                <div className="hd-face qp-face" role="tabpanel" aria-label="Proposal" hidden={tab !== "proposal"}>
                  {paper}
                </div>
              )}
            </div>
            {rail && (
              <aside className="hd-list qp-rail" aria-label="The price and what's open">
                {rail}
              </aside>
            )}
          </div>
        </div>
      </div>
    </>
  );

  if (!proposal || redraft) {
    const box = (
      <section className="qp-sec" aria-labelledby="qp-brief-h">
        <h2 className="qp-h" id="qp-brief-h">
          {proposal ? "Start the proposal again" : sm8Quoted ? "Update ServiceM8 quote" : "Create a quote"}
        </h2>
        <NoteToken
          as="field"
          label="what the job is"
          offer={false}
          rows={8}
          value={brief}
          onChange={setBrief}
          disabled={working !== null}
          placeholder="What's the job? The unit, where each part goes, and how the pipes, drain and power get there."
        />
        {error && <p className="wb2-sherr">{error}</p>}
        <div className="wb2-jqacts">
          {working === "draft" ? (
            <Waiting note="Drafting the proposal" />
          ) : (
            <>
              <button type="button" className="pbtn primary" disabled={!brief.trim()} onClick={() => void write("draft")}>
                Draft proposal
              </button>
              {proposal && (
                <button type="button" className="pbtn ghost" onClick={() => setRedraft(false)}>
                  Keep this draft
                </button>
              )}
              {!proposal && (
                <button type="button" className="pbtn ghost" onClick={() => (onCancel ? onCancel() : setOpen(false))}>
                  Cancel
                </button>
              )}
            </>
          )}
        </div>
      </section>
    );
    return frame(box, null, sm8Group, null);
  }

  const { draft } = proposal;
  const title = proposalTitle(address);
  const asks = asksByImpact(draft.checklist);
  const known = draft.checklist.filter((i) => i.state !== "ask");
  const left = priced ? leftOn(priced) : [];
  const totals: OptionTotal[] | null = price?.ok
    ? price.options.map((o) => ({ cents: o.build.exGstCents, incCents: o.build.incGstCents, left: leftOn(o).length }))
    : null;

  const actions = (
    <>
      {tab !== "proposal" && (
        <button type="button" className="pbtn ghost" onClick={() => setTab("proposal")}>
          Preview proposal
        </button>
      )}
      {draft.accepted.length === 0 && (
        <button
          type="button"
          className={next === "accepted" ? "pbtn primary" : "pbtn ghost"}
          disabled={busy}
          onClick={() => (draft.options.length === 1 ? void accept(0) : setTab("proposal"))}
        >
          Mark accepted
        </button>
      )}
      {next === "approve" && (
        <button type="button" className="pbtn primary" disabled={busy || fresh > 0} onClick={() => void mark("approve")}>
          Approve
        </button>
      )}
      {next === "sent" && (
        <button type="button" className="pbtn primary" disabled={busy || fresh > 0} onClick={() => void mark("sent")}>
          Mark sent
        </button>
      )}
    </>
  );

  const flow = (
    <>
      <section className="qp-sec" aria-labelledby="qp-read-h">
        <div className="qp-sh">
          <h2 className="qp-h" id="qp-read-h">
            What Tiff read
          </h2>
          <button type="button" className="pbtn ghost sm" disabled={busy} onClick={() => setRedraft(true)}>
            Start again
          </button>
        </div>
        <BriefWords text={proposal.brief} />
        {known.length > 0 && (
          <ul className="qp-read" aria-label="What Tiff took from it">
            {known.map((i) => (
              <li key={i.key} className={i.state === "na" ? "na" : undefined}>
                <span>{CHECKLIST[i.key].label}</span>
                <span>{i.answer}</span>
                <button
                  type="button"
                  className="pbtn ghost sm"
                  aria-label={`Change ${CHECKLIST[i.key].label}`}
                  disabled={asking}
                  onClick={() => choose(i.key)}
                >
                  Change
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="qp-sec" ref={questionsAt} aria-label="Questions">
        <SiteChecklist
          items={draft.checklist}
          on={on}
          setOn={setOn}
          busy={asking}
          applying={working === "apply"}
          failed={applyFailed?.reason ?? null}
          onAnswer={(key, answer) =>
            save(
              (d) => ({
                ...d,
                /* keeps the question it was asked with, for its Change */
                checklist: d.checklist.map((i) => (i.key === key ? { ...i, state: "known", answer, fresh: true, rank: undefined } : i)),
              }),
              false,
              true
            )
          }
          onSkip={(key) =>
            save(
              (d) => ({
                ...d,
                checklist: d.checklist.map((i) => (i.key === key ? { ...i, state: "na", answer: "Not needed on this job", rank: undefined } : i)),
              }),
              false,
              true
            )
          }
          onRetry={() => void write("apply")}
        />
      </section>

      {priced && (
        <section className="qp-sec" aria-labelledby="qp-in-h">
          <h2 className="qp-h" id="qp-in-h">
            What&rsquo;s in it
          </h2>
          {draft.options.length > 1 && <p className="qp-sub">{names[at]}</p>}
          <PriceLines option={priced} />
        </section>
      )}

      <section className="qp-sec" aria-labelledby="qp-lab-h">
        <h2 className="qp-h" id="qp-lab-h">
          Labour
        </h2>
        {draft.options.map((o, i) => (
          <OptionLabourRow
            key={i}
            option={o}
            heading={names[i]!}
            label={draft.options.length > 1 ? names[i]! : null}
            facts={labourFacts}
            disabled={busy}
            suggesting={working === "labour" && labourAt === i}
            error={labourAt === i ? labourError : null}
            onSet={(labour) =>
              save((d) => ({ ...d, options: d.options.map((x, j) => (j === i ? { ...x, labour } : x)) })).then((ok) => {
                if (ok) setLabourError(null);
                return ok;
              })
            }
            onSuggest={() => void suggestLabour(i)}
          />
        ))}
      </section>

      <section className="qp-sec" aria-labelledby="qp-change-h">
        <h2 className="qp-h" id="qp-change-h">
          Change the proposal
        </h2>
        <NoteToken
          as="field"
          label="what to change"
          offer={false}
          rows={3}
          value={change}
          onChange={setChange}
          disabled={busy}
          placeholder="Add a second option with the outdoor unit on the ground. Or ask which option is better."
        />
        {error && <p className="wb2-sherr">{error}</p>}
        <div className="wb2-jqacts">
          {working === "change" ? (
            <Waiting note="Changing the proposal" />
          ) : (
            <button type="button" className="pbtn primary" disabled={!change.trim() || busy} onClick={() => void write("change")}>
              Make the change
            </button>
          )}
        </div>
      </section>
      {/* the builder's sections read the quote afresh each time it changes */}
      <Fragment key={proposal.updatedAt}>{children}</Fragment>
    </>
  );

  const paper = (
    <div className="qp-desk">
      <article className="qp-paper" aria-label="The proposal">
        <div className="wb2-jcsec wb2-jq">
          <div className="wb2-jcdhead">
            <b>Proposal</b>
            <em>
              {proposal.changes.length ? "Changed" : "Drafted"} {whenOf(proposal.updatedAt)}
            </em>
          </div>
          <p className="wb2-jqtitle">{title}</p>
        </div>

        <QuoteBlock title="Intro" onEdit={() => setEditing("intro")} editing={editing === "intro"}>
          {editing === "intro" ? (
            <TextEdit
              label="the intro"
              value={draft.intro}
              word="Save intro"
              onCancel={() => setEditing(null)}
              onSave={(intro) => saveBlock("intro", (d) => ({ ...d, intro }))}
            />
          ) : (
            <p className="wb2-shtext wb2-jcread">{draft.intro}</p>
          )}
        </QuoteBlock>

        {(draft.why || editing === "why") && (
          <QuoteBlock title="Why this system" onEdit={() => setEditing("why")} editing={editing === "why"}>
            {editing === "why" ? (
              <TextEdit
                label="why this system"
                value={draft.why}
                word="Save"
                onCancel={() => setEditing(null)}
                onSave={(why) => saveBlock("why", (d) => ({ ...d, why }))}
              />
            ) : (
              <p className="wb2-shtext wb2-jcread">{draft.why}</p>
            )}
          </QuoteBlock>
        )}

        {draft.options.map((o, i) => {
          const key: Block = `option-${i}`;
          return (
            <QuoteBlock
              key={i}
              title={names[i]!}
              onEdit={() => setEditing(key)}
              editing={editing === key}
              aside={
                /* the option the client took is the job's equipment: what the
                   compliance certificate is filled in from */
                <button
                  type="button"
                  className={`pbtn ghost sm wb2-jqacc${draft.accepted.includes(i) ? " on" : ""}`}
                  aria-pressed={draft.accepted.includes(i)}
                  onClick={() => void accept(i)}
                >
                  {draft.accepted.includes(i) ? "Accepted" : "Mark accepted"}
                </button>
              }
            >
              {editing === key ? (
                <OptionEdit
                  option={o}
                  onCancel={() => setEditing(null)}
                  onSave={(nextOption) => saveBlock(key, (d) => ({ ...d, options: d.options.map((x, j) => (j === i ? nextOption : x)) }))}
                  onRemove={
                    draft.options.length > 1
                      ? () =>
                          saveBlock(key, (d) => ({
                            ...d,
                            options: d.options.filter((_, j) => j !== i),
                            accepted: acceptedAfterRemoving(d.accepted, i),
                          }))
                      : undefined
                  }
                />
              ) : (
                <OptionBody option={o} />
              )}
            </QuoteBlock>
          );
        })}

        <QuoteBlock title="Pricing" onEdit={() => setEditing("pricing")} editing={editing === "pricing"}>
          {editing === "pricing" ? (
            <PricingEdit
              draft={draft}
              linesByDefault={linesByDefault}
              onCancel={() => setEditing(null)}
              onSave={(pricing) => saveBlock("pricing", (d) => ({ ...d, ...pricing }))}
            />
          ) : (
            <PricingBody draft={draft} totals={totals} quoted={sm8?.quoted ?? null} showLines={draft.showLines ?? linesByDefault} />
          )}
        </QuoteBlock>

        <QuoteBlock title="Payment" onEdit={() => setEditing("payment")} editing={editing === "payment"}>
          <PaymentBlock
            payment={draft.payment}
            terms={tpl.terms}
            editing={editing === "payment"}
            onCancel={() => setEditing(null)}
            onPick={(payment) => save((d) => ({ ...d, payment }))}
            onSave={(payment) => saveBlock("payment", (d) => ({ ...d, payment }))}
          />
        </QuoteBlock>

        <QuoteBlock title="Notes for this job" onEdit={() => setEditing("notes")} editing={editing === "notes"}>
          {editing === "notes" ? (
            <NotesEdit
              picked={draft.notes}
              library={tpl.notes}
              onCancel={() => setEditing(null)}
              onSave={(notes) => saveBlock("notes", (d) => ({ ...d, notes }))}
            />
          ) : draft.notes.length === 0 ? (
            <p className="wb2-jqmode">No notes on this quote.</p>
          ) : (
            draft.notes.map((k) => {
              const n = noteFor(tpl, k);
              return n ? (
                <div className="wb2-jqnote" key={k}>
                  <b>{n.heading}</b>
                  <Bullets lines={n.lines} />
                </div>
              ) : null;
            })
          )}
        </QuoteBlock>
      </article>
    </div>
  );

  const rail = (
    <>
      {price?.ok && draft.options.length > 1 && (
        <div className="qp-seg" role="group" aria-label="Option">
          {names.map((n, i) => (
            <button key={i} type="button" aria-pressed={at === i} title={n} onClick={() => setPick(i)}>
              {`Option ${i + 1}`}
            </button>
          ))}
        </div>
      )}
      {price && <PriceSummary price={price} at={at} names={names} />}
      {sm8Group}
      {asks.length > 0 && (
        <section className="hd-ls-g" aria-label="To answer">
          <h2 className="hd-ls-grp due">
            To answer <span className="hd-ls-n">{asks.length}</span>
          </h2>
          <ul className="hd-ls-rows">
            {asks.map((i) => (
              <li className="hd-ls-it" key={i.key}>
                <div className="hd-ls-fold">
                  <div className="hd-ls-row has-vb">
                    <span className="hd-ls-lead">
                      <i className="hd-ls-dot" data-dot="due" aria-hidden="true" />
                    </span>
                    <span className="hd-ls-t">{CHECKLIST[i.key].label}</span>
                    <span className="hd-ls-sub">{i.question || CHECKLIST[i.key].question}</span>
                    <span className="hd-ls-vbs">
                      <button type="button" className="hd-ls-vb" aria-label={`Answer ${CHECKLIST[i.key].label}`} onClick={() => choose(i.key)}>
                        Answer
                      </button>
                    </span>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
      {left.length > 0 && (
        <section className="hd-ls-g" aria-label="Still to price">
          <h2 className="hd-ls-grp late">
            Still to price <span className="hd-ls-n">{left.length}</span>
          </h2>
          <ul className="hd-ls-rows">
            {left.map((u, i) => (
              <li className="hd-ls-it" key={i}>
                <div className="hd-ls-fold">
                  <div className="hd-ls-row">
                    <span className="hd-ls-lead">
                      <i className="hd-ls-dot" data-dot="late" aria-hidden="true" />
                    </span>
                    <span className="hd-ls-t">{u.name}</span>
                    <span className="hd-ls-sub late">{u.why}</span>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
      {known.length > 0 && (
        <section className="hd-ls-g" aria-label="Known">
          <h2 className="hd-ls-grp today">
            Known <span className="hd-ls-n">{known.length}</span>
          </h2>
          <p className="qp-known">{knownWords(known.map((i) => CHECKLIST[i.key].label))}</p>
        </section>
      )}
      {draft.accepted.length > 0 && send}
    </>
  );

  return frame(flow, paper, rail, actions);
}

/** The rail's Known: the first few topics by name, then how many more. */
const KNOWN_NAMED = 6;
const knownWords = (labels: string[]) =>
  labels.length <= KNOWN_NAMED ? labels.join(", ") : `${labels.slice(0, KNOWN_NAMED).join(", ")} and ${labels.length - KNOWN_NAMED} more`;

/** The brief in the person's own words: two lines until it's asked for. */
function BriefWords({ text }: { text: string }) {
  const [all, setAll] = useState(false);
  if (!text.trim()) return null;
  return (
    <blockquote className={all ? "qp-brief open" : "qp-brief"}>
      <span>{text}</span>
      <button type="button" className="hd-ls-link" aria-expanded={all} onClick={() => setAll((v) => !v)}>
        {all ? "Show less" : "Show the whole brief"}
      </button>
    </blockquote>
  );
}

/* ── the site checklist ── */

function SiteChecklist({
  items,
  on,
  setOn,
  busy,
  applying,
  failed,
  onAnswer,
  onSkip,
  onRetry,
}: {
  items: CheckItem[];
  /** The topic being asked, held by the page so What Tiff read and the list
      on the right can open one; `chosen` is a topic a person opened. */
  on: { key: ChecklistKey | null; chosen: boolean } | null;
  setOn: (next: { key: ChecklistKey | null; chosen: boolean }) => void;
  busy: boolean;
  /** Tiff writing the answers into the proposal */
  applying: boolean;
  /** why the answers couldn't be put in, until the next answer */
  failed: string | null;
  onAnswer: (key: ChecklistKey, answer: string) => Promise<boolean>;
  /** "Doesn't apply": the topic is marked not needed on this job */
  onSkip: (key: ChecklistKey) => Promise<boolean>;
  onRetry: () => void;
}) {
  /* the question that changes the most first (Isaac's 2905, 2026-10-05) */
  const asks = asksByImpact(items);
  /* What the card is on. A topic the person opened themselves stays open
     even when it's known; a topic the card moved on to by itself gives way
     to the first open question once it's settled, so a rewrite of the draft
     never leaves the card on an answered topic. */
  const first = asks[0]?.key ?? null;
  const asking =
    on === null
      ? first
      : on.chosen || on.key === null || asks.some((i) => i.key === on.key)
        ? on.key
        : first;
  const setAsking = (key: ChecklistKey | null, chosen = false) => setOn({ key, chosen });
  const [own, setOwn] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  if (items.length === 0) return null;

  const fresh = items.filter((i) => i.fresh).length;
  const current = asking ? CHECKLIST[asking] : null;
  const currentItem = asking ? items.find((i) => i.key === asking) : undefined;
  const others = asks.filter((i) => i.key !== asking);

  /* Tiff's question for this job, else (an old draft) the topic's own */
  const questionOf = (i: CheckItem) => i.question || CHECKLIST[i.key].question;
  const choicesOf = (i: CheckItem) => (i.choices?.length ? i.choices : CHECKLIST[i.key].choices);

  const answer = async (words: string | null) => {
    if (!asking || (words !== null && !words.trim())) return;
    setSaving(true);
    const ok = words === null ? await onSkip(asking) : await onAnswer(asking, words.trim());
    setSaving(false);
    if (!ok) return;
    setOwn(null);
    /* on down the list from the one just answered, then round to the top */
    const at = asks.findIndex((i) => i.key === asking);
    const next = asks.slice(at + 1).concat(asks.slice(0, Math.max(at, 0))).find((i) => i.key !== asking);
    setAsking(next ? next.key : null);
  };

  return (
    <>
      <h2 className={`qp-h ${asks.length > 0 || fresh > 0 ? "due" : "done"}`}>
        {asks.length > 0 ? (
          <>
            Questions <span className="hd-ls-n">{asks.length}</span>
          </>
        ) : (
          "Questions answered"
        )}
      </h2>

      {current && currentItem && (
        <div className="wb2-jqnow">
          <p className="wb2-jqask">{questionOf(currentItem)}</p>
          {/* a topic opened to change it says what it holds now */}
          {currentItem.state !== "ask" && currentItem.answer && <p className="wb2-jqhas">{currentItem.answer}</p>}
          {own === null ? (
            <div className="wb2-jqacts">
              {choicesOf(currentItem).map((c) => (
                <button key={c} type="button" className="pbtn ghost" disabled={saving || busy} onClick={() => void answer(c)}>
                  {c}
                </button>
              ))}
              <button
                type="button"
                className="pbtn ghost"
                disabled={saving || busy}
                onClick={() => setOwn(currentItem.state === "known" ? currentItem.answer : "")}
              >
                {choicesOf(currentItem).length ? "Something else" : "Type the answer"}
              </button>
              {currentItem.state === "ask" && (
                <button type="button" className="pbtn ghost" disabled={saving || busy} onClick={() => void answer(null)}>
                  Doesn&rsquo;t apply
                </button>
              )}
              <button type="button" className="pbtn ghost sm wb2-jqlead-r" disabled={saving} onClick={() => setAsking(null)}>
                Not now
              </button>
            </div>
          ) : (
            <div className="wb2-jqown">
              <input
                className="wb2-fi"
                aria-label={current.label}
                value={own}
                autoFocus
                disabled={saving}
                onChange={(e) => setOwn(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void answer(own);
                  if (e.key === "Escape") setOwn(null);
                }}
              />
              <button type="button" className="pbtn primary" disabled={saving || !own.trim()} onClick={() => void answer(own)}>
                Save answer
              </button>
              <button type="button" className="pbtn ghost" disabled={saving} onClick={() => setOwn(null)}>
                Cancel
              </button>
            </div>
          )}
        </div>
      )}

      {applying ? (
        <div className="wb2-jqfresh">
          <Waiting note="Putting the answers in" />
        </div>
      ) : (
        fresh > 0 &&
        failed && (
          <div className="wb2-jqfresh">
            <span>{`The answers aren't in the proposal yet. ${failed}`}</span>
            <button type="button" className="pbtn ghost sm" onClick={onRetry}>
              Try again
            </button>
          </div>
        )
      )}

      {others.length > 0 && (
        <ul className="qp-asks" aria-label="Still to ask">
          {others.map((i) => (
            <li key={i.key}>
              <span>{CHECKLIST[i.key].label}</span>
              <span>{questionOf(i)}</span>
              <button
                type="button"
                className="pbtn ghost sm"
                aria-label={`Answer ${CHECKLIST[i.key].label}`}
                disabled={busy}
                onClick={() => {
                  setOwn(null);
                  setAsking(i.key, true);
                }}
              >
                Answer
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/* ── the blocks ── */

function QuoteBlock({
  title,
  onEdit,
  editing = false,
  aside,
  children,
}: {
  title: string;
  onEdit?: () => void;
  editing?: boolean;
  /** A control beside Edit, like an option's Accepted mark. */
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="wb2-jcsec wb2-jq wb2-jqblock">
      <div className="wb2-jcdhead">
        <b>{title}</b>
        {!editing && (onEdit || aside) && (
          <span className="wb2-jqbtns">
            {aside}
            {onEdit && (
              <button type="button" className="pbtn ghost sm" aria-label={`Edit ${title}`} onClick={onEdit}>
                Edit
              </button>
            )}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

function Bullets({ lines }: { lines: readonly string[] }) {
  return (
    <ul className="wb2-jqbul">
      {lines.map((l, i) => (
        <li key={i}>{l}</li>
      ))}
    </ul>
  );
}

function OptionBody({ option }: { option: ProposalOption }) {
  return (
    <>
      <Bullets lines={option.lines} />
      {option.units.length > 0 && (
        <ul className="wb2-jqlines">
          {option.units.map((u, i) => (
            <li key={i}>
              <span>{unitPlace(u)}</span>
              <b>
                {unitWords(u)}
                {!u.model && <em>Model not given yet</em>}
              </b>
            </li>
          ))}
        </ul>
      )}
      {option.pros.length > 0 && (
        <div className="wb2-jqnote">
          <b>Pros</b>
          <Bullets lines={option.pros} />
        </div>
      )}
      {option.cons.length > 0 && (
        <div className="wb2-jqnote">
          <b>Cons</b>
          <Bullets lines={option.cons} />
        </div>
      )}
    </>
  );
}

function NamedRows({ label, rows }: { label: string; rows: readonly { name: string; detail: string }[] }) {
  return (
    <ul className="wb2-jqlines">
      {rows.map((x, i) => (
        <li key={i}>
          <span>{label}</span>
          <b>
            {x.name}
            {x.detail && <em>{x.detail}</em>}
          </b>
        </li>
      ))}
    </ul>
  );
}

/** The new total against what ServiceM8 quoted, on ServiceM8's own basis
    (Isaac, 2026-10-05: "it can just show you a comparison of what was
    already quoted versus the new quote"). */
export function againstQuoted(t: OptionTotal, quoted: { cents: number; basis: "ex" | "inc" }): string {
  const mine = quoted.basis === "ex" ? t.cents : t.incCents;
  const gap = mine - quoted.cents;
  const was = `ServiceM8 quoted ${fmtAud(quoted.cents)} ${quoted.basis} GST`;
  return gap === 0 ? `${was}: the same` : `${was}: ${fmtAud(Math.abs(gap))} ${gap > 0 ? "more" : "less"}`;
}

function PricingBody({
  draft,
  totals,
  quoted,
  showLines,
}: {
  draft: ProposalDraft;
  totals: OptionTotal[] | null;
  quoted: { cents: number; basis: "ex" | "inc" } | null;
  showLines: boolean;
}) {
  return (
    <>
      <p className="wb2-jqmode">{PRICING_WORDS[draft.pricingMode]}</p>
      <p className="wb2-jqmode">{showLines ? "The customer sees each option's line items and its total" : "The customer sees each option's total"}</p>
      <ul className="wb2-jqlines">
        {draft.pricingMode === "itemised"
          ? draft.items.map((it, i) => (
              <li key={i}>
                <span>{`${it.qty} ×`}</span>
                <b>{it.name}</b>
              </li>
            ))
          : draft.options.map((_, i) => {
              /* its Price block's total, once nothing is left to price */
              const t = totals?.[i];
              const whole = t && t.left === 0 ? t.cents : null;
              return (
                <li key={i}>
                  <span>{whole != null ? `${fmtAud(whole)} + GST` : t ? `${t.left} still to price` : "Not priced yet"}</span>
                  <b>
                    {optionHeading(draft, i)}
                    {whole != null && t && <em>{`${fmtAud(t.incCents)} inc GST`}</em>}
                    {whole != null && t && quoted && <em>{againstQuoted(t, quoted)}</em>}
                  </b>
                </li>
              );
            })}
      </ul>
      {draft.extras.length > 0 && (
        <div className="wb2-jqnote">
          <b>Extras, priced on their own</b>
          <NamedRows label="Extra" rows={draft.extras} />
        </div>
      )}
      {draft.allowances.length > 0 && (
        <div className="wb2-jqnote">
          <b>Allowances</b>
          <NamedRows label="Allowance" rows={draft.allowances} />
        </div>
      )}
    </>
  );
}

function PaymentBlock({
  payment,
  terms,
  editing,
  onCancel,
  onPick,
  onSave,
}: {
  payment: ProposalDraft["payment"];
  terms: PaymentTerms;
  editing: boolean;
  onCancel: () => void;
  /** A preset pressed: saved on its own, closing nothing. */
  onPick: (p: ProposalDraft["payment"]) => Promise<boolean>;
  onSave: (p: ProposalDraft["payment"]) => Promise<boolean>;
}) {
  const [switching, setSwitching] = useState(false);
  const problems = paymentProblems(payment.preset, payment.stages);
  const suggested = suggestedDeposit(payment.preset, payment.stages);

  const pick = async (preset: PaymentPreset) => {
    if (preset === payment.preset || switching) return;
    setSwitching(true);
    await onPick({ preset, stages: terms[preset].stages.map((s) => ({ ...s })) });
    setSwitching(false);
  };

  return (
    <>
      <div className="wb2-jqseg" role="radiogroup" aria-label="Payment terms">
        {PAYMENT_PRESET_KEYS.map((k) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={payment.preset === k}
            className={payment.preset === k ? "on" : undefined}
            disabled={switching || editing}
            onClick={() => void pick(k)}
          >
            {terms[k].label}
          </button>
        ))}
      </div>
      {editing ? (
        /* mounted fresh each time Edit opens, so it starts from the stages
           the draft holds now, whoever last changed them */
        <StagesEdit payment={payment} onCancel={onCancel} onSave={onSave} />
      ) : (
        <>
          <ul className="wb2-jqlines">
            {payment.stages.map((s, i) => (
              <li key={i}>
                <span>{s.percent === null ? "Claimed" : `${s.percent}%`}</span>
                <b>
                  {s.when}
                  {i === 0 && suggested != null && <em>{`Suggested ${suggested}%`}</em>}
                </b>
              </li>
            ))}
          </ul>
          {problems.map((p) => (
            <p key={p} className="wb2-sherr">
              {p}
            </p>
          ))}
        </>
      )}
    </>
  );
}

function StagesEdit({
  payment,
  onCancel,
  onSave,
}: {
  payment: ProposalDraft["payment"];
  onCancel: () => void;
  onSave: (p: ProposalDraft["payment"]) => Promise<boolean>;
}) {
  const [stages, setStages] = useState<PaymentStage[]>(payment.stages);
  const { busy, run } = useSaving(() => onSave({ preset: payment.preset, stages }));
  const problems = paymentProblems(payment.preset, stages);
  const suggested = suggestedDeposit(payment.preset, stages);
  return (
    <div className="wb2-jqform">
      {stages.map((s, i) => (
        <div className="wb2-jqstage" key={i}>
          <input
            className="wb2-fi"
            aria-label={`Stage ${i + 1}`}
            value={s.when}
            disabled={busy}
            onChange={(e) => setStages((cur) => cur.map((x, j) => (j === i ? { ...x, when: e.target.value } : x)))}
          />
          <input
            className="wb2-fi wb2-jqpct"
            aria-label={`Stage ${i + 1} percent`}
            inputMode="numeric"
            value={s.percent ?? ""}
            disabled={busy}
            onChange={(e) =>
              setStages((cur) =>
                cur.map((x, j) =>
                  j === i ? { ...x, percent: e.target.value.trim() === "" ? null : Number(e.target.value) || 0 } : x
                )
              )
            }
          />
          <span className="wb2-jqpcts">%</span>
          <button
            type="button"
            className="pbtn ghost sm"
            aria-label={`Remove stage ${i + 1}`}
            disabled={busy || stages.length < 2}
            onClick={() => setStages((cur) => cur.filter((_, j) => j !== i))}
          >
            Remove
          </button>
        </div>
      ))}
      {suggested != null && <p className="wb2-shtext">{`Suggested deposit ${suggested}%`}</p>}
      {problems.map((p) => (
        <p key={p} className="wb2-sherr">
          {p}
        </p>
      ))}
      <EditFoot
        busy={busy}
        onCancel={onCancel}
        onSave={() => void run()}
        saveWord="Save payment"
        extra={
          <button
            type="button"
            className="pbtn ghost wb2-jqlead"
            disabled={busy}
            onClick={() => setStages((cur) => [...cur, { when: "", percent: 0 }])}
          >
            Add a stage
          </button>
        }
      />
    </div>
  );
}

/* ── the edits: each saves the whole draft through the same gate ── */

function EditFoot({
  busy,
  onCancel,
  onSave,
  saveWord,
  extra,
}: {
  busy: boolean;
  onCancel: () => void;
  onSave: () => void;
  saveWord: string;
  extra?: React.ReactNode;
}) {
  return (
    <div className="wb2-jqacts">
      {extra}
      <button type="button" className="pbtn ghost" disabled={busy} onClick={onCancel}>
        Cancel
      </button>
      <button type="button" className="pbtn primary" disabled={busy} onClick={onSave}>
        {saveWord}
      </button>
    </div>
  );
}

function useSaving(onSave: () => Promise<boolean>) {
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    const ok = await onSave();
    if (!ok) setBusy(false);
  };
  return { busy, run };
}

function TextEdit({
  label,
  value,
  word,
  onCancel,
  onSave,
}: {
  label: string;
  value: string;
  word: string;
  onCancel: () => void;
  onSave: (text: string) => Promise<boolean>;
}) {
  const [text, setText] = useState(value);
  const { busy, run } = useSaving(() => onSave(text));
  return (
    <>
      <NoteToken as="field" label={label} offer={false} rows={5} value={text} onChange={setText} disabled={busy} />
      <EditFoot busy={busy} onCancel={onCancel} onSave={() => void run()} saveWord={word} />
    </>
  );
}

const ROLE_WORDS: Record<UnitRole, string> = { outdoor: "Outdoor unit", indoor: "Indoor unit", fan: "Fan" };

/* THE EQUIPMENT, ROW BY ROW. Each row is one unit with its own fields, so a
   model number is typed into the model box and never read back out of a
   sentence: these rows are what the compliance certificate is filled in
   from. */
function UnitsEdit({ units, onChange, disabled }: { units: UnitLine[]; onChange: (next: UnitLine[]) => void; disabled: boolean }) {
  const outdoors = units.filter((u) => u.role === "outdoor").length;
  const set = (i: number, patch: Partial<UnitLine>) => onChange(units.map((u, j) => (j === i ? { ...u, ...patch } : u)));
  const add = (role: UnitRole) => onChange([...units, blankUnit(role, outdoors)]);
  const whole = (v: string, max: number) => {
    const n = Math.floor(Number(v.trim()));
    return Number.isFinite(n) && n >= 1 ? Math.min(max, n) : null;
  };
  return (
    <div className="wb2-jqunited">
      {units.map((u, i) => (
        <div key={i} className="wb2-jqunit">
          <label className="m">
            <span>Unit</span>
            <select className="wb2-sel" value={u.role} disabled={disabled} onChange={(e) => onChange(setUnitRole(units, i, e.target.value as UnitRole))}>
              {UNIT_ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_WORDS[r]}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>{u.role === "outdoor" ? `Where outdoor unit ${u.system} goes` : "Room"}</span>
            <input className="wb2-fi" value={u.room} disabled={disabled} onChange={(e) => set(i, { room: e.target.value })} />
          </label>
          {u.role !== "fan" && (
            <label className="s">
              <span>Capacity</span>
              <input className="wb2-fi" placeholder="3.5 kW" value={u.capacity} disabled={disabled} onChange={(e) => set(i, { capacity: e.target.value })} />
            </label>
          )}
          <label>
            <span>Type</span>
            <input className="wb2-fi" value={u.type} disabled={disabled} onChange={(e) => set(i, { type: e.target.value })} />
          </label>
          <label>
            <span>Model</span>
            <input className="wb2-fi" placeholder="As on the plate" value={u.model} disabled={disabled} onChange={(e) => set(i, { model: e.target.value })} />
          </label>
          <label className="s">
            <span>How many</span>
            <input className="wb2-fi" inputMode="numeric" value={String(u.qty)} disabled={disabled} onChange={(e) => set(i, { qty: whole(e.target.value, MAX_UNIT_QTY) ?? 1 })} />
          </label>
          {u.role === "indoor" && outdoors > 1 && (
            <label className="m">
              <span>Runs from</span>
              <select className="wb2-sel" value={u.system} disabled={disabled} onChange={(e) => set(i, { system: Number(e.target.value) })}>
                {Array.from({ length: outdoors }, (_, k) => (
                  <option key={k} value={k + 1}>
                    {`Outdoor unit ${k + 1}`}
                  </option>
                ))}
              </select>
            </label>
          )}
          {u.role === "fan" && (
            <label className="s">
              <span>Rated L/s</span>
              <input className="wb2-fi" inputMode="numeric" value={u.lps === null ? "" : String(u.lps)} disabled={disabled} onChange={(e) => set(i, { lps: whole(e.target.value, 5000) })} />
            </label>
          )}
          <button type="button" className="wb2-ico wb2-jqunitx" aria-label={`Clear ${unitPlace(u)}`} disabled={disabled} onClick={() => onChange(removeUnit(units, i))}>
            <Icon name="x" size={14} />
          </button>
        </div>
      ))}
      {units.length < MAX_UNITS && (
        <div className="wb2-jqacts">
          <button type="button" className="pbtn ghost sm" disabled={disabled} onClick={() => add("outdoor")}>
            Add an outdoor unit
          </button>
          <button type="button" className="pbtn ghost sm" disabled={disabled} onClick={() => add("indoor")}>
            Add an indoor unit
          </button>
          <button type="button" className="pbtn ghost sm" disabled={disabled} onClick={() => add("fan")}>
            Add a fan
          </button>
        </div>
      )}
    </div>
  );
}

function OptionEdit({
  option,
  onCancel,
  onSave,
  onRemove,
}: {
  option: ProposalOption;
  onCancel: () => void;
  onSave: (next: ProposalOption) => Promise<boolean>;
  onRemove?: () => Promise<boolean>;
}) {
  const [name, setName] = useState(option.name);
  const [lines, setLines] = useState(option.lines.join("\n"));
  const [units, setUnits] = useState<UnitLine[]>(option.units);
  const [pros, setPros] = useState(option.pros.join("\n"));
  const [cons, setCons] = useState(option.cons.join("\n"));
  const { busy, run } = useSaving(() =>
    onSave({
      name,
      lines: linesOf(lines),
      units,
      pros: linesOf(pros),
      cons: linesOf(cons),
      /* the scope's edit keeps the option's price and labour; they're set
         where they're shown */
      priceCents: option.priceCents,
      labour: option.labour,
      suggestion: option.suggestion,
    })
  );
  const removing = useSaving(() => (onRemove ? onRemove() : Promise.resolve(false)));
  const off = busy || removing.busy;
  return (
    <div className="wb2-jqform">
      <label className="wb2-jqfield">
        <span>Name</span>
        <input className="wb2-fi" value={name} onChange={(e) => setName(e.target.value)} disabled={off} />
      </label>
      <div className="wb2-jqfield">
        <span>Scope, one line each</span>
        <NoteToken as="field" label="the scope" offer={false} rows={6} value={lines} onChange={setLines} disabled={off} />
      </div>
      <div className="wb2-jqfield">
        <span>Equipment</span>
        <UnitsEdit units={units} onChange={setUnits} disabled={off} />
      </div>
      <div className="wb2-jqfield">
        <span>Pros, one line each</span>
        <NoteToken as="field" label="the pros" offer={false} rows={2} value={pros} onChange={setPros} disabled={off} />
      </div>
      <div className="wb2-jqfield">
        <span>Cons, one line each</span>
        <NoteToken as="field" label="the cons" offer={false} rows={2} value={cons} onChange={setCons} disabled={off} />
      </div>
      <EditFoot
        busy={off}
        onCancel={onCancel}
        onSave={() => void run()}
        saveWord="Save option"
        extra={
          onRemove && (
            <button type="button" className="pbtn ghost danger wb2-jqlead" disabled={off} onClick={() => void removing.run()}>
              Remove option
            </button>
          )
        }
      />
    </div>
  );
}

/** Each option's total, ex GST, as its Price block works it out: whole,
    or what's left to price. Null to a reader without money access. */
export type OptionTotal = { cents: number; incCents: number; left: number };

/* ── an option's labour ── */

const hrsWords = (h: number) => `${Math.round(h * 10) / 10} hrs`;
const peopleWords = (n: number) => (n === 1 ? "1 person" : `${n} people`);
const daysWords = (d: number) => {
  if (Number.isInteger(d)) return d === 1 ? "1 day" : `${d} days`;
  if (Number.isInteger(d * 2)) return d < 1 ? "half a day" : `${Math.floor(d)} and a half days`;
  return `${Math.round(d * 100) / 100} days`;
};

function VisitRows({ visits }: { visits: readonly { stage: string; people: number; days: number | null; hours?: number | null }[] }) {
  return (
    <ul className="wb2-jqlines">
      {visits.map((v, i) => (
        <li key={i}>
          <span>{v.stage}</span>
          <b>{`${peopleWords(v.people)}, ${v.days != null ? daysWords(v.days) : hrsWords(v.hours ?? 0)}`}</b>
        </li>
      ))}
    </ul>
  );
}

const LABOUR_SET_WORDS: Record<OptionLabour["from"], string> = {
  tiff: "Tiff's suggestion, applied",
  typical: "Your typical, applied",
  you: "Set on the quote",
};

/* AN OPTION'S LABOUR, under its scope (Isaac, 2026-10-05: "api call can
   recommend a labour amount to use if none is provided in the brief";
   "typical labour hours for this type of job is 32 hours. And click
   apply"). What prices the option, in order: labour set on it, else the
   brief's. With neither, Tiff's suggestion from the option's own equipment
   waits with Apply, and nothing is priced until it's pressed; beside it,
   once the business's post-job reviews say so, what its jobs of this kind
   typically take. */
function OptionLabourRow({
  option,
  heading,
  label = "Labour",
  facts,
  disabled,
  suggesting,
  error,
  onSet,
  onSuggest,
}: {
  option: ProposalOption;
  /** The option's heading, "Option 1: Ducted", for its buttons' names. */
  heading: string;
  /** What the row is headed with; null under a section that already says. */
  label?: string | null;
  facts: QuoteLabour | null;
  disabled: boolean;
  suggesting: boolean;
  /** Why Tiff's suggestion couldn't be had, said under the row. */
  error: string | null;
  /** Labour on the option, or null to take it off. */
  onSet: (labour: OptionLabour | null) => Promise<boolean>;
  /** Tiff's suggestion, for a draft written before Tiff made one. */
  onSuggest: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const brief = facts?.brief ?? null;
  const own = option.labour;
  const priced = !!own || !!brief;
  const suggestion = priced ? null : option.suggestion;
  const typical = facts?.typical ?? null;
  const dayHours = facts?.dayHours ?? null;
  /* the brief's visits in days by the business's own day; one given only in
     hours, with no day set, keeps its row with the days left to fill */
  const briefDays = (brief?.visits ?? []).map((v) => ({
    stage: v.stage,
    people: v.people,
    days: v.days ?? (v.hours != null && dayHours ? Math.round((v.hours / dayHours) * 1000) / 1000 : null),
  }));

  if (editing) {
    return (
      <div className="wb2-jqnote">
        {label && <b>{label}</b>}
        <VisitsEdit
          initial={own?.visits ?? (briefDays.length ? briefDays : (option.suggestion?.visits ?? []))}
          onCancel={() => setEditing(false)}
          onSave={async (visits) => {
            const ok = await onSet(visits.length ? { visits, from: "you" } : null);
            if (ok) setEditing(false);
            return ok;
          }}
        />
      </div>
    );
  }

  const typicalVisits = typical && dayHours ? [{ stage: "Install" as const, people: 1, days: Math.round((typical.hours / dayHours) * 1000) / 1000 }] : null;
  return (
    <div className="wb2-jqnote">
      {label && <b>{label}</b>}
      {own ? (
        <>
          <VisitRows visits={own.visits} />
          <p className="wb2-jqmode">{LABOUR_SET_WORDS[own.from]}</p>
        </>
      ) : brief ? (
        <>
          <VisitRows visits={brief.visits} />
          <p className="wb2-jqmode">{`From the brief: ${brief.said.map((s) => `“${s}”`).join(" ")}`}</p>
        </>
      ) : suggestion ? (
        <>
          <p className="wb2-jqmode">Not in the brief. Tiff suggests:</p>
          <VisitRows visits={suggestion.visits} />
          {suggestion.why && <p className="wb2-shtext">{suggestion.why}</p>}
        </>
      ) : (
        <p className="wb2-jqmode">Not in the brief</p>
      )}
      {typical && <p className="wb2-shtext">{typical.words}</p>}
      {error && <p className="wb2-sherr">{error}</p>}
      <div className="wb2-jqacts">
        {suggesting ? (
          <Waiting note="Working out the labour" />
        ) : (
          <>
            {suggestion && (
              <button
                type="button"
                className="pbtn primary sm"
                aria-label={`Apply Tiff's labour to ${heading}`}
                disabled={disabled}
                onClick={() => void onSet({ visits: suggestion.visits, from: "tiff" })}
              >
                Apply
              </button>
            )}
            {typicalVisits && !own && (
              <button
                type="button"
                className="pbtn ghost sm"
                aria-label={`Apply your typical labour to ${heading}`}
                disabled={disabled}
                onClick={() => void onSet({ visits: typicalVisits, from: "typical" })}
              >
                Apply your typical
              </button>
            )}
            {!priced && !suggestion && (
              <button type="button" className="pbtn ghost sm" aria-label={`Suggest labour for ${heading}`} disabled={disabled} onClick={onSuggest}>
                Suggest labour
              </button>
            )}
            <button
              type="button"
              className="pbtn ghost sm"
              aria-label={`${priced || suggestion ? "Change" : "Set"} labour for ${heading}`}
              disabled={disabled}
              onClick={() => setEditing(true)}
            >
              {priced || suggestion ? "Change" : "Set labour"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

type VisitRow = { stage: VisitStage; people: string; days: string };

/** A row as typed, as a visit: whole people, and days as typed. Null when
    either is missing or out of range. */
function visitOf(r: VisitRow): Visit | null {
  const people = Number(r.people.trim());
  const days = Number(r.days.trim());
  if (!r.people.trim() || !r.days.trim() || !Number.isInteger(people) || people < 1 || people > MAX_CREW) return null;
  if (!Number.isFinite(days) || days <= 0 || days > MAX_VISIT_DAYS) return null;
  return { stage: r.stage, people, days: Math.round(days * 1000) / 1000 };
}

function VisitsEdit({
  initial,
  onCancel,
  onSave,
}: {
  /** A visit's days may be missing: the row opens with them to fill. */
  initial: readonly { stage: VisitStage; people: number; days: number | null }[];
  onCancel: () => void;
  onSave: (visits: Visit[]) => Promise<boolean>;
}) {
  const [rows, setRows] = useState<VisitRow[]>(() =>
    initial.map((v) => ({ stage: v.stage, people: String(v.people), days: v.days == null ? "" : String(v.days) }))
  );
  const [tried, setTried] = useState(false);
  const visits = rows.map(visitOf);
  const whole = visits.every((v) => v !== null);
  const { busy, run } = useSaving(() => onSave(visits.filter((v): v is Visit => v !== null)));
  const set = (i: number, patch: Partial<VisitRow>) => setRows((cur) => cur.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div className="wb2-jqform">
      <div className="wb2-jqunited">
        {rows.map((r, i) => (
          <div key={i} className="wb2-jqunit">
            <label className="m">
              <span>Visit</span>
              <select className="wb2-sel" value={r.stage} disabled={busy} onChange={(e) => set(i, { stage: e.target.value as VisitStage })}>
                {VISIT_STAGES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label className="s">
              <span>People</span>
              <input className="wb2-fi" inputMode="numeric" value={r.people} disabled={busy} onChange={(e) => set(i, { people: e.target.value })} />
            </label>
            <label className="s">
              <span>Days</span>
              <input className="wb2-fi" inputMode="decimal" value={r.days} disabled={busy} onChange={(e) => set(i, { days: e.target.value })} />
            </label>
            <button type="button" className="wb2-ico wb2-jqunitx" aria-label={`Clear visit ${i + 1}`} disabled={busy} onClick={() => setRows((cur) => cur.filter((_, j) => j !== i))}>
              <Icon name="x" size={14} />
            </button>
          </div>
        ))}
      </div>
      {tried && !whole && <p className="wb2-sherr">Each visit needs how many people and how many days.</p>}
      <EditFoot
        busy={busy}
        onCancel={onCancel}
        onSave={() => {
          setTried(true);
          if (whole) void run();
        }}
        saveWord="Save labour"
        extra={
          rows.length < MAX_VISITS ? (
            <button type="button" className="pbtn ghost wb2-jqlead" disabled={busy} onClick={() => setRows((cur) => [...cur, { stage: "Install", people: "", days: "" }])}>
              Add a visit
            </button>
          ) : undefined
        }
      />
    </div>
  );
}

/* An option's price is never typed (Isaac, 2026-10-05: "you should not
   have to manually enter it in"): it is its Price block's total. */
function PricingEdit({
  draft,
  linesByDefault,
  onCancel,
  onSave,
}: {
  draft: ProposalDraft;
  linesByDefault: boolean;
  onCancel: () => void;
  onSave: (pricing: Pick<ProposalDraft, "pricingMode" | "items" | "extras" | "allowances" | "showLines">) => Promise<boolean>;
}) {
  const [mode, setMode] = useState(draft.pricingMode);
  const [lines, setLines] = useState(draft.showLines ?? linesByDefault);
  const [items, setItems] = useState(draft.items.map((it) => `${it.qty} × ${it.name}`).join("\n"));
  const [extras, setExtras] = useState(namedText(draft.extras));
  const [allowances, setAllowances] = useState(namedText(draft.allowances));
  const { busy, run } = useSaving(() =>
    onSave({
      pricingMode: mode,
      items: linesOf(items).map((l) => {
        const m = /^(\d+(?:\.\d+)?)\s*[×x*]\s*(.+)$/i.exec(l);
        return m ? { qty: m[1]!, name: m[2]! } : { qty: "1", name: l };
      }),
      extras: namedOf(extras),
      allowances: namedOf(allowances),
      /* the business's default stays the default until it's changed here */
      showLines: lines === linesByDefault && draft.showLines == null ? null : lines,
    })
  );
  return (
    <div className="wb2-jqform">
      <label className="wb2-jqcheck">
        <input type="checkbox" checked={lines} onChange={(e) => setLines(e.target.checked)} disabled={busy} />
        Show line items to the customer
      </label>
      {(["multiple_choice", "optional", "itemised"] as const).map((m) => (
        <label className="wb2-jqcheck" key={m}>
          <input type="radio" name="jq-mode" checked={mode === m} onChange={() => setMode(m)} disabled={busy} />
          {PRICING_WORDS[m]}
        </label>
      ))}
      {mode === "itemised" && (
        <div className="wb2-jqfield">
          <span>Lines, one each: quantity × item</span>
          <NoteToken as="field" label="the lines" offer={false} rows={4} value={items} onChange={setItems} disabled={busy} />
        </div>
      )}
      <div className="wb2-jqfield">
        <span>Extras, one each: name, detail</span>
        <NoteToken as="field" label="the extras" offer={false} rows={2} value={extras} onChange={setExtras} disabled={busy} />
      </div>
      <div className="wb2-jqfield">
        <span>Allowances, one each: name, allowance</span>
        <NoteToken as="field" label="the allowances" offer={false} rows={2} value={allowances} onChange={setAllowances} disabled={busy} />
      </div>
      <EditFoot busy={busy} onCancel={onCancel} onSave={() => void run()} saveWord="Save pricing" />
    </div>
  );
}

function NotesEdit({
  picked,
  library,
  onCancel,
  onSave,
}: {
  picked: string[];
  library: QuoteNote[];
  onCancel: () => void;
  onSave: (notes: string[]) => Promise<boolean>;
}) {
  const [keys, setKeys] = useState<string[]>(picked);
  /* in the business's order; a note no longer on its list stays if it was picked */
  const listed = library.map((n) => n.key);
  const { busy, run } = useSaving(() => onSave([...listed.filter((k) => keys.includes(k)), ...keys.filter((k) => !listed.includes(k))]));
  return (
    <div className="wb2-jqform">
      {library.map((n) => (
        <label className="wb2-jqcheck" key={n.key}>
          <input
            type="checkbox"
            checked={keys.includes(n.key)}
            disabled={busy}
            onChange={(e) => setKeys((cur) => (e.target.checked ? [...cur, n.key] : cur.filter((x) => x !== n.key)))}
          />
          {n.heading}
        </label>
      ))}
      <EditFoot busy={busy} onCancel={onCancel} onSave={() => void run()} saveWord="Save notes" />
    </div>
  );
}
