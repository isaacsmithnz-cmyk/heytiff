import "server-only";
import { supabaseAdmin } from "@/lib/supabase-server";
import { migrateDesign } from "@/lib/studio/migrations";
import type { DesignDocument } from "@/lib/studio/document";
import { designPacks, designsOnJob } from "./design-read-server";
import { addLine, changeLine, readEngine, readLines, removeLine, setJoins } from "./lines-server";
import { keepDesignUnits, markDesign, readByHand } from "./lines-job-server";
import type { QuoteTake } from "@/lib/studio/take-from-quote";
import { readQuoteSettings } from "./settings-query";
import { pricedLinks, readUnitChoices } from "./links-server";
import type { QuoteLine } from "./lines";
import type { LineJoin } from "./design-join";
import {
  answersOf,
  bookOf,
  designRowOf,
  questionWords,
  readJoin,
  unitLineName,
  type Answer,
  type Book,
  type DesignUnit,
  type JoinQuestion,
  type JoinView,
  type JoinRead,
  type Step,
  type UnitLine,
} from "./design-units";
import { cents2 } from "./quote-sum";

/* ONE LIST OF UNITS, read and answered (design-units.ts says the rule): the
   job's design, the one its lines are joined in or else its newest, against
   the quote's unit lines. Reading keeps the joins it finds, so each knows
   what both sides said when they agreed. An answer is carried out as the
   person: the quote's lines through addLine, changeLine and removeLine,
   each kept in Changes with Undo, priced from the book as the Studio's unit
   browser prices a model; what the design is to take waits on the line.
   Service role, by org; the route gates. */

type Read = { doc: DesignDocument; read: JoinRead; lines: QuoteLine[]; book: Book };

const unitLineOf = (l: QuoteLine): UnitLine => ({
  id: l.id,
  optionIndex: l.optionIndex,
  system: l.system,
  name: l.name,
  code: l.code,
  qty: l.qty,
  costCents: l.costCents,
  sellCents: l.sellCents,
  design: l.design ?? null,
});

async function readDesignDoc(orgId: string, id: string): Promise<DesignDocument | null> {
  const { data } = await supabaseAdmin.from("studio_designs").select("doc").eq("org_id", orgId).eq("id", id).maybeSingle();
  try {
    return migrateDesign((data as { doc: unknown } | null)?.doc).doc;
  } catch {
    return null;
  }
}

/** The join as it stands, with the joins it found kept; null with no design, no unit lines, or a quote on the old engine. */
async function readNow(orgId: string, jobUuid: string): Promise<Read | null> {
  if (!jobUuid || (await readEngine(orgId, jobUuid)) !== "lines") return null;
  const [designs, lines, byHand] = await Promise.all([designsOnJob(orgId, jobUuid), readLines(orgId, jobUuid), readByHand(orgId, jobUuid)]);
  if (designs.length === 0) return null;
  const units = lines.filter((l) => l.kind === "unit");
  if (units.length === 0) return null;
  /* the design its lines are joined in, else the newest */
  const joinedIn = new Set(units.map((l) => l.design?.design).filter(Boolean));
  const chosen = designs.find((d) => joinedIn.has(d.id)) ?? designs[0]!;
  const doc = await readDesignDoc(orgId, chosen.id);
  if (!doc) return null;
  const pack = await designPacks(doc);
  const marks = byHand.designJoin ?? { leftOff: [], drop: [] };
  const book = bookOf(pack);
  const read = readJoin({ doc, lines: units.map(unitLineOf), accepted: byHand.accepted, book, leftOff: marks.leftOff, drop: marks.drop });
  if (!read) return null;
  if (read.found.length) {
    await setJoins(orgId, jobUuid, read.found.map((f) => ({ id: f.lineId, join: f.join })));
    const by = new Map(read.found.map((f) => [f.lineId, f.join]));
    for (const l of lines) if (by.has(l.id)) l.design = by.get(l.id)!;
  }
  return { doc, read, lines, book };
}

/** A pack model as the book sells it: the supplier the business buys it
    from (its own pick, else the lowest), that supplier's code and cost. */
type Priced = { code: string; supplierKey: string; costCents: number };

