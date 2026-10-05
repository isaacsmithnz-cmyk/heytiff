import type { DataPack } from "@/lib/studio/packs/schema";
import { formFactorLabel } from "@/lib/studio/form-factors";
import { isBoxHead } from "@/lib/studio/multi";
import { isVrfHead, joinsVrf, vrfOutdoorsListing } from "@/lib/studio/vrf";
import { provisionalVrfTree, sizeVrfTree } from "@/lib/studio/vrf-tree";
import { KIT, RUN_TO_ASK, STYLE_OF, WHERE_TO_ASK, type OutdoorAt, type SizedRoom } from "./brief-rooms";

/* THE ROOMS ON A VRF OR PUMY — switched on in the Rooms block (Isaac,
   2026-10-04: the install kits, "VRF / PUMY: already built (#997), waiting
   to be switched on").

   Sized from the shared data pack exactly as Studio sizes one: each room's
   head the smallest of its style that joins a VRF (City Multi heads on
   joints, the others on the outdoor's branch boxes) and covers its load; the
   outdoor the smallest the pack lists for those heads and their loads
   together (vrfOutdoorsListing); the pipe tree, its sizes, joints and branch
   boxes from Studio's own sizer (vrf-tree), so a quote and a design never
   disagree. The business's own items price it. Pure. */

export type VrfHead = { room: string; indoor: string; style: string; coolKw: number; heatKw: number };

export type VrfOption = {
  outdoor: string;
  coolKw: number;
  heatKw: number;
  outdoorWidthMm: number | null;
  outdoorWeightKg: number | null;
  outdoorAmps: number | null;
  heads: VrfHead[];
  /** the joints and branch boxes Studio's sizer chose: a part, or none */
  fittings: { kind: "joint" | "header" | "box"; part: string | null; branches: number }[];
  /** each section of pipe at its size: a head's own (its room), or the main
      and the runs between fittings (room null) */
  sections: { liquidMm: number; gasMm: number; role: "main" | "between" | "branch" | "box"; room: string | null }[];
};

export type VrfProposal = { ok: true; vrf: VrfOption } | { ok: false; why: string };

/** How a VRF's heads connect: every head on the outdoor's branch boxes, or
    every head a City Multi head on joints — never a mix. */
export type VrfMethod = "box" | "joint";
export const VRF_METHOD_WORDS: Record<VrfMethod, string> = { box: "on branch boxes", joint: "City Multi heads on joints" };

export function sizeVrf(rooms: readonly SizedRoom[], pack: DataPack, method: VrfMethod): VrfProposal | null {
  if (rooms.length < 2) return null;
  const heads: { room: SizedRoom; idu: DataPack["indoor_units"][number] }[] = [];
  const joins = (u: DataPack["indoor_units"][number]) =>
    method === "joint" ? isVrfHead(pack, u) : joinsVrf(pack, u) && !isVrfHead(pack, u) && isBoxHead(pack, null, u);
  for (const r of rooms) {
    const idu = pack.indoor_units
      .filter((u) => joins(u) && STYLE_OF[u.form_factor] === r.style)
      .filter((u) => Math.min(u.capacity_cool_kw, u.capacity_heat_kw) >= r.loadKw)
      .sort((a, b) => a.capacity_cool_kw - b.capacity_cool_kw || a.model.localeCompare(b.model))[0];
    if (!idu) return { ok: false, why: `No head ${VRF_METHOD_WORDS[method]} of that style in the data pack covers ${r.name}'s ${r.loadKw} kW` };
    heads.push({ room: r, idu });
  }
  const load = rooms.reduce((n, r) => n + r.loadKw, 0);
  const odu = vrfOutdoorsListing(pack, heads.map((h) => h.idu), { load: { kw: load, basis: "worst-of-both" } })[0];
  if (!odu) return { ok: false, why: `No VRF outdoor in the data pack takes these heads ${VRF_METHOD_WORDS[method]} together` };
  return { ok: true, vrf: vrfOptionOf(pack, odu, heads.map((h) => ({ room: h.room.name, idu: h.idu }))) };
}

/** A VRF on a known outdoor and heads: its pipe tree, joints and branch
    boxes from Studio's own sizer. */
