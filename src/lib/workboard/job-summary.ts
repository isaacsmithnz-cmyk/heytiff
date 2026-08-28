import Anthropic from "@anthropic-ai/sdk";
import { supabaseAdmin } from "@/lib/supabase-server";
import { getSm8Timezone } from "./query";
import { todayInZone } from "./dates";
import {
  familyMediaSources,
  readJobFamily,
  readJobLedger,
  readJobNotes,
  readMirrorJobDetail,
  resolveJobCard,
} from "./all-jobs-query";
import { readJobMedia } from "./job-media-query";
import { fmtAud } from "./project-money";
import { claimTitle, type FamilyMoney } from "./job-family";
import type { JobMoney } from "./job-money";
import {
  buildJobStory,
  stampDay,
  storyEventLabel,
  storyLineOf,
  storyStamp,
  type StoryEntry,
} from "./job-story";

/* "WHERE IT'S UP TO" — the paragraph at the top of the job card.

   THE STORY IS THE INPUT. The summary is written from the same merge the
   Diary tab renders, serialised line by line, and from nothing else — a fact
   that isn't a story entry cannot be in the summary, which is what makes a
   wrong sentence traceable. Figures are handed in ALREADY DERIVED (the same
   FamilyMoney the money block renders); the model narrates them, it never
   computes them.

   REFRESHED WHEN THE STORY MOVES, NEVER ON OPEN. The stored paragraph
   renders instantly; a write runs only when the story's stamp has left the
   stored one behind. A quiet job costs nothing, a busy one about a cent per
   change — `effort` is the lever, and a long Claude call lives in a route
   handler, both per the fleet-valuations law.

   TWO FIELDS, ONE CALL. The work narrative is for everyone; the money
   sentence rides the same `workboard_money` gate the Money tab does, so the
   writer keeps them in separate fields and the reader strips one at the
   door. The work field is told to carry NO figures at all — a dollar amount
   in the ungated field would be the gate leaking by prose. */

const MODEL = "claude-opus-5";
const MAX_TOKENS = 2000;

/* THE SHAPE IS STRUCTURED, NOT A PARAGRAPH (Isaac, 2026-08-28): one LEAD
   sentence — the job's state at a glance — over a handful of POINTS, each a
   single fact on its own line. The reader scans the lead, then only the
   lines that concern them; a wrong line is also easier to trace than a
   wrong clause buried mid-paragraph. */

/** Clamped on our side as well as asked of the model, because a rule the
    schema can't state is a rule that will eventually be broken. */
const MAX_LEAD_CHARS = 200;
const MAX_POINT_CHARS = 180;
const MAX_POINTS = 5;
const MAX_MONEY_CHARS = 300;

export type JobSummaryRead = {
  /** One sentence — the job's state at a glance. */
  lead: string;
  /** Short single-fact lines under it: progress, what's next, loose ends. */
  points: string[];
  /** Null for a reader without money — stripped by the caller at the gate —
      and null when the job has no money facts to speak of. */
  money: string | null;
  stamp: string;
  /** The day of the newest event the summary was written at. */
  eventOn: string | null;
  /** What moved it — "the final payment", "Nathan's note". */
  eventLabel: string | null;
};

type SummaryRow = {
  work_summary: string;
  work_points: unknown;
  money_summary: string | null;
  story_stamp: string;
  event_on: string | null;
  event_label: string | null;
};

/** The points column is jsonb; only an array of strings is believed. */
function pointsOf(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((p): p is string => typeof p === "string" && p.trim().length > 0);
}

export async function readStoredJobSummary(
  orgId: string,
  jobUuid: string
): Promise<JobSummaryRead | null> {
  const { data } = await supabaseAdmin
    .from("job_summaries")
    .select("work_summary, work_points, money_summary, story_stamp, event_on, event_label")
    .eq("org_id", orgId)
    .eq("job_uuid", jobUuid)
    .maybeSingle();
  const row = data as SummaryRow | null;
  if (!row) return null;
  return {
    lead: row.work_summary,
    points: pointsOf(row.work_points),
    money: row.money_summary,
    stamp: row.story_stamp,
    eventOn: row.event_on,
    eventLabel: row.event_label,
  };
}

