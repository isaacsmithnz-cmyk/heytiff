import Anthropic from "@anthropic-ai/sdk";
import { SM8_BRIEF_HEAD } from "./sm8-quote-brief";
import { supabaseAdmin } from "@/lib/supabase-server";
import { getSm8Timezone } from "@/lib/workboard/query";
import { todayInZone } from "@/lib/workboard/dates";
import {
  familyMediaSources,
  readJobNotes,
  readMirrorJobDetail,
  resolveJobCard,
} from "@/lib/workboard/all-jobs-query";
import { readOurJobNotes } from "@/lib/workboard/job-notes-query";
import {
  MAX_OPTIONS,
  normaliseDraft,
  statusAfterChange,
  type ProposalDraft,
  type ProposalOption,
} from "./proposal";
import { VISIT_STAGES } from "./buildup";
import { CHECKLIST, CHECKLIST_KEYS, capAsks, keepSettled } from "./checklist";
import { PAYMENT_PRESET_KEYS } from "./payment";
import { orgTemplates } from "@/lib/templates/query";
import type { PaymentTerms, QuoteNote } from "@/lib/templates/settings";

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
export const FALLBACK_MODEL = "claude-opus-4-8";
/* Thinking can't be turned off on this model and counts against the cap, so
   the cap leaves room for it on top of a long draft (about 1,100 tokens of
   JSON): a call that stops at the cap is paid for and returns nothing. */
const MAX_TOKENS = 16000;

/** What a draft is written from, read where the writer runs. */
export type ProposalJob = {
  /** The business writing the quote, from Admin → Organisation: its trading
      name (or legal name) and home state. Null when neither is filled in. */
  business: string | null;
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
  /** The business's quote notes and payment terms (Admin → Templates →
      Quote): the notes Tiff may pick from, and the stages each preset sets. */
  noteLibrary: QuoteNote[];
  paymentTerms: PaymentTerms;
};

const MAX_NOTES = 8;
const MAX_NOTE_CHARS = 600;

/* WHO IS WRITING, from the workspace's own row, never from the prompt: every
   business on HeyTiff shares the instructions below, so a name written into
   them would put one business's name on another's quotes. */
async function readBusiness(orgId: string): Promise<string | null> {
  const { data } = await supabaseAdmin.from("organizations").select("trading_name, legal_name, state").eq("id", orgId).maybeSingle();
  const row = (data ?? {}) as { trading_name?: string | null; legal_name?: string | null; state?: string | null };
  const name = row.trading_name?.trim() || row.legal_name?.trim() || "";
  if (!name) return null;
  return row.state?.trim() ? `${name}, ${row.state.trim()}` : name;
}

