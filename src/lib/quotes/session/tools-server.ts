import "server-only";
import { bookProducts } from "../book-view-server";
import type { Product } from "../families";
import { addKit } from "../kits-server";
import { addLine, changeLine, copyOption, readLines, removeLine } from "../lines-server";
import { addCompared, nameOption, readByHand, saveProposal } from "../lines-job-server";
import { jobKind, readCorrections } from "../corrections-server";
import { jobFiles, lookAt } from "./job-files-server";
import { lookupUnit } from "../lookups-server";
import { runResearch } from "../research-server";
import { sessionModelFor } from "./model-server";
import { readOrgDay } from "../org-day-server";
import { hourCostOf } from "../profit";
import { readQuotePrice } from "../quote-price-server";
import { readQuoteSettings } from "../settings-query";
import type { NewLine } from "./tools";
import { lineFor, makeTools, type QuoteStore } from "./tools-run";

/* Tiff's tools in the app (tools-run.ts runs them): the quote store is the
   quote's own lines, every write through lines-server.ts as "tiff", so it's
   versioned, in the line's history and undoable like a person's. The book
   and the hour are read once a turn, and only when asked for. Service role,
   by org; the route gates the session on running the board and money
   access, as the quote's own lines do. */

export const TIFF = "tiff";

export function dbStore(orgId: string, jobUuid: string): QuoteStore {
  let products: Promise<Product[]> | null = null;
  let hour: Promise<number | null> | null = null;
  let supplier: Promise<string | null> | null = null;
  return {
    readLines: () => readLines(orgId, jobUuid),
    addLine: (row, why) => addLine(orgId, jobUuid, row, TIFF, why),
    changeLine: (id, version, patch, why) => changeLine(orgId, jobUuid, id, version, patch, TIFF, why),
    removeLine: (id, version, why) => removeLine(orgId, jobUuid, id, version, TIFF, why),
    copyOption: (from, to) => copyOption(orgId, jobUuid, from, to, TIFF),
    nameOption: (option, name) => nameOption(orgId, jobUuid, option, name, TIFF),
    research: async (lineId, what) => {
      const model = sessionModelFor(orgId);
      if (!model) return { ok: false, reason: "Research isn't switched on for this business.", usd: 0, model: "" };
      const line = (await readLines(orgId, jobUuid)).find((l) => l.id === lineId);
      if (!line) return { ok: false, reason: "That line has gone.", usd: 0, model: "" };
      return runResearch(model, { what, line: { name: line.name, qty: line.qty, unit: line.unit, system: line.system } });
    },
    proposal: () => (jobUuid ? readByHand(orgId, jobUuid).then((b) => b.proposal) : Promise.resolve(null)),
    writeProposal: async (patch) => {
      const res = await saveProposal(orgId, jobUuid, patch, TIFF);
      return res.ok ? { ok: true } : res;
    },
    compareWith: (lineId, code) => addCompared(orgId, jobUuid, lineId, code, TIFF),
    addKit: (kit, facts, at, unit) => addKit(orgId, jobUuid, kit, facts, at, unit, TIFF),
    book: () => (products ??= bookProducts(orgId)),
    supplier: () => (supplier ??= jobUuid ? readByHand(orgId, jobUuid).then((b) => b.supplier) : Promise.resolve(null)),
    jobFiles: () => (jobUuid ? jobFiles(orgId, jobUuid) : Promise.resolve([])),
    look: (id) => (jobUuid ? lookAt(orgId, jobUuid, id) : Promise.resolve("There's no job to look at.")),
    corrections: async (sameKind) => readCorrections(orgId, { kind: sameKind && jobUuid ? await jobKind(orgId, jobUuid) : null }),
    hourCost: () =>
      (hour ??= Promise.all([readQuoteSettings(orgId), readOrgDay(orgId)]).then(([s, d]) =>
        d.rate ? hourCostOf(d.rate.perHourCents, s.profitTargetPct, s.labourCostCents) : null
      )),
    lookupUnit: (brand, model) => lookupUnit(brand, model),
    taskHours: () =>
      Promise.all([readQuoteSettings(orgId), readOrgDay(orgId)]).then(([s, d]) => ({ hours: s.taskHours, dayHours: d.hours?.hours ?? null })),
    totals: async () => {
      const p = await readQuotePrice(orgId, jobUuid);
      return p.ok ? { ok: true, options: p.options.map((o) => o.build.exGstCents) } : { ok: false };
    },
  };
}

/** How a new line goes on for this business (a person's tapped answer
    uses it too): the store's book, hour and the job's supplier, and the
    line priced from them. */
export function linePricer(orgId: string, jobUuid = "") {
  const store = dbStore(orgId, jobUuid);
  return { book: store.book, hourCost: store.hourCost, supplier: store.supplier, lineFor: (l: NewLine) => lineFor(store, l) };
}

export function sessionTools(orgId: string, jobUuid: string) {
  return makeTools(dbStore(orgId, jobUuid));
}
