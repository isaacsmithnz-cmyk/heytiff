/* THE JOB'S STORY — every piece the card already fetches, merged into one
   diary and read newest-first.

   ONE PURE MODULE, TWO READERS. The Diary tab renders these entries, and the
   "Where it's up to" summary is WRITTEN from them — the same merge serialised
   into the writer's prompt. That coupling is the point: the summary cannot
   know anything the story doesn't, which is what makes a wrong sentence
   traceable to a wrong entry rather than to a model's imagination.

   ZERO NEW QUERIES. Sessions and milestones ride the detail read, notes and
   the ledger ride the record read, files carry their stamps in the media
   read. This module only rearranges what the sheet already holds — the same
   one-door shape noteLayoutOf gave the annotation work, applied to time.

   THE MONEY IS WHOEVER SENT IT. Claims, payments and the invoice milestone
   only exist here when the caller passes them, and the server only sends
   them behind `workboard_money` — so a reader without the grant gets a story
   with no money in it, absent rather than blanked, the same law the Money
   tab itself follows. */

import {
  claimTitle,
  isPartialInvoiceStubNote,
  type FamilyClaim,
  type FamilyMoney,
} from "./job-family";
import type { JobLedgerRead, JobNoteEntry, JobVisit } from "./all-jobs-query";
import type { JobChecklistItem } from "./all-jobs";
import type { JobMediaItem } from "./job-media";

/** How many photo tiles a day's cluster shows before "+N". Sixty thumbnails
    inline would bury the notes between them; four says what kind of day it
    was and the Photos tab holds the rest. */
export const STORY_PHOTOS_SHOWN = 4;

export type StoryPhoto = {
  remoteId: string;
  name: string;
  url: string | null;
  fromClaim: string | null;
};

export type StoryEntry =
  | {
      kind: "note";
      key: string;
      day: string;
      at: string | null;
      author: string | null;
      text: string;
      actionRequired: boolean;
      /** The claim's job number when the note was written on a clone. */
      fromClaim: string | null;
    }
  | { kind: "visit"; key: string; day: string; at: null; minutes: number; crew: string[] }
  | {
      kind: "photos";
      key: string;
      day: string;
      at: null;
      count: number;
      shown: StoryPhoto[];
    }
  | {
      kind: "claim";
      key: string;
      day: string;
      at: null;
      event: "raised" | "settled";
      remoteId: string;
      title: string;
      jobNumber: string | null;
      amountCents: number | null;
      /** True when this claim is the family's last — "the final payment". */
      isFinal: boolean;
    }
  | {
      kind: "payment";
      key: string;
      day: string;
      at: string | null;
      amountCents: number | null;
      method: string | null;
      takenBy: string | null;
      isDeposit: boolean;
    }
  | {
      kind: "tick";
      key: string;
      day: string;
      at: string | null;
      name: string;
      by: string | null;
    }
  | { kind: "design"; key: string; day: string; at: string | null; id: string; name: string }
  | { kind: "push"; key: string; day: string; at: string | null; count: number }
  | { kind: "milestone"; key: string; day: string; at: null; label: MilestoneLabel };

export type MilestoneLabel =
  | "Job raised"
  | "Quote sent"
  | "Became a work order"
  | "Job completed"
  | "Invoice raised";

export type StoryDay = { day: string; entries: StoryEntry[] };

export type StoryFilter = "all" | "notes" | "photos" | "money" | "visits";

/** What the merge is handed — the sheet's own reads, no more. Money-shaped
    inputs are null for a reader the server refused them to. */
export type StoryInputs = {
  detail: {
    date: string | null;
    quoteDate: string | null;
    workOrderDate: string | null;
    completionDate: string | null;
    visits: readonly JobVisit[];
    checklist: readonly JobChecklistItem[];
    designs: readonly { id: string; name: string; updatedAt: string }[];
  } | null;
  notes: readonly JobNoteEntry[] | null;
  /** Null without `workboard_money` — the server never sent it. */
  ledger: JobLedgerRead | null;
  family: FamilyMoney | null;
  /** The plain job's invoice date, from the money read. Same gate. */
  invoicedOn: string | null;
  media: readonly JobMediaItem[] | null;
  picklist: readonly { addedAt: string; pickedAt: string | null }[] | null;
  /** The account's own zone, for OUR timestamptz columns (designs, picklist).
      ServiceM8's stamps are already naive account-local strings and never
      pass through this. */
  timezone: string | null;
};

const dayOf = (naive: string | null | undefined): string | null =>
  typeof naive === "string" && naive.length >= 10 ? naive.slice(0, 10) : null;