export async function readProposalJob(orgId: string, remoteId: string): Promise<ProposalJob | null> {
  const target = await resolveJobCard(orgId, remoteId);
  const cardId = target.parentRemoteId;
  const timezone = await getSm8Timezone(orgId);
  const [detail, theirs, ours, business, templates] = await Promise.all([
    readMirrorJobDetail(orgId, cardId, todayInZone(timezone), { includeMoney: false, timezone }),
    familyMediaSources(orgId, cardId).then((claims) => readJobNotes(orgId, cardId, claims)),
    /* HeyTiff's own diary notes too: a site note typed on the card is often
       the one that says where the drain goes */
    readOurJobNotes(orgId, cardId, MAX_NOTES),
    readBusiness(orgId),
    orgTemplates(orgId),
  ]);
  if (!detail) return null;
  const notes = [
    ...theirs.map((n) => ({ text: n.text, at: n.writtenAt ?? "" })),
    ...ours.map((n) => ({ text: n.text, at: n.at })),
  ].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  const contact = detail.contacts.find((c) => c.name.trim());
  return {
    business,
    noteLibrary: templates.quoteNotes,
    paymentTerms: templates.paymentTerms,
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

/* An option's labour, as Tiff suggests it: plain fields, no nullable one
   added (an empty list says there's no suggestion). */
const LABOUR_SUGGESTION = {
  type: "object",
  properties: {
    visits: {
      type: "array",
      items: {
        type: "object",
        properties: {
          stage: { type: "string", enum: VISIT_STAGES },
          people: { type: "integer" },
          days: { type: "number" },
        },
        required: ["stage", "people", "days"],
        additionalProperties: false,
      },
    },
    why: { type: "string" },
  },
  required: ["visits", "why"],
  additionalProperties: false,
};

const named = {
  type: "object",
  properties: { name: { type: "string" }, detail: { type: "string" } },
  required: ["name", "detail"],
  additionalProperties: false,
};

/** The schema, with the note keys this business's list offers. */
const draftSchema = (noteKeys: readonly string[]) => ({
  type: "object",
  properties: {
    intro: { type: "string" },
    why: { type: "string" },
    options: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          lines: { type: "array", items: { type: "string" } },
          units: {
            type: "array",
            items: {
              type: "object",
              properties: {
                role: { type: "string", enum: ["outdoor", "indoor", "fan"] },
                room: { type: "string" },
                capacity: { type: "string" },
                type: { type: "string" },
                model: { type: "string" },
                qty: { type: "integer" },
                system: { type: "integer" },
                lps: { type: ["number", "null"] },
              },
              required: ["role", "room", "capacity", "type", "model", "qty", "system", "lps"],
              additionalProperties: false,
            },
          },
          pros: { type: "array", items: { type: "string" } },
          cons: { type: "array", items: { type: "string" } },
          labour_suggestion: LABOUR_SUGGESTION,
        },
        required: ["name", "lines", "units", "pros", "cons", "labour_suggestion"],
        additionalProperties: false,
      },
    },
    pricing_mode: { type: "string", enum: ["multiple_choice", "optional", "itemised"] },
    items: {
      type: "array",
      items: {
        type: "object",
        properties: { name: { type: "string" }, qty: { type: "string" } },
        required: ["name", "qty"],
        additionalProperties: false,
      },
    },
    extras: { type: "array", items: named },
    allowances: { type: "array", items: named },
    /* never an empty enum: a business with no notes to pick gets one that
       is dropped on the way back */
    notes: { type: "array", items: { type: "string", enum: noteKeys.length > 0 ? [...noteKeys] : ["none"] } },
    payment_preset: { type: "string", enum: PAYMENT_PRESET_KEYS },
    checklist: {
      type: "array",
      items: {
        type: "object",
        properties: {
          key: { type: "string", enum: CHECKLIST_KEYS },
          state: { type: "string", enum: ["known", "ask", "na"] },
          answer: { type: "string" },
          /* an ask's own question, answers and rank; empty or 0 otherwise.
             Plain strings and an integer: no nullable field added */
          question: { type: "string" },
          choices: { type: "array", items: { type: "string" } },
          rank: { type: "integer" },
        },
        required: ["key", "state", "answer", "question", "choices", "rank"],
        additionalProperties: false,
      },
    },
  },
  required: [
    "intro",
    "why",
    "options",
    "pricing_mode",
    "items",
    "extras",
    "allowances",
    "notes",
    "payment_preset",
    "checklist",
  ],
  additionalProperties: false,
});

/* The topics, with the usual way each is asked and answered — a HINT for the
   question Tiff writes for this job, never the question itself. */
const CHECKLIST_LIBRARY = CHECKLIST_KEYS.filter((k) => k !== "labour").map(
  (k) =>
    `- ${k} (${CHECKLIST[k].group}, ${CHECKLIST[k].label}): ${CHECKLIST[k].question}` +
    (CHECKLIST[k].choices.length ? ` Usual answers: ${CHECKLIST[k].choices.join("; ")}.` : "")
).join("\n");

/* THE SAME FOR EVERY BUSINESS. The business itself is named in the user
   turn (jobBlock), read from its own Organisation row: nothing here may name
   one (design-ratchets: no business's name in shared code). */
