/* ONE LIST OF UNITS, SHARED BY THE DESIGN AND THE QUOTE (Isaac, 27 November
   2026: "Yes, build it" to https://claude.ai/artifact/1Dhn6R3di6pdBX9F3ah3Nk;
   the rule, 26 November: "things need to be two way and reflect what other
   sections say or do").

   A unit lives once, on the job: the design places it and the quote prices
   it. A quote's unit line is joined to the design's units it is (their
   allocation ids, allocations.ts: the id a unit keeps through a swap), with
   what both said when they last agreed, the design's model and the quote's
   code, so a change on either side is known for whose it was.

   Most join on their own: the same model, in the room the line names. What
   doesn't, Tiff asks, once and one at a time: is the quote's system the
   design's, whose outdoor, whose heads, and what one side has that the
   other hasn't. Each answer is a few plain steps (Step) the server carries
   out, the quote's priced from the book; what the design is to take waits
   on the line (`take`) for the Studio, the design's only writer, to take
   when it next opens.

   Only for a quote and a design made apart, as 3406's were: a unit Tiff
   quotes from a design, or a design takes from the quote, is joined from
   the start. Pure. */

import type { DesignDocument, DesignSystem } from "@/lib/studio/document";
import type { DataPack } from "@/lib/studio/packs/schema";
import { allocationsOf, hasAllocations, roomsServed } from "@/lib/studio/allocations";
import { modelForCode, roomScore } from "@/lib/studio/from-quote";
import type { LineJoin } from "./design-join";

export { joinOf, type LineJoin } from "./design-join";

export type Kind = "split" | "multi" | "ducted" | "vrf";

/** A unit of the design: an allocation of a built system. */
export type DesignUnit = {
  id: string;
  systemId: string;
  role: "idu" | "odu";
  model: string;
  /** the rooms it serves, by name; none for an outdoor or a unit serving the whole system */
  rooms: string[];
};

export type DesignSys = { id: string; name: string; kind: Kind | null; units: DesignUnit[] };

/** The design's systems and their units, as the join reads them. */
export function designSystems(doc: DesignDocument): DesignSys[] {
  const roomName = new Map(doc.objects.filter((o) => o.type === "room").map((o) => [o.id, String(o.props.name ?? "").trim()]));
  return doc.systems.map((sys) => {
    const units: DesignUnit[] = hasAllocations(sys)
      ? allocationsOf(sys)
          .filter((a) => a.model)
          .map((a) => ({ id: a.id, systemId: sys.id, role: a.role, model: a.model, rooms: roomsServed(a).map((r) => roomName.get(r) ?? "").filter(Boolean) }))
      : [];
    return { id: sys.id, name: sys.name.trim() || "System", kind: designKind(sys), units };
  });
}

function designKind(sys: DesignSystem): Kind | null {
  if (sys.type === "vrf") return "vrf";
  if (allocationsOf(sys).some((a) => a.serves === "system") || /duct/i.test(sys.name)) return "ducted";
  if (sys.type === "multi-split") return "multi";
  if (sys.type === "split") return allocationsOf(sys).length ? "split" : null;
  return null;
}

/** A quote's unit line, as the join reads it. */
export type UnitLine = {
  id: string;
  optionIndex: number;
  system: string;
  name: string;
  code: string | null;
  qty: number;
  costCents: number;
  sellCents: number | null;
  design: LineJoin | null;
};

/** The book's models a code can be: the pack's indoor and outdoor units. */
export type Book = { idu: string[]; odu: string[]; oduType: Record<string, string> };

export function bookOf(pack: DataPack | null): Book {
  if (!pack) return { idu: [], odu: [], oduType: {} };
  return {
    idu: pack.indoor_units.map((u) => u.model),
    odu: pack.outdoor_units.map((u) => u.model),
    oduType: Object.fromEntries(pack.outdoor_units.map((u) => [u.model, u.system_type])),
  };
}

/** What a line is in the book: an outdoor or an indoor of a model, or not known. */
function lineModel(book: Book, code: string | null): { role: "idu" | "odu" | null; model: string | null } {
  if (!code) return { role: null, model: null };
  const odu = modelForCode(book.odu, code);
  if (odu) return { role: "odu", model: odu };
  const idu = modelForCode(book.idu, code);
  return idu ? { role: "idu", model: idu } : { role: null, model: null };
}

/** What a line is: by its model, else by its words, an outdoor or a head. */
function slotOf(book: Book, l: UnitLine): { role: "idu" | "odu" | null; model: string | null } {
  const m = lineModel(book, l.code);
  if (m.role) return m;
  return { role: /outdoor|condenser/i.test(l.name) ? "odu" : l.code ? "idu" : null, model: null };
}

