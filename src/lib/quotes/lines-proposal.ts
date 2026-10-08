import { PAYMENT_PRESETS, PAYMENT_PRESET_KEYS, type PaymentPreset, type PaymentStage } from "./payment";

/* THE PROPOSAL FOR A QUOTE BUILT ON ITS LINES (slice 7.1, mock-up screen 7,
   Isaac 2026-10-07: "the price should not be first… each option… clear
   scope… written summary… what's included on each one").

   The words are kept here; everything with a number comes from the lines
   when the proposal is drawn, so a price on the proposal is always the
   quote's: the equipment from the unit lines, each option's price, the
   payment stages' amounts.

   Laid out option by option, price last: each option's summary, the work
   by area, what's included, its equipment, then its price; then the choice
   (one option, or any the client ticks), what isn't included, payment by
   stage, the business's notes and terms, and the sign-off.

   Written by Tiff (write_proposal) or by a person, block by block. Approve
   is a person saying this version is right to go: any change to a line or
   to the words after that takes it back. Pure. */

export type ProposalArea = { name: string; items: string[] };
export type OptionWords = { summary: string; areas: ProposalArea[]; included: string[] };

export type LinesProposal = {
  title: string;
  intro: string;
  options: OptionWords[];
  notIncluded: string[];
  /** the client picks one option, or ticks any they want */
  choice: "one" | "any";
  payment: { preset: PaymentPreset; stages: PaymentStage[] };
  /** the business's quote notes put on it, by key (Admin, Templates) */
  notes: string[];
  updatedAt: string;
  approvedAt: string | null;
  approvedBy: string | null;
};

const MAX_TEXT = 2000;
const MAX_ITEM = 300;
const MAX_ITEMS = 30;
const MAX_AREAS = 10;

const text = (v: unknown, max = MAX_TEXT) => (typeof v === "string" ? v.replace(/\r/g, "").trim().slice(0, max) : "");
const items = (v: unknown) =>
  (Array.isArray(v) ? v : [])
    .map((x) => text(x, MAX_ITEM).replace(/\s+/g, " "))
    .filter(Boolean)
    .slice(0, MAX_ITEMS);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

function stagesOf(raw: unknown, preset: PaymentPreset): PaymentStage[] {
  const list = (Array.isArray(raw) ? raw : [])
    .map((s) => {
      const o = obj(s);
      const when = text(o.when, 200);
      const p = typeof o.percent === "number" && Number.isFinite(o.percent) && o.percent >= 0 && o.percent <= 100 ? Math.round(o.percent) : null;
      return when ? { when, percent: p } : null;
    })
    .filter((s): s is PaymentStage => s != null)
    .slice(0, 8);
  return list.length ? list : PAYMENT_PRESETS[preset].stages.map((s) => ({ ...s }));
}

export function proposalOf(raw: unknown): LinesProposal {
  const r = obj(raw);
  const pay = obj(r.payment);
  const preset = (PAYMENT_PRESET_KEYS as readonly unknown[]).includes(pay.preset) ? (pay.preset as PaymentPreset) : "domestic_small";
  return {
    title: text(r.title, 160),
    intro: text(r.intro),
    options: (Array.isArray(r.options) ? r.options : []).slice(0, 20).map((o) => {
      const x = obj(o);
      return {
        summary: text(x.summary),
        areas: (Array.isArray(x.areas) ? x.areas : [])
          .map((a) => ({ name: text(obj(a).name, 80), items: items(obj(a).items) }))
          .filter((a) => a.name || a.items.length)
          .slice(0, MAX_AREAS),
        included: items(x.included),
      };
    }),
    notIncluded: items(r.notIncluded),
    choice: r.choice === "any" ? "any" : "one",
    payment: { preset, stages: stagesOf(pay.stages, preset) },
    notes: (Array.isArray(r.notes) ? r.notes : []).filter((k): k is string => typeof k === "string" && /^[a-z0-9_-]{1,40}$/.test(k)).slice(0, 20),
    updatedAt: typeof r.updatedAt === "string" ? r.updatedAt : "",
    approvedAt: typeof r.approvedAt === "string" ? r.approvedAt : null,
    approvedBy: typeof r.approvedBy === "string" ? r.approvedBy : null,
  };
}

/* ── the words as a person types them ── */

/** One item a line: "- " or "• " in front is fine. */
export const listOf = (typed: string) => items(typed.split("\n").map((l) => l.replace(/^\s*(?:[-•*]|\d+[.)])\s*/, "")));
export const listText = (list: readonly string[]) => list.map((i) => `- ${i}`).join("\n");

/** The work by area as typed: an area's name on a line of its own ending
    in ":", its items under it. Items before any name are one nameless area. */
export function areasOf(typed: string): ProposalArea[] {
  const out: ProposalArea[] = [];
  for (const raw of typed.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const head = /^(.{1,80}):$/.exec(line);
    if (head && !/^[-•*]/.test(line)) {
      out.push({ name: head[1]!.trim(), items: [] });
      continue;
    }
    if (out.length === 0) out.push({ name: "", items: [] });
    const item = line.replace(/^\s*(?:[-•*]|\d+[.)])\s*/, "").slice(0, MAX_ITEM);
    if (item) out[out.length - 1]!.items.push(item);
  }
  return out.filter((a) => a.name || a.items.length).slice(0, MAX_AREAS);
}
export const areasText = (areas: readonly ProposalArea[]) => areas.map((a) => [a.name ? `${a.name}:` : "", ...a.items.map((i) => `- ${i}`)].filter(Boolean).join("\n")).join("\n\n");

/* ── approval ── */

/** Whether an approval still stands: given after the words last changed
    and after every line's last change. */
export function approvalStands(p: Pick<LinesProposal, "approvedAt" | "updatedAt">, lineTimes: readonly string[]): boolean {
  if (!p.approvedAt) return false;
  const last = [p.updatedAt, ...lineTimes].filter(Boolean).sort().at(-1) ?? "";
  return p.approvedAt >= last;
}

/** Each payment stage's amount, of a price inc GST, cents; null for a claim
    with no fixed share. */
export const stageAmounts = (stages: readonly PaymentStage[], incGstCents: number) =>
  stages.map((s) => (s.percent == null ? null : Math.round((incGstCents * s.percent) / 100)));
