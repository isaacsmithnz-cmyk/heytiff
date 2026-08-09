/* THE CHECK BETWEEN THE ROUTER AND THE REVIEW CARD.

   `lang/policy.ts` tells the router to write every stored record in
   Australian English and the models follow it. This is what happens when
   one doesn't. It sits inside `readNote`, after the proposal is shaped and
   before anything is persisted or shown, so a record that slipped through
   in another language is repaired rather than filed.

   THREE RULES, and they are what make this safe to run on every note:

     · IT NEVER LOSES WORDS. Every failure — no key, a refusal, a wrong
       shape, a translation that comes back still foreign — returns the
       proposal it was given. The person still gets their card; at worst
       they get it in the language they spoke, which is what they had
       before this file existed.

     · IT COSTS NOTHING WHEN THERE IS NOTHING TO DO. The detector is pure
       and local (`lang/english.ts`); the model is only called when it finds
       something, which on an English note is never. The added latency on
       the ordinary path is a few string scans.

     · NAMES ARE NOT TRANSLATED, so they are not offered. `assigneeHint`
       carries what the note said, and `resolveAssignee` matches it against
       the roster — a translated name matches nobody. Same for the
       equipment hint, which is a model string. Neither is walked here.

   WHY REPAIR RATHER THAN REFUSE: the note is already saved, the proposal is
   the enhancement, and a card the crew can't read is worth less than one
   translated by the same model that wrote it. The person confirming sees
   the English and can edit it — as they can every other field on the card. */

import Anthropic from "@anthropic-ai/sdk";
import { checkEnglish } from "@/lib/lang/english";
import { RECORD_IN_ENGLISH, RECORD_LANGUAGE } from "@/lib/lang/policy";
import type { NoteProposal } from "./note-brain";

/* Opus 5 at LOW effort, the same lever as keyword tagging and query prep:
   the judgement is shallow ("say this in English"), it runs rarely, and a
   cheaper model mangles the trade nouns it is supposed to be preserving. */
const MODEL = "claude-opus-5";
const MAX_TOKENS = 8_000;

/** More strings than one note can plausibly produce. A proposal past this
    is malformed rather than multilingual; the extras keep their text. */
const MAX_STRINGS = 40;

const SCHEMA = {
  type: "object",
  properties: {
    translations: { type: "array", items: { type: "string" } },
  },
  required: ["translations"],
  additionalProperties: false,
} as const;

const SYSTEM = [
  `You translate a work record into ${RECORD_LANGUAGE}.`,
  "",
  RECORD_IN_ENGLISH,
  "",
  "You are given numbered strings from one record. Return the same number of",
  "strings, in the same order, each one the English of the string with that",
  "number. Keep the meaning and the register: these are notes between",
  "tradespeople, not prose. A string already in English is returned",
  "unchanged — do not rewrite, tidy or expand it.",
].join("\n");

/* ── the fields (pure) ────────────────────────────────────────────────── */

/** Every string in a proposal that the whole crew will read.

    `assigneeHint` and `equipmentHint` are deliberately absent: one is a
    person's name, matched against the roster, and the other is a model
    string. Translating either breaks the thing it exists for. */
export function recordStrings(p: NoteProposal): string[] {
  const out: string[] = [];
  for (const t of p.tasks) out.push(t.title, t.detail, t.dueHint);
  out.push(...p.bringItems);
  for (const f of p.flags) out.push(f.message);
  out.push(...p.progressBullets);
  for (const e of p.commissioningEntries) out.push(e.body);
  for (const e of p.issueEntries) out.push(e.body);
  for (const k of p.kbEntries) out.push(k.title, k.body);
  out.push(...p.noteLines, p.plainNote);
  if (p.clarify) out.push(p.clarify.question, ...p.clarify.options);
  return out.filter((s) => s.trim() !== "");
}

/** The strings that need repairing, deduplicated — the same phrase in a
    task title and a bullet is one translation, not two. */
export function foreignStrings(p: NoteProposal): string[] {
  const seen = new Set<string>();
  for (const s of recordStrings(p)) {
    if (seen.has(s)) continue;
    if (checkEnglish(s).foreign) seen.add(s);
  }
  return [...seen].slice(0, MAX_STRINGS);
}