/** The room a line names: the words after its last comma ("Concealed ducted
    3.6 kW, Master Bedroom"), else its system where that's a room's. */
export function roomWordsOf(line: Pick<UnitLine, "name" | "system">, systemIsRoom = false): string {
  const at = line.name.lastIndexOf(",");
  const after = at >= 0 ? line.name.slice(at + 1).replace(/\bx\s*\d+\b/i, "").trim() : "";
  if (after && !/^(single|three) phase$/i.test(after)) return after;
  return systemIsRoom ? line.system : "";
}

/** A short name for a model: "P40" for PEFY-P40VMX-E, else the model. */
export function shortModel(model: string): string {
  return /^[A-Z]+-(P\d+)/.exec(model)?.[1] ?? model;
}

function quoteKind(lines: readonly UnitLine[], book: Book, name: string): Kind | null {
  const words = `${name} ${lines.map((l) => l.name).join(" ")}`;
  if (/\bvrf\b/i.test(words)) return "vrf";
  if (/duct/i.test(words)) return "ducted";
  for (const l of lines) {
    const m = lineModel(book, l.code);
    if (m.role === "odu" && m.model) {
      const t = book.oduType[m.model];
      if (t === "vrf" || t === "multi" || t === "split") return t;
    }
  }
  if (/\bmulti\b/i.test(words)) return "multi";
  if (/split|high wall|wall/i.test(words)) return "split";
  return null;
}

/** The quote's systems on an option: its unit lines by their system, with
    heads kept under a room's name ("Living", "Bed 2") gathered to the one
    outdoor beside them, as an old quote keeps them. */
export type QuoteGroup = { key: string; name: string; lines: UnitLine[]; byRoom: boolean };

export function quoteGroups(lines: readonly UnitLine[], book: Book): QuoteGroup[] {
  const order: string[] = [];
  const by = new Map<string, UnitLine[]>();
  for (const l of lines) {
    const k = l.system.trim();
    if (!by.has(k)) {
      by.set(k, []);
      order.push(k);
    }
    by.get(k)!.push(l);
  }
  const hasOdu = (ls: UnitLine[]) => ls.some((l) => lineModel(book, l.code).role === "odu" || /outdoor/i.test(l.name));
  const outdoorOnly = order.filter((k) => hasOdu(by.get(k)!) && by.get(k)!.every((l) => lineModel(book, l.code).role === "odu" || /outdoor/i.test(l.name)));
  const headOnly = order.filter((k) => !hasOdu(by.get(k)!));
  if (outdoorOnly.length === 1 && headOnly.length > 0 && outdoorOnly.length + headOnly.length === order.length) {
    const key = outdoorOnly[0]!;
    const all = order.flatMap((k) => by.get(k)!);
    return [{ key, name: key || "The units", lines: all, byRoom: true }];
  }
  return order.map((k) => ({ key: k, name: k || "The units", lines: by.get(k)!, byRoom: false }));
}

/** One unit a line counts, qty by qty. */
type Slot = { line: UnitLine; role: "idu" | "odu" | null; model: string | null; room: string };

/** How well a unit's rooms answer the quote's words for a room: the room
    names' own match (from-quote.ts), else a word in common ("Living +
    Kitchen" and "Kitchen/Sitting"); 0 not at all. */
export function roomMatch(rooms: readonly string[], said: string): number {
  if (!said) return 0;
  const best = Math.max(0, ...rooms.map((r) => roomScore(r, said)));
  if (best > 0) return best;
  const sw = new Set(wordsOf(said).filter((w) => w.length > 2));
  return rooms.some((r) => wordsOf(r).some((w) => sw.has(w))) ? 10 : 0;
}

/** A unit the quote has that doesn't join, one per unit a line counts. */
export type HeadSide = { lineId: string; model: string | null; code: string | null; room: string; role: "idu" | "odu" | null };

export type JoinQuestion =
  /** is the quote's system the design's */
  | { kind: "same"; id: string; group: QuoteGroup; system: DesignSys }
  /** whose outdoor */
  | { kind: "outdoor"; id: string; group: QuoteGroup; system: DesignSys; design: DesignUnit; line: UnitLine; quoteModel: string | null }
  /** whose heads: the ones that don't join, each side */
  | {
      kind: "heads";
      id: string;
      group: QuoteGroup;
      system: DesignSys;
      design: DesignUnit[];
      quote: HeadSide[];
      /** a quote unit and the design's it answers, in the same room: quote index → design unit id */
      pairs: Record<number, string>;
      /** the design's units each line here is already, by line id */
      joined: Record<string, string[]>;
      /** the lines here, by id: their qty */
      qty: Record<string, number>;
      quoteCanGo: boolean;
    }
  /** the quote has it, the design hasn't */
  | { kind: "quote-only"; id: string; group: QuoteGroup; canAdd: boolean }
  /** the design has it, the quote hasn't */
  | { kind: "design-only"; id: string; system: DesignSys };

