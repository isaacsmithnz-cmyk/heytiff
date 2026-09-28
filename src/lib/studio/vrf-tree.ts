/* A VRF's refrigerant tree, sized by the book (docs/studio-vrf.md, step 3).

   The tree is nodes (the outdoor, joints, heads) and sections between them,
   rooted at the outdoor. It comes from what is drawn on the plan or, until
   something is, from the zones in list order (provisionalVrfTree). Sizing
   follows MEES21K029 p.139-140 step by step:

   (1) outdoor → 1st joint ("A"): the outdoor's own connection sizes (Table 1),
       the liquid stepping up where the book says so for the farthest length;
   (2) between joints ("B, C, D…"): by the total index downstream (Table 2);
   (3) joint or header → head ("a, b, c…"): by that head's index (Table 3);
   (4) a section never larger than the one before it;
   (5a) past `max_after_first_joint_m` (40 m) from the first joint, the section
       where it is passed and everything after it go one liquid size up, up to
       `extended_after_first_joint_m` (90 m); further than that is red.
   The height rule (5b) needs lifts and arrives with them (step 4).

   Joints are chosen by downstream index (Table 4-1), the first by outdoor
   (Table 4-2); a node with three or more sections out is a header (Table 5):
   nothing branches after one, some outdoors cannot take one directly, and a
   CMY-Y104-G cannot take a P200 or P250 head.

   Pure functions. No React, no canvas. */

import type { DesignDocument, DesignSystem } from "./document";
import { buildSystemGraph } from "./graph";
import type { DataPack, IndoorUnit, OutdoorUnit, PipeSizingRule, VrfPipeTable } from "./packs/schema";
import { allocationsOf, hasAllocations } from "./allocations";
import { zoneIdsOf } from "./zones";

export interface VrfTreeNode {
  id: string;
  kind: "odu" | "joint" | "idu";
  /** a head's model (kind idu) */
  model?: string;
}

export interface VrfTreeSection {
  id: string;
  /** upstream node (toward the outdoor) */
  from: string;
  /** downstream node */
  to: string;
  /** metres as drawn; null while not drawn */
  lengthM: number | null;
}

export interface VrfTree {
  nodes: VrfTreeNode[];
  sections: VrfTreeSection[];
  /** from the zone order, not from the plan */
  provisional: boolean;
}

export interface SizedSection {
  id: string;
  from: string;
  to: string;
  /** "main" = outdoor → first joint or header; "between" = joint → joint;
      "branch" = joint or header → head */
  role: "main" | "between" | "branch";
  downstreamIndex: number;
  liquidMm: number;
  gasMm: number;
  /** liquid went one size up under the after-first-joint rule */
  upsized: boolean;
  lengthM: number | null;
}

export interface SizedFitting {
  nodeId: string;
  kind: "joint" | "header";
  /** null when no row of the book's table covers it */
  part: string | null;
  downstreamIndex: number;
  branches: number;
  /** the first fitting after the outdoor */
  first: boolean;
}

export interface TreeFinding {
  severity: "red" | "amber";
  code:
    | "not-a-tree"
    | "branch-after-header"
    | "header-not-direct"
    | "header-excludes-head"
    | "no-fitting-part"
    | "no-size"
    | "after-first-joint-over";
  message: string;
  fix?: string;
}

export interface SizedTree {
  sections: SizedSection[];
  fittings: SizedFitting[];
  findings: TreeFinding[];
  /** metres of liquid pipe per size ("9.52" → m), drawn sections only */
  liquidM: Record<string, number>;
  /** outdoor → farthest head, when every section on that path is drawn */
  farthestM: number | null;
  /** the whole tree is drawn */
  drawn: boolean;
  provisional: boolean;
}

/** the liquid ladder "one size larger" climbs */
const LIQUID_LADDER = [6.35, 9.52, 12.7, 15.88, 19.05, 22.2];
const oneUp = (mm: number): number => LIQUID_LADDER.find((s) => s > mm + 1e-6) ?? mm;
const key = (mm: number): string => String(mm);

