import Anthropic from "@anthropic-ai/sdk";
import { supabaseAdmin } from "@/lib/supabase-server";
import { getSm8Timezone } from "@/lib/workboard/query";
import { todayInZone } from "@/lib/workboard/dates";
import {
  familyMediaSources,
  readJobNotes,
  readMirrorJobDetail,
  resolveJobCard,
} from "@/lib/workboard/all-jobs-query";
import {
  EXTRA_NOTES,
  EXTRA_NOTE_KEYS,
  MAX_OPTIONS,
  normaliseDraft,
  type ProposalDraft,
} from "./proposal";

/* THE PROPOSAL WRITER — what a person says about a job, into the house
   layout's fields.

   The writer is handed the job as the mirror holds it (address, client,
   the office's scope, the latest notes) and the words the person said, and
   hands back fields — never a page. The page is drawn by ./proposal, so two
   drafts of two jobs come out in the same order and the same dress however
   the words were said.

   A CHANGE IS THE SAME CALL with the current draft and what to change. "Add
   a second option with the unit on the ground", "which option is better?"
   and "make the intro shorter" are all one mechanism: the whole draft goes
   back, changed where asked and untouched elsewhere.

   A route handler calls this, for the reason the job summary's does: a
   Claude call is seconds and `maxDuration` is a route-segment option. */

export const MODEL = "claude-opus-5-5";
/* If the model declines on policy grounds, the API re-runs the same request
   on this one inside the same call rather than returning nothing. */
const FALLBACK_MODEL = "claude-opus-4-8";
const MAX_TOKENS = 8000;

/** What a draft is written from, read where the writer runs. */
export type ProposalJob = {
  /** The card's own uuid — the PARENT's, when a claim's id was handed in. */
  cardId: string;
  jobNumber: string | null;
  address: string | null;
  clientName: string | null;
  /** The first job contact's first name, for the greeting. */
  contactFirstName: string | null;
  category: string | null;
  scope: string | null;
  /** Newest first, text only. */
  notes: string[];
};

const MAX_NOTES = 8;
const MAX_NOTE_CHARS = 600;

export async function readProposalJob(orgId: string, remoteId: string): Promise<ProposalJob | null> {
  const target = await resolveJobCard(orgId, remoteId);
  const cardId = target.parentRemoteId;
  const timezone = await getSm8Timezone(orgId);
  const detail = await readMirrorJobDetail(orgId, cardId, todayInZone(timezone), {
    includeMoney: false,
    timezone,
  });
  if (!detail) return null;
  const notes = await readJobNotes(orgId, cardId, await familyMediaSources(orgId, cardId));
  const contact = detail.contacts.find((c) => c.name.trim());
  return {
    cardId,
    jobNumber: detail.jobNumber,
    address: detail.address ?? detail.geoLine,
    clientName: detail.clientName,
    contactFirstName: contact ? contact.name.trim().split(/\s+/)[0] ?? null : null,
    category: detail.categoryName,
    scope: detail.description?.trim() || null,
    notes: notes
      .map((n) => n.text.trim())
      .filter(Boolean)
      .slice(0, MAX_NOTES)
      .map((t) => t.slice(0, MAX_NOTE_CHARS)),
  };
}

/* ── the call ── */

const DRAFT_SCHEMA = {
  type: "object",
  properties: {
    intro: { type: "string" },
    options: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          lines: { type: "array", items: { type: "string" } },
          pros: { type: "array", items: { type: "string" } },
          cons: { type: "array", items: { type: "string" } },
        },
        required: ["name", "lines", "pros", "cons"],
        additionalProperties: false,
      },
    },
    pricing_mode: { type: "string", enum: ["multiple_choice", "optional"] },
    notes: { type: "array", items: { type: "string", enum: EXTRA_NOTE_KEYS } },
    questions: { type: "array", items: { type: "string" } },
  },
  required: ["intro", "options", "pricing_mode", "notes", "questions"],
  additionalProperties: false,
};

const NOTE_LIBRARY = EXTRA_NOTE_KEYS.map(
  (k) => `- ${k}: "${EXTRA_NOTES[k].heading}" — ${EXTRA_NOTES[k].lines.join(" ")}`
).join("\n");

