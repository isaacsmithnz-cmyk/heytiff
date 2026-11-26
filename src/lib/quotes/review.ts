import type { QuoteLine } from "./lines";
import type { LinesProposal } from "./lines-proposal";
import type { Fit } from "./fit";
import { PAYMENT_PRESETS, type PaymentPreset } from "./payment";

/* TIFF CHECKS THE QUOTE BEFORE IT CAN BE MARKED READY TO SEND (Isaac, 26
   November 2026: "should there be a review pass before it can be marked
   ready to send?", then "Yes, build it" to
   https://claude.ai/artifact/5FtXp1LSQWQGpN4gcsCwwk). Job 3608's proposal
   went out with every unit's kW wrong, an outlet in a bath that had none,
   the old system's removal twice, cones and linear grilles both priced and
   a home's payment terms on a builder's tender, and nothing on the page
   asked. Mark ready to send now runs a check first: rules for what can be
   counted, then Tiff's read of the paper against the lines. What she finds
   comes one at a time beside the spot it's about. Doesn't match is fixed,
   or kept with a reason you write; Worth a look is fixed or kept. A reason
   goes on the paper under Qualifications. The fixes go to her as one
   message, and anything changed after the check needs it again. Pure. */

export type ReviewKind = "mismatch" | "look";
export type ReviewTab = "proposal" | "breakdown";
/** a fix: its button's words, and what's done. "op:payment:<preset>" is
    done here; anything else is what Tiff is asked to do */
export type ReviewAnswer = { label: string; fix: string };
export type ReviewFinding = {
  id: string;
  kind: ReviewKind;
  /** the option it's about; null: the whole quote */
  option: number | null;
  /** a few words the customer could read: it heads a qualification */
  topic: string;
  /** what's wrong or worth a look, in a sentence or two */
  words: string;
  /** what's on the quote now, "" when nothing says it */
  put: string;
  /** where to show it: the paper's block, or the lines */
  tab: ReviewTab;
  block: string;
  lineIds: string[];
  answers: ReviewAnswer[];
  /** open; fix (an answer picked, not yet done); sent (asked of Tiff or done); kept */
  state: "open" | "fix" | "sent" | "kept";
  picked: number | null;
  /** why it's kept, on the quote under Qualifications */
  reason: string;
};
export type QuoteReview = {
  at: string;
  by: string;
  /** the quote's fingerprint when it was checked: changed since, it's checked again */
  stamp: string;
  findings: ReviewFinding[];
  /** what Tiff's read cost, US$; null where it isn't known */
  usd: number | null;
};

export const MAX_FINDINGS = 12;
const MAX_WORDS = 600;
const MAX_REASON = 300;
const BLOCK = /^(?:title|intro|notIncluded|payment|notes|choice|qualifications|(?:summary|work|included|units)-\d{1,2})$/;

const text = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

function answersOf(v: unknown): ReviewAnswer[] {
  return (Array.isArray(v) ? v : [])
    .map((a) => {
      const o = obj(a);
      const label = text(o.label, 60);
      const fix = text(o.fix, 400);
      return label && fix ? { label, fix } : null;
    })
    .filter((a): a is ReviewAnswer => a !== null)
    .slice(0, 3);
}

/** One finding as kept or as Tiff wrote it, made safe; null when it says nothing. */
export function findingOf(raw: unknown, lineIds?: ReadonlySet<string>): ReviewFinding | null {
  const o = obj(raw);
  const words = text(o.words, MAX_WORDS);
  const topic = text(o.topic, 80);
  if (!words || !topic) return null;
  const option = typeof o.option === "number" && Number.isInteger(o.option) && o.option >= 0 && o.option < 20 ? o.option : null;
  const block = text(o.block, 40);
  const ids = (Array.isArray(o.lineIds) ? o.lineIds : []).map((x) => text(x, 60)).filter((x) => x && (!lineIds || lineIds.has(x)));
  const state = o.state === "fix" || o.state === "sent" || o.state === "kept" ? o.state : "open";
  const answers = answersOf(o.answers);
  const picked = typeof o.picked === "number" && Number.isInteger(o.picked) && o.picked >= 0 && o.picked < answers.length ? o.picked : null;
  return {
    id: text(o.id, 40) || `f${Math.abs(hash(topic + words)).toString(36)}`,
    kind: o.kind === "mismatch" ? "mismatch" : "look",
    option,
    topic,
    words,
    put: text(o.put, 200),
    tab: o.tab === "breakdown" ? "breakdown" : "proposal",
    block: BLOCK.test(block) ? block : "",
    lineIds: [...new Set(ids)].slice(0, 20),
    answers,
    state: state === "fix" && picked === null ? "open" : state,
    picked: state === "fix" || state === "sent" ? picked : null,
    reason: text(o.reason, MAX_REASON),
  };
}

