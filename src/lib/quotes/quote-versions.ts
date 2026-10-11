import type { QuoteLine } from "./lines";
import { stillUnknown, type LinesOption } from "./lines-price";

/* VERSION 2, BEFORE IT'S ACCEPTED (Isaac, 2026-10-10: "show me how that
   workflow goes from a completed quote to update quote"; the round-2 mock:
   "Before it's accepted (approved or sent), the same button makes version 2
   of the quote: the approval comes off and it goes back through Approve and
   Send, in the same conversation"). Updating an approved quote keeps it as
   it stood, numbered: each option's name, its lines and its totals, and
   when it was approved; the quote itself carries on as the next version.
   Pure. */

export type VersionLine = { name: string; code: string | null; qty: number; unit: string; totalCents: number | null };
export type VersionOption = { name: string; exGstCents: number; incGstCents: number; lines: VersionLine[] };
export type QuoteVersion = { n: number; what: string; approvedAt: string | null; madeAt: string; options: VersionOption[] };

/** The quote as it stands, for keeping: every option but a variation, its
    lines with what each comes to, and its totals. */
export function versionSnapshot(lines: readonly QuoteLine[], priced: readonly Pick<LinesOption, "name" | "build">[], skip: ReadonlySet<number> = new Set()): VersionOption[] {
  const out: VersionOption[] = [];
  priced.forEach((o, i) => {
    if (skip.has(i)) return;
    const mine = lines.filter((l) => l.optionIndex === i);
    const sold = new Map(o.build.groups.flatMap((g) => g.lines.map((l) => [l.key, l.sellCents] as const)));
    /* labour is priced as visits, in the order its known lines come */
    const labour = mine.filter((l) => l.kind === "labour" && !stillUnknown(l));
    const visitSell = new Map(labour.map((l, k) => [l.id, o.build.labour.visits[k]?.sellCents ?? null] as const));
    out.push({
      name: o.name || `Option ${i + 1}`,
      exGstCents: o.build.exGstCents,
      incGstCents: o.build.incGstCents,
      lines: mine.map((l) => ({
        name: l.name,
        code: l.code,
        qty: l.qty,
        unit: l.unit,
        totalCents: stillUnknown(l) ? null : l.kind === "labour" ? (visitSell.get(l.id) ?? null) : (sold.get(l.id) ?? null),
      })),
    });
  });
  return out;
}

const text = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : Number.isFinite(Number(v)) ? Number(v) : 0);

/** A kept version back from its row. */
export function versionOf(row: Record<string, unknown>): QuoteVersion {
  const snap = row.snapshot && typeof row.snapshot === "object" ? (row.snapshot as Record<string, unknown>) : {};
  const options = (Array.isArray(snap.options) ? snap.options : []).map((x) => {
    const o = x && typeof x === "object" ? (x as Record<string, unknown>) : {};
    return {
      name: text(o.name, 120),
      exGstCents: num(o.exGstCents),
      incGstCents: num(o.incGstCents),
      lines: (Array.isArray(o.lines) ? o.lines : []).map((y) => {
        const l = y && typeof y === "object" ? (y as Record<string, unknown>) : {};
        return { name: text(l.name, 200), code: typeof l.code === "string" ? l.code : null, qty: num(l.qty), unit: text(l.unit, 4), totalCents: l.totalCents == null ? null : num(l.totalCents) };
      }),
    };
  });
  return {
    n: Math.max(1, Math.round(num(row.n))),
    what: text(row.what, 500),
    approvedAt: typeof row.approved_at === "string" ? row.approved_at : null,
    madeAt: typeof row.made_at === "string" ? row.made_at : "",
    options,
  };
}
