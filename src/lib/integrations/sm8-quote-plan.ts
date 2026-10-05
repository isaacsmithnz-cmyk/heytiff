/* An accepted quote in ServiceM8 — the decisions, pure (quotes to
   ServiceM8, Isaac, 2026-10-05: "if a quote is accepted, then it can turn
   that into the work order for service mate… copy the scope and line items
   to service mate").

   One press is a set of queued rows (kind "quote"), each to one ServiceM8
   record, kept in the customer change's two columns (which record, its
   fields):

     job          the job's invoice description (work_done_description),
                  and its status to "Work Order" when it was a Quote: update
     jobmaterial  a line on the job, under a uuid chosen when the row was
                  queued: create; or a line that was there: delete (soft)

   Paths, fields and scopes read off ServiceM8's reference on 2026-10-05:
   job/{uuid}.json (manage_jobs; `status` required on an update, so the
   sender sends it — the new one, or the live one unchanged),
   jobmaterial.json (manage_job_materials; a client uuid accepted),
   jobmaterial/{uuid}.json DELETE (sets active to 0).

   ONE ROW PER RECORD PER PRESS (sm8_writes' dedupe_key):
   quote:<press id>:job, quote:<press id>:add:<n>, quote:<press id>:off:<uuid>. */

import { QUOTE_WORDS } from "./sm8-quote-words";

export { QUOTE_WORDS };

export type QuoteObject = "job" | "jobmaterial";

/** The fields each record may have sent by HeyTiff, and nothing else. */
export const QUOTE_FIELDS: Record<QuoteObject, readonly string[]> = {
  job: ["work_done_description", "status"],
  jobmaterial: ["name", "quantity", "price", "cost", "displayed_amount", "displayed_amount_is_tax_inclusive", "tax_rate_uuid", "sort_order"],
};

/** The only status a send sets. */
export const WORK_ORDER = "Work Order";
/** The statuses a job may be in for a send to touch it. */
export const QUOTE_STATUSES = ["Quote", WORK_ORDER] as const;


/** Only the fields a record may have sent, from what a row carries; a job's
    status only when it is the Work Order. */
export function allowedQuoteFields(object: QuoteObject, fields: unknown): Record<string, string> {
  const f = fields && typeof fields === "object" && !Array.isArray(fields) ? (fields as Record<string, unknown>) : {};
  const out = Object.fromEntries(QUOTE_FIELDS[object].filter((k) => typeof f[k] === "string").map((k) => [k, f[k] as string]));
  if (object === "job" && out.status !== undefined && out.status !== WORK_ORDER) delete out.status;
  return out;
}

/** Whether a record read back holds what was sent. */
export function holdsQuote(record: Record<string, unknown>, fields: Record<string, string>): boolean {
  return Object.entries(fields).every(([k, v]) => {
    const got = String(record[k] ?? "").trim();
    const n = Number(v);
    /* amounts come back as ServiceM8 keeps them: "9.3000" for "9.30" */
    return got === v.trim() || (v.trim() !== "" && Number.isFinite(n) && Number(got) === n);
  });
}

/* ── one press, as rows ── */

export type QuoteRowInput = {
  object: QuoteObject;
  op: "create" | "update" | "delete";
  /** the job (update) or the line taken off (delete); null for a line added */
  uuid: string | null;
  fields: Record<string, string>;
  label: string;
  /** the subject's own part: "job", "add:<n>", "off:<uuid>" */
  key: string;
};

/** A unit amount as ServiceM8 keeps it: dollars to four places. */
const amount = (cents: number) => (cents / 100).toFixed(4);
const quantityOf = (n: number) => String(Math.round(n * 10000) / 10000);
const fill = (s: string, name: string) => s.replace("{name}", name);

/** The rows one press queues for a send plan: the job first, then each line
    taken off, then each line added, in the quote's order. */
export function quoteRows(
  jobUuid: string,
  plan: {
    status: { to: string } | null;
    workDone: string;
    lines: readonly { name: string; quantity: number; unitPriceCents: number; unitCostCents: number | null }[];
    remove: readonly { uuid: string; name: string }[];
    taxRateUuid: string;
  }
): QuoteRowInput[] {
  const job: QuoteRowInput = {
    object: "job",
    op: "update",
    uuid: jobUuid,
    fields: { work_done_description: plan.workDone.slice(0, 20_000), ...(plan.status ? { status: WORK_ORDER } : {}) },
    label: QUOTE_WORDS.label.job,
    key: "job",
  };
  const off = plan.remove.map((r) => ({
    object: "jobmaterial" as const,
    op: "delete" as const,
    uuid: r.uuid,
    fields: {},
    label: fill(QUOTE_WORDS.label.off, r.name || "a line"),
    key: `off:${r.uuid.toLowerCase()}`,
  }));
  const add = plan.lines.map((l, i) => {
    const price = amount(l.unitPriceCents);
    return {
      object: "jobmaterial" as const,
      op: "create" as const,
      uuid: null,
      fields: {
        name: l.name.slice(0, 200),
        quantity: quantityOf(l.quantity),
        price,
        ...(l.unitCostCents != null ? { cost: amount(l.unitCostCents) } : {}),
        displayed_amount: price,
        displayed_amount_is_tax_inclusive: "0",
        tax_rate_uuid: plan.taxRateUuid,
        sort_order: String(i + 1),
      },
      label: fill(QUOTE_WORDS.label.add, l.name.slice(0, 60)),
      key: `add:${i + 1}`,
    };
  });
  return [job, ...off, ...add];
}