export const SYSTEM_PROMPT = `You fill in a quote proposal for Diamond Air Solutions, an air-conditioning installer in Sydney. The office sends these through ServiceM8 Proposals. The layout is fixed and drawn by the software; you only fill its fields. Write plain Australian trade English, the way the owner writes to a client: short, direct, specific. No sales talk, no filler, no exclamation marks.

The fields:

intro — Starts with "Hi <first name>," on its own line when the first name is known, otherwise "Hi," alone. Then one to three short sentences: why the client is getting this proposal and, when there is more than one option, that there are options to choose from. Nothing the options themselves already say.

options — One per real choice the client has. When the scope has only one way of doing the job, there is one option. Each has:
- name: a few words naming the option, e.g. "Install client-supplied 6 kW split", "Repair", "Replace with a 7 kW Daikin ducted system". Never "Option 1".
- lines: the scope, one fact per line, in the order the work happens. No leading dash. Follow the office's own phrasing:
  "Installation of a 7 kW Mitsubishi Electric split system. (MSZ-AP71VGD)"
  "Removal of the existing AC unit."
  "Outdoor unit mounted on the wall on brackets."
  "Indoor unit installed on the living room wall."
  "Pipes run through the ceiling space and down the wall cavity."
  "Power supplied from a new circuit at the switchboard."
  "Drain will be run to a suitable point."
  Write capacities as "3.5 kW". Put a model number in brackets only when it was given. Mention access work (roof tiles, ceiling space, EWP, wall cavity) as its own line when it is part of the job.
- pros, cons: only when the options are genuinely different ways of doing the job (repair or replace, one brand or another, one unit location or another), two or three short points each. With a single option, leave both empty. When asked which option is better, fill them and say the recommendation in one sentence at the end of the intro.

pricing_mode — "multiple_choice" when the client picks one option. "optional" when each block is a separate area or add-on they can take any of (for example "Downstairs" and "Upstairs"); then name each block by its area.

notes — Keys for the extra notes this job needs, beyond the office's standard notes (pipe coverings, grilles, general exclusions, compliance and warranty, which are always included and you never repeat). Pick only what applies:
${NOTE_LIBRARY}

questions — What the office still needs to find out before this can go to the client, as short direct questions: an unknown model, a pipe or cable run length that decides materials, how the drain falls, roof or height safety, strata, access, how many people and how long. Only what is really missing from what you were told; none when nothing is.

Never invent a model number, a measurement, a price or a fact you were not told. Never mention prices at all: pricing is added separately. Never mention this software or that anything was generated.`;

export function jobBlock(job: ProposalJob): string {
  const parts = [
    `Job ${job.jobNumber ?? "(no number)"}`,
    job.clientName ? `Client: ${job.clientName}` : null,
    job.contactFirstName ? `Contact's first name: ${job.contactFirstName}` : null,
    job.address ? `Site: ${job.address.replace(/\n+/g, ", ")}` : null,
    job.category ? `Job type: ${job.category}` : null,
    job.scope ? `The office's description of the job:\n${job.scope}` : null,
    job.notes.length ? `Notes on the job, newest first:\n${job.notes.map((n) => `- ${n}`).join("\n")}` : null,
  ];
  return parts.filter(Boolean).join("\n");
}

/** The user turn for a first draft. */
export function draftPrompt(job: ProposalJob, brief: string): string {
  return `${jobBlock(job)}\n\nWhat was said about the job after the site visit:\n${brief.trim()}\n\nFill in the proposal.`;
}

/** The user turn for a change to a draft. The brief rides along so a change
    can't lose what the draft was written from. */
export function changePrompt(
  job: ProposalJob,
  brief: string,
  draft: ProposalDraft,
  change: string
): string {
  const current = JSON.stringify({
    intro: draft.intro,
    options: draft.options,
    pricing_mode: draft.pricingMode,
    notes: draft.notes,
    questions: draft.questions,
  });
  return (
    `${jobBlock(job)}\n\nWhat was said about the job after the site visit:\n${brief.trim()}\n\n` +
    `The proposal as it stands:\n${current}\n\n` +
    `Change it as asked, and keep everything not asked about exactly as it is. ` +
    `Answers to the questions go into the scope, and answered questions come off the list. ` +
    `At most ${MAX_OPTIONS} options.\n\nThe change:\n${change.trim()}`
  );
}

export type WriteResult = { ok: true; draft: ProposalDraft } | { ok: false; reason: string };

function reasonFor(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return "Tiff is offline: the API key was rejected.";
  if (err instanceof Anthropic.RateLimitError) return "Tiff is busy. Try again in a minute.";
  if (err instanceof Anthropic.APIConnectionError) return "Tiff couldn't be reached. Try again.";
  if (err instanceof Anthropic.APIError) return "Tiff hit an error writing the proposal. Try again.";
  return "The proposal couldn't be written. Try again.";
}

