import type { Product } from "../families";
import { normaliseKitFacts, type KitFacts, type KitKey } from "../kits";
import type { QuoteLine } from "../lines";
import { stillUnknown } from "../lines-price";
import { findInBook, offerFor, supplierOffer, type UnitLookup } from "../lookups";
import type { TaskKey } from "../settings";
import type { Correction } from "../corrections";
import { proposalOf, type LinesProposal } from "../lines-proposal";
import { planOf } from "../build-progress";
import { writeUpOf } from "../write-up";
import type { Research } from "../research";
import { labourVisitsOf, visitLine } from "../labour-build";
import { keepPeoplesTasks, visitHours, visitName, type LineVisit } from "../line-visit";
import { taskCheck } from "../task-hours";
import { namedUnit, unitRoleOf, type UnitRole } from "../unit-name";
import type { Pairing } from "../pairing";
import type { Charge, ChargeAsk } from "../charge";
import type { ToolOutcome } from "./turn";
import type { MediaBlock } from "./model";
import { fitRead } from "./read-fit";
import { airflowCheck, airflowSaid, type AirflowGuide } from "@/lib/guides/airflow";
import { fitDesignRead, type JobDesign } from "../design-read";
import { airflowAskOf, bookPrice, isErr, kitAskOf, newLineOf, patchOf, questionOf, roomLoads, TOOL_LABELS, type NewLine } from "./tools";

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
  /** a price from the web for a line, by its own call (12.2); what it spent either way */
  research: (lineId: string, what: string) => Promise<({ ok: true; research: Research } | { ok: false; reason: string }) & { usd: number | null; model: string }>;
  /** the proposal's words as kept; null when none are written */
  proposal: () => Promise<LinesProposal | null>;
  /** the proposal's words, changed by the blocks given (7.1) */
  writeProposal: (patch: Partial<LinesProposal>) => Promise<{ ok: true } | { ok: false; reason: string }>;
  compareWith: (lineId: string, code: string) => Promise<{ ok: true } | { ok: false; reason: string }>;
  addKit: (
    kit: KitKey,
    facts: KitFacts,
    at: { optionIndex: number; system: string },
    unit: { brand: string; model: string } | null,
    indoor?: { brand: string; model: string } | null
  ) => Promise<{ ok: true; added: number; still?: { name: string; why: string }[] } | { ok: false; reason: string }>;
  book: () => Promise<Product[]>;
  /** an hour of labour's cost to the business; null when it isn't set */
  hourCost: () => Promise<number | null>;
  lookupUnit: (brand: string, model: string) => Promise<UnitLookup>;
  /** whether an outdoor takes the indoors given, by its maker's book */
  pairing: (brand: string, outdoor: string, indoors: string[]) => Promise<Pairing>;
  /** the refrigerant to add to a system, by its maker's book */
  charge: (brand: string, ask: ChargeAsk) => Promise<Charge>;
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
  /** her questions still open, by their numbers: what a person's own words can settle */
  openQuestions: () => Promise<{ id: number; question: string }[]>;
  /** the ducted airflow guide every business shares (lib/guides); null when none is installed */
  airflowGuide: () => Promise<AirflowGuide | null>;
  /** the job's Studio design as she reads it (design-read.ts): `id`'s, else the newest; why not, when there's none */
  design: (id: string | null) => Promise<JobDesign>;
};

const SEARCH_LIMIT = 12;

/** A unit's role off its maker's data pack, where the book names its maker
    and HeyTiff holds the maker's pack ("Mitsubishi Electric" is
    mitsubishi-electric); null otherwise, and the words say. */
async function packRole(store: Pick<QuoteStore, "lookupUnit">, item: { code: string; brand: string | null }): Promise<UnitRole | null> {
  if (!item.brand) return null;
  try {
    const u = await store.lookupUnit(item.brand.toLowerCase().replace(/[^a-z0-9]+/g, "-"), item.code);
    return u?.found ? u.specs.role : null;
  } catch {
    return null;
  }
}

/** What a unit line from the book is called (unit-name.ts): "Indoor unit",
    "Outdoor unit", a head with the room `words` give it, by the role its
    pack, the book's words or `words` say; `words` as given when none says,
    never the supplier's description. */
export async function unitNameOf(store: Pick<QuoteStore, "lookupUnit">, item: { name: string; code: string; brand: string | null }, words: string): Promise<string> {
  return namedUnit(unitRoleOf(await packRole(store, item), item, { name: words }), words);
}

/** A new line as it goes on: a book item priced from the book, labour at
    the business's hour, anything else not known yet. */
