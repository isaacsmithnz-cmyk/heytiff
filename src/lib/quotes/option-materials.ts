import type { DataPack } from "@/lib/studio/packs/schema";
import type { CheckItem } from "./checklist";
import type { ProposalOption, UnitLine } from "./proposal";
import {
  KIT,
  kitRows,
  multiKitRows,
  sizeMulti,
  sizeRoom,
  withSwap,
  type IndoorStyle,
  type OutdoorAt,
  type PairOption,
  type ReadRoom,
} from "./brief-rooms";

/* EACH OPTION ITS OWN MATERIALS (Isaac, 2026-10-05: "each option should
   have its own materials list… essentially you're building two quotes on
   one page… you should not have to manually enter it in").

   An option's list is worked out from what the option puts in — its units,
   each indoor on its outdoor — and what the site checklist knows: where
   the outdoor goes, the pipe length, whether the pipe is reused, how the
   drain falls, a new circuit, an old system out. The kits are the Rooms
   engine's (brief-rooms.ts), the units Studio's data pack: one indoor on an
   outdoor is a split pair at the unit's size; several are a multi, the
   outdoor the one the combination table takes them on. What isn't known
   goes on asked, and the Price says so. Nothing is stored: change a unit
   or answer the checklist and the list follows. Pure. */

export type OptionRow = { name: string; sub: string; qty: string };

type Pack = DataPack;

/** "2.5 kW", "6kw", "7.1" → kW; null when no size is written. */
export function kwOf(capacity: string): number | null {
  const m = /(\d+(?:\.\d+)?)\s*k?w?/i.exec(capacity);
  const n = m ? Number(m[1]) : NaN;
  return Number.isFinite(n) && n > 0 && n <= 60 ? n : null;
}

/** The indoor style a unit's type names. */
export function styleOf(type: string): IndoorStyle | null {
  const t = type.toLowerCase();
  if (/wall/.test(t)) return "wall";
  if (/duct/.test(t)) return "ducted";
  if (/cassette/.test(t)) return "cassette";
  if (/floor|console/.test(t)) return "floor";
  if (/bulkhead/.test(t)) return "bulkhead";
  if (/under.?ceiling|ceiling.?suspend/.test(t)) return "under-ceiling";
  return null;
}

/* ── what the site checklist knows ── */

export type SiteFacts = {
  outdoorAt: OutdoorAt | null;
  runM: number | null;
  keepPipe: boolean;
  pump: boolean;
  newCircuit: boolean;
  replacing: boolean;
};

const known = (checklist: readonly CheckItem[], key: CheckItem["key"]) => {
  const i = checklist.find((c) => c.key === key);
  return i && i.state === "known" ? i.answer.trim() : "";
};

export function siteFacts(checklist: readonly CheckItem[]): SiteFacts {
  const where = known(checklist, "outdoor_location").toLowerCase();
  const run = /(\d+(?:\.\d+)?)/.exec(known(checklist, "pipe_length"));
  const runM = run ? Number(run[1]) : NaN;
  return {
    outdoorAt: /roof/.test(where)
      ? "roof"
      : /bracket|wall/.test(where)
        ? "wall"
        : /ground|pad|slab|balcony|floor|under the house/.test(where)
          ? "ground"
          : null,
    runM: Number.isFinite(runM) && runM > 0 && runM <= 100 ? runM : null,
    keepPipe: /reuse|existing|keep/i.test(known(checklist, "pipe_reuse")),
    pump: /pump/i.test(known(checklist, "drain_fall")),
    newCircuit: /new/i.test(known(checklist, "power_supply")),
    replacing: /remove|dispose|replace|out\b/i.test(known(checklist, "old_system")),
  };
}

/* ── the units, system by system ── */

const norm = (m: string) => m.toUpperCase().replace(/[^A-Z0-9]/g, "");
/** A model as written names a pack model when one starts with the other:
    "MSZ-AP25VGD2" and "MSZ-AP25VG". */
const sameModel = (written: string, pack: string) => {
  const a = norm(written);
  const b = norm(pack);
  return a.length >= 6 && (a.startsWith(b) || b.startsWith(a));
};

const roomOf = (u: UnitLine, n: number, of: number): string => {
  const name = u.room.trim() || "Room";
  return of > 1 ? `${name} ${n}` : name;
};

const readRoom = (name: string, kw: number | null, style: IndoorStyle | null, f: SiteFacts, runM: number | null): ReadRoom => ({
  name,
  said: "",
  areaM2: null,
  sidesM: null,
  unitKw: kw,
  ceilingM: null,
  glazing: null,
  insulation: null,
  facing: null,
  roomAbove: null,
  style,
  runM,
  runSaid: null,
  outdoorAt: f.outdoorAt,
  outdoorSaid: null,
  drain: f.pump ? "pump" : null,
  drainSaid: null,
  newCircuit: f.newCircuit ? true : null,
  circuitSaid: null,
});