export async function runProposalWrite(
  userTurn: string,
  client: Anthropic = new Anthropic()
): Promise<WriteResult> {
  try {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      betas: ["server-side-fallback-2026-06-01"],
      fallbacks: [{ model: FALLBACK_MODEL }],
      /* Medium, set rather than left to the default: this is careful
         writing from a handed-over brief, not open reasoning. */
      output_config: {
        effort: "medium",
        format: { type: "json_schema", schema: DRAFT_SCHEMA },
      },
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userTurn }],
    });

    if (response.stop_reason === "refusal") return { ok: false, reason: "Tiff declined to write this one." };
    if (response.stop_reason === "max_tokens") return { ok: false, reason: "The proposal ran too long. Try a shorter brief." };

    const block = response.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") return { ok: false, reason: "Tiff returned nothing. Try again." };
    const draft = normaliseDraft(JSON.parse(block.text));
    if (!draft) return { ok: false, reason: "Tiff returned no scope. Say a little more about the job." };
    return { ok: true, draft };
  } catch (err) {
    if (err instanceof SyntaxError) return { ok: false, reason: "Tiff's answer couldn't be read. Try again." };
    return { ok: false, reason: reasonFor(err) };
  }
}

/* ── the stored draft ── */

export type StoredProposal = {
  cardId: string;
  draft: ProposalDraft;
  brief: string;
  /** The changes asked for since the first draft, oldest first. */
  changes: string[];
  updatedAt: string;
};

type Row = { sm8_job_uuid: string; draft: unknown; brief: string; changes: unknown; updated_at: string };

const MAX_CHANGES_KEPT = 30;

function storedOf(row: Row | null): StoredProposal | null {
  if (!row) return null;
  const draft = normaliseDraft(row.draft);
  if (!draft) return null;
  return {
    cardId: row.sm8_job_uuid,
    draft,
    brief: row.brief,
    changes: Array.isArray(row.changes) ? row.changes.filter((c): c is string => typeof c === "string") : [],
    updatedAt: row.updated_at,
  };
}

export async function readStoredProposal(orgId: string, cardId: string): Promise<StoredProposal | null> {
  const { data } = await supabaseAdmin
    .from("quote_drafts")
    .select("sm8_job_uuid, draft, brief, changes, updated_at")
    .eq("org_id", orgId)
    .eq("sm8_job_uuid", cardId)
    .maybeSingle();
  return storedOf(data as Row | null);
}

export async function storeProposal(
  orgId: string,
  userId: string,
  cardId: string,
  draft: ProposalDraft,
  brief: string,
  changes: string[]
): Promise<StoredProposal | null> {
  const now = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from("quote_drafts")
    .upsert(
      {
        org_id: orgId,
        sm8_job_uuid: cardId,
        draft,
        brief,
        changes: changes.slice(-MAX_CHANGES_KEPT),
        updated_by: userId,
        updated_at: now,
      },
      { onConflict: "org_id,sm8_job_uuid" }
    )
    .select("sm8_job_uuid, draft, brief, changes, updated_at")
    .single();
  if (error) return null;
  return storedOf(data as Row);
}

/* ── the whole write, for the route ── */

export type ProposalRequest =
  | { kind: "draft"; brief: string }
  | { kind: "change"; change: string };

export type ProposalResult = { ok: true; proposal: StoredProposal } | { ok: false; reason: string };

export async function writeProposal(
  orgId: string,
  userId: string,
  remoteId: string,
  req: ProposalRequest,
  client?: Anthropic
): Promise<ProposalResult> {
  const job = await readProposalJob(orgId, remoteId);
  if (!job) return { ok: false, reason: "That job isn't in HeyTiff's copy of ServiceM8." };

  if (req.kind === "draft") {
    const written = await runProposalWrite(draftPrompt(job, req.brief), client);
    if (!written.ok) return written;
    const stored = await storeProposal(orgId, userId, job.cardId, written.draft, req.brief.trim(), []);
    return stored ? { ok: true, proposal: stored } : { ok: false, reason: "The proposal couldn't be saved. Try again." };
  }

  const current = await readStoredProposal(orgId, job.cardId);
  if (!current) return { ok: false, reason: "There's no proposal on this job to change. Draft one first." };
  const written = await runProposalWrite(changePrompt(job, current.brief, current.draft, req.change), client);
  if (!written.ok) return written;
  const stored = await storeProposal(orgId, userId, job.cardId, written.draft, current.brief, [
    ...current.changes,
    req.change.trim(),
  ]);
  return stored ? { ok: true, proposal: stored } : { ok: false, reason: "The proposal couldn't be saved. Try again." };
}