/* ── the server's own story build, for the writer ── */

export type JobStoryServerRead = {
  /** The card's own uuid — the PARENT's, when a clone's id was handed in. */
  cardId: string;
  entries: StoryEntry[];
  stamp: string | null;
  scope: string | null;
  workDone: string | null;
  status: string | null;
  clientName: string | null;
  family: FamilyMoney | null;
  money: JobMoney | null;
  ledgerPaidCents: number;
};

/** The same inputs the card fetches, assembled where the writer runs. The
    writer reads EVERYTHING (admin reads — the stored fields are what get
    gated, not the writing of them), so a reader without money can still
    trigger a refresh whose money sentence waits for someone who may see it. */
export async function readJobStoryForSummary(
  orgId: string,
  remoteId: string
): Promise<JobStoryServerRead | null> {
  const target = await resolveJobCard(orgId, remoteId);
  const cardId = target.parentRemoteId;
  const timezone = await getSm8Timezone(orgId);
  const today = todayInZone(timezone);

  const detail = await readMirrorJobDetail(orgId, cardId, today, {
    includeMoney: true,
    includeDesigns: true,
    timezone,
  });
  if (!detail) return null;

  const claims = await familyMediaSources(orgId, cardId);
  const [notes, ledger, family, media, picklist] = await Promise.all([
    readJobNotes(orgId, cardId, claims),
    readJobLedger(orgId, cardId),
    readJobFamily(orgId, cardId, today, null),
    readJobMedia(orgId, cardId, claims),
    readPicklistStamps(orgId, cardId),
  ]);

  const entries = buildJobStory({
    detail,
    notes,
    ledger,
    family,
    invoicedOn: family?.isFamily ? null : detail.money?.invoicedOn ?? null,
    media: media.items,
    picklist,
    timezone,
  });

  return {
    cardId,
    entries,
    stamp: storyStamp(entries),
    scope: detail.description,
    workDone: detail.workDone,
    status: detail.status,
    clientName: detail.clientName,
    family,
    money: detail.money,
    ledgerPaidCents: ledger.payments.reduce((sum, p) => sum + (p.amountCents ?? 0), 0),
  };
}

async function readPicklistStamps(
  orgId: string,
  jobUuid: string
): Promise<{ addedAt: string; pickedAt: string | null }[]> {
  const { data } = await supabaseAdmin
    .from("job_picklist_items")
    .select("added_at, picked_at")
    .eq("org_id", orgId)
    .eq("sm8_job_uuid", jobUuid);
  return ((data ?? []) as { added_at: string; picked_at: string | null }[]).map((r) => ({
    addedAt: r.added_at,
    pickedAt: r.picked_at,
  }));
}

/* ── the writer ── */

const SUMMARY_SCHEMA = {
  type: "object",
  properties: {
    lead: { type: "string" },
    points: { type: "array", items: { type: "string" } },
    money: { type: ["string", "null"] },
  },
  required: ["lead", "points", "money"],
  additionalProperties: false,
};

/** The derived figures, spelled out for the narrator. Every amount here
    comes off the same derivation the money block renders — the model is
    told these are the ONLY figures it may repeat. */
