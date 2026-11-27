import "server-only";
import { supabaseAdmin } from "@/lib/supabase-server";
import { migrateDesign } from "@/lib/studio/migrations";
import type { DesignDocument } from "@/lib/studio/document";
import { designPacks, designsOnJob } from "./design-read-server";
import { addLine, changeLine, readEngine, readLines, removeLine, setJoins, undoChange } from "./lines-server";
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
  designSystems,
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
import { readQuotePrice } from "./quote-price-server";
import { auDayOf, fmtAuDayMonth } from "@/lib/au-dates";

/* ONE LIST OF UNITS, read and answered (design-units.ts says the rule): the
   job's design, the one its lines are joined in or else its newest, against
   the quote's unit lines. Reading keeps the joins it finds, so each knows
   what both sides said when they agreed. An answer is carried out as the
   person: the quote's lines through addLine, changeLine and removeLine,
   each kept in Changes with Undo, priced from the book as the Studio's unit
   browser prices a model; what the design is to take waits on the line.
   Service role, by org; the route gates. */

type Read = { doc: DesignDocument; read: JoinRead; lines: QuoteLine[]; book: Book; sent: boolean };

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
  updatedAt: l.updatedAt,
});

async function readDesignDoc(orgId: string, id: string): Promise<{ doc: DesignDocument; at: string } | null> {
  const { data } = await supabaseAdmin.from("studio_designs").select("doc, updated_at").eq("org_id", orgId).eq("id", id).maybeSingle();
  try {
    const row = data as { doc: unknown; updated_at: string | null } | null;
    return { doc: migrateDesign(row?.doc).doc, at: row?.updated_at ?? "" };
  } catch {
    return null;
  }
}

/** The join as it stands, with the joins it found kept; null with no
    design, no unit lines, or a quote on the old engine. `open`: the design
    as the Studio has it this second, in place of the one saved. */