/** The check as it's kept on the quote; null when there's none. */
export function reviewOf(raw: unknown): QuoteReview | null {
  const o = obj(raw);
  const stamp = text(o.stamp, 40);
  if (!stamp) return null;
  const findings = (Array.isArray(o.findings) ? o.findings : []).map((f) => findingOf(f)).filter((f): f is ReviewFinding => f !== null);
  const seen = new Set<string>();
  return {
    at: text(o.at, 40),
    by: text(o.by, 80),
    stamp,
    findings: findings.filter((f) => (seen.has(f.id) ? false : (seen.add(f.id), true))).slice(0, MAX_FINDINGS + 8),
    usd: typeof o.usd === "number" && Number.isFinite(o.usd) && o.usd >= 0 ? Math.round(o.usd * 10000) / 10000 : null,
  };
}

/* ── the fingerprint ── */

function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h | 0;
}

/** What the customer would be sent, as one string: every line's priced
    facts and every word of the proposal, nothing about when or by whom. */
export function quoteStamp(lines: readonly QuoteLine[], proposal: LinesProposal | null): string {
  const ls = [...lines]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((l) => [l.id, l.optionIndex, l.kind, l.group, l.name, l.code ?? "", l.qty, l.unit, l.costCents, l.sellCents ?? "", l.system].join("|"));
  const p = proposal
    ? JSON.stringify({ t: proposal.title, i: proposal.intro, o: proposal.options, n: proposal.notIncluded, c: proposal.choice, p: proposal.payment, x: proposal.notes })
    : "";
  const all = `${ls.join("\n")}\n${p}`;
  return `${(hash(all) >>> 0).toString(36)}${all.length.toString(36)}`;
}

/** The check still stands: made of the quote as it is now. */
export const reviewStands = (r: QuoteReview | null, stamp: string): r is QuoteReview => !!r && r.stamp === stamp;

/** Where the check has left the quote, for the panel's one button. */
export type ReviewStep =
  /* never checked, or changed since: Mark ready to send checks first */
  | { step: "check"; again: boolean }
  /* findings to go through, the first open one */
  | { step: "walk"; at: ReviewFinding; n: number; of: number }
  /* every finding answered, fixes picked: they go to Tiff */
  | { step: "fix"; fixes: number }
  /* checked, and nothing left but what was kept */
  | { step: "clear"; kept: number };

export function reviewStep(r: QuoteReview | null, stamp: string): ReviewStep {
  if (!reviewStands(r, stamp)) return { step: "check", again: !!r };
  const live = r.findings.filter((f) => f.state !== "sent");
  const open = live.findIndex((f) => f.state === "open");
  if (open >= 0) return { step: "walk", at: live[open]!, n: open + 1, of: live.length };
  const fixes = live.filter((f) => f.state === "fix").length;
  if (fixes > 0) return { step: "fix", fixes };
  return { step: "clear", kept: live.filter((f) => f.state === "kept").length };
}

/** Ready to send, as far as the check goes: it stands and nothing's left in it. */
export const reviewClear = (r: QuoteReview | null, stamp: string) => reviewStep(r, stamp).step === "clear";

/** A finding answered: an answer picked to fix it, or kept with its reason.
    Doesn't match can't be kept without one. */