export const SYSTEM_PROMPT = `You fill in a quote proposal for an Australian air-conditioning installer, the business named with the job, and you check it the way a supervisor would before it goes to the client. The layout is fixed and drawn by the software; you only fill its fields. Write plain Australian trade English, the way the owner writes to a client: short, direct, specific. No sales talk, no filler, no exclamation marks.

The fields:

intro — Starts with "Hi <first name>," on its own line when the first name is known, otherwise "Hi," alone. Then one to three short sentences: why the client is getting this proposal and, when there is more than one option, that there are options to choose from. When asked which option is better, end with one sentence saying which you recommend and why.

why — Empty unless the choice of system needs explaining to the client: a VRF system, a brand other than the one they expected, a heritage building, one big unit against two small ones. Then two to four plain sentences. Never repeat the intro.

options — One per real choice the client has. When there is only one way of doing the job, there is one option. Each has:
- name: a few words, e.g. "Install client-supplied 6 kW split", "Repair", "Downstairs". Never "Option 1".
- lines: the scope, one fact per line, in the order the work happens. No leading dash. The office's own phrasing:
  "Installation of a 7 kW wall split system. (its model number, when given)"
  "Removal of the existing AC unit."
  "Outdoor unit mounted on the wall on brackets."
  "Pipes run through the ceiling space and down the wall cavity."
  "Pipes run along the outside wall in pipe covering, in the colour asked for."
  "Power supplied from a new circuit at the switchboard."
  "Drain run to the downpipe beside the laundry."
  Write capacities as "3.5 kW". Put a model number in brackets only when it was given. Access work (roof tiles, ceiling space, EWP, wall cavity) is its own line.
- units: every piece of equipment this option installs, one entry each. These rows become the job's equipment record and its compliance certificate, so they must match the scope exactly.
  - role "outdoor": each outdoor unit. room is where it goes ("Side of the house", "Rooftop", "Wall brackets, rear"), or empty when not said. system is its number, counting outdoor units from 1 in the order you list them.
  - role "indoor": each indoor unit. room is the room it serves. system is the number of the outdoor unit it runs from.
  - role "fan": each exhaust or ventilation fan. room is the room it serves. system is 0. lps is its rated airflow in L/s only when given, otherwise null.
  - A single split is one outdoor and one indoor. A multi-split or VRF is one outdoor and each of its indoor units.
  - capacity like "3.6 kW" for air conditioning units, empty for fans. type in a few words: "High wall", "Ducted", "Bulkhead", "Cassette", "Floor console", "Outdoor unit", "In-line fan", "Ceiling exhaust fan".
  - model exactly as given, for example "PEA-M140HAA"; empty when it was not given. Never invent or guess a model; put "model" on the checklist as "ask" instead.
  - qty for identical units in the same room or place, otherwise 1.
- pros, cons: only when the options are genuinely different ways of doing the job, two or three short points each, with the figures that make the difference. Empty with a single option.
- labour_suggestion: only when the job's words give no labour (no crew with a time, such as "2 pax for 3 days" or "8 hrs x 2 men"). Then your suggestion for THIS option's labour, worked out from the equipment it puts in and the site: each visit's stage (${VISIT_STAGES.join(", ")}), how many people, and how many days (quarter days allowed). why is one plain sentence naming what drives it, for example "Six ducted heads over two levels and a ground-mount outdoor: two people for a two-day rough-in, then two days to fit off." It is shown to the business as your suggestion and priced only when they accept it. When the words give the labour, visits is empty and why is "".

pricing_mode — "multiple_choice" when the client picks one option. "optional" when each block is a separate area or add-on they can take any of (name each by its area). "itemised" for work priced line by line, such as building works; then list the lines in items with a quantity.

items — Only for itemised pricing: name and quantity per line. Empty otherwise.

extras — Add-ons the client can take or leave, each priced separately later: name and a few words of detail (for example "Wi-Fi adaptor", "Control it from your phone"). Only ones that were mentioned or that the job plainly offers.

allowances — A choice not made yet that the price covers with a stated allowance, when the words say so (for example "Ceiling grilles", "$100 + GST per grille"). Never invent a figure.

notes — Keys for the notes this job needs, from the business's notes listed with the job. Pick only the ones this job needs; none is fine. The business's notes that go on every quote are added anyway and are not listed.

payment_preset — "domestic_small" for a home job of a day or two; "domestic_construction" for a home job that runs in stages over weeks or months (a whole house, a renovation, a new build); "commercial" for a business.

checklist — You are the supervisor. For every topic below that applies to this job, say what is known in a few words ("known"), or that it has to be asked ("ask"), or that it doesn't apply here but someone might wonder ("na", with the reason in a few words). Leave out topics that plainly don't belong to this kind of job (grilles for a wall split, a model for building works), and topics the scope already rules out (grilles it excludes, an old system on a new build).
- known: answer is the fact, in a few words. Never a question, never "confirm" or "check". question "", choices [], rank 0.
- na: answer is the reason, in a few words. question "", choices [], rank 0.
- ask: answer "". question is ONE plain-English question a person on site could answer straight away. It names the rooms, units, levels or places on THIS job and, when it isn't obvious, says what the answer changes. Not a topic heading, not a fragment. For example "How do the pipes get from the garage up to the Level 3 bedroom and study: a riser cupboard, inside the walls, or outside in trunking?" — never "Riser route between levels". choices are two to four short answers a person would tap, each a few words ("Riser cupboard", "Inside the walls", "Outside in trunking"); the person can always type their own. rank orders the asks: 1 is the one that changes the price, the scope or how it's installed the most.
- Ask only what changes the price, the scope or how the job is installed, at most eight, and only what the job's words leave open. Labour is never a question: crew and time are the business's own call.
The topics, each with the usual way it's asked (a hint for your question, not the question):
${CHECKLIST_LIBRARY}

Where a fact the scope needs is missing, put the topic on the checklist as "ask" and leave the fact out of the scope line. Never write "TBC", "to be confirmed", "as discussed" or "a suitable point" in the scope. Never invent a model number, a measurement, a price or a fact you were not told; the labour suggestion is the one estimate you make, and it is marked as yours. Never mention prices at all, except an allowance you were given. Never mention this software or that anything was generated.`;