function byIndex(rule: PipeSizingRule | undefined, index: number): { liquid: number; gas: number } | null {
  if (!rule || rule.method !== "size_by_downstream_index") return null;
  const step = rule.steps.find((s) => index <= s.index_max);
  return step ? { liquid: step.liquid_mm, gas: step.gas_mm } : null;
}

/** the zones in list order, before anything is drawn: the outdoor, a joint
    per head but the last, each joint feeding its head and the next joint,
    the last joint feeding the last two heads (the book's Fig. 12-2-1A without
    a header). One head hangs straight off the outdoor. */
export function provisionalVrfTree(oduId: string, heads: { id: string; model: string }[]): VrfTree {
  const nodes: VrfTreeNode[] = [{ id: oduId, kind: "odu" }];
  const sections: VrfTreeSection[] = [];
  for (const h of heads) nodes.push({ id: h.id, kind: "idu", model: h.model });
  if (heads.length === 1) {
    sections.push({ id: `s:${heads[0].id}`, from: oduId, to: heads[0].id, lengthM: null });
  } else if (heads.length > 1) {
    let up = oduId;
    for (let i = 0; i < heads.length - 1; i++) {
      const j = `j:${i + 1}`;
      nodes.push({ id: j, kind: "joint" });
      sections.push({ id: `s:${j}`, from: up, to: j, lengthM: null });
      sections.push({ id: `s:${heads[i].id}`, from: j, to: heads[i].id, lengthM: null });
      up = j;
    }
    const last = heads[heads.length - 1];
    sections.push({ id: `s:${last.id}`, from: up, to: last.id, lengthM: null });
  }
  return { nodes, sections, provisional: true };
}

