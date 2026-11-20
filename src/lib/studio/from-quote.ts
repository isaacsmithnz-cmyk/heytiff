/* FROM THE QUOTE (Isaac, 17 November 2026: "i want to draw up a system in
   design from an accepted quote, is there a feature to suggest units you
   quoted to appear? its for normans in waitara", then the mock
   https://claude.ai/artifact/Vx4V9fQPq3VRYwej49aico, picked to build).

   A design on a job whose quote names its units offers each option's units
   in the Systems panel: the outdoor, and each head against the room on the
   plan its line names ("Indoor unit, Living" is on the Living line). Add to
   design makes the system the builder would, a split for one head, a multi
   for more, the outdoor the quote's. The units then wait to be placed.

   The quote's codes are the supplier's (MSZ-AP50VGKD2-A2); the pack's are
   the book's (MSZ-AP50VGD2): a code is the model whose capacity part it
   shares and whose letters it carries in order, the longest such.

   Pure. */

import type { DesignDocument } from "./document";
import type { RoomObj } from "./loads-room";
import type { DataPack } from "./packs/schema";
import type { SizingBasis } from "./loads";
import { addMultiHead, addSplit, chooseOutdoor } from "./builder";
import { answerFromQuote, type QuotedMaterial } from "./install-from-quote";

/** A quote's unit line, as quote_lines keeps it. */
export type QuotedLine = { optionIndex: number; system: string; name: string; code: string | null; kind: string; qty: number };

export type QuotedHead = {
  /** the quote's words for where it goes: "Living" */
  room: string;
  code: string;
  /** the pack's model, null when the book has none like it */
  model: string | null;
  /** the room on the plan it serves, null when none matches */
  roomId: string | null;
  roomName: string | null;
};

export type QuotedOption = {
  index: number;
  name: string;
  accepted: boolean;
  outdoor: { code: string; model: string | null } | null;
  heads: QuotedHead[];
  /** "Mitsubishi Electric multi" */
  kind: "split" | "multi" | null;
  /** the option's material lines, by their words: Install details' answers */
  materials: QuotedMaterial[];
};

const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

/** The book's model for a supplier's code, or null. */
export function modelForCode(models: readonly string[], code: string): string | null {
  const c = norm(code);
  let best: string | null = null;
  for (const m of models) {
    const n = norm(m);
    /* the family and capacity, up to the last digit of its first run of digits */
    const head = /^[A-Z]*\d+/.exec(n)?.[0];
    if (!head || !c.startsWith(head)) continue;
    let i = head.length;
    for (const ch of n.slice(head.length)) {
      i = c.indexOf(ch, i);
      if (i < 0) break;
      i += 1;
    }
    if (i < 0) continue;
    if (!best || n.length > norm(best).length) best = m;
  }
  return best;
}

const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

/** How well a room's name answers the quote's words for it: 0 not at all. */
function roomScore(roomName: string, said: string): number {
  const r = norm(roomName);
  const q = norm(said);
  if (!q) return 0;
  if (r === q) return 100;
  if (r.startsWith(q)) return 50;
  const rw = words(roomName);
  /* "Master bed" against "MASTER BEDROOM"; never a robe of a bedroom */
  if (rw.some((w) => w === "robe" || w === "wir" || w === "ensuite") && !words(said).some((w) => rw.includes(w) && (w === "robe" || w === "ensuite"))) return 0;
  return words(said).every((w) => rw.some((x) => x === w || x.startsWith(w))) ? 20 : 0;
}