/** Where a unit line stands against the design. */
export type LineStand =
  | { from: "design"; units: string[] }
  | { from: "quote" }
  /** the design is to take it from the quote, when the Studio next opens */
  | { from: "waiting" }
  | null;

export type JoinRead = {
  design: { id: string; name: string };
  /** the option the design is joined to */
  option: number;
  lines: Record<string, LineStand>;
  questions: JoinQuestion[];
  /** joins found this read, to keep with their lines */
  found: { lineId: string; join: LineJoin }[];
  /** the units the design is waiting to take */
  waiting: number;
  /** of a line waiting, how many units the design is still to add */
  toAdd?: Record<string, number>;
};

/** Which option the design joins: one already joined, else the one the
    client took, else the one with most units the design has, else the
    first with units. Null with no unit lines. */
export function joinOption(lines: readonly UnitLine[], designId: string, accepted: readonly number[], book: Book, units: readonly DesignUnit[]): number | null {
  const present = [...new Set(lines.map((l) => l.optionIndex))].sort((a, b) => a - b);
  if (present.length === 0) return null;
  const joined = present.find((o) => lines.some((l) => l.optionIndex === o && l.design?.design === designId));
  if (joined !== undefined) return joined;
  const took = accepted.find((o) => present.includes(o));
  if (took !== undefined) return took;
  const models = new Set(units.map((u) => u.model));
  let best = present[0]!;
  let score = -1;
  for (const o of present) {
    const s = lines.filter((l) => l.optionIndex === o && models.has(lineModel(book, l.code).model ?? "")).length;
    if (s > score) [best, score] = [o, s];
  }
  return best;
}

/** A size said in kW: "12.5 kW", "12kw". */
const kwOf = (s: string): number | null => {
  const m = /(\d+(?:\.\d+)?)\s*kw\b/i.exec(s);
  return m ? Number(m[1]) : null;
};

const STOP = new Set(["the", "a", "of", "to", "and", "system", "floor", "kw", "unit", "units", "on"]);
const wordsOf = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1 && !STOP.has(w) && !/^\d+$/.test(w));

/** How the join stands: every unit line of the option against the design,
    the joins found, and the questions left. `leftOff`: the design's systems
    a person left off the quote; `drop`: the design's units a person said go,
    for the Studio. */