async function bookPrices(orgId: string, models: readonly string[]): Promise<Map<string, Priced>> {
  const out = new Map<string, Priced>();
  if (models.length === 0) return out;
  const want = new Set(models);
  const [links, choices] = await Promise.all([pricedLinks(orgId), readUnitChoices(orgId)]);
  for (const l of links) {
    if (!want.has(l.model)) continue;
    const pick = (choices.get(l.model) ? l.offers.find((o) => o.supplierKey === choices.get(l.model)) : undefined) ?? l.cheapest;
    if (pick && pick.netCents > 0) out.set(l.model, { code: pick.code, supplierKey: pick.supplierKey, costCents: pick.netCents });
  }
  return out;
}

const modelsOf = (answers: readonly Answer[]) =>
  [...new Set(answers.flatMap((a) => a.steps.flatMap((s) => (s.step === "add" ? [s.unit.model] : s.step === "swap" ? [s.model] : []))))];

/** What an answer does to the price, at the business's unit markup: lines
    off and lines on. Null where a unit it adds isn't in the book. */
function deltaOf(a: Answer, lines: readonly QuoteLine[], prices: Map<string, Priced>, markupPct: number): number | null {
  const sell = (cost: number) => cost * (1 + markupPct / 100);
  const lineSell = (l: QuoteLine) => (l.sellCents ?? sell(l.costCents)) * l.qty;
  let d = 0;
  for (const s of a.steps) {
    const l = "lineId" in s ? lines.find((x) => x.id === s.lineId) : undefined;
    if (s.step === "remove" && l) d -= lineSell(l);
    if (s.step === "qty" && l) d -= (l.sellCents ?? sell(l.costCents)) * (l.qty - s.qty);
    if (s.step === "add") {
      const p = prices.get(s.unit.model);
      d += p ? sell(p.costCents) : 0;
    }
    if (s.step === "swap" && l) {
      const p = prices.get(s.model);
      if (p) d += sell(p.costCents) * l.qty - lineSell(l);
    }
  }
  return Math.round(d);
}

/** The join for the quote's page: where each unit line stands, the Design
    row, and Tiff's questions with what each answer does to the price. */
export async function readDesignJoin(orgId: string, jobUuid: string, money: boolean): Promise<JoinView | null> {
  const now = await readNow(orgId, jobUuid);
  if (!now) return null;
  const { read, lines } = now;
  const all = read.questions.map((q) => ({ q, answers: answersOf(read.design.id, q, now.book) }));
  const [prices, settings] = money && all.length ? await Promise.all([bookPrices(orgId, all.flatMap((x) => modelsOf(x.answers))), readQuoteSettings(orgId)]) : [new Map<string, Priced>(), null];
  const markup = settings?.unitMarkupPct ?? 0;
  const sellOf = (ls: readonly UnitLine[]) => {
    if (!money) return null;
    const c = ls.reduce((n, u) => n + (u.sellCents ?? u.costCents * (1 + markup / 100)) * u.qty, 0);
    return c > 0 ? cents2(Math.round(c)) : null;
  };
  return {
    design: read.design,
    option: read.option,
    row: designRowOf(read),
    lines: read.lines,
    waiting: read.waiting,
    asks: all.map(({ q, answers }) => {
      const w = questionWords(q, sellOf);
      return {
        id: q.id,
        question: w.ask,
        topic: w.topic,
        put: w.put,
        answers: answers.map((a) => ({ label: a.label })),
        deltas: answers.map((a) => (money ? deltaOf(a, lines, prices, markup) : null)),
      };
    }),
  };
}

const why = (q: JoinQuestion, label: string) => `“${label}”, to “${questionWords(q).ask}”`;

/** An answer carried out as the person, step by step. */
export async function answerDesignJoin(orgId: string, jobUuid: string, questionId: string, index: number, by: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  const now = await readNow(orgId, jobUuid);
  if (!now) return { ok: false, reason: "There's no design to join this quote to." };
  const q = now.read.questions.find((x) => x.id === questionId);
  if (!q) return { ok: false, reason: "That's been answered. The quote's been reloaded." };
  const answer = answersOf(now.read.design.id, q, now.book)[index];
  if (!answer) return { ok: false, reason: "That isn't one of the answers." };
  const said = why(q, answer.label);
  const prices = await bookPrices(orgId, modelsOf([answer]));
  const line = (id: string) => now.lines.find((l) => l.id === id);
  for (const s of answer.steps) {
    const r = await carry(orgId, jobUuid, now.read.option, s, line, prices, by, said);
    if (!r.ok) return r;
  }
  return { ok: true };
}