async function readNow(orgId: string, jobUuid: string, open: DesignDocument | null = null): Promise<Read | null> {
  if (!jobUuid || (await readEngine(orgId, jobUuid)) !== "lines") return null;
  const [designs, lines, byHand] = await Promise.all([designsOnJob(orgId, jobUuid), readLines(orgId, jobUuid), readByHand(orgId, jobUuid)]);
  if (designs.length === 0) return null;
  const units = lines.filter((l) => l.kind === "unit");
  if (units.length === 0) return null;
  /* the design its lines are joined in, else the newest */
  const joinedIn = new Set(units.map((l) => l.design?.design).filter(Boolean));
  const chosen = designs.find((d) => joinedIn.has(d.id)) ?? designs[0]!;
  const saved = open && open.id === chosen.id ? { doc: open, at: new Date().toISOString() } : await readDesignDoc(orgId, chosen.id);
  if (!saved) return null;
  const doc = saved.doc;
  const pack = await designPacks(doc);
  const marks = byHand.designJoin ?? { leftOff: [], drop: [] };
  const book = bookOf(pack);
  const read = readJoin({ doc, lines: units.map(unitLineOf), accepted: byHand.accepted, book, leftOff: marks.leftOff, drop: marks.drop, designAt: saved.at });
  if (!read) return null;
  if (read.found.length) {
    await setJoins(orgId, jobUuid, read.found.map((f) => ({ id: f.lineId, join: f.join })));
    const by = new Map(read.found.map((f) => [f.lineId, f.join]));
    for (const l of lines) if (by.has(l.id)) l.design = by.get(l.id)!;
  }
  /* sent for real, or taken: the quote is the customer's, a change only said */
  const sent = (!!byHand.sent && !byHand.sent.trial) || byHand.accepted.length > 0;
  return { doc, read, lines, book, sent };
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
    row: designRowOf(read, now.sent),
    sent: now.sent,
    changes: money ? await changesSinceSent(orgId, now) : null,
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

/* ── FOLLOWING THE DESIGN (the units mock, boards 3 and 5) ── */

/** What following the design did to one line, for the Studio's toast and its Undo. */
export type Followed = { lineId: string; words: string; deltaCents: number; changeId: number | null; before: LineJoin | null };

const short = (m: string) => /^[A-Z]+-(P\d+)/.exec(m)?.[1] ?? m;

/** What the design changed since the quote was sent, as the quote's page
    says it: each line's model now and what it does to the price. */
async function changesSinceSent(orgId: string, now: Read): Promise<{ count: number; deltaCents: number; lines: Record<string, number> } | null> {
  if (!now.sent || now.read.follow.length === 0) return null;
  const models = now.read.follow.flatMap((f) => (f.kind === "model" ? [f.model] : f.kind === "split" ? f.moved.map((m) => m.model) : []));
  const [prices, settings] = await Promise.all([bookPrices(orgId, models), readQuoteSettings(orgId)]);
  const markup = settings.unitMarkupPct ?? 0;
  const sell = (c: number) => c * (1 + markup / 100);
  const lines: Record<string, number> = {};
  for (const f of now.read.follow) {
    const l = now.lines.find((x) => x.id === f.lineId);
    if (!l) continue;
    const each = l.sellCents ?? sell(l.costCents);
    if (f.kind === "model") {
      const p = prices.get(f.model);
      lines[l.id] = p ? Math.round((sell(p.costCents) - each) * l.qty) : 0;
    } else if (f.kind === "gone") lines[l.id] = Math.round(-each * (l.qty - f.left));
    else lines[l.id] = Math.round(f.moved.reduce((n, m) => n + (prices.get(m.model) ? sell(prices.get(m.model)!.costCents) - each : 0), 0));
  }
  return { count: now.read.follow.length, deltaCents: Object.values(lines).reduce((a, b) => a + b, 0), lines };
}

/** THE QUOTE FOLLOWS THE DESIGN until it's sent: a unit the design made
    another model, the line takes the book's price for it; units the design
    took out, the line counts what's left. Each a change in Changes with
    Undo, said "Changed with the design". Sent, nothing is touched: the
    change is said on the line, and Update quote takes it. `open`: the
    design as the Studio has it, when it asks as it changes. */
export async function followDesign(orgId: string, jobUuid: string, by: string, open: DesignDocument | null = null): Promise<{ sent: boolean; followed: Followed[]; waiting: number }> {
  const now = await readNow(orgId, jobUuid, open);
  if (!now) return { sent: false, followed: [], waiting: 0 };
  if (now.sent || now.read.follow.length === 0) return { sent: now.sent, followed: [], waiting: now.read.follow.length };
  const models = now.read.follow.flatMap((f) => (f.kind === "model" ? [f.model] : f.kind === "split" ? f.moved.map((m) => m.model) : []));
  const [prices, settings] = await Promise.all([bookPrices(orgId, models), readQuoteSettings(orgId)]);
  const markup = settings.unitMarkupPct ?? 0;
  const sell = (c: number) => c * (1 + markup / 100);
  const unitRooms = new Map(now.doc.systems.flatMap((s) => (s.settings.allocations as { id: string; roomId?: string | null }[] | undefined ?? []).map((a) => [a.id, a.roomId ?? null] as const)));
  const roomName = (unit: string) => {
    const r = unitRooms.get(unit);
    return r ? String(now.doc.objects.find((o) => o.id === r)?.props.name ?? "") : "Outdoor";
  };
  const why = "Changed with the design";
  const followed: Followed[] = [];
  for (const f of now.read.follow) {
    const l = now.lines.find((x) => x.id === f.lineId);
    if (!l) continue;
    const each = l.sellCents ?? sell(l.costCents);
    const before = l.design ?? null;
    if (f.kind === "model") {
      const p = prices.get(f.model);
      const patch = p ? { code: p.code, supplierKey: p.supplierKey, costCents: p.costCents, source: "said" } : { code: f.model, supplierKey: null, costCents: 0, source: "unknown" };
      const r = await changeLine(orgId, jobUuid, l.id, l.version, patch, by, why, { design: now.read.design.id, units: f.units, model: f.model, code: patch.code });
      if (r.ok) followed.push({ lineId: l.id, words: `${roomName(f.units[0]!)} ${short(f.model)}`, deltaCents: p ? Math.round((sell(p.costCents) - each) * l.qty) : 0, changeId: r.changeId ?? null, before });
    } else if (f.kind === "gone") {
      const r =
        f.left > 0
          ? await changeLine(orgId, jobUuid, l.id, l.version, { qty: f.left }, by, why, { ...(before ?? { design: now.read.design.id }), units: f.units, design: now.read.design.id })
          : await removeLine(orgId, jobUuid, l.id, l.version, by, why);
      if (r.ok) followed.push({ lineId: l.id, words: `${l.name} taken out`, deltaCents: Math.round(-each * (l.qty - f.left)), changeId: r.changeId ?? null, before });
    } else {
      const r = await changeLine(orgId, jobUuid, l.id, l.version, { qty: f.keep.length }, by, why, { ...(before ?? { design: now.read.design.id }), design: now.read.design.id, units: f.keep });
      if (r.ok) followed.push({ lineId: l.id, words: `${l.name}, ${f.keep.length} kept`, deltaCents: Math.round(-each * f.moved.length), changeId: r.changeId ?? null, before });
      for (const m of f.moved) {
        const p = prices.get(m.model) ?? null;
        const unit = { id: m.unit, systemId: "", role: "idu" as const, model: m.model, rooms: [roomName(m.unit)] };
        const a = await addUnit(orgId, jobUuid, l.optionIndex, l.system, unit, p, by, why, { design: now.read.design.id, units: [m.unit], model: m.model });
        if (a.ok) followed.push({ lineId: a.line?.id ?? "", words: `${roomName(m.unit)} ${short(m.model)}`, deltaCents: p ? Math.round(sell(p.costCents)) : 0, changeId: a.changeId ?? null, before: null });
      }
    }
  }
  return { sent: false, followed, waiting: 0 };
}

/** The Studio's Undo of what the quote did with it: each change undone, and
    each line joined as it was before. */
export async function undoFollowed(orgId: string, jobUuid: string, followed: readonly Pick<Followed, "lineId" | "changeId" | "before">[], by: string): Promise<boolean> {
  /* only what following the design did: any other change is undone on the quote, where money is gated */
  const ids = followed.flatMap((f) => (f.changeId == null ? [] : [f.changeId]));
  if (ids.length === 0) return true;
  const { data } = await supabaseAdmin.from("quote_line_changes").select("id").eq("org_id", orgId).eq("sm8_job_uuid", jobUuid).eq("why", "Changed with the design").in("id", ids);
  const mine = new Set(((data ?? []) as { id: number }[]).map((r) => r.id));
  let ok = true;
  for (const f of [...followed].reverse()) {
    if (f.changeId == null || !mine.has(f.changeId)) continue;
    const r = await undoChange(orgId, jobUuid, f.changeId, by);
    if (!r.ok) ok = false;
    else if (r.line && f.before) await setJoins(orgId, jobUuid, [{ id: r.line.id, join: f.before }]);
  }
  return ok;
}

/* ── ON THE QUOTE, in the Studio (the units mock, board 4) ── */

export type QuoteOnDesign = {
  /** the option the design is joined to, as the quote names it */
  option: string;
  /** each of the design's systems on the quote: what its quote system comes to, ex GST; null without money */
  systems: Record<string, { cents: number | null }>;
  /** where the customer is: Not sent yet, Sent 25 Nov, Accepted, Option 1 */
  customer: string;
};

/** What the quote did with each of the design's systems. Null where the job has no quote joined to this design. */
export async function quoteOnDesign(orgId: string, jobUuid: string, designId: string, money: boolean): Promise<QuoteOnDesign | null> {
  const now = await readNow(orgId, jobUuid);
  if (!now || now.read.design.id !== designId) return null;
  const byHand = await readByHand(orgId, jobUuid);
  const opt = now.read.option;
  const name = byHand.names[opt]?.trim() || `Option ${opt + 1}`;
  const systemOfUnit = new Map(designSystems(now.doc).flatMap((s) => s.units.map((u) => [u.id, s.id] as const)));
  /* each design system's quote systems: the ones whose lines are its units */
  const quoteSystems = new Map<string, Set<string>>();
  for (const l of now.lines) {
    const st = now.read.lines[l.id];
    if (l.optionIndex !== opt || st?.from !== "design") continue;
    for (const u of st.units) {
      const sid = systemOfUnit.get(u);
      if (sid) quoteSystems.set(sid, (quoteSystems.get(sid) ?? new Set()).add(l.system));
    }
  }
  let sells: Map<string, number> | null = null;
  if (money) {
    const price = await readQuotePrice(orgId, jobUuid).catch(() => null);
    const o = price && price.ok ? price.options[opt] : undefined;
    if (o) {
      sells = new Map();
      for (const g of o.build.groups) for (const bl of g.lines) sells.set(bl.key, bl.sellCents);
      const labour = now.lines.filter((l) => l.optionIndex === opt && l.kind === "labour" && !(l.source === "unknown" && l.costCents <= 0 && l.sellCents == null));
      labour.forEach((l, i) => {
        const v = o.build.labour.visits[i];
        if (v) sells!.set(l.id, v.sellCents);
      });
    }
  }
  const systems: QuoteOnDesign["systems"] = {};
  for (const [sid, keys] of quoteSystems) {
    const lines = now.lines.filter((l) => l.optionIndex === opt && keys.has(l.system));
    systems[sid] = { cents: sells ? Math.round(lines.reduce((n, l) => n + (sells!.get(l.id) ?? 0), 0)) : null };
  }
  const took = byHand.accepted.find((i) => i === opt);
  const customer =
    took !== undefined
      ? `Accepted, ${name}`
      : byHand.accepted.length > 0
        ? `Accepted, Option ${byHand.accepted[0]! + 1}`
        : byHand.sent && !byHand.sent.trial
          ? `Sent ${fmtAuDayMonth(auDayOf(byHand.sent.at))}`
          : "Not sent yet";
  return { option: name, systems, customer };
}