export function readJoin(input: {
  doc: DesignDocument;
  lines: readonly UnitLine[];
  accepted: readonly number[];
  book: Book;
  leftOff?: readonly string[];
  drop?: readonly string[];
}): JoinRead | null {
  const { doc, book } = input;
  const systems = designSystems(doc);
  const allUnits = systems.flatMap((s) => s.units);
  const dropped = new Set(input.drop ?? []);
  const option = joinOption(input.lines, doc.id, input.accepted, book, allUnits);
  if (option === null) return null;
  const lines = input.lines.filter((l) => l.optionIndex === option);
  const groups = quoteGroups(lines, book);
  const groupOf = new Map<string, QuoteGroup>();
  for (const g of groups) for (const l of g.lines) groupOf.set(l.id, g);

  const unitById = new Map(allUnits.map((u) => [u.id, u]));
  const taken = new Set<string>();
  const stand: Record<string, LineStand> = {};
  const joinedUnits = new Map<string, string[]>();
  const found: JoinRead["found"] = [];
  let waiting = 0;
  /* the group's system, by the design units its lines are */
  const groupSystem = new Map<string, string>();
  const vote = (g: QuoteGroup, systemId: string) => {
    if (!groupSystem.has(g.key)) groupSystem.set(g.key, systemId);
  };

  /* what's kept: a join in this design whose units are still in it */
  const open: Slot[] = [];
  const takes: { l: UnitLine; j: LineJoin; g: QuoteGroup }[] = [];
  const toAdd: Record<string, number> = {};
  for (const l of lines) {
    const j = l.design && l.design.design === doc.id ? l.design : null;
    const g = groupOf.get(l.id)!;
    if (j?.only) {
      stand[l.id] = { from: "quote" };
      continue;
    }
    if (j?.take) {
      takes.push({ l, j, g });
      continue;
    }
    const kept = (j?.units ?? []).filter((u) => unitById.has(u) && !taken.has(u));
    kept.forEach((u) => taken.add(u));
    if (kept.length) {
      joinedUnits.set(l.id, kept);
      vote(g, unitById.get(kept[0]!)!.systemId);
    }
    /* said to be the design's system, its units not settled yet */
    if (j && !j.only && !j.take && j.system && !kept.length) vote(g, j.system);
    const m = slotOf(book, l);
    const room = roomWordsOf(l, g.byRoom);
    for (let n = kept.length; n < Math.max(1, Math.round(l.qty)); n++) open.push({ line: l, role: m.role, model: m.model, room });
  }

  /* what the design was to take from the quote: taken once the Studio has
     it, the unit it is joined as it stands; waiting until then */
  for (const { l, j, g } of takes) {
    const take = j.take!;
    const own = j.units.map((u) => unitById.get(u)).filter((u): u is DesignUnit => !!u && !taken.has(u.id));
    const need = Math.max(1, Math.round(l.qty)) - own.length;
    const extra: DesignUnit[] = [];
    if (need > 0) {
      const inNew = j.system?.startsWith("new:") ? j.system.slice(4) : null;
      const seen = new Set(own.map((u) => u.id));
      for (let n = 0; n < need; n++) {
        let got: DesignUnit | null = null;
        let score = -1;
        for (const u of allUnits) {
          if (taken.has(u.id) || seen.has(u.id) || u.model !== take) continue;
          if (j.system && !inNew && u.systemId !== j.system) continue;
          const sysName = systems.find((x) => x.id === u.systemId)?.name ?? "";
          const sc = (inNew && sysName === inNew ? 100 : 0) + roomMatch(u.rooms, j.room ?? "");
          if (sc > score) [got, score] = [u, sc];
        }
        if (!got) break;
        seen.add(got.id);
        extra.push(got);
      }
    }
    /* the unit it is stays its, the model to change */
    own.forEach((u) => taken.add(u.id));
    if (own.every((u) => u.model === take) && extra.length === Math.max(0, need)) {
      extra.forEach((u) => taken.add(u.id));
      const units = [...own, ...extra];
      joinedUnits.set(l.id, units.map((u) => u.id));
      if (units[0]) vote(g, units[0].systemId);
      continue;
    }
    stand[l.id] = { from: "waiting" };
    waiting += Math.max(1, Math.round(l.qty));
    /* what of it the design has already stays its: the Studio adds the rest */
    extra.forEach((u) => taken.add(u.id));
    toAdd[l.id] = Math.max(0, need - extra.length);
    if (own[0]) vote(g, own[0].systemId);
    else if (j.system && !j.system.startsWith("new")) vote(g, j.system);
  }

  /* joined on their own: the same model, outdoors first so the heads know
     their system, then in the room the line names */
  const sure = (slot: Slot) => {
    if (!slot.model || !slot.role) return false;
    const g = groupOf.get(slot.line.id)!;
    const sys = groupSystem.get(g.key);
    let best: DesignUnit | null = null;
    let score = -1;
    for (const u of allUnits) {
      if (taken.has(u.id) || dropped.has(u.id) || u.role !== slot.role || u.model !== slot.model) continue;
      /* a head in another room is another head, the same model or not */
      const room = slot.room && u.rooms.length ? roomMatch(u.rooms, slot.room) : null;
      if (room === 0) continue;
      if (sys && u.systemId !== sys && !room) continue;
      const s = (sys && u.systemId === sys ? 200 : 0) + (room ?? 0);
      if (s > score) [best, score] = [u, s];
    }
    if (!best) return false;
    taken.add(best.id);
    joinedUnits.set(slot.line.id, [...(joinedUnits.get(slot.line.id) ?? []), best.id]);
    vote(g, best.systemId);
    return true;
  };
  const left: Slot[] = [];
  for (const slot of [...open.filter((s) => s.role === "odu"), ...open.filter((s) => s.role !== "odu")]) if (!sure(slot)) left.push(slot);

  for (const l of lines) {
    const units = joinedUnits.get(l.id);
    if (!units?.length) continue;
    stand[l.id] = { from: "design", units };
    const was = l.design && l.design.design === doc.id ? l.design : null;
    const had = was?.units ?? [];
    /* new to it, or what it waited for is in: kept as it stands now */
    if (!was || was.take || was.system || units.length !== had.length || units.some((u, i) => had[i] !== u)) {
      found.push({ lineId: l.id, join: { design: doc.id, units, model: unitById.get(units[0]!)!.model, code: l.code } });
    }
  }

  const questions: JoinQuestion[] = [];
  const sysById = new Map(systems.map((s) => [s.id, s]));
  const leftOff = new Set(input.leftOff ?? []);
  const pairedSystems = new Set(groupSystem.values());
  const asked = new Set<string>();
  const unpaired: QuoteGroup[] = [];
  const leftUnits = (s: DesignSys) => s.units.filter((u) => !taken.has(u.id) && !dropped.has(u.id));

  for (const g of groups) {
    const mine = left.filter((s) => groupOf.get(s.line.id) === g);
    const sid = groupSystem.get(g.key);
    if (sid) {
      const sys = sysById.get(sid);
      if (!sys || asked.has(sid)) continue;
      const theirs = leftUnits(sys);
      const qOdu = mine.filter((s) => s.role === "odu");
      const dOdu = theirs.filter((u) => u.role === "odu");
      const qHeads = mine.filter((s) => s.role !== "odu");
      const dHeads = theirs.filter((u) => u.role !== "odu");
      if (qOdu.length === 1 && dOdu.length === 1) {
        questions.push({ kind: "outdoor", id: `outdoor:${dOdu[0]!.id}`, group: g, system: sys, design: dOdu[0]!, line: qOdu[0]!.line, quoteModel: qOdu[0]!.model });
      }
      const extraOdu = qOdu.length === 1 && dOdu.length === 1 ? [] : qOdu;
      const extraDOdu = qOdu.length === 1 && dOdu.length === 1 ? [] : dOdu;
      const q = [...qHeads, ...extraOdu];
      const d = [...dHeads, ...extraDOdu];
      if (q.length || d.length) {
        asked.add(sid);
        /* each of the quote's against the design's in the same room; one of
           each left over is the same unit, its model apart */
        const pairs: Record<number, string> = {};
        const used = new Set<string>();
        const tries = q.flatMap((sl, i) => d.map((u) => ({ i, u, score: sl.role === u.role || !sl.role ? roomMatch(u.rooms, sl.room) : 0 }))).filter((t) => t.score > 0);
        tries.sort((a, b) => b.score - a.score);
        for (const t of tries) {
          if (t.i in pairs || used.has(t.u.id)) continue;
          pairs[t.i] = t.u.id;
          used.add(t.u.id);
        }
        const qLeft = q.map((_, i) => i).filter((i) => !(i in pairs));
        const dLeft = d.filter((u) => !used.has(u.id));
        if (qLeft.length === 1 && dLeft.length === 1 && (!q[qLeft[0]!]!.role || q[qLeft[0]!]!.role === dLeft[0]!.role)) pairs[qLeft[0]!] = dLeft[0]!.id;
        const plan = doc.objects.filter((o) => o.type === "room").map((o) => String(o.props.name ?? ""));
        const touched = [...new Set(q.map((sl) => sl.line.id))];
        questions.push({
          kind: "heads",
          id: `heads:${sid}`,
          group: g,
          system: sys,
          design: d,
          quote: q.map((sl) => ({ lineId: sl.line.id, model: sl.model, code: sl.line.code, room: sl.room, role: sl.role })),
          pairs,
          joined: Object.fromEntries(touched.map((id) => [id, joinedUnits.get(id) ?? []])),
          qty: Object.fromEntries(touched.map((id) => [id, Math.max(1, Math.round(lines.find((l) => l.id === id)!.qty))])),
          quoteCanGo: q.every((sl, i) => !!sl.model && (sl.role === "odu" || i in pairs || roomMatch(plan, sl.room) > 0)),
        });
      }
      continue;
    }
    /* nothing of it joined: settled below, against the design's systems */
    if (g.lines.some((l) => !stand[l.id])) unpaired.push(g);
  }

  /* the quote's systems nothing joined, each against the design's most like
     it, the likeliest pairs first: the same kind, the same size, words in
     common */
  const free = systems.filter((s) => !pairedSystems.has(s.id) && !asked.has(s.id) && !leftOff.has(s.id) && !s.units.some((u) => taken.has(u.id)));
  const pairs: { g: QuoteGroup; s: DesignSys; score: number }[] = [];
  for (const g of unpaired) {
    const text = `${g.name} ${g.lines.map((l) => l.name).join(" ")}`;
    const kind = quoteKind(g.lines, book, g.name);
    const gw = new Set(wordsOf(text));
    const gk = kwOf(text);
    for (const s of free) {
      const sk = kwOf(s.name);
      const score = (kind && s.kind === kind ? 2 : 0) + wordsOf(s.name).filter((w) => gw.has(w)).length + (gk && sk && Math.abs(gk - sk) / Math.max(gk, sk) <= 0.1 ? 1 : 0);
      if (score >= 2) pairs.push({ g, s, score });
    }
  }
  pairs.sort((a, b) => b.score - a.score || unpaired.indexOf(a.g) - unpaired.indexOf(b.g));
  const sameFor = new Map<string, DesignSys>();
  for (const p of pairs) {
    if (sameFor.has(p.g.key) || asked.has(p.s.id)) continue;
    sameFor.set(p.g.key, p.s);
    asked.add(p.s.id);
  }
  /* one of each left, nothing alike: still asked, the only pair there is */
  const lonely = unpaired.filter((g) => !sameFor.has(g.key));
  const freeLeft = free.filter((s) => !asked.has(s.id));
  if (lonely.length === 1 && freeLeft.length === 1) {
    sameFor.set(lonely[0]!.key, freeLeft[0]!);
    asked.add(freeLeft[0]!.id);
  }
  for (const g of unpaired) {
    const s = sameFor.get(g.key);
    if (s) {
      questions.push({ kind: "same", id: `same:${g.key}:${s.id}`, group: g, system: s });
      continue;
    }
    const slots = left.filter((x) => groupOf.get(x.line.id) === g);
    questions.push({
      kind: "quote-only",
      id: `quote-only:${g.key}`,
      group: g,
      canAdd: slots.some((x) => x.role === "odu" && x.model) && slots.some((x) => x.role === "idu" && x.model && x.room),
    });
  }
  /* in the quote's order */
  const at = (q: JoinQuestion) => (q.kind === "design-only" ? groups.length : groups.indexOf(q.group));
  questions.sort((a, b) => at(a) - at(b));
  for (const s of systems) {
    if (pairedSystems.has(s.id) || asked.has(s.id) || leftOff.has(s.id) || s.units.length === 0) continue;
    if (s.units.some((u) => taken.has(u.id))) continue;
    questions.push({ kind: "design-only", id: `design-only:${s.id}`, system: s });
  }

  for (const l of lines) if (!(l.id in stand)) stand[l.id] = null;
  return { design: { id: doc.id, name: doc.meta.name?.trim() || "Design" }, option, lines: stand, questions, found, waiting, toAdd };
}