export function vrfOptionOf(
  pack: DataPack,
  odu: DataPack["outdoor_units"][number],
  heads: readonly { room: string; idu: DataPack["indoor_units"][number] }[]
): VrfOption {
  /* the tree, as Studio sizes it: City Multi heads on joints, the others on
     the outdoor's branch boxes */
  const ids = heads.map((h, i) => ({ id: `h:${i + 1}`, model: h.idu.model, room: h.room }));
  const boxed = new Set(ids.filter((_, i) => !isVrfHead(pack, heads[i]!.idu) && isBoxHead(pack, odu, heads[i]!.idu)).map((h) => h.id));
  const ports = Math.max(1, ...pack.parts.filter((p) => p.part_type === "branch-box").map((p) => p.ports ?? 0));
  const sized = sizeVrfTree(pack, odu, provisionalVrfTree("odu", ids, boxed, ports));
  return {
    outdoor: odu.model,
    coolKw: odu.capacity_cool_kw,
    heatKw: odu.capacity_heat_kw,
    outdoorWidthMm: odu.width_mm ?? null,
    outdoorWeightKg: odu.weight_kg ?? null,
    outdoorAmps: odu.max_amps_a ?? null,
    heads: heads.map(({ room, idu }) => ({
      room,
      indoor: idu.model,
      style: formFactorLabel(idu.form_factor) ?? "Indoor",
      coolKw: idu.capacity_cool_kw,
      heatKw: idu.capacity_heat_kw,
    })),
    fittings: sized.fittings.map((f) => ({ kind: f.kind, part: f.part, branches: f.branches })),
    sections: sized.sections.map((x) => ({ liquidMm: x.liquidMm, gasMm: x.gasMm, role: x.role, room: ids.find((h) => h.id === x.to)?.room ?? null })),
  };
}

/* the pair coil sizes a business can buy as coil; anything bigger is copper
   in straight lengths, from its range */
const COIL_SIZES = new Set(["6.35+9.52", "6.35+12.7", "6.35+15.88", "9.52+15.88", "9.52+19.05"]);

/** A VRF's kit: the outdoor once with its mount, isolator and a circuit when
    the brief says; each head; each joint and branch box the sizer chose; each
    section of pipe at its size — a head's own run from its room, the main and
    the runs between fittings asked; each head's drain and consumables, and a
    pump where its room can't drain. */
export function vrfKitRows(
  v: VrfOption,
  rooms: readonly Pick<SizedRoom, "name" | "drain" | "newCircuit">[],
  c: { runs: Record<string, number | null>; outdoorAt: OutdoorAt | null }
): { name: string; sub: string; qty: string }[] {
  const sys = "the VRF";
  const size = [v.outdoorWidthMm != null ? `${v.outdoorWidthMm} mm` : null, v.outdoorWeightKg != null ? `${v.outdoorWeightKg} kg` : null].filter(Boolean).join(", ");
  const mount = c.outdoorAt ? ({ ground: KIT.groundMount, wall: KIT.wallBracket, roof: KIT.roofStand } as const)[c.outdoorAt] : null;
  const rows = [
    { name: v.outdoor, sub: `VRF outdoor unit, ${v.heads.length} heads`, qty: "1" },
    mount ? { name: mount, sub: `${size ? `for the outdoor's ${size}, ` : ""}${sys}`, qty: "1" } : { name: KIT.mount, sub: sys, qty: WHERE_TO_ASK },
    { name: KIT.isolator, sub: `${v.outdoorAmps != null ? `for the outdoor's ${v.outdoorAmps} A, ` : ""}${sys}`, qty: "1" },
  ];
  if (rooms.some((r) => r.newCircuit)) rows.push({ name: KIT.newCircuit, sub: sys, qty: "1" });
  for (const h of v.heads) rows.push({ name: h.indoor, sub: `${h.style} indoor unit, ${h.room}`, qty: "1" });
  for (const f of v.fittings) {
    rows.push(
      f.part
        ? { name: f.part, sub: f.kind === "box" ? `branch box, ${f.branches} heads` : `${f.kind}, ${sys}`, qty: "1" }
        : { name: f.kind === "box" ? "Branch box" : "Refrigerant joint", sub: `the data pack has none for this point, ${sys}`, qty: "Size to ask" }
    );
  }
  for (const s of v.sections) {
    const runM = s.room ? (c.runs[s.room] ?? null) : null;
    const where = s.room ?? (s.role === "main" ? "main line, outdoor to the first fitting" : "between fittings");
    const coil = COIL_SIZES.has(`${s.liquidMm}+${s.gasMm}`);
    rows.push({
      name: coil ? `ø${s.liquidMm} / ø${s.gasMm} pair coil` : `ø${s.liquidMm} / ø${s.gasMm} copper`,
      sub: `${coil ? "liquid / gas mm" : "straight lengths"}, ${where}`,
      qty: runM != null ? `${runM} m` : RUN_TO_ASK,
    });
  }
  for (const h of v.heads) {
    const room = rooms.find((r) => r.name === h.room);
    const runM = c.runs[h.room] ?? null;
    rows.push({ name: KIT.drainHose, sub: `along the run, ${h.room}`, qty: runM != null ? `${runM} m` : RUN_TO_ASK });
    if (room?.drain === "pump") rows.push({ name: KIT.pump, sub: `it can't drain by gravity, ${h.room}`, qty: "1" });
    rows.push({ name: KIT.consumables, sub: `a head, ${h.room}`, qty: "1" });
  }
  return rows;
}