/** Rebuild the proposal with each translated string swapped in wherever it
    appeared. Keyed by the ORIGINAL TEXT rather than a field path, which is
    what keeps this a plain map rather than a parallel copy of the shape. */
export function withTranslations(
  p: NoteProposal,
  map: ReadonlyMap<string, string>
): NoteProposal {
  const s = (v: string) => map.get(v) ?? v;
  return {
    ...p,
    tasks: p.tasks.map((t) => ({
      ...t,
      title: s(t.title),
      detail: s(t.detail),
      dueHint: s(t.dueHint),
    })),
    bringItems: p.bringItems.map(s),
    flags: p.flags.map((f) => ({ ...f, message: s(f.message) })),
    progressBullets: p.progressBullets.map(s),
    commissioningEntries: p.commissioningEntries.map((e) => ({ ...e, body: s(e.body) })),
    issueEntries: p.issueEntries.map((e) => ({ ...e, body: s(e.body) })),
    kbEntries: p.kbEntries.map((k) => ({ ...k, title: s(k.title), body: s(k.body) })),
    noteLines: p.noteLines.map(s),
    plainNote: s(p.plainNote),
    clarify: p.clarify
      ? { question: s(p.clarify.question), options: p.clarify.options.map(s) }
      : null,
  };
}

/** Align the model's answer to what was asked. A short array, a long one, a
    non-string or an empty translation all mean that ONE string keeps its
    original text — never that the batch is thrown away. */
export function alignTranslations(
  originals: readonly string[],
  raw: unknown
): Map<string, string> {
  const map = new Map<string, string>();
  const list = Array.isArray(raw) ? raw : [];
  originals.forEach((original, i) => {
    const t = list[i];
    if (typeof t !== "string") return;
    const text = t.trim();
    if (text && text !== original) map.set(original, text);
  });
  return map;
}

/* ── the pass (impure) ────────────────────────────────────────────────── */

async function translate(strings: readonly string[]): Promise<Map<string, string>> {
  const client = new Anthropic();
  const numbered = strings.map((s, i) => `${i + 1}. ${s}`).join("\n");

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    output_config: {
      effort: "low",
      format: { type: "json_schema", schema: SCHEMA },
    },
    system: SYSTEM,
    messages: [{ role: "user", content: `${strings.length} strings:\n\n${numbered}` }],
  });

  /* A refusal is a content outcome, not an error — and here it simply means
     the record keeps the words it already had. */
  if (response.stop_reason === "refusal") return new Map();
  const block = response.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") return new Map();

  const body: unknown = JSON.parse(block.text);
  const raw = (body as { translations?: unknown })?.translations;
  return alignTranslations(strings, raw);
}

/**
 * Make sure the record the crew will read is in English.
 *
 * Never throws and never drops text: on any failure the proposal comes back
 * exactly as it went in.
 */
export async function englishProposal(proposal: NoteProposal): Promise<NoteProposal> {
  const foreign = foreignStrings(proposal);
  if (foreign.length === 0) return proposal;
  if (!process.env.ANTHROPIC_API_KEY) return proposal;

  try {
    const map = await translate(foreign);
    if (map.size === 0) {
      console.error(`[note-english] ${foreign.length} field(s) left unrepaired`);
      return proposal;
    }

    /* WHAT SURVIVED. The repair is a model call like any other, so it is
       checked by the same reading that asked for it — and a field still
       foreign afterwards is logged rather than swallowed, because it is the
       one case where the instruction, the check AND the repair all missed. */
    const stubborn = foreign.filter((s) => {
      const after = map.get(s);
      return after === undefined || checkEnglish(after).foreign;
    });
    if (stubborn.length > 0) {
      console.error(`[note-english] still not English after repair: ${stubborn.length} field(s)`);
    }

    return withTranslations(proposal, map);
  } catch (err) {
    // The same blindness as everywhere else on this path: the person gets
    // their card, and the reason reaches us rather than nobody.
    console.error(
      `[note-english] repair failed: ${err instanceof Error ? err.message : String(err)}`
    );
    return proposal;
  }
}