/* An ISO instant, said in the account's own zone as a naive local stamp —
   "2026-08-21 14:32". en-CA is the one locale whose date renders as
   YYYY-MM-DD, which keeps this string sortable beside ServiceM8's. Parsing an
   instant is not the hydration trap: that is about reading the CLOCK in a
   render body, and this reads only its argument. */
function naiveInZone(iso: string, timezone: string | null): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  try {
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone ?? "Australia/Sydney",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    // "2026-08-21, 14:32" — the comma varies by ICU version, so rebuild it.
    const parts = fmt.formatToParts(d);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    const day = `${get("year")}-${get("month")}-${get("day")}`;
    // Intl says "24:00" for midnight in some ICU builds; keep it sortable.
    const hour = get("hour") === "24" ? "00" : get("hour");
    return `${day} ${hour}:${get("minute")}`;
  } catch {
    return iso.slice(0, 16).replace("T", " ");
  }
}

/* WITHIN A DAY, the clock orders what has one, and what doesn't sinks in a
   fixed rank: the visit is the day's spine, photos ride it, ticks and money
   follow, and a date-only milestone ("Completed") is the day's verdict, so
   it reads last. The feed is newest-first, so "last" means the bottom of the
   day's group. */
const DATE_ONLY_RANK: Record<StoryEntry["kind"], number> = {
  visit: 0,
  photos: 1,
  tick: 2,
  payment: 3,
  claim: 4,
  design: 5,
  push: 6,
  note: 7,
  milestone: 8,
};

