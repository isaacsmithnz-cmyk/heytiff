import { EXTRA_NOTES, EXTRA_NOTE_KEYS } from "@/lib/quotes/proposal";
import { PAYMENT_PRESETS, PAYMENT_PRESET_KEYS, type PaymentPreset, type PaymentStage } from "@/lib/quotes/payment";
import { DEFAULT_CHECKLIST, type ChecklistSeed } from "@/lib/workboard/stages";

/* A BUSINESS'S OWN TEMPLATES — the wording it sends that is its own to
   change, kept per business (public.org_templates, one row per template).
   Until a business changes one, it gets the standard wording below, and
   going back to it deletes the row.

   Four templates, and only these: the quote's notes, its payment terms, the
   checklist every new project starts with (its Handover section prints on
   the handover sheet), and the documents email. The certificate and the
   SWMS are not here: their wording is checked against the standards and
   approved, never edited (lib/certs/mechanical, lib/swms/library).

   Pure, so the editors in the browser and the readers on the server agree
   on what a valid template is. */

export const TEMPLATE_SETTINGS = ["quote_notes", "payment_terms", "project_checklist", "documents_email"] as const;
export type TemplateSetting = (typeof TEMPLATE_SETTINGS)[number];

export type QuoteNote = {
  /** Kept on each quote that carries the note: a standard note keeps its
      standard key, a note the business adds gets its own. */
  key: string;
  heading: string;
  lines: string[];
  /** On every quote, rather than when Tiff judges a job needs it. */
  always: boolean;
};
export type PaymentTerms = Record<PaymentPreset, { label: string; stages: PaymentStage[] }>;
export type DocumentsEmail = { subject: string; message: string };

export type OrgTemplates = {
  quoteNotes: QuoteNote[];
  paymentTerms: PaymentTerms;
  projectChecklist: ChecklistSeed[];
  documentsEmail: DocumentsEmail;
  /** When each was last changed (ISO), for the ones the business has
      changed; absent means the standard wording. */
  changed: Partial<Record<TemplateSetting, string>>;
};

export const MAX_NOTES = 20;
export const MAX_NOTE_LINES = 6;
export const MAX_LINE = 300;
export const MAX_HEADING = 80;
export const MAX_ITEMS = 40;
export const MAX_SUBJECT = 200;
export const MAX_MESSAGE = 2000;

/* ── the standard wording ──────────────────────────────────────────────── */

export const STANDARD_NOTES: QuoteNote[] = EXTRA_NOTE_KEYS.map((key) => ({
  key,
  heading: EXTRA_NOTES[key].heading,
  lines: [...EXTRA_NOTES[key].lines],
  always: false,
}));

export const STANDARD_EMAIL: DocumentsEmail = {
  subject: "Documents for job [job number], [site address]",
  message: "Hi,\n\nPlease find our documents for this job attached.\n\nKind regards,\n[your name]\n[your business]",
};

const copyTerms = (t: PaymentTerms): PaymentTerms =>
  Object.fromEntries(PAYMENT_PRESET_KEYS.map((k) => [k, { label: t[k].label, stages: t[k].stages.map((s) => ({ ...s })) }])) as PaymentTerms;

export function standardTemplates(): OrgTemplates {
  return {
    quoteNotes: STANDARD_NOTES.map((n) => ({ ...n, lines: [...n.lines] })),
    paymentTerms: copyTerms(PAYMENT_PRESETS),
    projectChecklist: DEFAULT_CHECKLIST.map((i) => ({ ...i })),
    documentsEmail: { ...STANDARD_EMAIL },
    changed: {},
  };
}

/* ── reading one back: a browser's claim, or a stored row ──────────────── */

const text = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const KEY = /^[a-z0-9_-]{1,40}$/;

/** A key for a note the business adds, from its heading. */
export function noteKeyFor(heading: string, taken: readonly string[]): string {
  const base = `own-${heading.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30) || "note"}`;
  let key = base;
  for (let n = 2; taken.includes(key); n += 1) key = `${base}-${n}`;
  return key;
}

export function normaliseNotes(raw: unknown): QuoteNote[] | null {
  if (!Array.isArray(raw)) return null;
  const out: QuoteNote[] = [];
  for (const r of raw.slice(0, MAX_NOTES)) {
    const o = rec(r);
    const heading = text(o.heading, MAX_HEADING);
    const lines = (Array.isArray(o.lines) ? o.lines : []).map((l) => text(l, MAX_LINE)).filter(Boolean).slice(0, MAX_NOTE_LINES);
    if (!heading || lines.length === 0) continue;
    const taken = out.map((n) => n.key);
    const key = typeof o.key === "string" && KEY.test(o.key) && !taken.includes(o.key) ? o.key : noteKeyFor(heading, taken);
    out.push({ key, heading, lines, always: o.always === true });
  }
  return out;
}

export function normaliseTerms(raw: unknown): PaymentTerms | null {
  const o = rec(raw);
  if (Object.keys(o).length === 0) return null;
  const terms = copyTerms(PAYMENT_PRESETS);
  for (const k of PAYMENT_PRESET_KEYS) {
    const p = rec(o[k]);
    const stages = (Array.isArray(p.stages) ? p.stages : []).slice(0, 8).flatMap((s): PaymentStage[] => {
      const r = rec(s);
      const when = text(r.when, MAX_HEADING);
      const n = typeof r.percent === "number" ? r.percent : Number(r.percent);
      const percent = r.percent === null || r.percent === "" || !Number.isFinite(n) ? null : Math.round(Math.min(100, Math.max(0, n)));
      return when ? [{ when, percent }] : [];
    });
    if (stages.length > 0) terms[k] = { label: terms[k].label, stages };
  }
  return terms;
}