/* ── answers ── */

/** What an answer does, step by step, for the server to carry out: the
    quote's own lines priced from the book; what the design takes waits on
    its line for the Studio. */
export type Step =
  /** keep a join on a line, nothing else changed */
  | { step: "join"; lineId: string; join: LineJoin }
  /** the line becomes the design's unit: its model, priced from the book */
  | { step: "swap"; lineId: string; model: string; join: LineJoin }
  /** the line goes */
  | { step: "remove"; lineId: string }
  /** the line counts fewer: the units of it that the design has */
  | { step: "qty"; lineId: string; qty: number }
  /** a line for a unit of the design, priced from the book */
  | { step: "add"; system: string; unit: DesignUnit; join: LineJoin }
  /** the design's system stays off the quote */
  | { step: "leave-off"; systemId: string }
  /** the design's unit goes, when the Studio next opens */
  | { step: "drop"; unitId: string };

export type Answer = { key: string; label: string; steps: Step[] };

const joined = (designId: string, u: DesignUnit, code: string | null): LineJoin => ({ design: designId, units: [u.id], model: u.model, code });

/** The line name a unit of the design goes on the quote as. */
export function unitLineName(u: DesignUnit): string {
  if (u.role === "odu") return `Outdoor unit, ${u.model}`;
  return u.rooms.length ? `Indoor unit, ${u.rooms.join(", ")}` : `Indoor unit, ${u.model}`;
}