function compareWithinDay(a: StoryEntry, b: StoryEntry): number {
  if (a.at !== null && b.at !== null && a.at !== b.at) return a.at < b.at ? 1 : -1;
  if (a.at !== null && b.at === null) return -1;
  if (a.at === null && b.at !== null) return 1;
  const rank = DATE_ONLY_RANK[a.kind] - DATE_ONLY_RANK[b.kind];
  if (rank !== 0) return rank;
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

/** The merge. Tolerant of missing pieces on purpose — the sheet's reads land
    on their own clocks, and the diary grows as they do. */
export function buildJobStory(inputs: StoryInputs): StoryEntry[] {
  const entries: StoryEntry[] = [];
  const detail = inputs.detail;

  /* Notes — the parent's and its claims', one stream. The stub sweep from
     #556 applies here too: "This job was created as a Partial Invoice…" is
     ServiceM8 narrating its own cloning, and the claim event says it
     better. The 212 real clone notes survive. */
  for (const n of inputs.notes ?? []) {
    if (isPartialInvoiceStubNote(n.text)) continue;
    const day = dayOf(n.writtenAt) ?? n.writtenOn;
    if (!day) continue;
    entries.push({
      kind: "note",
      key: `note:${n.remoteId}`,
      day,
      at: n.writtenAt ?? null,
      author: n.writtenBy,
      text: n.text,
      actionRequired: n.actionRequired,
      fromClaim: n.fromClaim,
    });
  }

  /* Visits — the per-session rows the old sheet summed into one figure.
     Already one row per day with who went; the diary is where they read as
     days. */
  for (const v of detail?.visits ?? []) {
    entries.push({
      kind: "visit",
      key: `visit:${v.day}`,
      day: v.day,
      at: null,
      minutes: v.minutes,
      crew: [...v.crew],
    });
  }

  /* Photos — clustered per day, four tiles then "+N" into the Photos tab.
     The media read lists newest-first, so a cluster's first four are the
     day's latest. Only photos cluster: documents belong to the Documents
     tab, and a video is named there, not here. */
  const photoDays = new Map<string, StoryPhoto[]>();
  for (const m of inputs.media ?? []) {
    if (m.kind !== "photo") continue;
    const day = dayOf(m.takenAt);
    if (!day) continue;
    const list = photoDays.get(day) ?? [];
    list.push({ remoteId: m.remoteId, name: m.name, url: m.url, fromClaim: m.fromClaim });
    photoDays.set(day, list);
  }
  for (const [day, photos] of photoDays) {
    entries.push({
      kind: "photos",
      key: `photos:${day}`,
      day,
      at: null,
      count: photos.length,
      shown: photos.slice(0, STORY_PHOTOS_SHOWN),
    });
  }

  /* Money — claims for a family, payment rows for a plain job, never both:
     the parent's own payments ARE its final claim settling, and saying it
     twice is how a feed stops being trusted. */
  const family = inputs.family;
  if (family?.isFamily) {
    const last = [...family.claims].sort((a, b) => a.index - b.index).at(-1) ?? null;
    for (const c of family.claims) {
      if (c.raisedOn) {
        entries.push(claimEntry(c, "raised", c.raisedOn, last));
      }
      /* Settled only when the derivation SAYS settled. A part payment shows
         in the block's ledger; an event claiming "settled" on it would be
         the feed passing a verdict the derivation refused. */
      if (c.state === "paid" && c.paidOn) {
        entries.push(claimEntry(c, "settled", c.paidOn, last));
      }
    }
  } else {
    for (const p of inputs.ledger?.payments ?? []) {
      const day = dayOf(p.takenAt) ?? p.takenOn;
      if (!day) continue;
      entries.push({
        kind: "payment",
        key: `payment:${p.remoteId}`,
        day,
        at: p.takenAt ?? null,
        amountCents: p.amountCents,
        method: p.method,
        takenBy: p.takenBy,
        isDeposit: p.isDeposit,
      });
    }
    if (inputs.invoicedOn) {
      entries.push({
        kind: "milestone",
        key: "milestone:invoiced",
        day: inputs.invoicedOn,
        at: null,
        label: "Invoice raised",
      });
    }
  }

  /* Ticks — completed checklist items only. The story records what happened;
     what hasn't yet is the Checklist tab's business. */
  for (const [i, item] of (detail?.checklist ?? []).entries()) {
    if (!item.done || !item.doneOn) continue;
    entries.push({
      kind: "tick",
      key: `tick:${i}:${item.name}`,
      day: item.doneOn,
      at: null,
      name: item.name,
      by: item.doneBy,
    });
  }

  /* Our own contributions — a Studio design touched, materials pushed onto
     the picklist. HeyTiff's acts belong in the same stream as ServiceM8's.
     `picked_by` holds an auth id, not a name, so a picklist tick stays a
     quiet line rather than printing an identifier at somebody. */
  for (const d of detail?.designs ?? []) {
    const at = naiveInZone(d.updatedAt, inputs.timezone);
    const day = dayOf(at);
    if (!day) continue;
    entries.push({ kind: "design", key: `design:${d.id}`, day, at, id: d.id, name: d.name });
  }
  const pushDays = new Map<string, { at: string; count: number }>();
  for (const item of inputs.picklist ?? []) {
    const at = naiveInZone(item.addedAt, inputs.timezone);
    const day = dayOf(at);
    if (!at || !day) continue;
    const cur = pushDays.get(day);
    if (cur) {
      cur.count += 1;
      if (at < cur.at) cur.at = at;
    } else {
      pushDays.set(day, { at, count: 1 });
    }
  }
  for (const [day, p] of pushDays) {
    entries.push({ kind: "push", key: `push:${day}`, day, at: p.at, count: p.count });
  }

  /* The job's own dates. Date-only facts, sunk to their day's end. */
  const milestone = (label: MilestoneLabel, on: string | null | undefined, key: string) => {
    const day = dayOf(on);
    if (day) entries.push({ kind: "milestone", key: `milestone:${key}`, day, at: null, label });
  };
  milestone("Job raised", detail?.date, "raised");
  milestone("Quote sent", detail?.quoteDate, "quoted");
  milestone("Became a work order", detail?.workOrderDate, "workorder");
  milestone("Job completed", detail?.completionDate, "completed");

  entries.sort((a, b) => (a.day !== b.day ? (a.day < b.day ? 1 : -1) : compareWithinDay(a, b)));
  return entries;
}

function claimEntry(
  c: FamilyClaim,
  event: "raised" | "settled",
  day: string,
  last: FamilyClaim | null
): StoryEntry {
  return {
    kind: "claim",
    key: `claim:${c.remoteId}:${event}`,
    day,
    at: null,
    event,
    remoteId: c.remoteId,
    title: claimTitle(c),
    jobNumber: c.jobNumber,
    amountCents: c.amountCents,
    isFinal: last !== null && c.index === last.index,
  };
}

/** The feed, day-grouped for the markers. Days arrive already newest-first. */
export function groupStoryDays(entries: readonly StoryEntry[]): StoryDay[] {
  const days: StoryDay[] = [];
  for (const e of entries) {
    const cur = days[days.length - 1];
    if (cur && cur.day === e.day) cur.entries.push(e);
    else days.push({ day: e.day, entries: [e] });
  }
  return days;
}

/** One filter's slice of the feed. "Money" covers the claim events, the
    payment rows and the invoice milestone — everything the grant gates. */
export function filterStory(
  entries: readonly StoryEntry[],
  filter: StoryFilter
): StoryEntry[] {
  if (filter === "all") return [...entries];
  return entries.filter((e) => {
    switch (filter) {
      case "notes":
        return e.kind === "note";
      case "photos":
        return e.kind === "photos";
      case "visits":
        return e.kind === "visit";
      case "money":
        return (
          e.kind === "claim" ||
          e.kind === "payment" ||
          (e.kind === "milestone" && e.label === "Invoice raised")
        );
    }
  });
}

/** The day the story began — "Since Mon 12 Jan" at the diary's head. */
export function storySince(entries: readonly StoryEntry[]): string | null {
  return entries.length > 0 ? entries[entries.length - 1].day : null;
}

/* ── the summary's side of the module ── */

/** The identity of "what the story currently says", for the refresh rule:
    the stored summary is stale exactly when this string moves. The newest
    entry's own identity carries most changes; the count catches a backfilled
    entry landing in the past, which would otherwise never re-write. */
export function storyStamp(entries: readonly StoryEntry[]): string | null {
  if (entries.length === 0) return null;
  const newest = entries[0];
  return [newest.day, newest.at ?? "", newest.key, String(entries.length)].join("|");
}

/** What moved the summary, in the stamp's own words — "Updated Sat 22 Aug ·
    the final payment". Short, definite, derived — never generated. */
export function storyEventLabel(entry: StoryEntry): string {
  switch (entry.kind) {
    case "note": {
      const first = entry.author?.split(/\s+/)[0];
      return first ? `${first}'s note` : "a note";
    }
    case "visit":
      return "a site visit";
    case "photos":
      return entry.count === 1 ? "a new photo" : "new photos";
    case "claim":
      if (entry.event === "settled")
        return entry.isFinal ? "the final payment" : "a payment";
      return "a new invoice";
    case "payment":
      return "a payment";
    case "tick":
      return "a ticked item";
    case "design":
      return "a Studio design";
    case "push":
      return "the materials list";
    case "milestone":
      switch (entry.label) {
        case "Job raised":
          return "the job being raised";
        case "Quote sent":
          return "the quote";
        case "Became a work order":
          return "the work order";
        case "Job completed":
          return "completion";
        case "Invoice raised":
          return "the invoice";
      }
  }
}

/** The day the stamp names. The stamp's first field is the newest entry's
    day — split rather than re-derived so the two can never disagree. */
export function stampDay(stamp: string): string | null {
  const day = stamp.split("|")[0];
  return day && day.length === 10 ? day : null;
}

/** One entry, as a line of the writer's prompt. The summary is written FROM
    these lines and nothing else — see the module header. Amounts are spelled
    in dollars so the model never does cents arithmetic. */
export function storyLineOf(entry: StoryEntry): string {
  const when = entry.at ? `${entry.day} ${entry.at.slice(11, 16)}` : entry.day;
  switch (entry.kind) {
    case "note": {
      const who = entry.author ? ` by ${entry.author}` : "";
      const flag = entry.actionRequired ? " [action required]" : "";
      return `${when} — note${who}${flag}: "${entry.text}"`;
    }
    case "visit": {
      const crew = entry.crew.length > 0 ? entry.crew.join(", ") : "crew unnamed";
      return `${when} — site visit, ${fmtStoryMinutes(entry.minutes)} (${crew})`;
    }
    case "photos":
      return `${when} — ${entry.count} photo${entry.count === 1 ? "" : "s"} added`;
    case "claim": {
      const amount = entry.amountCents !== null ? ` — ${fmtStoryAud(entry.amountCents)}` : "";
      return `${when} — ${entry.title} ${entry.event}${amount}`;
    }
    case "payment": {
      const amount = entry.amountCents !== null ? ` of ${fmtStoryAud(entry.amountCents)}` : "";
      const method = entry.method ? ` via ${entry.method}` : "";
      return `${when} — ${entry.isDeposit ? "deposit" : "payment"}${amount} received${method}`;
    }
    case "tick":
      return `${when} — checked off: ${entry.name}${entry.by ? ` (${entry.by})` : ""}`;
    case "design":
      return `${when} — Studio design "${entry.name}" edited`;
    case "push":
      return `${when} — ${entry.count} material line${entry.count === 1 ? "" : "s"} pushed to the picklist from the Studio`;
    case "milestone":
      return `${when} — ${entry.label}`;
  }
}

export function fmtStoryMinutes(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function fmtStoryAud(cents: number): string {
  const dollars = cents / 100;
  return dollars.toLocaleString("en-AU", {
    style: "currency",
    currency: "AUD",
    minimumFractionDigits: 2,
  });
}

/** What an empty diary says it looked at — never a blank pane. The money
    words appear only when the money inputs were on the table at all. */
export function emptyStoryLine(moneyVisible: boolean): string {
  return moneyVisible
    ? "Nothing in the diary yet. Checked notes, visits, payments, photos and checklists."
    : "Nothing in the diary yet. Checked notes, visits, photos and checklists.";
}