/** size a VRF tree against its outdoor's table */
export function sizeVrfTree(pack: DataPack, odu: OutdoorUnit, tree: VrfTree): SizedTree {
  const findings: TreeFinding[] = [];
  const empty: SizedTree = {
    sections: [],
    fittings: [],
    findings,
    liquidM: {},
    farthestM: null,
    drawn: false,
    provisional: tree.provisional,
  };
  const table: VrfPipeTable | undefined = pack.vrf_pipe_tables.find((t) => t.series === odu.pipe_table_ref);
  if (!table) {
    findings.push({ severity: "red", code: "no-size", message: `${odu.model} has no piping table in the book` });
    return empty;
  }
  const nodeById = new Map(tree.nodes.map((n) => [n.id, n]));
  const root = tree.nodes.find((n) => n.kind === "odu");
  const children = new Map<string, VrfTreeSection[]>();
  const incoming = new Map<string, VrfTreeSection>();
  for (const s of tree.sections) {
    if (incoming.has(s.to) || !nodeById.has(s.from) || !nodeById.has(s.to)) {
      findings.push({ severity: "red", code: "not-a-tree", message: "The pipework joins back on itself", fix: "Every head needs one way back to the outdoor" });
      return empty;
    }
    incoming.set(s.to, s);
    children.set(s.from, [...(children.get(s.from) ?? []), s]);
  }
  if (!root) return empty;

  const iduIndex = (n: VrfTreeNode): number => {
    const u: IndoorUnit | undefined = pack.indoor_units.find((x) => x.model === n.model);
    return u?.capacity_index ?? 0;
  };
  /* downstream index per node, and every node reachable from the outdoor */
  const below = new Map<string, number>();
  const seen = new Set<string>();
  const walk = (id: string): number => {
    if (seen.has(id)) return below.get(id) ?? 0;
    seen.add(id);
    const n = nodeById.get(id)!;
    const sum = n.kind === "idu" ? iduIndex(n) : (children.get(id) ?? []).reduce((t, s) => t + walk(s.to), 0);
    below.set(id, sum);
    return sum;
  };
  walk(root.id);
  if (tree.nodes.some((n) => n.kind === "idu" && !seen.has(n.id))) {
    findings.push({ severity: "red", code: "not-a-tree", message: "A head is not joined to the outdoor", fix: "Draw its run to a joint" });
  }

  /* the first fitting: where the main from the outdoor ends */
  const mainSection = (children.get(root.id) ?? [])[0];
  const firstFitting = mainSection && nodeById.get(mainSection.to)?.kind === "joint" ? mainSection.to : null;

  /* (1)-(3), then (4) top-down */
  const sized = new Map<string, SizedSection>();
  const visit = (nodeId: string, parent: { liquid: number; gas: number } | null) => {
    for (const s of children.get(nodeId) ?? []) {
      const to = nodeById.get(s.to)!;
      const from = nodeById.get(s.from)!;
      const down = below.get(s.to) ?? 0;
      let role: SizedSection["role"];
      let size: { liquid: number; gas: number } | null;
      if (from.kind === "odu") {
        role = "main";
        size = { liquid: odu.conn_liquid_mm, gas: odu.conn_gas_mm };
      } else if (to.kind === "idu") {
        role = "branch";
        size = byIndex(table.branch_sizing ?? table.pipe_sizing, down);
      } else {
        role = "between";
        size = byIndex(table.pipe_sizing, down);
      }
      if (!size) {
        findings.push({ severity: "red", code: "no-size", message: `No pipe size in the book for P${down}` });
        continue;
      }
      if (parent) size = { liquid: Math.min(size.liquid, parent.liquid), gas: Math.min(size.gas, parent.gas) };
      sized.set(s.id, {
        id: s.id,
        from: s.from,
        to: s.to,
        role,
        downstreamIndex: down,
        liquidMm: size.liquid,
        gasMm: size.gas,
        upsized: false,
        lengthM: s.lengthM,
      });
      visit(s.to, size);
    }
  };
  visit(root.id, null);

  /* lengths: outdoor → each head, and first fitting → each head */
  const heads = tree.nodes.filter((n) => n.kind === "idu" && seen.has(n.id));
  const pathTo = (id: string): VrfTreeSection[] => {
    const out: VrfTreeSection[] = [];
    let cur = incoming.get(id);
    while (cur) {
      out.unshift(cur);
      cur = incoming.get(cur.from);
    }
    return out;
  };
  const drawn = tree.sections.length > 0 && tree.sections.every((s) => s.lengthM != null);
  let farthestM: number | null = null;
  if (drawn) {
    for (const h of heads) {
      const m = pathTo(h.id).reduce((t, s) => t + (s.lengthM ?? 0), 0);
      farthestM = Math.max(farthestM ?? 0, m);
    }
  }

  /* (1) the main's liquid steps up with the farthest length (Table 1 notes) */
  const up = table.odu_liquid_upsize?.[odu.model];
  if (up && farthestM != null && farthestM >= up.farthest_m_min && mainSection) {
    const m = sized.get(mainSection.id);
    if (m) m.liquidMm = up.liquid_mm;
  }

  /* (5a) past 40 m from the first joint: the section where it is passed and
     everything after it, one liquid size up; past 90 m, red */
  const limit = table.limits.max_after_first_joint_m;
  const extended = table.limits.extended_after_first_joint_m ?? limit;
  if (firstFitting && drawn) {
    const bump = new Set<string>();
    let over = false;
    for (const h of heads) {
      let run = 0;
      let passed = false;
      for (const s of pathTo(h.id)) {
        if (s.from === root.id) continue;
        run += s.lengthM ?? 0;
        if (!passed && run > limit) passed = true;
        if (passed) bump.add(s.id);
      }
      if (run > extended) over = true;
    }
    for (const id of bump) {
      const s = sized.get(id);
      if (s) {
        s.liquidMm = oneUp(s.liquidMm);
        s.upsized = true;
      }
    }
    if (over)
      findings.push({
        severity: "red",
        code: "after-first-joint-over",
        message: `A head is more than ${extended} m past the first joint`,
        fix: "Move the first joint closer to the heads, or the outdoor",
      });
  }

  /* fittings */
  const fittings: SizedFitting[] = [];
  for (const n of tree.nodes) {
    if (n.kind !== "joint" || !seen.has(n.id)) continue;
    const outs = children.get(n.id) ?? [];
    const down = below.get(n.id) ?? 0;
    const first = n.id === firstFitting;
    if (outs.length >= 3) {
      const step = (table.header_selection?.steps ?? []).find((h) => outs.length <= h.branches_max && down <= h.index_max);
      fittings.push({ nodeId: n.id, kind: "header", part: step?.part_ref ?? null, downstreamIndex: down, branches: outs.length, first });
      if (!step)
        findings.push({ severity: "red", code: "no-fitting-part", message: `No header in the book takes ${outs.length} branches at P${down}` });
      if (outs.some((s) => nodeById.get(s.to)?.kind !== "idu"))
        findings.push({ severity: "red", code: "branch-after-header", message: "The pipework branches again after a header", fix: "Run each header branch straight to its head" });
      if (step && first && mainSection?.from === root.id && step.direct_odus && !step.direct_odus.includes(odu.model))
        findings.push({ severity: "red", code: "header-not-direct", message: `${step.part_ref} can't join ${odu.model} directly`, fix: "Put a joint before it" });
      const excluded = step?.excludes_idu_index ?? [];
      for (const s of outs) {
        const h = nodeById.get(s.to);
        if (h?.kind === "idu" && excluded.includes(iduIndex(h)))
          findings.push({ severity: "red", code: "header-excludes-head", message: `${step!.part_ref} can't take ${h.model}` });
      }
    } else {
      const byOdu = first ? table.joint_selection.first_joint_by_odu?.[odu.model] : undefined;
      const part = byOdu ?? table.joint_selection.steps.find((j) => down <= j.index_max)?.part_ref ?? null;
      fittings.push({ nodeId: n.id, kind: "joint", part, downstreamIndex: down, branches: outs.length, first });
      if (!part) findings.push({ severity: "red", code: "no-fitting-part", message: `No joint in the book for P${down}` });
    }
  }

  const liquidM: Record<string, number> = {};
  for (const s of sized.values())
    if (s.lengthM != null) liquidM[key(s.liquidMm)] = (liquidM[key(s.liquidMm)] ?? 0) + s.lengthM;

  return {
    sections: tree.sections.map((s) => sized.get(s.id)).filter((s): s is SizedSection => s != null),
    fittings,
    findings,
    liquidM,
    farthestM,
    drawn,
    provisional: tree.provisional,
  };
}