/** Each option on the quote with its units, its heads matched to the plan's rooms. */
export function quotedOptions(
  doc: DesignDocument,
  pack: DataPack,
  lines: readonly QuotedLine[],
  accepted: readonly number[],
  names: Readonly<Record<number, string>> = {}
): QuotedOption[] {
  const units = lines.filter((l) => l.kind === "unit" && l.code);
  const idus = pack.indoor_units.map((u) => u.model);
  const odus = pack.outdoor_units.map((u) => u.model);
  const rooms = doc.objects.filter((o): o is RoomObj => o.type === "room");
  const indexes = [...new Set(units.map((l) => l.optionIndex))].sort((a, b) => a - b);
  return indexes.map((index) => {
    const mine = units.filter((l) => l.optionIndex === index);
    let outdoor: QuotedOption["outdoor"] = null;
    const heads: QuotedHead[] = [];
    const taken = new Set<string>();
    for (const l of mine) {
      const code = l.code!;
      const odu = modelForCode(odus, code);
      if (odu && !outdoor) {
        outdoor = { code, model: odu };
        continue;
      }
      const said = l.system || l.name.replace(/^indoor unit,?\s*/i, "");
      for (let n = 0; n < Math.max(1, Math.round(l.qty)); n++) {
        let room: RoomObj | null = null;
        let score = 0;
        for (const r of rooms) {
          if (taken.has(r.id)) continue;
          const s = roomScore(String(r.props.name ?? ""), said);
          if (s > score) [room, score] = [r, s];
        }
        if (room) taken.add(room.id);
        heads.push({ room: said, code, model: modelForCode(idus, code), roomId: room?.id ?? null, roomName: room ? String(room.props.name ?? "") : null });
      }
    }
    const type = outdoor?.model ? pack.outdoor_units.find((u) => u.model === outdoor!.model)?.system_type : null;
    const kind = type === "multi" || heads.length > 1 ? "multi" : type === "split" ? "split" : null;
    const materials = lines.filter((l) => l.kind === "material" && l.optionIndex === index).map((l) => ({ name: l.name, qty: l.qty }));
    return { index, name: names[index] || `Option ${index + 1}`, accepted: accepted.includes(index), outdoor, heads, kind, materials };
  });
}

/** Can this option be made: an outdoor the book has, and a head with a model and a room. */
export const canAddQuoted = (o: QuotedOption): boolean =>
  !!o.outdoor?.model && o.kind != null && o.heads.some((h) => h.model && h.roomId);

/** an option's name as a system's: its heading, the words before a colon
    ("Mitsubishi Electric multi 8 kW: 5 kW living, 2.5 kW each bedroom" is
    "Mitsubishi Electric multi 8 kW"), so the column's title and rows hold it
    (the live walk, 21 November 2026) */
export function systemNameOf(optionName: string): string {
  const head = optionName.split(":")[0].trim();
  return head || optionName.trim();
}

/** The option as a system: a split for one head, a multi for more, named
    as the quote heads it. Heads with no room or no model are left off. */
export function addQuotedOption(doc: DesignDocument, pack: DataPack, basis: SizingBasis, o: QuotedOption): { doc: DesignDocument; systemId: string | null } {
  if (!canAddQuoted(o)) return { doc, systemId: null };
  const heads = o.heads.filter((h) => h.model && h.roomId);
  let d = doc;
  let systemId: string | null = null;
  if (o.kind === "split" && heads.length === 1) {
    const out = addSplit(d, pack, { roomId: heads[0].roomId!, iduModel: heads[0].model!, oduModel: o.outdoor!.model! });
    d = out.doc;
    systemId = out.systemId;
  } else {
    for (const h of heads) {
      const out = addMultiHead(d, pack, basis, { systemId, roomId: h.roomId!, iduModel: h.model! });
      d = out.doc;
      systemId = out.systemId;
    }
    d = chooseOutdoor(d, pack, basis, systemId!, o.outdoor!.model!);
  }
  d = { ...d, systems: d.systems.map((s) => (s.id === systemId ? { ...s, name: systemNameOf(o.name) } : s)) };
  /* what the quote says of how it goes in, answered (install-from-quote.ts) */
  if (systemId && o.materials?.length) d = answerFromQuote(d, systemId, o.materials);
  return { doc: d, systemId };
}
