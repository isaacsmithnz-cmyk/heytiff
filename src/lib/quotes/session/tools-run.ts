import type { Product } from "../families";
import { normaliseKitFacts, type KitFacts, type KitKey } from "../kits";
import type { QuoteLine } from "../lines";
import { stillUnknown } from "../lines-price";
import { findInBook, type UnitLookup } from "../lookups";
import type { ToolOutcome } from "./turn";
import { bookPrice, isErr, kitAskOf, newLineOf, patchOf, questionOf, roomLoads, TOOL_LABELS, type NewLine } from "./tools";

/* TIFF'S TOOLS, RUN (tools.ts says what each is and what holds her to the
   book), over a QUOTE STORE: the quote's own lines in the database in the
   app (tools-server.ts), or a quote held in memory on the bench, so a
   recorded run replays against exactly the tools the app runs. Every write
   is the store's, as "tiff". Pure, given the store. */

export type LineWrite = { ok: true; line: QuoteLine | null } | { ok: false; reason: string; stale?: true };

export type QuoteStore = {
  readLines: () => Promise<QuoteLine[]>;
  addLine: (row: Record<string, unknown>, why: string) => Promise<LineWrite>;
  changeLine: (id: string, version: number, patch: Record<string, unknown>, why: string) => Promise<LineWrite>;
  removeLine: (id: string, version: number, why: string) => Promise<LineWrite>;
  copyOption: (from: number, to: number) => Promise<LineWrite>;
  addKit: (kit: KitKey, facts: KitFacts, at: { optionIndex: number; system: string }, unit: { brand: string; model: string } | null) => Promise<{ ok: true; added: number } | { ok: false; reason: string }>;
  book: () => Promise<Product[]>;
  /** an hour of labour's cost to the business; null when it isn't set */
  hourCost: () => Promise<number | null>;
  lookupUnit: (brand: string, model: string) => Promise<UnitLookup>;
  /** each option's total ex GST, cents; not ok when pricing isn't set up */
  totals: () => Promise<{ ok: true; options: number[] } | { ok: false }>;
};

const SEARCH_LIMIT = 12;

/** A new line as it goes on: a book item priced from the book, labour at
    the business's hour, anything else not known yet. */
export async function lineFor(store: Pick<QuoteStore, "book" | "hourCost">, l: NewLine): Promise<Record<string, unknown> | string> {
  const base = { optionIndex: l.optionIndex, system: l.system, group: l.group, kind: l.kind, qty: l.qty, unit: l.unit, source: l.source, why: l.why, sellCents: null };
  if (l.kind === "labour") return { ...base, name: l.name, costCents: (await store.hourCost()) ?? 0 };
  if (l.code) {
    const p = bookPrice(await store.book(), l.code, l.unit);
    if (!p) return `${l.name}: ${l.code} isn't in the business's book. Search the book for what it buys, or add it with no code as not known yet.`;
    return { ...base, name: p.name, code: p.code, supplierKey: p.supplierKey, kind: l.kind === "unit" || p.kind === "unit" ? "unit" : "material", costCents: p.costCents };
  }
  /* no code: an allowance nobody has priced, so not known yet */
  return { ...base, name: l.name, code: null, supplierKey: null, costCents: 0, source: "unknown" };
}

