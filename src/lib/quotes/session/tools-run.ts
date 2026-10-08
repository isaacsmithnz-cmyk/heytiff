import type { Product } from "../families";
import { normaliseKitFacts, type KitFacts, type KitKey } from "../kits";
import type { QuoteLine } from "../lines";
import { stillUnknown } from "../lines-price";
import { findInBook, offerFor, supplierOffer, type UnitLookup } from "../lookups";
import type { TaskKey } from "../settings";
import type { Correction } from "../corrections";
import { proposalOf, type LinesProposal } from "../lines-proposal";
import { taskCheck } from "../task-hours";
import type { ToolOutcome } from "./turn";
import type { MediaBlock } from "./model";
import { bookPrice, isErr, kitAskOf, newLineOf, patchOf, questionOf, roomLoads, TOOL_LABELS, type NewLine } from "./tools";

/* TIFF'S TOOLS, RUN (tools.ts says what each is and what holds her to the
   book), over a QUOTE STORE: the quote's own lines in the database in the
   app (tools-server.ts), or a quote held in memory on the bench, so a
   recorded run replays against exactly the tools the app runs. Every write
   is the store's, as "tiff". Pure, given the store. */

/** A file on the job she can ask to look at. */
export type JobFile = { id: string; name: string; kind: "photo" | "document"; taken: string | null; from: string | null };

export type LineWrite = { ok: true; line: QuoteLine | null } | { ok: false; reason: string; stale?: true };

export type QuoteStore = {
  readLines: () => Promise<QuoteLine[]>;
  addLine: (row: Record<string, unknown>, why: string) => Promise<LineWrite>;
  changeLine: (id: string, version: number, patch: Record<string, unknown>, why: string) => Promise<LineWrite>;
  removeLine: (id: string, version: number, why: string) => Promise<LineWrite>;
  copyOption: (from: number, to: number) => Promise<LineWrite>;
  nameOption: (option: number, name: string) => Promise<{ ok: true } | { ok: false; reason: string }>;
  /** the proposal's words as kept; null when none are written */
  proposal: () => Promise<LinesProposal | null>;
  /** the proposal's words, changed by the blocks given (7.1) */
  writeProposal: (patch: Partial<LinesProposal>) => Promise<{ ok: true } | { ok: false; reason: string }>;
  compareWith: (lineId: string, code: string) => Promise<{ ok: true } | { ok: false; reason: string }>;
  addKit: (kit: KitKey, facts: KitFacts, at: { optionIndex: number; system: string }, unit: { brand: string; model: string } | null) => Promise<{ ok: true; added: number } | { ok: false; reason: string }>;
  book: () => Promise<Product[]>;
  /** an hour of labour's cost to the business; null when it isn't set */
  hourCost: () => Promise<number | null>;
  lookupUnit: (brand: string, model: string) => Promise<UnitLookup>;
  /** each option's total ex GST, cents; not ok when pricing isn't set up */
  totals: () => Promise<{ ok: true; options: number[] } | { ok: false }>;
  /** the supplier the job buys from, where it sells the item; null: any */
  supplier: () => Promise<string | null>;
  /** people's changes to her lines on past quotes, this kind of job's or every kind's (13.1) */
  corrections: (sameKind: boolean) => Promise<Correction[]>;
  /** the job's photos and documents she can look at, newest first (4.6) */
  jobFiles: () => Promise<JobFile[]>;
  /** one of them as she sees it, or why she can't */
  look: (id: string) => Promise<MediaBlock[] | string>;
  /** the business's own task hours and working day (slice 8.1) */
  taskHours: () => Promise<{ hours: Record<TaskKey, number | null>; dayHours: number | null }>;
};

const SEARCH_LIMIT = 12;

/** A new line as it goes on: a book item priced from the book, labour at
    the business's hour, anything else not known yet. */
