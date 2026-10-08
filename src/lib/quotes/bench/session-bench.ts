import type { BuildSettings } from "../buildup";
import type { Product } from "../families";
import { expandKit, type KitAllowances } from "../kits";
import { applyPatch, lineFromRow, lineRow, normaliseLine, sortLines, type QuoteLine } from "../lines";
import { priceLines } from "../lines-price";
import type { UnitLookup } from "../lookups";
import type { TaskKey } from "../settings";
import type { ModelCall } from "../session/model";
import { openingMessage, sessionSystemPrompt } from "../session/prompt";
import { SESSION_TOOLS } from "../session/tools";
import { makeTools, type QuoteStore } from "../session/tools-run";
import { runTurn, type EventDraft } from "../session/turn";
import type { BenchCase, CaseLine } from "./score";

/* TIFF ON THE BENCH (slice 4.3) — a case's brief through the same session,
   prompt and tools the app runs, against a quote held in memory and a
   frozen book, so a run is scored part by part against the lines a person
   built (score.ts). Recorded once with the real model (the cost told first,
   and his OK), then replayed free on every change: a replay refuses any
   request it never saw, so a changed prompt or tool shows as "not
   recorded" rather than passing on a stale answer. Pure, given the model. */

/** A quote in memory: the app's own line rules (lines.ts), no database. */
export function memoryStore(opts: {
  products: Product[];
  settings: BuildSettings;
  hourCostCents: number | null;
  units?: Record<string, UnitLookup>;
  allowances?: KitAllowances | null;
  taskHours?: Record<TaskKey, number | null>;
  supplier?: string | null;
}): QuoteStore & { lines: () => QuoteLine[] } {
  let lines: QuoteLine[] = [];
  const names: string[] = [];
  let n = 0;
  const add = (row: Record<string, unknown>) => {
    const f = normaliseLine(row);
    if (!f) return { ok: false as const, reason: "A line needs a name and a group." };
    if (row.position == null) f.position = Math.max(-1, ...lines.filter((l) => l.optionIndex === f.optionIndex).map((l) => l.position)) + 1;
    const line = lineFromRow({ ...lineRow(f), id: `m${++n}`, version: 1, updated_at: "", updated_by: "tiff" })!;
    lines = [...lines, line];
    return { ok: true as const, line };
  };
  return {
    lines: () => sortLines(lines),
    readLines: async () => sortLines(lines),
    addLine: async (row) => add(row),
    changeLine: async (id, version, patch) => {
      const line = lines.find((l) => l.id === id);
      if (!line) return { ok: false, reason: "That line has gone. Reload the quote.", stale: true };
      if (line.version !== version) return { ok: false, reason: "Someone changed that line just now. It's been reloaded.", stale: true };
      const a = applyPatch(line, patch);
      if (!a) return { ok: false, reason: "A line needs a name and a group." };
      const next = { ...line, ...a.next, version: version + 1 };
      lines = lines.map((l) => (l.id === id ? next : l));
      return { ok: true, line: next };
    },
    removeLine: async (id, version) => {
      const line = lines.find((l) => l.id === id);
      if (line && line.version !== version) return { ok: false, reason: "Someone changed that line just now. It's been reloaded.", stale: true };
      lines = lines.filter((l) => l.id !== id);
      return { ok: true, line: null };
    },
    copyOption: async (from, to) => {
      const mine = lines.filter((l) => l.optionIndex === from);
      if (mine.length === 0) return { ok: false, reason: "That option has no lines to copy." };
      for (const l of mine) add({ ...l, optionIndex: to, position: l.position });
      return { ok: true, line: null };
    },
    addKit: async (kit, facts, at) => {
      const made = expandKit(kit, facts, opts.products, at, opts.allowances ?? null, opts.supplier ?? null);
      for (const l of made) add(l as Record<string, unknown>);
      return { ok: true, added: made.length };
    },
    nameOption: async (option, name) => {
      names[option] = name;
      return { ok: true };
    },
    compareWith: async () => ({ ok: true }),
    supplier: async () => opts.supplier ?? null,
    book: async () => opts.products,
    hourCost: async () => opts.hourCostCents,
    lookupUnit: async (_brand, model) => opts.units?.[model.toUpperCase()] ?? { found: false, reason: "no data pack" },
    totals: async () => ({ ok: true, options: priceLines(lines, [], opts.settings, { pct: null, labourCostCents: null }).map((o) => o.build.exGstCents) }),
    taskHours: async () => ({ hours: opts.taskHours ?? { zone: null, grille: null, metre: null, visit: null }, dayHours: opts.settings.dayHours }),
  };
}

/** A code the bench gives a case's item that had none, so it can be bought;
    taken off again before the score, which knows such a part by its name. */
export const BENCH_CODE = "BENCH-";

/** A frozen book from the cases' own items: every part a person built any
    case with, each once, at the price it was built at. Allowances (a
    contingency, a core hole nobody priced) aren't items. */
export function caseBook(cases: readonly BenchCase[]): Product[] {
  const byKey = new Map<string, Product>();
  let n = 0;
  for (const c of cases)
    for (const o of c.options)
      for (const l of o.lines) {
        if (l.kind === "labour" || l.costCents <= 0 || /contingency/i.test(l.name)) continue;
        const key = l.code ?? `name:${l.name.toLowerCase()}`;
        if (byKey.has(key)) continue;
        const code = l.code ?? `${BENCH_CODE}${++n}`;
        const offer = { supplierKey: "book", supplierName: "Book", code, name: l.name, netCents: l.costCents };
        byKey.set(key, { key: `book|${code}`, name: l.name, category: l.kind === "unit" ? "units" : "parts", offers: [offer], cheapest: offer, preferred: null, brand: null, quotes: 0 } as Product);
      }
  return [...byKey.values()];
}

const caseLineOf = (l: QuoteLine): CaseLine => ({
  system: l.system,
  group: l.group,
  name: l.name,
  ...(l.code && !l.code.startsWith(BENCH_CODE) ? { code: l.code } : {}),
  kind: l.kind,
  qty: l.qty,
  unit: l.unit,
  costCents: l.costCents,
  ...(l.sellCents != null ? { sellCents: l.sellCents } : {}),
  source: l.source,
  why: l.why,
});

export type SessionRun = { lines: CaseLine[][]; spentUsd: number; ended: string; events: EventDraft[] };

/** A case's brief through one turn of the session, the quote it left, by option. */
export async function benchSession(c: BenchCase, opts: { model: ModelCall; modelName: string; products: Product[]; hourCostCents: number | null }): Promise<SessionRun> {
  const store = memoryStore({ products: opts.products, settings: c.settings, hourCostCents: opts.hourCostCents });
  const events: EventDraft[] = [];
  const end = await runTurn({ messages: [], summary: "" }, openingMessage(c.brief, "Quote this job."), {
    model: opts.model,
    modelName: opts.modelName,
    system: sessionSystemPrompt(),
    tools: SESSION_TOOLS,
    runTool: makeTools(store),
    save: async (_s, ev) => {
      events.push(...ev);
      return true;
    },
  });
  const all = store.lines();
  const options = Math.max(c.options.length, ...all.map((l) => l.optionIndex + 1));
  return { lines: Array.from({ length: options }, (_, i) => all.filter((l) => l.optionIndex === i).map(caseLineOf)), spentUsd: end.spentUsd, ended: end.ended, events };
}