export async function lineFor(store: Pick<QuoteStore, "book" | "hourCost" | "supplier" | "lookupUnit">, l: NewLine): Promise<Record<string, unknown> | string> {
  const base = { optionIndex: l.optionIndex, system: l.system, group: l.group, kind: l.kind, qty: l.qty, unit: l.unit, source: l.source, why: l.why, sellCents: l.sellCents ?? null, duct: l.duct ?? false };
  if (l.kind === "labour") return { ...base, name: l.name, costCents: (await store.hourCost()) ?? 0 };
  if (l.code) {
    const p = bookPrice(await store.book(), l.code, l.unit, await store.supplier());
    if (!p) return `${l.name}: ${l.code} isn't in the business's book. Search the book for what it buys, or add it with no code as not known yet.`;
    const kind = l.kind === "unit" || p.kind === "unit" ? "unit" : "material";
    /* a unit by what it is, its model the code; any other item by the book's own name */
    return { ...base, name: kind === "unit" ? await unitNameOf(store, p, l.name) : p.name, code: p.code, supplierKey: p.supplierKey, kind, costCents: p.costCents };
  }
  /* no code and a price the person gave: theirs, as they said it */
  if (l.sellCents) return { ...base, name: l.name, code: null, supplierKey: null, costCents: 0 };
  /* no code: an allowance nobody has priced, so not known yet */
  return { ...base, name: l.name, code: null, supplierKey: null, costCents: 0, source: "unknown" };
}