/** The notes Tiff picks from: the ones not already on every quote. */
const pickable = (job: ProposalJob) => job.noteLibrary.filter((n) => !n.always);

/** The business's notes on a draft Tiff just wrote: its every-quote notes
    first, then the ones Tiff picked from its list. A note already on the
    draft stays, even one since taken off the list. */
function withTemplates(d: ProposalDraft, job: ProposalJob, already: readonly string[]): ProposalDraft {
  const always = job.noteLibrary.filter((n) => n.always).map((n) => n.key);
  const allowed = new Set([...pickable(job).map((n) => n.key), ...already]);
  return { ...d, notes: [...always, ...d.notes.filter((k) => allowed.has(k) && !always.includes(k))] };
}

/** A preset's stages, as the business has set them. */
const termsFor = (job: ProposalJob, preset: ProposalDraft["payment"]["preset"]): ProposalDraft["payment"] => ({
  preset,
  stages: job.paymentTerms[preset].stages.map((s) => ({ ...s })),
});

export function jobBlock(job: ProposalJob): string {
  const parts = [
    job.business ? `The business writing this quote: ${job.business}` : null,
    `Job ${job.jobNumber ?? "(no number)"}`,
    job.clientName ? `Client: ${job.clientName}` : null,
    job.contactFirstName ? `Contact's first name: ${job.contactFirstName}` : null,
    job.address ? `Site: ${job.address.replace(/\n+/g, ", ")}` : null,
    job.category ? `Job type: ${job.category}` : null,
    job.scope ? `The office's description of the job:\n${job.scope}` : null,
    job.notes.length ? `Notes on the job, newest first:\n${job.notes.map((n) => `- ${n}`).join("\n")}` : null,
    pickable(job).length
      ? `The business's quote notes to pick from (key: heading, then its words):\n${pickable(job)
          .map((n) => `- ${n.key}: "${n.heading}" — ${n.lines.join(" ")}`)
          .join("\n")}`
      : null,
  ];
  return parts.filter(Boolean).join("\n");
}

/** The user turn for a first draft. A brief that is ServiceM8's own quote is
    read as the scope already quoted: built on, with only what it leaves open
    asked. */
export function draftPrompt(job: ProposalJob, brief: string): string {
  const words = brief.trim();
  const head = words.includes(SM8_BRIEF_HEAD)
    ? "The quote ServiceM8 already holds for this job, as the office wrote it. Build the proposal on it, keeping what it says; ask only what it leaves open that changes the price, the scope or the install:"
    : "What was said about the job after the site visit:";
  return `${jobBlock(job)}\n\n${head}\n${words}\n\nFill in the proposal and the checklist.`;
}

