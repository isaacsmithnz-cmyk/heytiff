/* WHAT THE DESIGN TAKES FROM THE QUOTE (one list of units, Isaac, 27
   November 2026: "Yes, build it" to
   https://claude.ai/artifact/1Dhn6R3di6pdBX9F3ah3Nk). Where a person said
   the quote's unit is the one (src/lib/quotes/design-units.ts), the line
   waits with the model the design is to take; the Studio, the design's only
   writer, takes it when it opens: a unit's model swapped, a head or an
   outdoor put on the system the quote's is, a system of its own for one the
   design hadn't got, and a unit a person said goes taken out. What can't be
   taken (no room on the plan for a head, a model the book hasn't got) waits.

   Pure. */

import type { DesignDocument } from "./document";
import type { DataPack } from "./packs/schema";
import type { RoomObj } from "./loads-room";
import { allocationsOf } from "./allocations";
import { addMultiHead, chooseOutdoor, removeAllocation, swapAllocation } from "./builder";
import { addQuotedOption, canAddQuoted, roomScore, type QuotedHead, type QuotedOption } from "./from-quote";

/** A unit line waiting for the design to take it. */
export type QuoteTake = {
  lineId: string;
  /** the book's model */
  take: string;
  /** the design's unit it is, where it's one already */
  units: string[];
  /** the design's system it goes on, or "new:<the quote's system>" */
  system: string | null;
  /** the quote's words for its room */
  room: string;
  /** how many the line counts: the units it is, and the heads to add for the rest */
  count?: number;
};

export type Took = { doc: DesignDocument; words: string[]; lineIds: string[]; dropped: string[] };
/* lineIds: the lines taken whole; a line taken in part is taken again on the
   next read only for what's still to add (design-units.ts counts it) */

const shortModel = (m: string) => /^[A-Z]+-(P\d+)/.exec(m)?.[1] ?? m;

/** The room on the plan the quote's words name, or null. */
function roomFor(doc: DesignDocument, said: string): RoomObj | null {
  let best: RoomObj | null = null;
  let score = 0;
  for (const o of doc.objects) {
    if (o.type !== "room") continue;
    const s = roomScore(String(o.props.name ?? ""), said);
    if (s > score) [best, score] = [o as RoomObj, s];
  }
  return best;
}

const systemOf = (doc: DesignDocument, unitId: string) => doc.systems.find((s) => allocationsOf(s).some((a) => a.id === unitId)) ?? null;

/** Everything waiting, taken where it can be. */
export function takeFromQuote(doc: DesignDocument, pack: DataPack, takes: readonly QuoteTake[], drop: readonly string[]): Took {
  const basis = doc.settings.sizingBasis;
  const isOdu = (m: string) => pack.outdoor_units.some((u) => u.model === m);
  const isIdu = (m: string) => pack.indoor_units.some((u) => u.model === m);
  let d = doc;
  const words: string[] = [];
  const lineIds: string[] = [];
  const dropped: string[] = [];

  for (const id of drop) {
    const sys = systemOf(d, id);
    if (!sys) continue;
    const a = allocationsOf(sys).find((x) => x.id === id)!;
    const room = a.roomId ? String(d.objects.find((o) => o.id === a.roomId)?.props.name ?? "") : "";
    d = removeAllocation(d, sys.id, id, pack);
    words.push(`${room || shortModel(a.model)} out`);
    dropped.push(id);
  }

  /* units the design has, another model; then, on a system the design has,
     as many more as the line counts: heads first, then an outdoor */
  const onto = takes.filter((x) => x.units.length > 0 || (x.system && !x.system.startsWith("new:")));
  for (const t of [...onto.filter((x) => !isOdu(x.take)), ...onto.filter((x) => isOdu(x.take))]) {
    let all = true;
    for (const id of t.units) {
      const sys = systemOf(d, id);
      const a = sys ? allocationsOf(sys).find((x) => x.id === id) : undefined;
      if (!sys || !a) {
        all = false;
        continue;
      }
      if (a.model === t.take) continue;
      if (a.role === "odu") {
        if (!isOdu(t.take)) {
          all = false;
          continue;
        }
        d = chooseOutdoor(d, pack, basis, sys.id, t.take);
      } else {
        const r = swapAllocation(d, pack, basis, sys.id, a.id, t.take);
        if (!r.ok) {
          all = false;
          continue;
        }
        d = r.doc;
      }
      const room = a.roomId ? String(d.objects.find((o) => o.id === a.roomId)?.props.name ?? "") : "";
      words.push(`${room || "Outdoor"} ${shortModel(t.take)}`);
    }
    const more = Math.max(0, (t.count ?? 1) - t.units.length);
    const sysId = t.system && !t.system.startsWith("new:") && d.systems.some((x) => x.id === t.system) ? t.system : null;
    for (let n = 0; n < more && all; n++) {
      if (!sysId) {
        all = false;
        break;
      }
      if (isIdu(t.take)) {
        const room = roomFor(d, t.room);
        if (!room) {
          all = false;
          break;
        }
        d = addMultiHead(d, pack, basis, { systemId: sysId, roomId: room.id, iduModel: t.take }).doc;
        words.push(`${String(room.props.name ?? "")} ${shortModel(t.take)}`);
      } else if (isOdu(t.take)) {
        d = chooseOutdoor(d, pack, basis, sysId, t.take);
        words.push(`Outdoor ${shortModel(t.take)}`);
      } else all = false;
    }
    if (all) lineIds.push(t.lineId);
  }

  /* a system of its own, made as the quote's option would be (from-quote.ts) */
  const fresh = new Map<string, QuoteTake[]>();
  for (const t of takes) if (t.units.length === 0 && t.system?.startsWith("new:")) fresh.set(t.system, [...(fresh.get(t.system) ?? []), t]);
  for (const [key, ts] of fresh) {
    const out = ts.find((t) => isOdu(t.take));
    const heads: QuotedHead[] = ts
      .filter((t) => isIdu(t.take))
      .map((t) => {
        const room = roomFor(d, t.room);
        return { room: t.room, code: t.take, model: t.take, roomId: room?.id ?? null, roomName: room ? String(room.props.name ?? "") : null };
      });
    const type = out ? pack.outdoor_units.find((u) => u.model === out.take)?.system_type : null;
    const option: QuotedOption = {
      index: 0,
      name: key.slice(4) || "From the quote",
      accepted: false,
      outdoor: out ? { code: out.take, model: out.take } : null,
      heads,
      kind: type === "multi" || heads.length > 1 ? "multi" : type === "split" ? "split" : null,
      materials: [],
    };
    if (!canAddQuoted(option) || heads.some((h) => !h.roomId)) continue;
    d = addQuotedOption(d, pack, basis, option).doc;
    words.push(option.name);
    lineIds.push(...ts.map((t) => t.lineId));
  }

  return { doc: d, words, lineIds, dropped };
}

/** The toast's words: what the design took. */
export function tookWords(t: Pick<Took, "words">): string {
  return `The design took the quote's: ${t.words.join(", ")}`;
}