/** A visit's tasks as she reads them: what a person changed, said so. */
const visitRead = (v: LineVisit) => ({
  stage: v.stage,
  people: v.people,
  tasks: v.tasks.map((t) => ({ task: t.task, hours: t.hours, ...(t.byHand ? (t.was != null ? { person_changed_from: t.was } : { person_added: true }) : {}) })),
});

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
          /* a long quote narrowed to fit, saying what it left out (read-fit) */
          value: fitRead(
            Array.from({ length: options }, (_, i) => ({
              option: i,
              total_ex_gst_cents: price.ok ? (price.options[i] ?? 0) : null,
              /* the business's own hours for a task, and what they make this
                 option's labour: what assumed labour rests on */
              ...(Object.keys(set).length ? { your_task_hours: set, by_your_task_hours: taskCheck(lines.filter((l) => l.optionIndex === i), tasks.hours, tasks.dayHours) } : {}),
              still_to_price: lines.filter((l) => l.optionIndex === i && stillUnknown(l)).map((l) => l.name),
              lines: lines
                .filter((l) => l.optionIndex === i)
                .map((l) => ({
                  id: l.id,
                  version: l.version,
                  system: l.system,
                  group: l.group,
                  name: l.name,
                  code: l.code,
                  kind: l.kind,
                  qty: l.qty,
                  unit: l.unit,
                  cost_each_cents: l.costCents,
                  source: l.source,
                  ...(l.estimate ? { estimate: true } : {}),
                  ...(l.visit ? { visit: visitRead(l.visit) } : { why: l.why }),
                })),
            })),
            { option: typeof input.option === "number" ? input.option : null, from: typeof input.from === "number" ? input.from : null }
          ),
          ...(price.ok ? {} : { said: "Quoting isn't set up to price it yet" }),
        };
      }
      case "search_book": {
        const text = typeof input.text === "string" ? input.text.slice(0, 120) : "";
        if (!text.trim()) return fail("Say what to search for.");
        const size = typeof input.size_mm === "number" ? input.size_mm : null;
        const brand = typeof input.brand === "string" && input.brand.trim() ? input.brand.trim() : null;
        const supplier = await store.supplier();
        const found = findInBook(await store.book(), { text, sizeMm: size, brand, limit: SEARCH_LIMIT * 2, loose: true });
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
      case "refrigerant_charge": {
        const brand = typeof input.brand === "string" ? input.brand.trim() : "";
        const outdoor = typeof input.outdoor === "string" ? input.outdoor.trim() : "";
        const indoors = Array.isArray(input.indoors) ? input.indoors.filter((m): m is string => typeof m === "string" && m.trim() !== "").map((m) => m.trim()).slice(0, 40) : [];
        const liquidM: Record<string, number> = {};
        for (const r of Array.isArray(input.liquid_pipe) ? input.liquid_pipe : []) {
          const o = r && typeof r === "object" ? (r as { size_mm?: unknown; metres?: unknown }) : {};
          if (typeof o.size_mm === "number" && typeof o.metres === "number" && o.metres > 0 && o.metres < 1000) liquidM[String(o.size_mm)] = (liquidM[String(o.size_mm)] ?? 0) + o.metres;
        }
        if (!brand || !outdoor || !indoors.length || Object.keys(liquidM).length === 0) return fail("Name the brand's pack, the outdoor, every indoor on it and the liquid pipe by size and metres.");
        const farthestM = typeof input.farthest_m === "number" && input.farthest_m > 0 ? input.farthest_m : null;
        const method = input.method === "branch-box" ? "branch-box" : "joint";
        const c = await store.charge(brand, { outdoor, indoors, liquidM, farthestM, method });
        return { ok: true, label, said: `${outdoor}: ${!c.found ? c.reason : c.addKg == null ? "not from what's known" : `${c.addKg} kg to add`}`, value: c };
      }
      case "pairing_check": {
        const brand = typeof input.brand === "string" ? input.brand.trim() : "";
        const outdoor = typeof input.outdoor === "string" ? input.outdoor.trim() : "";
        const indoors = Array.isArray(input.indoors) ? input.indoors.filter((m): m is string => typeof m === "string" && m.trim() !== "").map((m) => m.trim()).slice(0, 40) : [];
        if (!brand || !outdoor || !indoors.length) return fail("Name the brand's pack, the outdoor and every indoor on it.");
        const p = await store.pairing(brand, outdoor, indoors);
        return { ok: true, label, said: `${outdoor}: ${!p.found ? p.reason : p.connects === true ? "connects" : p.connects === false ? "doesn't connect" : "not checked"}`, value: p };
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
        /* the line's reason is the change's: an old one never stays behind it */
        const patch: Record<string, unknown> = { ...p.patch };
        const line = p.patch.code || p.patch.name ? (await store.readLines()).find((l) => l.id === p.id) : undefined;
        /* a unit keeps the room it's named for, unless she names another */
        const words = p.patch.name ?? line?.name ?? "";
        if (p.patch.code) {
          const unit = p.patch.unit ?? line?.unit ?? "";
          const priced = bookPrice(await store.book(), p.patch.code, unit, await store.supplier());
          if (!priced) return fail(`${p.patch.code} isn't in the business's book. Search the book for what it buys.`);
          const name = line?.kind === "unit" || priced.kind === "unit" ? await unitNameOf(store, priced, words) : priced.name;
          Object.assign(patch, { code: priced.code, name, supplierKey: priced.supplierKey, costCents: priced.costCents, sellCents: p.patch.sellCents ?? null });
        } else if (p.patch.name && line?.kind === "unit" && line.code) {
          /* a unit she renames is still named by what it is */
          const item = bookPrice(await store.book(), line.code, line.unit, await store.supplier());
          patch.name = await unitNameOf(store, item ?? { name: line.name, code: line.code, brand: null }, words);
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
        const res = await store.addKit(k.kit, normaliseKitFacts(k.facts), k.at, k.unit, k.indoor);
        if (!res.ok) return fail(res.reason);
        /* what it couldn't size or price: hers to settle, from the book or by asking */
        const still = res.still ?? [];
        return {
          ok: true,
          label,
          said: `${k.kit === "split" ? "Split" : "Ducted"}, ${res.added} parts${still.length ? `, ${still.length} to settle` : ""}`,
          value: still.length ? { added: res.added, still_to_settle: still } : { added: res.added },
        };
      }
      /* the guide's figure and its reason for each check: hers to say, the
         brief's or the person's to override (Isaac, 2026-10-15: "which we
         can change during the conversation") */
      case "airflow_check": {
        const ask = airflowAskOf(input);
        if (isErr(ask)) return fail(ask.error);
        const guide = await store.airflowGuide();
        if (!guide) return fail("The ducted airflow guide isn't installed here.");
        const res = airflowCheck(guide, ask);
        return { ok: true, label, said: airflowSaid(res), value: res };
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
      /* the business's own design of the job, as the Studio's Summary shows
         it (Isaac, 2026-10-17: "I think Tiff can already read the studio
         design. Or can she not?") */
      case "read_design": {
        const id = typeof input.id === "string" && input.id.trim() ? input.id.trim().slice(0, 80) : null;
        const system = typeof input.system === "string" ? input.system.slice(0, 120) : null;
        const got = await store.design(id);
        if (!got.found) {
          if (!got.designs?.length) return { ok: true, label, said: "No design on this job", value: { design: null, said: got.reason } };
          return fail(`${got.reason} Its designs: ${got.designs.map((d) => `${d.name} (${d.id}, saved ${d.saved})`).join("; ")}.`);
        }
        const { read, others } = got;
        const n = (k: number, one: string) => `${k} ${one}${k === 1 ? "" : "s"}`;
        return {
          ok: true,
          label,
          said: `${read.design.name}: ${n(read.systems.length, "system")}, ${n(read.rooms, "room")}`,
          /* a long design narrowed to fit, saying what it left out */
          value: fitDesignRead({ ...read, ...(others.length ? { other_designs: others } : {}) }, { system }),
        };
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
      case "build_labour": {
        const option = typeof input.option === "number" ? Math.max(0, Math.min(19, Math.round(input.option))) : 0;
        const visits = labourVisitsOf(input.visits);
        if (typeof visits === "string") return fail(visits);
        const [now, hour, day] = await Promise.all([store.readLines(), store.hourCost(), store.taskHours()]);
        /* hers go, and every line worked out task by task, with what people
           did to its tasks kept (keepPeoplesTasks); a person's own labour
           line stays */
        const old = now.filter((x) => x.optionIndex === option && x.kind === "labour" && (x.updatedBy === "tiff" || x.visit));
        for (const l of old) await store.removeLine(l.id, l.version, "Labour worked out again");
        const built = keepPeoplesTasks(
          visits.map((v) => visitLine(v, day.dayHours).visit),
          old.flatMap((l) => (l.visit ? [l.visit] : []))
        );
        let hours = 0;
        for (const visit of built) {
          hours += visitHours(visit);
          const r = await store.addLine({ optionIndex: option, system: "", group: "Labour", name: visitName(visit), kind: "labour", unit: "h", costCents: hour ?? 0, sellCents: null, source: "assumed", why: "Worked out task by task", visit }, "Labour, task by task");
          if (!r.ok) return fail(r.reason);
        }
        return { ok: true, label, said: `${hours} h over ${built.length} ${built.length === 1 ? "visit" : "visits"}`, value: { hours, visits: built.map(visitName) } };
      }
      case "research_price": {
        const lineId = typeof input.line_id === "string" ? input.line_id : "";
        const what = typeof input.what === "string" ? input.what.trim().slice(0, 400) : "";
        if (!(await store.readLines()).some((l) => l.id === lineId)) return fail("There's no line with that id. Read the quote for its lines.");
        if (!what) return fail("Say what to price.");
        const run = await store.research(lineId, what);
        const cost = run.model ? { usd: run.usd, model: run.model } : undefined;
        if (!run.ok) return { ok: false, error: run.reason, label, cost };
        const r = run.research;
        const dollars = `$${(r.priceCents / 100).toFixed(2)}`;
        return {
          ok: true,
          label,
          said: `${dollars} ${r.per}`,
          value: { price_ex_gst: dollars, per: r.per, summary: r.summary, source: r.source.title, use: "The person presses Use it to put it on the line. Don't change the line's price yourself." },
          detail: { research: { lineId, ...r } },
          cost,
        };
      }
      case "write_up": {
        const writeUp = writeUpOf(input);
        if (!writeUp) return fail("Write the job out: what you read, the sizing, the work, the visits, what you can't price and what you're assuming.");
        /* the write-up rides on the event, as the building list does: the page draws it */
        return { ok: true, label, said: "the job, written out", value: { written: true }, detail: { writeUp } };
      }
      case "plan_parts": {
        const parts = planOf(input.parts);
        if (parts.length === 0) return fail("Give the parts in order, each with its group.");
        const option = typeof input.option === "number" ? Math.max(0, Math.min(19, Math.round(input.option))) : 0;
        return { ok: true, label, said: `${parts.length} ${parts.length === 1 ? "part" : "parts"}`, value: { planned: parts.length }, detail: { option, parts } };
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
      /* a question the person answered in their own words, ticked off once
         she's changed the lines to match (Isaac, 2026-10-11) */
      case "settle": {
        const given = (Array.isArray(input.settled) ? input.settled : []).slice(0, 10).flatMap((x) => {
          const o = x && typeof x === "object" ? (x as Record<string, unknown>) : {};
          const answer = typeof o.answer === "string" ? o.answer.trim().slice(0, 80) : "";
          return typeof o.question === "number" && answer ? [{ question: Math.round(o.question), answer }] : [];
        });
        if (given.length === 0) return fail("Give each question's number and the answer in a few words.");
        const open = new Map((await store.openQuestions()).map((q) => [q.id, q.question]));
        const settled = given.filter((g) => open.has(g.question));
        if (settled.length === 0) return fail(`None of those is open. Open: ${[...open.keys()].join(", ") || "none"}.`);
        return {
          ok: true,
          label,
          said: settled.map((s) => s.answer).join(", "),
          value: { settled: settled.length, notOpen: given.filter((g) => !open.has(g.question)).map((g) => g.question) },
          detail: { settled },
        };
      }
      default:
        return fail(`There's no tool called ${name}.`);
    }
  };
}