export function moneyFactsFor(read: {
  family: FamilyMoney | null;
  money: JobMoney | null;
  ledgerPaidCents: number;
}): string[] {
  const lines: string[] = [];
  const family = read.family;
  if (family?.isFamily) {
    if (family.valueCents !== null)
      lines.push(
        `Job value ${fmtAud(family.valueCents)}${family.basis === "inc" ? " inc GST" : family.basis === "ex" ? " ex GST" : ""}`
      );
    if (family.invoicedCents !== null && family.toComeCents !== null && family.toComeCents > 0)
      lines.push(
        `${fmtAud(family.invoicedCents)} invoiced so far — ${fmtAud(family.toComeCents)} to come`
      );
    if (family.paidCents > 0) lines.push(`${fmtAud(family.paidCents)} paid`);
    if (family.awaitingCents !== null && family.awaitingCents > 0)
      lines.push(`${fmtAud(family.awaitingCents)} awaiting payment`);
    if (
      family.valueCents !== null &&
      family.paidCents >= family.valueCents &&
      family.awaitingCents === 0 &&
      family.toComeCents === 0
    )
      lines.push("Paid in full");
    for (const c of family.claims) {
      const bits = [
        claimTitle(c),
        c.amountCents !== null ? fmtAud(c.amountCents) : "amount unknown",
        c.state === "paid"
          ? "paid"
          : c.state === "part"
            ? "part paid"
            : c.state === "awaiting"
              ? "awaiting payment"
              : c.state === "not_invoiced"
                ? "not yet invoiced"
                : c.state === "paid_unknown"
                  ? "part or all paid"
                  : "amount unknown",
      ];
      lines.push(bits.join(" · "));
    }
    return lines;
  }
  const money = read.money;
  if (!money) return lines;
  if (money.valueCents !== null) {
    /* ServiceM8's job total is inc GST by definition — see JobMoney. */
    lines.push(`Job value ${fmtAud(money.valueCents)} inc GST`);
    if (read.ledgerPaidCents >= money.valueCents && money.valueCents > 0) lines.push("Paid in full");
  }
  if (read.ledgerPaidCents > 0 && (money.valueCents === null || read.ledgerPaidCents < money.valueCents))
    lines.push(`${fmtAud(read.ledgerPaidCents)} paid so far`);
  return lines;
}

export function summaryPrompt(read: JobStoryServerRead, moneyFacts: string[]): string {
  const story = read.entries.map(storyLineOf).join("\n");
  const parts = [
    `Job status: ${read.status ?? "unknown"}`,
    read.scope ? `The job, in the office's own words:\n${read.scope}` : null,
    read.workDone ? `What was done, in the office's own words:\n${read.workDone}` : null,
    moneyFacts.length > 0 ? `Derived money facts (the ONLY figures you may use):\n${moneyFacts.join("\n")}` : null,
    `The job's record, newest first:\n${story}`,
  ];
  return parts.filter(Boolean).join("\n\n");
}

const SYSTEM_PROMPT =
  "You write the short, structured \"Where it's up to\" block at the top of a job card for " +
  "a small Australian HVAC company. You are handed one job's record — its events newest " +
  "first, its scope, and sometimes a list of derived money facts. Plain Australian trade " +
  "English throughout.\n\n" +
  "Write `lead`: ONE short sentence — the job's state at a glance, past what the scope " +
  "already says. It should read like the job: a fresh quote reads like a quote, a job " +
  "mid-install reads like a site report, a finished job reads like a handover. The " +
  "freshest state, not the history.\n\n" +
  "Write `points`: two to four lines, each ONE concrete fact from the record on its own — " +
  "never two facts joined into one line. Order them: what's been done or is under way " +
  "first, then what's booked or coming next, then any loose end last (an open note may be " +
  "quoted briefly, with who wrote it). Each line under twenty words, no trailing filler. " +
  "Skip a category that has nothing real in it — fewer good lines beat padding. Name " +
  "people only as the record names them. Never invent a fact, a date or a reason the " +
  "record doesn't state; say less rather than guess. STRICTLY no dollar figures, prices " +
  "or payment states in `lead` or `points` — money is not yours to mention there, even " +
  "when the record shows it.\n\n" +
  "Write `money`: one sentence on where the money is up to, using ONLY the derived money " +
  "facts, with the figures repeated exactly as given — never recomputed, added or rounded. " +
  "Say how the billing is structured when it is (deposit, progress, final). If no money " +
  "facts were provided, or they say nothing worth a sentence, return null.\n\n" +
  "No headings, no exclamation marks, and never mention this system, the mirror, " +
  "ServiceM8's internals, or that anything was generated.";

export type SummaryWriteResult =
  | { ok: true; lead: string; points: string[]; money: string | null }
  | { ok: false; reason: string };