export function answered(r: QuoteReview, id: string, pick: number | "keep", reason: string): QuoteReview | { error: string } {
  const f = r.findings.find((x) => x.id === id);
  if (!f) return { error: "That finding isn't on the check." };
  if (pick === "keep") {
    const why = text(reason, MAX_REASON);
    if (f.kind === "mismatch" && !why) return { error: "Say why it stays as written." };
    return { ...r, findings: r.findings.map((x) => (x.id === id ? { ...x, state: "kept", picked: null, reason: why } : x)) };
  }
  if (!Number.isInteger(pick) || pick < 0 || pick >= f.answers.length) return { error: "That isn't one of the fixes." };
  return { ...r, findings: r.findings.map((x) => (x.id === id ? { ...x, state: "fix", picked: pick, reason: "" } : x)) };
}

/** A finding taken back to open, to be answered again. */
export const reopened = (r: QuoteReview, id: string): QuoteReview => ({
  ...r,
  findings: r.findings.map((x) => (x.id === id && x.state !== "sent" ? { ...x, state: "open", picked: null, reason: "" } : x)),
});

/** The payment fixes done here, by preset. */
export function paymentFixOf(f: ReviewFinding): PaymentPreset | null {
  if (f.state !== "fix" || f.picked === null) return null;
  const m = /^op:payment:(\w+)$/.exec(f.answers[f.picked]?.fix ?? "");
  return m && m[1]! in PAYMENT_PRESETS ? (m[1] as PaymentPreset) : null;
}

/** Everything picked to fix that Tiff does, as one message to her. */
export function fixesMessage(r: QuoteReview): string {
  const asks = r.findings
    .filter((f) => f.state === "fix" && f.picked !== null && !paymentFixOf(f))
    .map((f, i) => `${i + 1}) ${f.option === null ? "" : `Option ${f.option + 1}: `}${f.answers[f.picked!]!.fix}`);
  return asks.length ? `From the check before it's marked ready to send, fix these:\n${asks.join("\n")}` : "";
}

/** The fixes sent: those findings done with, the rest as they were. */
export const fixesSent = (r: QuoteReview): QuoteReview => ({ ...r, findings: r.findings.map((f) => (f.state === "fix" ? { ...f, state: "sent" } : f)) });

/** What's kept with a reason, for the paper's Qualifications. */
export function qualificationsOf(r: QuoteReview | null): string[] {
  return (r?.findings ?? []).filter((f) => f.state === "kept" && f.reason).map((f) => `${f.topic}: ${f.reason.replace(/[.\s]+$/, "")}.`);
}

/** A new check's findings with the person's decisions on the last one kept:
    a kept one stays kept, and isn't raised again. */
export function carried(prior: QuoteReview | null, fresh: ReviewFinding[]): ReviewFinding[] {
  const kept = (prior?.findings ?? []).filter((f) => f.state === "kept");
  const keptTopics = new Set(kept.map((f) => f.topic.toLowerCase()));
  return [...kept, ...fresh.filter((f) => !keptTopics.has(f.topic.toLowerCase()))].slice(0, MAX_FINDINGS + kept.length);
}

/* ── the checks that are counted, not read ── */

const BUILDER = /\b(build|building|builders?|constructions?|construct|developments?|projects?|homes|joinery|carpentry)\b/i;

export type RuleInput = {
  lines: readonly QuoteLine[];
  proposal: LinesProposal | null;
  client: string | null;
  fits: readonly Fit[];
};

/** How many visits each option's labour runs over. */
export function visitsOf(lines: readonly QuoteLine[], option: number): number {
  const names = new Set(lines.filter((l) => l.optionIndex === option && l.kind === "labour").map((l) => (l.visit ? `${l.name}` : null)).filter(Boolean));
  return names.size;
}

