import { auDayOf } from "@/lib/au-dates";
import type { ByHand } from "./lines-job";
import { quoteStarted, type QuoteFacts } from "./quote-card";
import type { QuoteVersion } from "./quote-versions";

/* THE QUOTE TAB'S LANDING, "QUOTES" (Isaac, 2026-10-18, layout plan
   6-revisions: "The Quote tab opens on a landing"). Three states for the
   job's one quote: nothing yet, in progress, and accepted with its versions
   and variations under it, newest first. What it says beyond QuoteFacts:
   the quote's name, who last worked on it with Tiff and when, the versions
   kept and the variations started, and what each comes to, the money only
   for a reader with money access (`financials`, as the quote's own lines
   are: money-hidden.ts), taken out here before it leaves the server. Pure. */

/** A person as the landing names them: their name, or null where no
    staff profile names the sign-in. */
type Named = string | null;

export type LandingVersion = { n: number; approvedAt: string | null; madeAt: string; by: Named; cents: number | null };
export type LandingVariation = { n: number; what: string; startedAt: string; by: Named; approvedAt: string | null; acceptedAt: string | null; cents: number | null };

export type QuoteLanding = {
  /** the proposal's title, or the open option's name; "" for neither */
  name: string;
  /** when it was begun: the first thing said on Tiff's session */
  startedAt: string | null;
  /** the last person to work on it, and when: their last word to Tiff or
      their last change to a line, whichever is later. `now`: Tiff is
      working on a turn this minute. */
  who: { name: Named; at: string; now: boolean } | null;
  /** who approved the quote as it stands */
  approvedBy: Named;
  /** when an option was marked accepted, from the quote's history */
  acceptedAt: string | null;
  /** the quote as it stands, ex GST: the accepted option, or option 1.
      null without money access, or before it can be priced */
  totalCents: number | null;
  /** whether this reader sees money, so may start a variation */
  money: boolean;
  /** the versions kept before this one, newest first */
  versions: LandingVersion[];
  /** the variations started on the accepted quote, newest first; each
      one's figure is the difference it makes */
  variations: LandingVariation[];
};

/** What the server read, for landingOf. */
export type LandingRaw = {
  byHand: Pick<ByHand, "accepted" | "names" | "proposal" | "variations">;
  versions: readonly Pick<QuoteVersion, "n" | "approvedAt" | "approvedBy" | "madeAt" | "madeBy" | "options">[];
  lines: readonly { updatedAt: string; updatedBy: string }[];
  /** the first event on Tiff's session */
  firstAt: string | null;
  /** the last thing a person said to her */
  lastSaid: { author: string; at: string } | null;
  working: boolean;
  /** the last "Option N accepted" in the quote's history */
  acceptedAt: string | null;
  /** sign-in id to name */
  names: Readonly<Record<string, string>>;
  /** each option's ex GST total, by index; null when not priced */
  optionCents: readonly number[] | null;
  money: boolean;
};

const TIFF = "tiff";
const person = (id: string | null | undefined) => !!id && id !== TIFF;

/** The sign-ins the landing names, for namesBySignIn. */
export function landingPeople(raw: Pick<LandingRaw, "byHand" | "versions" | "lines" | "lastSaid">): string[] {
  const ids = [
    raw.lastSaid?.author,
    lastLineChange(raw.lines)?.by,
    raw.byHand.proposal?.approvedBy,
    ...raw.versions.flatMap((v) => [v.approvedBy, v.madeBy]),
    ...raw.byHand.variations.map((v) => v.startedBy),
  ];
  return [...new Set(ids.filter((i): i is string => person(i)))];
}

function lastLineChange(lines: LandingRaw["lines"]): { by: string; at: string } | null {
  let out: { by: string; at: string } | null = null;
  for (const l of lines) if (person(l.updatedBy) && l.updatedAt && (!out || l.updatedAt > out.at)) out = { by: l.updatedBy, at: l.updatedAt };
  return out;
}

export function landingOf(raw: LandingRaw): QuoteLanding {
  const name = (id: string | null | undefined): Named => (person(id) ? (raw.names[id!] ?? null) : null);
  const open = raw.byHand.accepted[0] ?? 0;
  const said = raw.lastSaid && person(raw.lastSaid.author) ? { by: raw.lastSaid.author, at: raw.lastSaid.at } : null;
  const changed = lastLineChange(raw.lines);
  const last = said && changed ? (changed.at > said.at ? changed : said) : (said ?? changed);
  /* money only to a reader who sees it: never only hidden on the page */
  const priced = raw.money ? raw.optionCents : null;
  const at = (i: number) => (priced && Number.isFinite(priced[i]) ? priced[i]! : null);
  return {
    name: (raw.byHand.proposal?.title ?? "").trim() || (raw.byHand.names[open] ?? "").trim(),
    startedAt: raw.firstAt,
    who: last ? { name: name(last.by), at: last.at, now: raw.working } : null,
    approvedBy: name(raw.byHand.proposal?.approvedBy),
    acceptedAt: raw.byHand.accepted.length ? raw.acceptedAt : null,
    totalCents: at(open),
    money: raw.money,
    versions: [...raw.versions]
      .sort((a, b) => b.n - a.n)
      .map((v) => ({
        n: v.n,
        approvedAt: v.approvedAt,
        madeAt: v.madeAt,
        by: name(v.approvedBy) ?? name(v.madeBy),
        cents: raw.money ? ((v.options[open] ?? v.options[0])?.exGstCents ?? null) : null,
      })),
    variations: [...raw.byHand.variations]
      .sort((a, b) => b.n - a.n)
      .map((v) => {
        const mine = at(v.option);
        const was = at(v.of);
        return { n: v.n, what: v.what, startedAt: v.startedAt, by: name(v.startedBy), approvedAt: v.approvedAt, acceptedAt: v.acceptedAt, cents: mine != null && was != null ? mine - was : null };
      }),
  };
}