/** A design system's units onto the quote, under `system`. */
const addAll = (designId: string, s: DesignSys, system: string): Step[] =>
  s.units.map((u) => ({ step: "add", system, unit: u, join: joined(designId, u, null) }));

/** Each answer a question has, with the steps it takes. */
export function answersOf(designId: string, q: JoinQuestion, book: Book): Answer[] {
  /* what the design takes is the book's model the code is */
  const modelOf = (l: UnitLine) => lineModel(book, l.code).model ?? l.code ?? "";
  if (q.kind === "same") {
    const lines = q.group.lines;
    if (q.system.units.length === 0) {
      /* the design names it and places nothing: it takes the quote's */
      return [
        {
          key: "yes",
          label: "Yes, the same system",
          steps: lines.map((l) => ({ step: "join", lineId: l.id, join: { design: designId, units: [], take: modelOf(l), system: q.system.id, room: roomWordsOf(l, q.group.byRoom), code: l.code } })),
        },
        { key: "no", label: "No, they're two systems", steps: lines.map((l) => ({ step: "join", lineId: l.id, join: { design: designId, units: [], only: true } })) },
      ];
    }
    const no: Answer = { key: "no", label: "No, they're two systems", steps: addAll(designId, q.system, q.system.name) };
    /* the quote names no model: nothing of its to keep, the design's priced in its place */
    if (lines.every((l) => !l.code)) {
      return [{ key: "yes", label: "Yes, the same system", steps: [...lines.map((l) => ({ step: "remove" as const, lineId: l.id })), ...addAll(designId, q.system, q.group.key || q.system.name)] }, no];
    }
    /* both have units: one system, and what differs is asked next */
    return [{ key: "yes", label: "Yes, the same system", steps: lines.map((l) => ({ step: "join" as const, lineId: l.id, join: { design: designId, units: [], system: q.system.id } })) }, no];
  }
  if (q.kind === "outdoor") {
    const out: Answer[] = [{ key: "design", label: `The design's ${q.design.model}`, steps: [{ step: "swap", lineId: q.line.id, model: q.design.model, join: joined(designId, q.design, null) }] }];
    if (q.quoteModel) {
      out.push({
        key: "quote",
        label: `The quote's ${q.line.code ?? q.quoteModel}`,
        steps: [{ step: "join", lineId: q.line.id, join: { design: designId, units: [q.design.id], model: q.design.model, code: q.line.code, take: q.quoteModel } }],
      });
    }
    return out;
  }
  if (q.kind === "heads") {
    const where = q.group.key || q.system.name;
    const unit = new Map(q.design.map((u) => [u.id, u]));
    const byLine = new Map<string, number[]>();
    q.quote.forEach((h, i) => byLine.set(h.lineId, [...(byLine.get(h.lineId) ?? []), i]));
    /* the design's: a line that's one unit and answers one of the design's
       takes its model; otherwise the line keeps the units that joined and the
       design's come on as lines of their own */
    const dSteps: Step[] = [];
    const swapped = new Set<string>();
    for (const [lineId, slots] of byLine) {
      const qty = q.qty[lineId] ?? slots.length;
      const kept = (q.joined[lineId] ?? []).length;
      const pair = slots.length === 1 ? q.pairs[slots[0]!] : undefined;
      if (kept === 0 && qty === 1 && pair) {
        dSteps.push({ step: "swap", lineId, model: unit.get(pair)!.model, join: joined(designId, unit.get(pair)!, null) });
        swapped.add(pair);
      } else if (qty - slots.length > 0) dSteps.push({ step: "qty", lineId, qty: qty - slots.length });
      else dSteps.push({ step: "remove", lineId });
    }
    for (const u of q.design) if (!swapped.has(u.id)) dSteps.push({ step: "add", system: where, unit: u, join: joined(designId, u, null) });
    const design: Answer = { key: "design", label: q.design.length ? `The design's ${countWord(q.design.length)}` : "Take them off the quote", steps: dSteps };
    if (!q.quoteCanGo) return [design];
    /* the quote's: each line waits for the design to have its model, on the
       units it answers and as many more as it counts; the design's others go */
    const paired = new Set(Object.values(q.pairs));
    const qSteps: Step[] = [];
    for (const [lineId, slots] of byLine) {
      const h = q.quote[slots[0]!]!;
      const units = [...(q.joined[lineId] ?? []), ...slots.flatMap((i) => (q.pairs[i] ? [q.pairs[i]!] : []))];
      qSteps.push({ step: "join", lineId, join: { design: designId, units, take: h.model ?? "", system: q.system.id, room: h.room, code: h.code } });
    }
    for (const u of q.design) if (!paired.has(u.id)) qSteps.push({ step: "drop", unitId: u.id });
    const quote: Answer = { key: "quote", label: q.quote.length ? `The quote's ${countWord(q.quote.length)}` : "Take them out of the design", steps: qSteps };
    return [design, quote];
  }
  if (q.kind === "quote-only") {
    const only: Answer = { key: "only", label: "Quote only", steps: q.group.lines.map((l) => ({ step: "join", lineId: l.id, join: { design: designId, units: [], only: true } })) };
    if (!q.canAdd) return [only];
    return [
      {
        key: "add",
        label: "Add to the design",
        steps: q.group.lines.map((l) => ({ step: "join", lineId: l.id, join: { design: designId, units: [], take: modelOf(l), system: `new:${q.group.key}`, room: roomWordsOf(l, q.group.byRoom), code: l.code } })),
      },
      only,
    ];
  }
  return [
    { key: "add", label: "Add to the quote", steps: addAll(designId, q.system, q.system.name) },
    { key: "leave", label: "Leave it off the quote", steps: [{ step: "leave-off", systemId: q.system.id }] },
  ];
}