export function normaliseChecklist(raw: unknown): ChecklistSeed[] | null {
  if (!Array.isArray(raw)) return null;
  const out = raw.slice(0, MAX_ITEMS).flatMap((r): ChecklistSeed[] => {
    const o = rec(r);
    const section = text(o.section, MAX_HEADING);
    const label = text(o.label, MAX_LINE);
    return section && label ? [{ section, label }] : [];
  });
  return out.length > 0 ? out : null;
}

export function normaliseEmail(raw: unknown): DocumentsEmail | null {
  const o = rec(raw);
  const subject = text(o.subject, MAX_SUBJECT);
  /* the message keeps its line breaks; only runs of spaces close up */
  const message =
    typeof o.message === "string"
      ? o.message
          .replace(/\r\n?/g, "\n")
          .replace(/[ \t]+/g, " ")
          .replace(/\n{3,}/g, "\n\n")
          .trim()
          .slice(0, MAX_MESSAGE)
      : "";
  return subject && message ? { subject, message } : null;
}

/** Every template, from the stored rows: each row that reads back as a
    valid template replaces the standard one. */
export function templatesFrom(rows: readonly { key: string; value: unknown; updated_at: string }[]): OrgTemplates {
  const t = standardTemplates();
  for (const r of rows) {
    if (r.key === "quote_notes") {
      const v = normaliseNotes(r.value);
      if (v) {
        t.quoteNotes = v;
        t.changed.quote_notes = r.updated_at;
      }
    } else if (r.key === "payment_terms") {
      const v = normaliseTerms(r.value);
      if (v) {
        t.paymentTerms = v;
        t.changed.payment_terms = r.updated_at;
      }
    } else if (r.key === "project_checklist") {
      const v = normaliseChecklist(r.value);
      if (v) {
        t.projectChecklist = v;
        t.changed.project_checklist = r.updated_at;
      }
    } else if (r.key === "documents_email") {
      const v = normaliseEmail(r.value);
      if (v) {
        t.documentsEmail = v;
        t.changed.documents_email = r.updated_at;
      }
    }
  }
  return t;
}

/** What stops a template being saved, in words; empty when it can be. */
export function templateProblems(key: TemplateSetting, value: unknown): string[] {
  if (key === "quote_notes") {
    const v = normaliseNotes(value);
    return v === null ? ["Those notes couldn't be read."] : [];
  }
  if (key === "payment_terms") {
    const v = normaliseTerms(value);
    if (!v) return ["Those payment terms couldn't be read."];
    return PAYMENT_PRESET_KEYS.flatMap((k) => paymentTermProblems(k, v[k].stages).map((p) => `${v[k].label}: ${p}`));
  }
  if (key === "project_checklist") return normaliseChecklist(value) ? [] : ["Give the checklist at least one item."];
  return normaliseEmail(value) ? [] : ["Give the email a subject and a message."];
}

/* the Home Building Act's limit, and terms that add up; a business's
   progress claims are claimed, not set in advance */
function paymentTermProblems(preset: PaymentPreset, stages: readonly PaymentStage[]): string[] {
  if (preset === "commercial") return [];
  const out: string[] = [];
  const first = stages[0];
  if (first && first.percent !== null && first.percent > 10 && /deposit/i.test(first.when)) out.push("a deposit on a home job can't be more than 10%.");
  if (stages.some((s) => s.percent === null)) out.push("every stage on a home job needs its percentage.");
  else {
    const total = stages.reduce((n, s) => n + (s.percent ?? 0), 0);
    if (total !== 100) out.push(`the stages add up to ${total}%, not 100%.`);
  }
  return out;
}

/* ── the documents email, filled in ────────────────────────────────────── */

export type EmailFacts = { jobNumber: string | null; siteAddress: string | null; yourName: string | null; business: string | null };

export const EMAIL_FILLS: readonly { token: string; label: string }[] = [
  { token: "[job number]", label: "Job number" },
  { token: "[site address]", label: "Site address" },
  { token: "[your name]", label: "Your name" },
  { token: "[your business]", label: "Your business" },
];

/** The template's words with the job's facts in place. A fact the job
    doesn't have takes its token out, and the punctuation it leaves behind
    with it ("Documents for job 1234, " loses its comma). */
export function fillEmail(words: string, f: EmailFacts): string {
  const value: Record<string, string> = {
    "[job number]": f.jobNumber?.trim() ?? "",
    "[site address]": f.siteAddress?.trim() ?? "",
    "[your name]": f.yourName?.trim() ?? "",
    "[your business]": f.business?.trim() ?? "",
  };
  return words
    .split("\n")
    .map((line) => {
      const had = /\[(job number|site address|your name|your business)\]/i.test(line);
      if (!had) return line;
      const filled = line
        .replace(/\[(job number|site address|your name|your business)\]/gi, (m) => value[m.toLowerCase()] ?? "")
        .replace(/[ \t]+([,.])/g, "$1")
        .replace(/,(\s*,)+/g, ",")
        .replace(/^[\s,]+|[\s,]+$/g, "")
        .replace(/[ \t]{2,}/g, " ");
      return filled === "" ? null : filled;
    })
    .filter((l): l is string => l !== null)
    .join("\n");
}
