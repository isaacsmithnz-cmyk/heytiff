/* CORRECTIONS (slice 13.1) — every change a person makes to a line Tiff
   wrote: what it was, what it became, who, why, and on what kind of job.
   Read from the quote lines' own history (quote_line_changes), so nothing
   new is kept: a line Tiff added is hers, and a person's change to it after
   is a correction. Tiff reads her corrections for the kind of job before
   she builds (your_corrections), and the habits that ask to become a rule
   grow from them (13.2). Pure. */

export type ChangeRow = {
  lineId: string;
  job: string;
  action: "add" | "change" | "remove";
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  why: string;
  madeBy: string;
  madeAt: string;
};

export type Correction = {
  job: string;
  /** the job's category in ServiceM8, "Residential install"; null unknown */
  kind: string | null;
  /** what changed, in a few words: "qty 4 → 6", "took it off", "PC1412 → PC1438" */
  what: string;
  line: string;
  why: string;
  by: string;
  at: string;
};

const FIELD_WORDS: Record<string, string> = { qty: "qty", costCents: "cost", sellCents: "sell", unit: "unit", system: "system", group: "group", optionIndex: "option" };

const shown = (k: string, v: unknown) => (v == null ? "none" : (k === "costCents" || k === "sellCents") && typeof v === "number" ? `$${(v / 100).toFixed(2)}` : String(v));

/** A change in a few words. */
export function changeWords(c: Pick<ChangeRow, "action" | "before" | "after">): string {
  if (c.action === "remove") return "took it off";
  const before = c.before ?? {};
  const after = c.after ?? {};
  if (after.code !== undefined && before.code !== after.code) return `${before.code ?? before.name ?? "none"} → ${after.code ?? after.name ?? "none"}`;
  return Object.keys(after)
    .filter((k) => k in FIELD_WORDS)
    .map((k) => `${FIELD_WORDS[k]} ${shown(k, before[k])} → ${shown(k, after[k])}`)
    .join(", ");
}

/** The changes people made to Tiff's lines, newest first, each with its
    job's kind. `kinds` by job. */
export function correctionsFrom(rows: readonly ChangeRow[], kinds: ReadonlyMap<string, string | null>): Correction[] {
  const hers = new Map(rows.filter((r) => r.action === "add" && r.madeBy === "tiff").map((r) => [r.lineId, String(r.after?.name ?? "a line")]));
  return rows
    .filter((r) => r.madeBy !== "tiff" && r.action !== "add" && hers.has(r.lineId))
    .map((r) => ({
      job: r.job,
      kind: kinds.get(r.job) ?? null,
      what: changeWords(r),
      line: hers.get(r.lineId)!,
      why: r.why,
      by: r.madeBy,
      at: r.madeAt,
    }))
    .filter((c) => c.what)
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}