export async function lineFor(store: Pick<QuoteStore, "book" | "hourCost" | "supplier">, l: NewLine): Promise<Record<string, unknown> | string> {
  const base = { optionIndex: l.optionIndex, system: l.system, group: l.group, kind: l.kind, qty: l.qty, unit: l.unit, source: l.source, why: l.why, sellCents: null };
  if (l.kind === "labour") return { ...base, name: l.name, costCents: (await store.hourCost()) ?? 0 };
  if (l.code) {
    const p = bookPrice(await store.book(), l.code, l.unit, await store.supplier());
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
        const [lines, price, tasks] = await Promise.all([store.readLines(), store.totals(), store.taskHours()]);
        const options = Math.max(1, ...lines.map((l) => l.optionIndex + 1));
        const set = Object.fromEntries(Object.entries(tasks.hours).filter(([, h]) => h != null));
        return {
          ok: true,
          label,
          value: Array.from({ length: options }, (_, i) => ({
            option: i,
            total_ex_gst_cents: price.ok ? (price.options[i] ?? 0) : null,
            /* the business's own hours for a task, and what they make this
               option's labour: what assumed labour rests on */
            ...(Object.keys(set).length ? { your_task_hours: set, by_your_task_hours: taskCheck(lines.filter((l) => l.optionIndex === i), tasks.hours, tasks.dayHours) } : {}),
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
        const supplier = await store.supplier();
        const found = findInBook(await store.book(), { text, sizeMm: size, brand, limit: SEARCH_LIMIT * 2 });
        /* the job's supplier's items first */
        const hits = (supplier ? [...found.filter((h) => supplierOffer(h.product, supplier)), ...found.filter((h) => !supplierOffer(h.product, supplier))] : found).slice(0, SEARCH_LIMIT);
        return {
          ok: true,
          label,
          said: `${text}: ${hits.length} found`,
          value: hits.map((h) => {
            const o = offerFor(h.product, supplier);
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
          const priced = bookPrice(await store.book(), p.patch.code, unit, await store.supplier());
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
      case "compare_with": {
        const lineId = typeof input.line_id === "string" ? input.line_id.slice(0, 60) : "";
        const code = typeof input.code === "string" ? input.code.trim().slice(0, 80) : "";
        if (!lineId || !code) return fail("Name the line and the unit's code.");
        if (!bookPrice(await store.book(), code, "")) return fail(`${code} isn't in the business's book.`);
        const res = await store.compareWith(lineId, code);
        return res.ok ? { ok: true, label, said: code, value: { added: code } } : fail(res.reason);
      }
      case "job_files": {
        const files = await store.jobFiles();
        return { ok: true, label, said: `${files.length} ${files.length === 1 ? "file" : "files"}`, value: files };
      }
      case "look_at": {
        const id = typeof input.id === "string" ? input.id.slice(0, 120) : "";
        if (!id) return fail("Name the file by its id from job_files.");
        const seen = await store.look(id);
        if (typeof seen === "string") return fail(seen);
        const name = (await store.jobFiles()).find((f) => f.id === id)?.name ?? id;
        return { ok: true, label, said: name, value: { looking_at: name }, media: seen };
      }
      case "your_corrections": {
        const sameKind = input.every_kind !== true;
        const list = await store.corrections(sameKind);
        return {
          ok: true,
          label,
          said: `${list.length} ${list.length === 1 ? "correction" : "corrections"}`,
          value: list.map((c) => ({ kind: c.kind, line: c.line, what: c.what, why: c.why || null, by: c.by })),
        };
      }
      case "name_option": {
        const option = typeof input.option === "number" ? Math.max(0, Math.min(19, Math.round(input.option))) : 0;
        const name = typeof input.name === "string" ? input.name.trim().slice(0, 120) : "";
        if (!name) return fail("Give the option a name.");
        const res = await store.nameOption(option, name);
        return res.ok ? { ok: true, label, said: name, value: { named: option } } : fail(res.reason);
      }
      case "write_proposal": {
        const patch: Partial<LinesProposal> = {};
        if (typeof input.title === "string") patch.title = input.title;
        if (typeof input.intro === "string") patch.intro = input.intro;
        if (Array.isArray(input.not_included)) patch.notIncluded = input.not_included as string[];
        if (input.choice === "one" || input.choice === "any") patch.choice = input.choice;
        const words = { summary: input.summary, areas: Array.isArray(input.work) ? input.work.map((w) => ({ name: (w as { area?: unknown }).area, items: (w as { items?: unknown }).items })) : undefined, included: input.included };
        const forOption = Object.values(words).some((v) => v !== undefined);
        if (forOption) {
          if (typeof input.option !== "number") return fail("Say which option the summary, work or included are for.");
          const options = Math.max(1, ...(await store.readLines()).map((l) => l.optionIndex + 1));
          const i = Math.round(input.option);
          if (i < 0 || i >= options) return fail(`The quote has ${options} ${options === 1 ? "option" : "options"}; there's no option ${i + 1}.`);
          const was = proposalOf((await store.proposal()) ?? {});
          const kept = Array.from({ length: options }, (_, j) => was.options[j] ?? { summary: "", areas: [], included: [] });
          /* made clean as the rest of the proposal is, by the same reader */
          const given = proposalOf({ options: [{ ...kept[i], ...Object.fromEntries(Object.entries(words).filter(([, v]) => v !== undefined)) }] }).options[0]!;
          patch.options = kept.map((o, j) => (j === i ? given : o));
        }
        if (Object.keys(patch).length === 0) return fail("Give the words to write: a title, an introduction, an option's summary, work or included, what isn't included, or how the client chooses.");
        const res = await store.writeProposal(patch);
        const what = [patch.title !== undefined && "title", patch.intro !== undefined && "introduction", forOption && `option ${Math.round(input.option as number) + 1}`, patch.notIncluded && "not included", patch.choice && "choice"].filter(Boolean).join(", ");
        return res.ok ? { ok: true, label, said: what, value: { written: what } } : fail(res.reason);
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
