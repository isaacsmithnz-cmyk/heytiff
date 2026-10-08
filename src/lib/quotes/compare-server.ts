import "server-only";
import { bookProducts } from "./book-view-server";
import { capacityOf, unitPartOf, unitTypeOf } from "./brands";
import { askedPair, bookUnit, byCode, pairOutdoor, suggestions, type BookUnit, type Pair } from "./compare";
import { specsOfCodes } from "./fit-server";
import { pipeFromMm } from "./kits";
import type { QuoteLine } from "./lines";
import { readByHand } from "./lines-job-server";
import { changeLine, readLines } from "./lines-server";
import type { UnitSpecs } from "./lookups";
import { readQuoteSettings } from "./settings-query";

/* Compare, read and used (compare.ts says what's offered and how it pairs):
   each column's price as the quote would sell it, what it is off its
   maker's data pack ("No data pack" where there's none), and Use on option
   N swapping the indoor and outdoor lines at the book's price, as the
   person. Service role, by org; the route gates. */

export type CompareColumn = {
  current: boolean;
  indoor: BookUnit;
  outdoor: BookUnit | null;
  /** what the pair sells for on the quote, ex GST; null when it can't be told */
  sellCents: number | null;
  /** against the unit on the quote */
  diffCents: number | null;
  cooling: string;
  /** null: no data pack */
  indoorSpec: string | null;
  outdoorSpec: string | null;
  pipe: string | null;
  pairedBy: string;
};

export type CompareView = { ok: true; line: { id: string; name: string; system: string; option: number }; columns: CompareColumn[] } | { ok: false; reason: string };

const kw = (n: number | null) => (n == null ? null : `${Math.round(n * 10) / 10} kW`);

function specWords(s: UnitSpecs | null) {
  if (!s) return { indoor: null, outdoor: null, pipe: null };
  const size = s.sizeMm ? `${s.sizeMm.map((n) => n.toLocaleString("en-AU")).join(" × ")} mm` : null;
  const sound = s.soundDba.low != null && s.soundDba.high != null ? `${s.soundDba.low} to ${s.soundDba.high} dB(A)` : null;
  const pipe = s.pipeMm ? pipeFromMm(s.pipeMm.liquid, s.pipeMm.gas)?.replace("+", " + ") ?? null : null;
  return {
    indoor: [size, s.weightKg != null ? `${s.weightKg} kg` : null, sound].filter(Boolean).join(", ") || null,
    outdoor: [s.sizeMm ? `${s.sizeMm[2].toLocaleString("en-AU")} mm tall` : null, s.weightKg != null ? `${s.weightKg} kg` : null, s.maxAmps != null ? `${s.maxAmps} A` : null].filter(Boolean).join(", ") || null,
    pipe,
  };
}

/** The outdoor on the quote beside an indoor line: the same option and
    system, a unit, an outdoor by its name or code. */
export const outdoorLineOf = (lines: readonly QuoteLine[], indoor: QuoteLine) =>
  lines.find((l) => l.id !== indoor.id && l.optionIndex === indoor.optionIndex && l.system === indoor.system && l.kind === "unit" && unitPartOf(l.name, l.code ?? "") === "outdoor") ?? null;

