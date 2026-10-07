import type { DataPack } from "@/lib/studio/packs/schema";
import type { CheckItem } from "./checklist";
import type { ProposalOption, UnitLine } from "./proposal";
import { isBoxHead } from "@/lib/studio/multi";
import { isVrfHead, joinsVrf, vrfOutdoorsListing } from "@/lib/studio/vrf";
import { vrfKitRows, vrfOptionOf } from "./brief-vrf";
import {
  KIT,
  kitRows,
  multiKitRows,
  nearestKw,
  sizeMulti,
  sizeRoom,
  STYLE_OF,
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

export type OptionRow = {
  name: string;
  sub: string;
  qty: string;
  /** the system a unit is part of, so its indoor and outdoor are priced
      from one supplier (job-price.ts) */
  system?: number;
};

/** A system's rows, its units marked as that system's. */
const ofSystem = (rows: readonly OptionRow[], n: number): OptionRow[] =>
  rows.map((r) => (/\b(indoor|outdoor) unit\b/i.test(r.sub) ? { ...r, system: n } : r));

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

/** What an outdoor sits on, from words. */
const mountIn = (where: string): OutdoorAt | null =>
  /roof/.test(where)
    ? "roof"
    : /bracket|wall/.test(where)
      ? "wall"
      : /ground|pad|slab|balcony|floor|under the house|garage|plant room|basement|car ?park/.test(where)
        ? "ground"
        : null;

export function siteFacts(checklist: readonly CheckItem[]): SiteFacts {
  /* where the unit itself sits: the first clause first ("Garage, ducted to
     roof garden" is the garage, not the roof), else the whole answer ("Side
     of the house, on wall brackets") */
  const answer = known(checklist, "outdoor_location").toLowerCase();
  const run = /(\d+(?:\.\d+)?)/.exec(known(checklist, "pipe_length"));
  const runM = run ? Number(run[1]) : NaN;
  return {
    outdoorAt: mountIn(answer.split(/[,;(]/)[0] ?? "") ?? mountIn(answer),
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

/** A model's body, its maker's suffix (-A, -E, -E4, -L) taken off: the
    office writes PEFY-P25VMX-A where the data pack holds PEFY-P25VMX-E. */
const body = (m: string) => {
  let x = m.toUpperCase().trim();
  for (let y = x.replace(/-[A-Z0-9]{1,2}$/, ""); y !== x; y = x.replace(/-[A-Z0-9]{1,2}$/, "")) x = y;
  return norm(x);
};
/** The same unit, by its model or its body. */
export const sameUnit = (written: string, pack: string) => sameModel(written, pack) || (body(written).length >= 6 && body(written) === body(pack));

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

  /** One system's rows: a split pair's kit, a multi's, or its units as written. */
  const systemRows = (o: UnitLine | null): OptionRow[] => {
    const rows: OptionRow[] = [];
    const heads = o ? onSystem(o.system) : indoors;
    /* each head of a kind, one by one: "2 × 2.5 kW, Bedrooms" is two rooms */
    const expanded = heads.flatMap((u) => Array.from({ length: Math.max(1, u.qty) }, (_, i) => ({ u, name: roomOf(u, i + 1, Math.max(1, u.qty)) })));
    if (expanded.length === 0) {
      if (o) rows.push({ name: o.model || `${o.capacity} outdoor unit`.trim(), sub: `Outdoor unit, ${o.room || option.name}`, qty: String(Math.max(1, o.qty)) });
      return rows;
    }
    /* a VRF or PUMY, named by its outdoor or its heads: Studio's tree */
    const vrf = pack ? vrfRows(o, expanded, f, pack) : null;
    if (vrf) return vrf;

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
        return rows;
      }
      rows.push(...unpacked(head, o, expanded[0]!.name, f));
      return rows;
    }

    /* several heads on one outdoor: a multi, by the combination table */
    const multi = pack && sized.length === expanded.length ? sizeMulti(sized, pack) : null;
    if (multi?.ok) {
      const kit = multiKitRows(multi.multi, sized, { runs: Object.fromEntries(sized.map((r) => [r.name, null])), outdoorAt: f.outdoorAt });
      rows.push(...withSwap(kit, { replacing: f.replacing, keepPipe: f.keepPipe }, "the multi"));
      return rows;
    }
    if (o) rows.push({ name: o.model || `${o.capacity} outdoor unit`.trim(), sub: `Outdoor unit, ${multi && !multi.ok ? multi.why : "no data pack for it"}`, qty: "1" });
    for (const { u, name } of expanded) rows.push({ name: u.model || `${u.capacity} ${u.type}`.trim(), sub: `Indoor unit, ${name}`, qty: "1" });
    return rows;
  };

  /* system by system, each one's units marked as its own */
  const systems = outdoors.length ? outdoors : indoors.length ? [null] : [];
  for (const [n, o] of systems.entries()) rows.push(...ofSystem(systemRows(o), n + 1));

  for (const fan of option.units.filter((u) => u.role === "fan")) {
    rows.push({ name: fan.model || fan.type || "Fan", sub: `Fan, ${fan.room || option.name}`, qty: String(Math.max(1, fan.qty)) });
  }
  return rows;
}

/** A VRF or PUMY's rows (Isaac's 2905: a PUMY-P200 and six PEFY heads got no
    kit): the outdoor the office wrote, or the one the pack lists for the
    heads; each head as written, matched to the pack's unit by its model or
    its body, else the pack's nearest of its style to its size; then the pipe
    tree, joints and branch boxes from Studio's own sizer, and the VRF kit.
    Null when the system isn't a VRF. */
function vrfRows(o: UnitLine | null, expanded: readonly { u: UnitLine; name: string }[], f: SiteFacts, pack: Pack): OptionRow[] | null {
  const odu = o?.model ? pack.outdoor_units.find((u) => u.system_type === "vrf" && sameUnit(o.model, u.model)) : undefined;
  const written = expanded.map(({ u }) => (u.model ? pack.indoor_units.find((p) => joinsVrf(pack, p) && sameUnit(u.model, p.model)) : undefined));
  if (!odu && !written.some((p) => p && isVrfHead(pack, p))) return null;

  /* the rows when it can't be sized: the units as written, why, and the kit asked */
  const asWritten = (why: string): OptionRow[] => [
    o
      ? { name: o.model || `${o.capacity} outdoor unit`.trim(), sub: `VRF outdoor unit, ${why}`, qty: "1" }
      : { name: "VRF outdoor unit", sub: why, qty: "Size to ask" },
    ...expanded.map(({ u, name }) => ({ name: u.model || `${u.capacity} ${u.type}`.trim(), sub: `Indoor unit, ${name}`, qty: "1" })),
    { name: "VRF pipe, joints and kit", sub: "sized once the units are", qty: "Size to ask" },
  ];
  /* a model written for the outdoor that isn't a VRF in the pack is never
     sized as another unit under its name */
  if (o?.model && !odu) return asWritten(`${o.model} isn't a VRF outdoor in the data pack`);

  /* heads the outdoor takes: City Multi heads on joints first, then its own
     branch boxes' heads (a PUHY takes no branch boxes) */
  const takes = (p: Pack["indoor_units"][number]) => isVrfHead(pack, p) || (odu ? !!odu.branch_boxes && isBoxHead(pack, odu, p) : joinsVrf(pack, p));
  const heads: { room: string; idu: Pack["indoor_units"][number] }[] = [];
  const unsized: string[] = [];
  expanded.forEach(({ u, name }, i) => {
    const kw = kwOf(u.capacity);
    const style = styleOf(u.type) ?? "wall";
    const pool = pack.indoor_units.filter((p) => takes(p) && STYLE_OF[p.form_factor] === style);
    const at = kw != null ? nearestKw(pool.map((p) => p.capacity_cool_kw), kw) : undefined;
    const idu =
      (written[i] && takes(written[i]!) ? written[i] : undefined) ??
      pool
        .filter((p) => p.capacity_cool_kw === at)
        .sort((a, b) => Number(isVrfHead(pack, b)) - Number(isVrfHead(pack, a)) || a.model.localeCompare(b.model))[0];
    if (idu) heads.push({ room: name, idu });
    else unsized.push(name);
  });
  const load = heads.reduce((n, h) => n + h.idu.capacity_cool_kw, 0);
  const outdoor = odu ?? vrfOutdoorsListing(pack, heads.map((h) => h.idu), { load: { kw: load, basis: "worst-of-both" } })[0];
  if (unsized.length) return asWritten(`no VRF head in the data pack this outdoor takes for ${unsized.join(", ")}`);
  if (!outdoor) return asWritten("no VRF outdoor in the data pack takes these heads");
  /* rows named by the pack's units, so the confirmed order codes price them
     (Quoting's Equipment pack links); the office's -A beside a pack's -E is
     confirmed there once */
  const v = vrfOptionOf(pack, outdoor, heads);
  const rooms = expanded.map(({ name }) => ({ name, drain: f.pump ? ("pump" as const) : null, newCircuit: f.newCircuit ? true : null }));
  const kit = vrfKitRows(v, rooms, { runs: {}, outdoorAt: f.outdoorAt });
  /* reused pipe: every section stays, the copper main included */
  const piped = f.keepPipe ? kit.filter((r) => !/copper$/.test(r.name)) : kit;
  return withSwap(piped, { replacing: f.replacing, keepPipe: f.keepPipe }, "the VRF");
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