async function carry(
  orgId: string,
  jobUuid: string,
  option: number,
  s: Step,
  line: (id: string) => QuoteLine | undefined,
  prices: Map<string, Priced>,
  by: string,
  said: string
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (s.step === "join") return (await setJoins(orgId, jobUuid, [{ id: s.lineId, join: s.join }])) ? { ok: true } : { ok: false, reason: "That didn't save. Try again." };
  if (s.step === "leave-off") return okOf(await markDesign(orgId, jobUuid, { leftOff: s.systemId }, by));
  if (s.step === "drop") return okOf(await markDesign(orgId, jobUuid, { drop: s.unitId }, by));
  if (s.step === "remove") {
    const l = line(s.lineId);
    if (!l) return { ok: true };
    return okOf(await removeLine(orgId, jobUuid, l.id, l.version, by, said));
  }
  if (s.step === "swap") {
    const l = line(s.lineId);
    if (!l) return { ok: false, reason: "That line has gone. The quote's been reloaded." };
    const p = prices.get(s.model);
    const patch = p ? { code: p.code, supplierKey: p.supplierKey, costCents: p.costCents, source: "said" } : { code: s.model, supplierKey: null, costCents: 0, source: "unknown" };
    return okOf(await changeLine(orgId, jobUuid, l.id, l.version, patch, by, said, { ...s.join, code: patch.code }));
  }
  if (s.step === "qty") {
    const l = line(s.lineId);
    if (!l) return { ok: false, reason: "That line has gone. The quote's been reloaded." };
    return okOf(await changeLine(orgId, jobUuid, l.id, l.version, { qty: s.qty }, by, said));
  }
  return okOf(await addUnit(orgId, jobUuid, option, s.system, s.unit, prices.get(s.unit.model) ?? null, by, said, s.join));
}

/** A unit of the design onto the quote, priced from the book, or to price where the book hasn't got it. */
function addUnit(orgId: string, jobUuid: string, option: number, system: string, u: DesignUnit, p: Priced | null, by: string, said: string, join: LineJoin) {
  return addLine(
    orgId,
    jobUuid,
    {
      optionIndex: option,
      system,
      group: "Units",
      name: unitLineName(u),
      code: p?.code ?? u.model,
      supplierKey: p?.supplierKey ?? null,
      kind: "unit",
      qty: 1,
      costCents: p?.costCents ?? 0,
      source: p ? "said" : "unknown",
      why: "From the design",
    },
    by,
    said,
    { ...join, code: p?.code ?? u.model }
  );
}

const okOf = (r: { ok: boolean; reason?: string }): { ok: true } | { ok: false; reason: string } => (r.ok ? { ok: true } : { ok: false, reason: r.reason ?? "That didn't save. Try again." });

/** WHAT THE DESIGN IS TO TAKE, for the Studio as it opens: the lines
    waiting on this design, read after the join settles what it has taken
    already, and the units a person said go. */
export async function quoteTakes(orgId: string, jobUuid: string, designId: string): Promise<{ takes: QuoteTake[]; drop: string[] }> {
  const now = await readNow(orgId, jobUuid);
  if (!now || now.read.design.id !== designId) return { takes: [], drop: [] };
  const byHand = await readByHand(orgId, jobUuid);
  const takes = now.lines
    .filter((l) => now.read.lines[l.id]?.from === "waiting" && l.design?.take)
    .map((l) => ({ lineId: l.id, take: l.design!.take!, units: l.design!.units, system: l.design!.system ?? null, room: l.design!.room ?? "", count: l.design!.units.length + (now.read.toAdd?.[l.id] ?? 0) }));
  return { takes, drop: byHand.designJoin?.drop ?? [] };
}

/** The Studio's Undo of what it took: the design as it was, and the quote
    asks again. The lines' joins come off; the units it took out stay in. */
export async function refuseTakes(orgId: string, jobUuid: string, lineIds: readonly string[], dropped: readonly string[], by: string): Promise<boolean> {
  const ok = await setJoins(orgId, jobUuid, lineIds.map((id) => ({ id, join: null })));
  if (dropped.length) await keepDesignUnits(orgId, jobUuid, dropped, by);
  return ok;
}
