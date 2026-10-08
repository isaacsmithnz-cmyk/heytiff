import "server-only";
import { bookProducts } from "../book-view-server";
import type { Product } from "../families";
import { normaliseKitFacts } from "../kits";
import { addKit } from "../kits-server";
import { addLine, changeLine, copyOption, readLines, removeLine } from "../lines-server";
import { stillUnknown } from "../lines-price";
import { findInBook } from "../lookups";
import { lookupUnit } from "../lookups-server";
import { readOrgDay } from "../org-day-server";
import { hourCostOf } from "../profit";
import { readQuotePrice } from "../quote-price-server";
import { readQuoteSettings } from "../settings-query";
import type { ToolOutcome } from "./turn";
import { bookPrice, isErr, kitAskOf, newLineOf, patchOf, questionOf, TOOL_LABELS, type NewLine } from "./tools";

/* TIFF'S TOOLS, RUN (tools.ts says what each is and what holds her to the
   book). Every write goes through lines-server.ts as "tiff", so it's
   versioned, in the line's history and undoable like a person's. Service
   role, by org; the route gates the session on running the board and money
   access, as the quote's own lines do. */

export const TIFF = "tiff";

const SEARCH_LIMIT = 12;

/** How a new line goes on for this business: a book item priced from its
    book, labour at its hour, anything else not known yet. The book and the
    hour are read once, and only when asked for. */
export function linePricer(orgId: string) {
  let products: Promise<Product[]> | null = null;
  const book = () => (products ??= bookProducts(orgId));
  let hour: Promise<number | null> | null = null;
  const hourCost = () =>
    (hour ??= Promise.all([readQuoteSettings(orgId), readOrgDay(orgId)]).then(([s, d]) =>
      d.rate ? hourCostOf(d.rate.perHourCents, s.profitTargetPct, s.labourCostCents) : null
    ));

  /** A new line as it goes on: a book item priced from the book, labour at
      the hour, anything else not known yet. */
  const lineFor = async (l: NewLine): Promise<Record<string, unknown> | string> => {
    const base = { optionIndex: l.optionIndex, system: l.system, group: l.group, kind: l.kind, qty: l.qty, unit: l.unit, source: l.source, why: l.why, sellCents: null };
    if (l.kind === "labour") return { ...base, name: l.name, costCents: (await hourCost()) ?? 0 };
    if (l.code) {
      const p = bookPrice(await book(), l.code, l.unit);
      if (!p) return `${l.name}: ${l.code} isn't in the business's book. Search the book for what it buys, or add it with no code as not known yet.`;
      return { ...base, name: p.name, code: p.code, supplierKey: p.supplierKey, kind: l.kind === "unit" || p.kind === "unit" ? "unit" : "material", costCents: p.costCents };
    }
    /* no code: an allowance nobody has priced, so not known yet */
    return { ...base, name: l.name, code: null, supplierKey: null, costCents: 0, source: "unknown" };
  };
  return { book, hourCost, lineFor };
}

export function sessionTools(orgId: string, jobUuid: string) {
  const { book, lineFor } = linePricer(orgId);

  return async function runTool(name: string, input: Record<string, unknown>): Promise<ToolOutcome> {
    const label = TOOL_LABELS[name] ?? name;
    const fail = (error: string): ToolOutcome => ({ ok: false, error, label });
    switch (name) {
      case "read_quote": {
        const [lines, price] = await Promise.all([readLines(orgId, jobUuid), readQuotePrice(orgId, jobUuid)]);
        const options = Math.max(1, ...lines.map((l) => l.optionIndex + 1));
        return {
          ok: true,
          label,
          value: Array.from({ length: options }, (_, i) => ({
            option: i,
            total_ex_gst_cents: price.ok ? (price.options[i]?.build.exGstCents ?? 0) : null,
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
        const hits = findInBook(await book(), { text, sizeMm: size, brand, limit: SEARCH_LIMIT });
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
        return { ok: true, label, said: model, value: await lookupUnit(brand, model) };
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
          const row = await lineFor(l);
          if (typeof row === "string") {
            refused.push(row);
            continue;
          }
          const res = await addLine(orgId, jobUuid, row, TIFF, l.why);
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
          const unit = p.patch.unit ?? (await readLines(orgId, jobUuid)).find((l) => l.id === p.id)?.unit ?? "";
          const priced = bookPrice(await book(), p.patch.code, unit);
          if (!priced) return fail(`${p.patch.code} isn't in the business's book. Search the book for what it buys.`);
          Object.assign(patch, { code: priced.code, name: priced.name, supplierKey: priced.supplierKey, costCents: priced.costCents, sellCents: null });
        }
        const res = await changeLine(orgId, jobUuid, p.id, p.version, patch, TIFF, p.patch.why);
        if (!res.ok) return fail(res.reason);
        return { ok: true, label, said: res.line?.name, value: res.line ? { id: res.line.id, version: res.line.version } : null };
      }
      case "remove_line": {
        const id = typeof input.id === "string" ? input.id : "";
        const version = typeof input.version === "number" ? input.version : -1;
        const why = typeof input.why === "string" ? input.why.slice(0, 400) : "";
        if (!id || !why) return fail("Name the line by its id and version, and say why.");
        const res = await removeLine(orgId, jobUuid, id, version, TIFF, why);
        return res.ok ? { ok: true, label, value: { removed: id } } : fail(res.reason);
      }
      case "add_kit": {
        const k = kitAskOf(input);
        const res = await addKit(orgId, jobUuid, k.kit, normaliseKitFacts(k.facts), k.at, k.unit, TIFF);
        return res.ok ? { ok: true, label, said: `${k.kit === "split" ? "Split" : "Ducted"}, ${res.added} parts`, value: { added: res.added } } : fail(res.reason);
      }
      case "copy_option": {
        const n = (v: unknown) => (typeof v === "number" ? Math.max(0, Math.min(19, Math.round(v))) : -1);
        const res = await copyOption(orgId, jobUuid, n(input.from), n(input.to), TIFF);
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