/** the tree as DRAWN on the plan: from the outdoor through the system's
    refrigerant runs, joints and risers (graph.ts). A riser, or a joint with
    one run on, is passed through — its lengths add into one section. A run
    that loops back makes a second way into a node, which the sizer calls out.
    `joined` is the heads the drawing reaches. Null when the outdoor is not
    on the plan. */
export function drawnVrfTree(
  doc: DesignDocument,
  sys: DesignSystem,
  oduId: string,
  heads: { id: string; model: string }[]
): { tree: VrfTree; joined: Set<string> } | null {
  const graph = buildSystemGraph(doc.objects, doc.floors, sys.id);
  if (!graph.nodes.has(oduId)) return null;
  const headModel = new Map(heads.map((h) => [h.id, h.model]));
  const adj = new Map<string, { to: string; lengthM: number | null; edge: string }[]>();
  for (const e of graph.edges) {
    adj.set(e.a, [...(adj.get(e.a) ?? []), { to: e.b, lengthM: e.lengthM, edge: e.id }]);
    adj.set(e.b, [...(adj.get(e.b) ?? []), { to: e.a, lengthM: e.lengthM, edge: e.id }]);
  }
  /* walk out from the outdoor; every edge is used once, in the direction it
     is first met */
  const usedEdge = new Set<string>();
  const out = new Map<string, { to: string; lengthM: number | null }[]>();
  const seen = new Set([oduId]);
  const queue = [oduId];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const n of adj.get(cur) ?? []) {
      if (usedEdge.has(n.edge)) continue;
      usedEdge.add(n.edge);
      out.set(cur, [...(out.get(cur) ?? []), { to: n.to, lengthM: n.lengthM }]);
      if (!seen.has(n.to)) {
        seen.add(n.to);
        queue.push(n.to);
      }
    }
  }
  /* keep the outdoor, the heads and the joints that branch; pass the rest */
  const keep = (id: string): boolean =>
    id === oduId || headModel.has(id) || (graph.nodes.get(id)?.type === "joint" && (out.get(id)?.length ?? 0) >= 2);
  const nodes: VrfTreeNode[] = [{ id: oduId, kind: "odu" }];
  const sections: VrfTreeSection[] = [];
  const joined = new Set<string>();
  const add = (from: string, to: string, lengthM: number | null, guard: Set<string>) => {
    if (keep(to)) {
      sections.push({ id: `${from}>${to}`, from, to, lengthM });
      if (guard.has(to)) return;
      guard.add(to);
      if (headModel.has(to)) {
        joined.add(to);
        nodes.push({ id: to, kind: "idu", model: headModel.get(to) });
      } else {
        nodes.push({ id: to, kind: "joint" });
      }
      for (const n of out.get(to) ?? []) add(to, n.to, n.lengthM, guard);
      return;
    }
    /* pass through: a riser, a joint with one run on, a unit not of this tree */
    for (const n of out.get(to) ?? [])
      add(from, n.to, lengthM == null || n.lengthM == null ? null : lengthM + n.lengthM, guard);
  };
  const guard = new Set<string>([oduId]);
  for (const n of out.get(oduId) ?? []) add(oduId, n.to, n.lengthM, guard);
  return { tree: { nodes, sections, provisional: false }, joined };
}