/** The draft as the writer's own field names, for a change. */
function asFields(draft: ProposalDraft) {
  return {
    intro: draft.intro,
    why: draft.why,
    /* a person's price and labour stay out: they are kept by the server */
    options: draft.options.map((o) => ({
      name: o.name,
      lines: o.lines,
      units: o.units,
      pros: o.pros,
      cons: o.cons,
      labour_suggestion: o.suggestion ?? { visits: [], why: "" },
    })),
    pricing_mode: draft.pricingMode,
    items: draft.items,
    extras: draft.extras,
    allowances: draft.allowances,
    notes: draft.notes,
    payment_preset: draft.payment.preset,
    checklist: draft.checklist.map(({ key, state, answer, question, choices, rank }) => ({
      key,
      state,
      answer,
      question: question ?? "",
      choices: choices ?? [],
      rank: rank ?? 0,
    })),
  };
}

/** The user turn for a change to a draft. The brief rides along so a change
    can't lose what the draft was written from, and answers given on the
    card since the last change are named so they reach the scope. */
export function changePrompt(
  job: ProposalJob,
  brief: string,
  draft: ProposalDraft,
  change: string
): string {
  const fresh = draft.checklist.filter((i) => i.fresh);
  const answered = fresh.length
    ? `\n\nAnswers given on the checklist since the last change, to put into the scope:\n${fresh
        .map((i) => `- ${CHECKLIST[i.key].label}: ${i.answer}`)
        .join("\n")}`
    : "";
  return (
    `${jobBlock(job)}\n\nWhat was said about the job after the site visit:\n${brief.trim()}\n\n` +
    `The proposal as it stands:\n${JSON.stringify(asFields(draft))}${answered}\n\n` +
    `Change it as asked, and keep everything not asked about exactly as it is. ` +
    `Answers go into the scope, and answered topics become "known". ` +
    `At most ${MAX_OPTIONS} options.\n\nThe change:\n${change.trim() || "Put the answers into the proposal."}`
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

/** One call to the writer, its answer as the schema's fields. */
async function askWriter(
  userTurn: string,
  schema: Record<string, unknown>,
  client: Anthropic
): Promise<{ ok: true; raw: Record<string, unknown> } | { ok: false; reason: string }> {
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
        format: { type: "json_schema", schema },
      },
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userTurn }],
    });

    if (response.stop_reason === "refusal") return { ok: false, reason: "Tiff declined to write this one." };
    if (response.stop_reason === "max_tokens") return { ok: false, reason: "The proposal ran too long. Try a shorter brief." };

    /* THE LAST text block: when the fallback model takes over, the first
       model's partial answer can stand ahead of the full one */
    const block = [...response.content].reverse().find((b) => b.type === "text");
    if (!block || block.type !== "text") return { ok: false, reason: "Tiff returned nothing. Try again." };
    return { ok: true, raw: JSON.parse(block.text) as Record<string, unknown> };
  } catch (err) {
    if (err instanceof SyntaxError) return { ok: false, reason: "Tiff's answer couldn't be read. Try again." };
    return { ok: false, reason: reasonFor(err) };
  }
}

export async function runProposalWrite(
  userTurn: string,
  client: Anthropic = new Anthropic(),
  noteKeys: readonly string[] = []
): Promise<WriteResult> {
  const asked = await askWriter(userTurn, draftSchema(noteKeys), client);
  if (!asked.ok) return asked;
  /* the writer names a payment preset; the stages are HeyTiff's */
  const draft = normaliseDraft({ ...asked.raw, payment: { preset: asked.raw.payment_preset } });
  if (!draft) return { ok: false, reason: "Tiff returned no scope. Say a little more about the job." };
  return { ok: true, draft };
}

/* ── labour for a draft written before Tiff suggested it ── */

const labourSchema = {
  type: "object",
  properties: {
    options: {
      type: "array",
      items: {
        type: "object",
        properties: { labour_suggestion: LABOUR_SUGGESTION },
        required: ["labour_suggestion"],
        additionalProperties: false,
      },
    },
  },
  required: ["options"],
  additionalProperties: false,
};

