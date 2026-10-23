import type { DataPack, IndoorUnit } from "@/lib/studio/packs/schema";
import { provisionalVrfTree, sizeVrfTree, type VrfTreeSection } from "@/lib/studio/vrf-tree";
import { isVrfHead } from "@/lib/studio/vrf";
import { linkedModel, sameUnit, type ConfirmedLink } from "./lookups";

/* A VRF'S RUN, BY ITS MAKER'S TABLE, FOR A KIT (Isaac, 2026-10-24: "ok" to
   the VRF kit; the 21 October bench: on a PUMY job she searched the book in
   eight of her fifteen rounds, over 30 searches, part by part).

   The Studio's own sizing (vrf-tree.ts) on the chain it starts every VRF
   with before anything is drawn: the outdoor, a joint for each head but the
   last, each head on its own branch, the heads a branch box takes on boxes.
   Each section at the book's size for the index it carries, each joint the
   book's for the index after it. Lengths as given: the outdoor to the first
   joint, between joints, and each head's branch; a length not given leaves
   that size's metres not known. Pure. */

export type VrfAsk = {
  outdoor: string;
  heads: { model: string; branchM?: number | null }[];
  /** the outdoor to the first joint, metres */
  mainM: number | null;
  /** joint to joint, metres */
  betweenM: number | null;
  /** each head's branch, metres, where a head doesn't give its own */
  branchM: number | null;
};

export type VrfPipe = { liquidMm: number; gasMm: number; m: number | null; sections: number };
export type VrfFitting = { part: string | null; kind: "joint" | "header" | "box"; qty: number; index: number[] };

export type VrfPlan =
  | { ok: false; why: string }
  | {
      ok: true;
      outdoor: string;
      heads: number;
      /** the heads on the run itself, not on a branch box: each takes the maker's wall controller */
      vrfHeads: number;
      /** the pipe by size, liquid / gas mm, its metres where every section's length was given */
      pipes: VrfPipe[];
      /** the joints, headers and branch boxes, by the book's part */
      fittings: VrfFitting[];
      totalM: number | null;
      /** what the book's limits say of this run, red first */
      warnings: string[];
      /** the table it was sized by */
      from: string;
    };

const sum = (xs: (number | null | undefined)[]): number | null => (xs.every((x) => x != null) ? xs.reduce<number>((a, x) => a + x!, 0) : null);

/** A VRF's pipe and fittings off its maker's pack, the outdoor and each head
    read through the business's confirmed links where the pack doesn't name
    them. */
export function vrfPlanOf(pack: DataPack | null, ask: VrfAsk, links: readonly ConfirmedLink[] = []): VrfPlan {
  if (!pack) return { ok: false, why: "No data pack for this maker" };
  const find = <U extends { model: string }>(units: readonly U[], code: string): U | undefined => {
    const direct = units.find((u) => sameUnit(code, u.model));
    if (direct) return direct;
    const linked = linkedModel(links, code);
    return linked ? units.find((u) => sameUnit(linked, u.model)) : undefined;
  };
  const odu = find(pack.outdoor_units, ask.outdoor);
  if (!odu) return { ok: false, why: `${ask.outdoor} isn't in the data pack` };
  if (odu.system_type !== "vrf") return { ok: false, why: `${odu.model} isn't a VRF outdoor: its own kit is the split's` };
  if (ask.heads.length === 0) return { ok: false, why: "Needs the heads" };
  const heads: { id: string; unit: IndoorUnit; branchM: number | null }[] = [];
  for (const [i, h] of ask.heads.entries()) {
    const unit = find(pack.indoor_units, h.model);
    if (!unit) return { ok: false, why: `${h.model} isn't in the data pack` };
    heads.push({ id: `h:${i + 1}`, unit, branchM: h.branchM ?? ask.branchM });
  }

  /* a head that isn't the maker's VRF head goes on a branch box (PUMY) */
  const boxed = new Set(heads.filter((h) => !isVrfHead(pack, h.unit)).map((h) => h.id));
  const tree = provisionalVrfTree(
    "odu",
    heads.map((h) => ({ id: h.id, model: h.unit.model })),
    boxed
  );
  const branchOf = new Map(heads.map((h) => [h.id, h.branchM]));
  const lengthOf = (s: VrfTreeSection): number | null => {
    const toHead = branchOf.has(s.to);
    if (toHead) return s.from === "odu" ? sum([ask.mainM, branchOf.get(s.to)]) : (branchOf.get(s.to) ?? null);
    return s.from === "odu" ? ask.mainM : ask.betweenM;
  };
  const sized = sizeVrfTree(pack, odu, { ...tree, sections: tree.sections.map((s) => ({ ...s, lengthM: lengthOf(s) })) });

  const bySize = new Map<string, VrfPipe>();
  for (const s of sized.sections) {
    const key = `${s.liquidMm}/${s.gasMm}`;
    const was = bySize.get(key);
    bySize.set(key, was ? { ...was, m: sum([was.m, s.lengthM]), sections: was.sections + 1 } : { liquidMm: s.liquidMm, gasMm: s.gasMm, m: s.lengthM, sections: 1 });
  }
  const byPart = new Map<string, VrfFitting>();
  for (const f of sized.fittings) {
    const key = `${f.kind}|${f.part ?? ""}`;
    const was = byPart.get(key);
    if (was) {
      was.qty += 1;
      was.index.push(f.downstreamIndex);
    } else byPart.set(key, { part: f.part, kind: f.kind, qty: 1, index: [f.downstreamIndex] });
  }
  const table = pack.vrf_pipe_tables.find((t) => t.series === (boxed.size ? (odu.mixed_table_ref ?? odu.branch_box_table_ref) : odu.pipe_table_ref));
  return {
    ok: true,
    outdoor: odu.model,
    heads: heads.length,
    vrfHeads: heads.length - boxed.size,
    pipes: [...bySize.values()].sort((a, b) => b.gasMm - a.gasMm || b.liquidMm - a.liquidMm),
    fittings: [...byPart.values()],
    totalM: sum(sized.sections.map((s) => s.lengthM)),
    warnings: [...sized.findings].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "red" ? -1 : 1)).slice(0, 4).map((f) => f.message),
    from: table ? [table.provenance.source, table.provenance.edition, table.provenance.page ? `p.${table.provenance.page}` : ""].filter(Boolean).join(" ") : "",
  };
}