/** a VRF system's tree, sized: the one drawn on the plan once it reaches
    every head, else its heads in zone order (the provisional tree). Null for
    any other system, or without an outdoor. */
export function systemVrfTree(
  pack: DataPack,
  sys: DesignSystem,
  doc?: DesignDocument
): (SizedTree & { joined: number; heads: number }) | null {
  if (sys.type !== "vrf" || !hasAllocations(sys)) return null;
  const allocs = allocationsOf(sys);
  const oduAlloc = allocs.find((a) => a.role === "odu" && a.model);
  const odu = oduAlloc ? pack.outdoor_units.find((o) => o.model === oduAlloc.model) : undefined;
  if (!oduAlloc || !odu) return null;
  const order = zoneIdsOf(sys);
  const rank = (zoneId: string | null) => {
    const i = zoneId ? order.indexOf(zoneId) : -1;
    return i < 0 ? order.length : i;
  };
  const heads = allocs
    .map((a, i) => ({ a, i }))
    .filter(({ a }) => a.role === "idu" && a.model)
    .sort((x, y) => rank(x.a.roomId) - rank(y.a.roomId) || x.i - y.i)
    .map(({ a }) => ({ id: a.id, model: a.model }));
  const drawn = doc ? drawnVrfTree(doc, sys, oduAlloc.id, heads) : null;
  const joined = drawn?.joined.size ?? 0;
  const tree =
    drawn && heads.length > 0 && joined === heads.length ? drawn.tree : provisionalVrfTree(oduAlloc.id, heads);
  return { ...sizeVrfTree(pack, odu, tree), joined, heads: heads.length };
}

/** the section that feeds a head, sized */
export const headSection = (tree: SizedTree, headId: string): SizedSection | null =>
  tree.sections.find((s) => s.to === headId) ?? null;