/** One option's materials, from its units and the site checklist. */
export function optionMaterials(option: Pick<ProposalOption, "name" | "units">, checklist: readonly CheckItem[], pack: Pack | null): OptionRow[] {
  const f = siteFacts(checklist);
  const rows: OptionRow[] = [];
  const outdoors = option.units.filter((u) => u.role === "outdoor");
  const indoors = option.units.filter((u) => u.role === "indoor");
  /* a single outdoor carries every indoor that names none */
  const onSystem = (n: number) => indoors.filter((u) => u.system === n || (outdoors.length === 1 && !outdoors.some((o) => o.system === u.system)));

  const systems = outdoors.length ? outdoors : indoors.length ? [null] : [];
  for (const o of systems) {
    const heads = o ? onSystem(o.system) : indoors;
    /* each head of a kind, one by one: "2 × 2.5 kW, Bedrooms" is two rooms */
    const expanded = heads.flatMap((u) => Array.from({ length: Math.max(1, u.qty) }, (_, i) => ({ u, name: roomOf(u, i + 1, Math.max(1, u.qty)) })));
    if (expanded.length === 0) {
      if (o) rows.push({ name: o.model || `${o.capacity} outdoor unit`.trim(), sub: `Outdoor unit, ${o.room || option.name}`, qty: String(Math.max(1, o.qty)) });
      continue;
    }
    const sized = pack
      ? expanded.map(({ u, name }) => sizeRoom(readRoom(name, kwOf(u.capacity), styleOf(u.type), f, expanded.length === 1 ? f.runM : null), 0, "residential", pack))
      : [];

    /* one head on its outdoor: a split pair, the models written when the pack has that pair */
    if (expanded.length === 1) {
      const head = expanded[0]!.u;
      const room = sized[0];
      const pick: PairOption | undefined = room
        ? (room.options.find((p) => (!head.model || sameModel(head.model, p.indoor)) && (!o?.model || sameModel(o.model, p.outdoor))) ?? (head.model || o?.model ? undefined : room.options[0]))
        : undefined;
      if (room && pick) {
        const kit = kitRows(room, pick, { runM: f.runM, outdoorAt: f.outdoorAt });
        rows.push(...withSwap(kit, { replacing: f.replacing, keepPipe: f.keepPipe }, room.name));
        continue;
      }
      rows.push(...unpacked(head, o, expanded[0]!.name, f));
      continue;
    }

    /* several heads on one outdoor: a multi, by the combination table */
    const multi = pack && sized.length === expanded.length ? sizeMulti(sized, pack) : null;
    if (multi?.ok) {
      const kit = multiKitRows(multi.multi, sized, { runs: Object.fromEntries(sized.map((r) => [r.name, null])), outdoorAt: f.outdoorAt });
      rows.push(...withSwap(kit, { replacing: f.replacing, keepPipe: f.keepPipe }, "the multi"));
      continue;
    }
    if (o) rows.push({ name: o.model || `${o.capacity} outdoor unit`.trim(), sub: `Outdoor unit, ${multi && !multi.ok ? multi.why : "no data pack for it"}`, qty: "1" });
    for (const { u, name } of expanded) rows.push({ name: u.model || `${u.capacity} ${u.type}`.trim(), sub: `Indoor unit, ${name}`, qty: "1" });
  }

  for (const fan of option.units.filter((u) => u.role === "fan")) {
    rows.push({ name: fan.model || fan.type || "Fan", sub: `Fan, ${fan.room || option.name}`, qty: String(Math.max(1, fan.qty)) });
  }
  return rows;
}

/** A unit the data pack doesn't hold (another maker's, or a size it has
    no pair at): its units as written and the kit that doesn't need the
    pack, the rest asked. */
function unpacked(head: UnitLine, o: UnitLine | null, room: string, f: SiteFacts): OptionRow[] {
  const run = f.runM != null ? `${f.runM} m` : "Run to ask";
  const rows: OptionRow[] = [
    { name: head.model || `${head.capacity} ${head.type}`.trim(), sub: `Indoor unit, ${room}`, qty: "1" },
    ...(o ? [{ name: o.model || `${o.capacity} outdoor unit`.trim(), sub: `Outdoor unit, ${room}`, qty: "1" }] : []),
    { name: "Pair coil", sub: `the unit's sizes, ${room}`, qty: f.keepPipe ? "0" : run },
    f.outdoorAt ? { name: { ground: KIT.groundMount, wall: KIT.wallBracket, roof: KIT.roofStand }[f.outdoorAt], sub: room, qty: "1" } : { name: KIT.mount, sub: room, qty: "Where it sits: ask" },
    { name: KIT.isolator, sub: room, qty: "1" },
    { name: KIT.drainHose, sub: `along the run, ${room}`, qty: run },
    ...(f.pump ? [{ name: KIT.pump, sub: room, qty: "1" }] : []),
    { name: KIT.consumables, sub: `a head, ${room}`, qty: "1" },
    ...(f.newCircuit ? [{ name: KIT.newCircuit, sub: room, qty: "1" }] : []),
  ].filter((r) => r.qty !== "0");
  return withSwap(rows, { replacing: f.replacing, keepPipe: f.keepPipe }, room);
}