/* ── the words ─────────────────────────────────────────────────────────── */

export type LandingTone = "good" | "look" | "info";
/** A state word and the rest of its line: "Waiting for the client", ", return grille in Bed 2". */
export type LandingState = { tone: LandingTone; word: string; rest: string };

/** How a timestamp is worded: the day it was in Australia, and its clock time. */
export type LandingWhen = { day: (isoDay: string) => string; time: (at: string) => string };

const dayOf = (when: LandingWhen, at: string | null | undefined) => (at ? when.day(auDayOf(at)) : "");
const join = (...xs: (string | null | undefined | false)[]) => xs.filter(Boolean).join(", ");

/** The landing's three states for the job's one quote. */
export function landingKind(f: Pick<QuoteFacts, "lines" | "talked" | "drafted" | "accepted">): "first" | "progress" | "accepted" {
  if (f.accepted.length > 0) return "accepted";
  return quoteStarted(f) ? "progress" : "first";
}

/** Where a quote in progress stands, as its card's state word: waiting
    for the client once it's gone, approved, items to settle, or the
    scope as far as it's laid out. */
export function progressState(f: QuoteFacts, when: LandingWhen): LandingState {
  if (f.sent && !f.sent.trial) return { tone: "look", word: "Waiting for the client", rest: `, sent ${dayOf(when, f.sent.at)}` };
  if (f.approved) return { tone: "good", word: f.version > 1 ? `Version ${f.version} approved` : "Approved", rest: f.sent?.trial ? ", trial run to ServiceM8" : "" };
  if (f.toConfirm > 0) return { tone: "look", word: `Scope, ${f.toConfirm} to settle`, rest: "" };
  if (f.lines > 0) return { tone: "info", word: `Scope, ${f.lines} ${f.lines === 1 ? "line" : "lines"}`, rest: "" };
  return { tone: "info", word: f.talked ? "Brief, with Tiff" : "Drafted", rest: "" };
}

/** "Version 1, 2 options, started Fri 17 Oct". */
export function progressLine(f: Pick<QuoteFacts, "version" | "options">, l: Pick<QuoteLanding, "startedAt">, when: LandingWhen): string {
  return join(`Version ${f.version}`, f.options > 1 && `${f.options} options`, l.startedAt && `started ${dayOf(when, l.startedAt)}`);
}

/** Who is on it, and when: "Isaac Smith, with Tiff, last Fri 17 Oct at
    10:24 pm"; the when alone where no one is named. */
export function whoWords(who: QuoteLanding["who"], talked: boolean, when: LandingWhen): string {
  if (!who) return "";
  const with_ = talked || who.now ? "with Tiff" : "";
  const at = who.now ? "now" : `last ${dayOf(when, who.at)} at ${when.time(who.at)}`;
  const words = join(who.name, with_, at);
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** An accepted quote's own line: "Accepted Wed 22 Oct, version 2". */
export function acceptedState(f: Pick<QuoteFacts, "version">, l: Pick<QuoteLanding, "acceptedAt">, when: LandingWhen): LandingState {
  return { tone: "good", word: "Accepted", rest: `${l.acceptedAt ? ` ${dayOf(when, l.acceptedAt)}` : ""}, version ${f.version}` };
}

/** One row under an accepted quote: a variation or a version. */
export type LandingRow = {
  key: string;
  title: string;
  state: LandingState;
  who: Named;
  cents: number | null;
  /** a variation's figure is the difference it makes */
  signed: boolean;
  /** still being worked: Continue, where the rest Open, read-only */
  open: boolean;
};

/** The versions and variations under an accepted quote, newest first:
    each variation, then the version accepted, then the versions kept
    before it. */
export function acceptedRows(f: Pick<QuoteFacts, "version">, l: QuoteLanding, when: LandingWhen): LandingRow[] {
  const variations = l.variations.map<LandingRow>((v) => ({
    key: `variation-${v.n}`,
    title: `Variation ${v.n}`,
    state: v.acceptedAt
      ? { tone: "good", word: "Accepted", rest: ` ${dayOf(when, v.acceptedAt)}${v.what ? `, ${v.what}` : ""}` }
      : v.approvedAt
        ? { tone: "look", word: "Waiting for the client", rest: v.what ? `, ${v.what}` : "" }
        : { tone: "info", word: "Started", rest: ` ${dayOf(when, v.startedAt)}${v.what ? `, ${v.what}` : ""}` },
    who: v.by,
    cents: v.cents,
    signed: true,
    open: !v.acceptedAt,
  }));
  const current: LandingRow = {
    key: `version-${f.version}`,
    title: `Version ${f.version}`,
    state: { tone: "good", word: "Accepted", rest: l.acceptedAt ? ` ${dayOf(when, l.acceptedAt)}` : "" },
    who: l.approvedBy,
    cents: l.totalCents,
    signed: false,
    open: false,
  };
  const kept = l.versions.map<LandingRow>((v) => ({
    key: `version-${v.n}`,
    title: `Version ${v.n}`,
    state: { tone: "info", word: "Replaced", rest: v.approvedAt ? `, approved ${dayOf(when, v.approvedAt)}` : v.madeAt ? `, kept ${dayOf(when, v.madeAt)}` : "" },
    who: v.by,
    cents: v.cents,
    signed: false,
    open: false,
  }));
  return [...variations, current, ...kept];
}

/** "$24,574.63"; a difference carries its sign, "+$412.00", "−$80.00". */
export function landingMoney(cents: number, signed = false): string {
  const words = `$${(Math.abs(cents) / 100).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return cents < 0 ? `−${words}` : signed ? `+${words}` : words;
}