export function ruleFindings({ lines, proposal, client, fits }: RuleInput): ReviewFinding[] {
  const out: ReviewFinding[] = [];
  const options = Math.max(0, ...lines.map((l) => l.optionIndex + 1));
  const visits = Math.max(0, ...Array.from({ length: options }, (_, i) => visitsOf(lines, i)));
  const builder = !!client && BUILDER.test(client);
  if (proposal && proposal.payment.preset === "domestic_small" && (builder || visits > 1)) {
    const who = builder ? `${client} is a builder` : "it's a staged job";
    out.push({
      id: "rule-payment",
      kind: "look",
      option: null,
      topic: "Payment terms",
      words: `Payment is ${PAYMENT_PRESETS.domestic_small.label}: 10% on accepting and 90% at the end. ${who}${visits > 1 ? `, and the work runs over ${visits} visits` : ""}.`,
      put: PAYMENT_PRESETS.domestic_small.label,
      tab: "proposal",
      block: "payment",
      lineIds: [],
      answers: [
        { label: `Use ${PAYMENT_PRESETS.domestic_construction.label}`, fix: "op:payment:domestic_construction" },
        { label: `Use ${PAYMENT_PRESETS.commercial.label}`, fix: "op:payment:commercial" },
      ],
      state: "open",
      picked: null,
      reason: "",
    });
  }
  for (const f of fits) {
    if (f.state !== "misfit") continue;
    const l = lines.find((x) => x.id === f.key);
    if (!l) continue;
    out.push({
      id: `rule-fit-${l.id}`.slice(0, 40),
      kind: "look",
      option: l.optionIndex,
      topic: l.name.slice(0, 80),
      words: `${l.name} doesn't fit as quoted: ${f.why}.`,
      put: `${l.qty}${l.unit ? ` ${l.unit}` : ""}`,
      tab: "breakdown",
      block: "",
      lineIds: [l.id],
      answers: [{ label: "Ask Tiff to fix it", fix: `${l.name} doesn't fit (${f.why}): change it to one that does, or tell me why it's right.` }],
      state: "open",
      picked: null,
      reason: "",
    });
  }
  return out;
}

/* ── Tiff's read ── */

export const REVIEW_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["findings"],
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "option", "topic", "words", "put", "tab", "block", "lineIds", "answers"],
        properties: {
          kind: { type: "string", enum: ["mismatch", "look"] },
          option: { type: "integer", description: "0-based option it's about; -1 for the whole quote" },
          topic: { type: "string" },
          words: { type: "string" },
          put: { type: "string" },
          tab: { type: "string", enum: ["proposal", "breakdown"] },
          block: { type: "string" },
          lineIds: { type: "array", items: { type: "string" } },
          answers: {
            type: "array",
            items: { type: "object", additionalProperties: false, required: ["label", "fix"], properties: { label: { type: "string" }, fix: { type: "string" } } },
          },
        },
      },
    },
  },
} as const;

/** Tiff's findings as she wrote them, made safe against the quote's own lines. */
export function parseReviewRead(raw: unknown, lines: readonly QuoteLine[]): ReviewFinding[] {
  const ids = new Set(lines.map((l) => l.id));
  const list = Array.isArray(obj(raw).findings) ? (obj(raw).findings as unknown[]) : [];
  return list
    .map((f, i) => {
      const o = obj(f);
      return findingOf({ ...o, id: `t${i + 1}`, option: typeof o.option === "number" && o.option >= 0 ? o.option : null, state: "open" }, ids);
    })
    .filter((f): f is ReviewFinding => f !== null && f.answers.length > 0)
    .slice(0, MAX_FINDINGS);
}

const money = (c: number | null) => (c == null ? "no price" : `$${(c / 100).toFixed(2)}`);

/** The quote as Tiff reads it for the check: every option's lines with their
    ids, then the proposal's words block by block. */