export function makeTools(store: QuoteStore) {
  return async function runTool(name: string, input: Record<string, unknown>): Promise<ToolOutcome> {
    const label = TOOL_LABELS[name] ?? name;
    const fail = (error: string): ToolOutcome => ({ ok: false, error, label });
    switch (name) {
      case "read_quote": {
        const [lines, price] = await Promise.all([store.readLines(), store.totals()]);
        const options = Math.max(1, ...lines.map((l) => l.optionIndex + 1));
        return {
          ok: true,
          label,
          value: Array.from({ length: options }, (_, i) => ({
            option: i,
            total_ex_gst_cents: price.ok ? (price.options[i] ?? 0) : null,
            still_to_price: lines.filter((l) => l.optionIndex === i && stillUnknown(l)).map((l) => l.name),
            lines: lines
              .filter((l) => l.optionIndex === i)
              .map((l) => ({ id: l.id, version: l.version, system: l.system, group: l.group, name: l.name, code: l.code, kind: l.kind, qty: l.qty, unit: l.unit, cost_each_cents: l.costCents, source: l.source, why: l.why })),
          })),
          ...(price.ok ? {} : { said: "Quoting isn't set up to price it yet" }),
        };
      }
      case "search_book": {
        const text = typeof input.text === "string" ? input.text.slice(0, 120) : "";
        if (!text.trim()) return fail("Say what to search for.");
        const size = typeof input.size_mm === "number" ? input.size_mm : null;
        const brand = typeof input.brand === "string" && input.brand.trim() ? input.brand.trim() : null;
        const hits = findInBook(await store.book(), { text, sizeMm: size, brand, limit: SEARCH_LIMIT });
        return {
          ok: true,
          label,
          said: `${text}: ${hits.length} found`,
          value: hits.map((h) => {
            const o = h.product.preferred ?? h.product.cheapest;
            return { name: h.product.name, code: o?.code ?? null, supplier: o?.supplierName ?? null, cost_each_cents: o?.netCents ?? null, kind: h.product.category === "units" ? "unit" : "material", why: h.why };
          }),
        };
      }
      case "unit_specs": {
        const brand = typeof input.brand === "string" ? input.brand.trim() : "";
        const model = typeof input.model === "string" ? input.model.trim() : "";
        if (!brand || !model) return fail("Name the brand's pack and the model.");
        return { ok: true, label, said: model, value: await store.lookupUnit(brand, model) };
      }
      case "room_load": {
        const v = roomLoads(input);
        if (v.rooms.length === 0) return fail("Give each room its area in m².");
        return { ok: true, label, said: `${v.rooms.length} ${v.rooms.length === 1 ? "room" : "rooms"}, ${v.total_kw} kW`, value: v };
      }
      case "add_lines": {
        const raw = Array.isArray(input.lines) ? input.lines.slice(0, 40) : [];
        if (raw.length === 0) return fail("No lines given.");
        const added: { id: string; name: string }[] = [];
        const refused: string[] = [];
        for (const r of raw) {
          const l = newLineOf(r);
          if (isErr(l)) {
            refused.push(l.error);
            continue;
          }
          const row = await lineFor(store, l);
          if (typeof row === "string") {
            refused.push(row);
            continue;
          }
          const res = await store.addLine(row, l.why);
          if (res.ok && res.line) added.push({ id: res.line.id, name: res.line.name });
          else refused.push(`${l.name}: ${res.ok ? "not added" : res.reason}`);
        }
        if (added.length === 0) return fail(refused.join("\n") || "Nothing was added.");
        return { ok: true, label, said: `${added.length} ${added.length === 1 ? "line" : "lines"}`, value: { added, refused } };
      }
      case "change_line": {
        const p = patchOf(input);
        if (isErr(p)) return fail(p.error);
        const patch: Record<string, unknown> = { ...p.patch };
        delete patch.why;
        if (p.patch.code) {
          const unit = p.patch.unit ?? (await store.readLines()).find((l) => l.id === p.id)?.unit ?? "";
          const priced = bookPrice(await store.book(), p.patch.code, unit);
          if (!priced) return fail(`${p.patch.code} isn't in the business's book. Search the book for what it buys.`);
          Object.assign(patch, { code: priced.code, name: priced.name, supplierKey: priced.supplierKey, costCents: priced.costCents, sellCents: null });
        }
        const res = await store.changeLine(p.id, p.version, patch, p.patch.why);
        if (!res.ok) return fail(res.reason);
        return { ok: true, label, said: res.line?.name, value: res.line ? { id: res.line.id, version: res.line.version } : null };
      }
      case "remove_line": {
        const id = typeof input.id === "string" ? input.id : "";
        const version = typeof input.version === "number" ? input.version : -1;
        const why = typeof input.why === "string" ? input.why.slice(0, 400) : "";
        if (!id || !why) return fail("Name the line by its id and version, and say why.");
        const res = await store.removeLine(id, version, why);
        return res.ok ? { ok: true, label, value: { removed: id } } : fail(res.reason);
      }
      case "add_kit": {
        const k = kitAskOf(input);
        const res = await store.addKit(k.kit, normaliseKitFacts(k.facts), k.at, k.unit);
        return res.ok ? { ok: true, label, said: `${k.kit === "split" ? "Split" : "Ducted"}, ${res.added} parts`, value: { added: res.added } } : fail(res.reason);
      }
      case "copy_option": {
        const n = (v: unknown) => (typeof v === "number" ? Math.max(0, Math.min(19, Math.round(v))) : -1);
        const res = await store.copyOption(n(input.from), n(input.to));
        return res.ok ? { ok: true, label, value: { copied: true } } : fail(res.reason);
      }
      case "ask": {
        const q = questionOf(input);
        if (isErr(q)) return fail(q.error);
        return { ok: true, label, said: q.question, value: { asked: true }, event: { kind: "question", author: "tiff", body: q } };
      }
      default:
        return fail(`There's no tool called ${name}.`);
    }
  };
}