const NUMBER_WORDS = ["none", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const countWord = (n: number) => NUMBER_WORDS[n] ?? String(n);

const unitWords = (u: { model: string | null; code?: string | null; rooms?: string[]; room?: string; role?: string | null }) => {
  const where = u.rooms?.length ? u.rooms.join(", ") : u.room || (u.role === "odu" ? "Outdoor" : "");
  const m = u.model ? shortModel(u.model) : u.code ? shortModel(u.code) : "no model";
  return where ? `${where} ${m}` : m;
};

const listWords = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/** A question as Tiff asks it: the question, and what each side has now
    as her card says it after "On the quote now:" (tiff-questions.tsx);
    `money` says what quote lines come to, where the person sees money. */
export function questionWords(q: JoinQuestion, money?: (lines: readonly UnitLine[]) => string | null): { ask: string; topic: string; put: string } {
  const priced = (ls: readonly UnitLine[]) => {
    const m = money?.(ls);
    return m ? `, ${m}` : "";
  };
  const quoteUnits = (ls: readonly UnitLine[]) => listWords(ls.map((l) => l.code ?? `${l.name}, no model`));
  const designUnits = (s: DesignSys) => (s.units.length ? listWords(s.units.map((u) => u.model)) : "no units placed");
  if (q.kind === "same") {
    return {
      ask: `Is the quote's ${q.group.name} the design's ${q.system.name}?`,
      topic: `${q.group.name} and the design's ${q.system.name}`,
      put: `${q.group.name}, ${quoteUnits(q.group.lines)}${priced(q.group.lines)}. In the design: ${q.system.name}, ${designUnits(q.system)}.`,
    };
  }
  if (q.kind === "outdoor") {
    return {
      ask: `${q.system.name}'s outdoor: the design's or the quote's?`,
      topic: `${q.system.name}'s outdoor`,
      put: `${q.line.code ?? "no model"}${priced([q.line])}. In the design: ${q.design.model}.`,
    };
  }
  if (q.kind === "heads") {
    const d = q.design.map((u) => unitWords(u));
    const qq = q.quote.map((h) => unitWords(h));
    return {
      ask: `${q.system.name}'s units: the design's ${countWord(d.length)} or the quote's ${countWord(qq.length)}?`,
      topic: `${q.system.name}'s units`,
      put: `${qq.length ? listWords(qq) : "none"}. In the design: ${d.length ? listWords(d) : "none"}.`,
    };
  }
  if (q.kind === "quote-only") {
    return { ask: `The quote's ${q.group.name} isn't in the design.`, topic: q.group.name, put: `${q.group.name}, ${quoteUnits(q.group.lines)}${priced(q.group.lines)}.` };
  }
  return { ask: `The design's ${q.system.name} isn't on the quote.`, topic: `The design's ${q.system.name}`, put: `nothing of it. In the design: ${q.system.name}, ${designUnits(q.system)}.` };
}

/** The Design row of Where it's up to: the same as the quote, or what's left. */
export function designRowOf(read: JoinRead | null): { words: string; tone: "good" | "due" } | null {
  if (!read) return null;
  const n = read.questions.length;
  if (n > 0) return { words: `${n} to join`, tone: "due" };
  if (read.waiting > 0) return { words: `${read.waiting} for the Studio`, tone: "due" };
  return { words: "Same as the quote", tone: "good" };
}

/** The steps a line's change takes when the Studio has taken what it waited
    for: the join settled on the units it became. */
export function settledJoin(designId: string, units: readonly DesignUnit[], code: string | null): LineJoin {
  return { design: designId, units: units.map((u) => u.id), model: units[0]?.model, code };
}

/* ── what the quote's page is given (design-units-server.ts) ── */

export type JoinAsk = {
  id: string;
  question: string;
  topic: string;
  put: string;
  answers: { label: string }[];
  /** what each answer does to the quote's price, ex GST; null without money */
  deltas: (number | null)[];
};

export type JoinView = {
  design: { id: string; name: string };
  option: number;
  /** the Design row of Where it's up to */
  row: { words: string; tone: "good" | "due" } | null;
  lines: Record<string, LineStand>;
  asks: JoinAsk[];
  waiting: number;
};