function reasonFor(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return "The writer is offline — API key rejected.";
  if (err instanceof Anthropic.RateLimitError) return "The writer is busy — try again in a minute.";
  if (err instanceof Anthropic.APIConnectionError) return "Couldn't reach the writer.";
  if (err instanceof Anthropic.APIError) return "The writer hit an API error.";
  return "The summary couldn't be written.";
}

export async function runSummaryWrite(
  read: JobStoryServerRead,
  client: Anthropic = new Anthropic()
): Promise<SummaryWriteResult> {
  const moneyFacts = moneyFactsFor(read);
  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      /* Low effort on purpose: this is compression of a handed-over record,
         not reasoning, and effort is the cost lever (~a cent a change). */
      output_config: {
        effort: "low",
        format: { type: "json_schema", schema: SUMMARY_SCHEMA },
      },
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: summaryPrompt(read, moneyFacts) }],
    });

    if (response.stop_reason === "refusal")
      return { ok: false, reason: "The writer declined this job." };

    const block = response.content.find((b) => b.type === "text");
    if (!block || block.type !== "text")
      return { ok: false, reason: "The writer returned nothing." };

    const parsed = JSON.parse(block.text) as {
      lead?: unknown;
      points?: unknown;
      money?: unknown;
    };
    const lead = typeof parsed.lead === "string" ? parsed.lead.trim().slice(0, MAX_LEAD_CHARS) : "";
    if (!lead) return { ok: false, reason: "The writer returned nothing." };
    /* The schema says array-of-strings; the clamps say how many and how
       long. A lead with no points is a legitimate answer for a quiet job. */
    const points = (Array.isArray(parsed.points) ? parsed.points : [])
      .filter((p): p is string => typeof p === "string" && p.trim().length > 0)
      .map((p) => p.trim().slice(0, MAX_POINT_CHARS))
      .slice(0, MAX_POINTS);
    const money =
      typeof parsed.money === "string" && parsed.money.trim() && moneyFacts.length > 0
        ? parsed.money.trim().slice(0, MAX_MONEY_CHARS)
        : null;
    return { ok: true, lead, points, money };
  } catch (err) {
    return { ok: false, reason: reasonFor(err) };
  }
}

/* ── the whole refresh, for the route ── */

export type SummaryRefreshResult =
  | { ok: true; summary: JobSummaryRead | null; wrote: boolean }
  | { ok: false; reason: string };

/** Derive, compare, maybe write, store. The stamp comparison is the cost
    guard: a client that asks again out of confusion costs a derive, never a
    second model call. */
export async function refreshJobSummary(
  orgId: string,
  remoteId: string,
  client?: Anthropic
): Promise<SummaryRefreshResult> {
  const read = await readJobStoryForSummary(orgId, remoteId);
  if (!read) return { ok: false, reason: "That job isn't in the mirror." };

  /* A story with no events has nothing to summarise — and nothing to be
     stale against. The scope alone carries the card. */
  if (!read.stamp || read.entries.length === 0) return { ok: true, summary: null, wrote: false };

  const stored = await readStoredJobSummary(orgId, read.cardId);
  if (stored && stored.stamp === read.stamp) return { ok: true, summary: stored, wrote: false };

  const written = await runSummaryWrite(read, client);
  if (!written.ok) return { ok: false, reason: written.reason };

  const newest = read.entries[0];
  const summary: JobSummaryRead = {
    lead: written.lead,
    points: written.points,
    money: written.money,
    stamp: read.stamp,
    eventOn: stampDay(read.stamp) ?? newest.day,
    eventLabel: storyEventLabel(newest),
  };

  const { error } = await supabaseAdmin.from("job_summaries").upsert(
    {
      org_id: orgId,
      job_uuid: read.cardId,
      work_summary: summary.lead,
      work_points: summary.points,
      money_summary: summary.money,
      story_stamp: summary.stamp,
      event_on: summary.eventOn,
      event_label: summary.eventLabel,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "org_id,job_uuid" }
  );
  if (error) return { ok: false, reason: "The summary couldn't be saved." };

  return { ok: true, summary, wrote: true };
}