export function reviewInput(lines: readonly QuoteLine[], proposal: LinesProposal | null, optionNames: readonly string[], unitKw: (l: QuoteLine) => number | null): string {
  const options = Math.max(1, ...lines.map((l) => l.optionIndex + 1));
  const parts: string[] = [];
  for (let i = 0; i < options; i++) {
    parts.push(`## Option ${i + 1} (index ${i}): ${optionNames[i] || "unnamed"}`);
    for (const l of lines.filter((x) => x.optionIndex === i)) {
      const kw = l.kind === "unit" ? unitKw(l) : null;
      parts.push(`- [${l.id}] ${l.group} | ${l.kind} | ${l.name}${l.code ? ` (${l.code})` : ""} | ${l.qty} ${l.unit} | sells ${money(l.sellCents ?? null)} each${kw != null ? ` | maker's cooling ${kw} kW` : ""}${l.why ? ` | why: ${l.why.slice(0, 160)}` : ""}`);
    }
  }
  if (proposal) {
    parts.push("## The proposal, block by block");
    parts.push(`[title] ${proposal.title}`);
    parts.push(`[intro] ${proposal.intro}`);
    proposal.options.forEach((o, i) => {
      parts.push(`[summary-${i}] ${o.summary}`);
      parts.push(`[work-${i}] ${o.areas.map((a) => `${a.name ? `${a.name}: ` : ""}${a.items.join("; ")}`).join(" / ")}`);
      parts.push(`[included-${i}] ${o.included.join("; ")}`);
    });
    parts.push(`[notIncluded] ${proposal.notIncluded.join("; ")}`);
    parts.push(`[payment] ${PAYMENT_PRESETS[proposal.payment.preset]?.label ?? proposal.payment.preset}: ${proposal.payment.stages.map((s) => `${s.when}${s.percent != null ? ` ${s.percent}%` : ""}`).join("; ")}`);
    parts.push(`[choice] the customer picks ${proposal.choice === "any" ? "any options they want" : "one option"}`);
  } else {
    parts.push("## The proposal: not written yet");
  }
  return parts.join("\n");
}

export function reviewPrompt(input: { business: string; client: string | null; site: string | null; kept: readonly ReviewFinding[] }): string {
  const kept = input.kept.length
    ? `\nAlready decided on this quote, so don't raise these again:\n${input.kept.map((f) => `- ${f.topic}: kept, "${f.reason || "no reason given"}"`).join("\n")}\n`
    : "";
  return `You are Tiff, checking a quote from ${input.business}, an air-conditioning business, before it's marked ready to send. The customer is ${input.client ?? "not named"}${input.site ? `, for ${input.site}` : ""}. The quote is above: each option's lines, then the proposal's words, each block tagged with its key in square brackets.

Find what a careful estimator would catch before the customer sees it. Two kinds:
- "mismatch": the paper says something the lines don't have, or the lines have something the paper doesn't say; a figure on the paper that isn't the line's or the maker's (a unit's kW, a count, a total); the same thing priced twice (ceiling cone diffusers and linear grilles for the same room); the same thing said twice; an outlet, unit or room named that has nothing on the lines.
- "look": worth a second look, not wrong: a maker's specified part swapped for another; duct, static or noise concerns the lines' "why" admits; terms or conditions that don't suit the customer (a home's payment terms on a builder's tender, no conditions for a staged build: visits included, return visits charged, positions fixed at rough-in, power ready for commissioning, how long the price holds).
${kept}
Rules:
- Only real findings. Nothing about style or tone. None at all is a fine answer.
- At most ${MAX_FINDINGS}, the ones that matter most first.
- "topic": a few plain words a customer could read ("Unit cooling figures", "Copper tees for CMY joints").
- "words": one or two sentences saying what's wrong, with the figures. Plain Australian English, no jargon the trade wouldn't use.
- "put": what's on the quote now, in a few words ("14, 8, 2.5 and 2 kW"), or "".
- "tab": "proposal" when it's about the paper's words, "breakdown" when it's about the lines. "block": the paper's block key it's in (for example "summary-0", "work-1", "units-0", "payment", "notIncluded"), or "" on the lines. "lineIds": the ids in square brackets of the lines it's about, or [].
- "option": the option's index, or -1 for the whole quote.
- "answers": one to three fixes, the likely one first. "label": a button's words, a verb and a noun, under 40 characters ("Use the maker's figures"). "fix": exactly what to change, as an instruction to yourself on this quote. Never offer to keep it: keeping is always offered.`;
}