/** The user turn that asks only for each option's labour. */
export function labourPrompt(job: ProposalJob, brief: string, draft: ProposalDraft): string {
  const options = draft.options.map((o) => ({ name: o.name, lines: o.lines, units: o.units }));
  return (
    `${jobBlock(job)}\n\nWhat was said about the job after the site visit:\n${brief.trim()}\n\n` +
    `The proposal's options:\n${JSON.stringify(options)}\n\n` +
    `Suggest each option's labour, one entry per option in the same order, as labour_suggestion is described — ` +
    `except that the business has asked for it: HeyTiff couldn't read the labour from the brief, so suggest it for every option. ` +
    `Where the job's notes or words do state a crew and time, use them and say so in why.`
  );
}

/** Tiff's labour suggestion onto each option of a stored draft, for the
    Apply beside it (Isaac, 2026-10-05: "api call can recommend a labour
    amount to use if none is provided in the brief"). Nothing priced: a
    suggestion waits for a person. */
export async function suggestLabour(orgId: string, userId: string, remoteId: string, client: Anthropic = new Anthropic()): Promise<ProposalResult> {
  const job = await readProposalJob(orgId, remoteId);
  if (!job) return { ok: false, reason: "That job isn't in HeyTiff's copy of ServiceM8." };
  const current = await readStoredProposal(orgId, job.cardId);
  if (!current) return { ok: false, reason: "There's no proposal on this job yet. Draft one first." };
  const asked = await askWriter(labourPrompt(job, current.brief, current.draft), labourSchema, client);
  if (!asked.ok) return asked;
  const got = Array.isArray(asked.raw.options) ? (asked.raw.options as unknown[]) : [];
  const draft = normaliseDraft({
    ...current.draft,
    options: current.draft.options.map((o: ProposalOption, i) => ({
      ...o,
      suggestion: (got[i] as { labour_suggestion?: unknown } | undefined)?.labour_suggestion ?? null,
    })),
  });
  if (!draft) return { ok: false, reason: SAVE_FAILED };
  if (draft.options.every((o) => !o.suggestion)) return { ok: false, reason: "Tiff couldn't suggest labour for this one. Set it yourself." };
  const stored = await storeProposal(orgId, userId, job.cardId, draft, current.brief, current.changes, current.updatedAt);
  if (stored.ok) return stored;
  if (!stored.conflict) return { ok: false, reason: SAVE_FAILED };
  return { ok: false, reason: CHANGED_MEANWHILE, proposal: await readStoredProposal(orgId, job.cardId) };
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

export type Stored = { ok: true; proposal: StoredProposal } | { ok: false; conflict: boolean };

/** Writes the draft. With `base` (the updatedAt the change was made on) it
    writes only if nobody saved in between: two saves made on the same draft
    would otherwise keep whichever landed last, and the first would be lost
    without a word. Without `base` it is a first draft, or a deliberate
    start-again, and replaces whatever is there. */
export async function storeProposal(
  orgId: string,
  userId: string,
  cardId: string,
  draft: ProposalDraft,
  brief: string,
  changes: string[],
  base?: string
): Promise<Stored> {
  const row = {
    draft,
    brief,
    changes: changes.slice(-MAX_CHANGES_KEPT),
    updated_by: userId,
    updated_at: new Date().toISOString(),
  };
  const columns = "sm8_job_uuid, draft, brief, changes, updated_at";
  const { data, error } =
    base === undefined
      ? await supabaseAdmin
          .from("quote_drafts")
          .upsert({ org_id: orgId, sm8_job_uuid: cardId, ...row }, { onConflict: "org_id,sm8_job_uuid" })
          .select(columns)
          .single()
      : await supabaseAdmin
          .from("quote_drafts")
          .update(row)
          .eq("org_id", orgId)
          .eq("sm8_job_uuid", cardId)
          .eq("updated_at", base)
          .select(columns)
          .maybeSingle();
  if (error) return { ok: false, conflict: false };
  const proposal = storedOf(data as Row | null);
  return proposal ? { ok: true, proposal } : { ok: false, conflict: base !== undefined };
}

export const SAVE_FAILED = "The proposal couldn't be saved. Try again.";
export const CHANGED_MEANWHILE = "Someone else changed this proposal while you were working. Here it is as it stands now.";

/* ── the whole write, for the route ── */

export type ProposalRequest =
  /** `replace` says the person pressed Start again; without it a draft never
      writes over one that is already there. */
  | { kind: "draft"; brief: string; replace?: boolean }
  | { kind: "change"; change: string };

export type ProposalResult =
  | { ok: true; proposal: StoredProposal }
  /** `proposal` rides along when the draft moved on underneath, so the card
      can show what is there now. */
  | { ok: false; reason: string; proposal?: StoredProposal | null };

export async function writeProposal(
  orgId: string,
  userId: string,
  remoteId: string,
  req: ProposalRequest,
  client?: Anthropic
): Promise<ProposalResult> {
  const job = await readProposalJob(orgId, remoteId);
  if (!job) return { ok: false, reason: "That job isn't in HeyTiff's copy of ServiceM8." };

  const current = await readStoredProposal(orgId, job.cardId);

  if (req.kind === "draft") {
    /* checked before the call, so a card that failed to read the draft
       can't pay for a new one that silently replaces it */
    if (current && !req.replace) {
      return { ok: false, reason: "This job already has a proposal.", proposal: current };
    }
    const written = await runProposalWrite(draftPrompt(job, req.brief), client, pickable(job).map((n) => n.key));
    if (!written.ok) return written;
    const draft = withTemplates(written.draft, job, []);
    /* Tiff's asks cut to the eight that matter most */
    const stored = await storeProposal(
      orgId,
      userId,
      job.cardId,
      { ...draft, checklist: capAsks(draft.checklist), payment: termsFor(job, draft.payment.preset) },
      req.brief.trim(),
      []
    );
    return stored.ok ? stored : { ok: false, reason: SAVE_FAILED };
  }

  if (!current) return { ok: false, reason: "There's no proposal on this job to change. Draft one first." };
  const written = await runProposalWrite(changePrompt(job, current.brief, current.draft, req.change), client, pickable(job).map((n) => n.key));
  if (!written.ok) return written;
  written.draft = withTemplates(written.draft, job, current.draft.notes);
  /* stages a person set by hand survive a change that kept the same preset;
     a new preset takes the business's own terms for it */
  written.draft.payment =
    written.draft.payment.preset === current.draft.payment.preset ? current.draft.payment : termsFor(job, written.draft.payment.preset);
  /* and so does every answer a person gave, whatever Tiff sent back */
  written.draft.checklist = keepSettled(current.draft.checklist, written.draft.checklist);
  /* the cap after the person's answers are back: a re-asked settled topic
     never takes an open question's place */
  written.draft.checklist = capAsks(written.draft.checklist);
  /* and what the customer sees: a person's choice, never Tiff's */
  written.draft.showLines = current.draft.showLines;
  /* the day it was sent stays; an approval was of the version just changed */
  written.draft.status = statusAfterChange(current.draft.status);
  /* and every price and labour a person set: Tiff sets neither, so an
     option keeps them by its name — the one option of that name, even when
     it had none — or by its place when no name matches and the options
     stayed as many */
  const named = (list: readonly ProposalOption[], name: string) => list.filter((c) => c.name === name).length;
  const kept = <K extends "priceCents" | "labour">(o: ProposalOption, i: number, k: K): ProposalOption[K] | null => {
    const byName = named(current.draft.options, o.name) === 1 && named(written.draft.options, o.name) === 1;
    const was = byName
      ? current.draft.options.find((c) => c.name === o.name)
      : current.draft.options.length === written.draft.options.length
        ? current.draft.options[i]
        : undefined;
    return was?.[k] ?? null;
  };
  written.draft.options = written.draft.options.map((o, i) => ({ ...o, priceCents: kept(o, i, "priceCents"), labour: kept(o, i, "labour") }));
  const stored = await storeProposal(
    orgId,
    userId,
    job.cardId,
    written.draft,
    current.brief,
    [...current.changes, req.change.trim() || "Put the checklist answers in"],
    current.updatedAt
  );
  if (stored.ok) return stored;
  if (!stored.conflict) return { ok: false, reason: SAVE_FAILED };
  return {
    ok: false,
    reason: "The proposal was edited while Tiff was writing, so the change wasn't put in. Try it again.",
    proposal: await readStoredProposal(orgId, job.cardId),
  };
}