export async function compareView(orgId: string, jobUuid: string, lineId: string): Promise<CompareView> {
  const [lines, products, settings, byHand] = await Promise.all([readLines(orgId, jobUuid), bookProducts(orgId), readQuoteSettings(orgId), readByHand(orgId, jobUuid)]);
  const line = lines.find((l) => l.id === lineId);
  if (!line || line.kind !== "unit" || !line.code) return { ok: false, reason: "Compare works from a unit on the quote." };
  const outLine = outdoorLineOf(lines, line);
  const markup = settings.unitMarkupPct;
  const sellOf = (cost: number, set: number | null) => (set != null ? set : markup == null ? null : Math.round(cost * (1 + markup / 100)));

  const current: Pair = {
    indoor: { name: line.name, code: line.code, supplierKey: line.supplierKey ?? "", costCents: line.costCents, brand: null },
    outdoor: outLine?.code ? { name: outLine.name, code: outLine.code, supplierKey: outLine.supplierKey ?? "", costCents: outLine.costCents, brand: null } : null,
  };
  const others = [
    ...suggestions(products, line.code),
    ...(byHand.compare[line.id] ?? []).map((c) => byCode(products, c)).filter((p) => p != null).map((p) => {
      const out = pairOutdoor(products, p!);
      return { indoor: bookUnit(p!)!, outdoor: out ? bookUnit(out) : null };
    }),
  ].filter((p, i, all) => p.indoor.code !== line.code && all.findIndex((q) => q.indoor.code === p.indoor.code) === i);

  const pairs = [current, ...others];
  const specs = await specsOfCodes(pairs.flatMap((p) => [p.indoor, ...(p.outdoor ? [p.outdoor] : [])]));
  const lineSell = (l: QuoteLine) => (sellOf(l.costCents, l.sellCents) ?? 0) * Math.max(1, l.qty);
  const curSell = markup == null && line.sellCents == null ? null : lineSell(line) + (outLine ? lineSell(outLine) : 0);

  const columns = pairs.map((p, i): CompareColumn => {
    const isCurrent = i === 0;
    const sell = isCurrent ? curSell : (() => {
      const a = sellOf(p.indoor.costCents, null);
      const b = p.outdoor ? sellOf(p.outdoor.costCents, null) : 0;
      return a == null || b == null ? null : a + b;
    })();
    const inSpec = specs.get(p.indoor.code) ?? null;
    const outSpec = p.outdoor ? (specs.get(p.outdoor.code) ?? null) : null;
    const pack = outSpec ?? inSpec;
    const cool = pack?.coolKw != null ? [kw(pack.coolKw), pack.heatKw != null ? `${kw(pack.heatKw)} heating` : null].filter(Boolean).join(", ") : `${kw(capacityOf(p.indoor.name, p.indoor.code)) ?? "Not known"}, from its name`;
    return {
      current: isCurrent,
      indoor: p.indoor,
      outdoor: p.outdoor,
      sellCents: sell,
      diffCents: isCurrent || sell == null || curSell == null ? null : sell - curSell,
      cooling: cool,
      indoorSpec: specWords(inSpec).indoor,
      outdoorSpec: specWords(outSpec).outdoor,
      pipe: specWords(outSpec ?? inSpec).pipe,
      pairedBy: isCurrent ? "On the quote" : p.outdoor ? "Your book: same brand, type and size" : "No outdoor for it in your book",
    };
  });
  return { ok: true, line: { id: line.id, name: line.name, system: line.system, option: line.optionIndex }, columns };
}

/** Use a compared unit on the quote: the indoor line and its outdoor
    swapped at the book's price, as the person. */
export async function putComparedOn(orgId: string, jobUuid: string, lineId: string, indoorCode: string, by: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  const [lines, products] = await Promise.all([readLines(orgId, jobUuid), bookProducts(orgId)]);
  const line = lines.find((l) => l.id === lineId);
  const product = byCode(products, indoorCode);
  if (!line || !product) return { ok: false, reason: "That unit has gone from the quote or your book." };
  const indoor = bookUnit(product)!;
  const out = pairOutdoor(products, product);
  const why = `Compared, chose ${indoor.code}`;
  const swap = (l: QuoteLine, u: BookUnit) => changeLine(orgId, jobUuid, l.id, l.version, { name: u.name, code: u.code, supplierKey: u.supplierKey, costCents: u.costCents, sellCents: null }, by, why);
  const r = await swap(line, indoor);
  if (!r.ok) return r;
  const outLine = outdoorLineOf(lines, line);
  if (outLine && out) {
    const r2 = await swap(outLine, bookUnit(out)!);
    if (!r2.ok) return r2;
  }
  return { ok: true };
}

/** What a person asked to compare with: found in the book with no
    judgement, or null for Tiff. */
export async function askCompare(orgId: string, jobUuid: string, lineId: string, ask: string): Promise<{ found: Pair | null; line: QuoteLine | null }> {
  const [lines, products] = await Promise.all([readLines(orgId, jobUuid), bookProducts(orgId)]);
  const line = lines.find((l) => l.id === lineId) ?? null;
  if (!line) return { found: null, line: null };
  return { found: askedPair(products, ask, unitTypeOf(line.name, line.code ?? "")), line };
}
