/* A VRF's refrigerant tree, sized by the book (docs/studio-vrf.md).

   The tree is nodes (the outdoor, joints, branch boxes, heads) and sections
   between them, rooted at the outdoor. It comes from what is drawn on the
   plan or, until something is, from the zones in list order
   (provisionalVrfTree). The outdoor's table depends on how the heads connect
   (PUMY M-P0860 §11-2): joints and headers only, branch boxes only, or both
   ("mixed"); PUHY has joints only. Sizing, step by step (PUHY MEES21K029
   p.139-140, PUMY p.74-84):

   (1) outdoor → 1st joint, header or box ("A"): the outdoor's own connection
       sizes, the liquid stepping up where the book says so;
   (2) between joints, and on to a branch box: by the total downstream index
       or kW, as the table keys it;
   (3) joint or header → head: by that head's index; box → head: by the
       head's series (M, S or P) and model number;
   (4) a section never larger than the one before it, where the book says so
       (PUHY);
   (5) the book's conditional liquid sizes: PUHY's one size up past 40 m from
       the first joint (5a) and past 15 m head to head (5b); PUMY's fixed
       step-ups by the farthest length, the length to the farthest box, or a
       P200/P250 head on the system, and its small City Multi heads' own pipe.
   Then the book's limits on a drawn tree (lengths, lifts, box sections, bends
   per path) and the charge against the outdoor's maximum.

   Joints are chosen by downstream index, the first by outdoor where the book
   says; a node with three or more sections out is a header (nothing branches
   after one; some outdoors cannot take one directly; a CMY-Y104-G cannot take
   a P200 or P250 head). A branch box is the smallest box whose ports take its
   heads, of a family its outdoor lists.

   Pure functions. No React, no canvas. */

import type { DesignDocument, DesignSystem } from "./document";
import { buildSystemGraph } from "./graph";
import type { DataPack, IndoorUnit, OutdoorUnit, PipeSizingRule, VrfPipeTable } from "./packs/schema";
import { allocationsOf, hasAllocations } from "./allocations";
import { zoneIdsOf } from "./zones";
import { evaluateVrfCharge } from "./materials";
import { isBoxHead, isVrfHead } from "./vrf";

export interface VrfTreeNode {
  id: string;
  kind: "odu" | "joint" | "box" | "idu";
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
  /** metres up from `from` to `to` (risers); negative is down */
  riseM?: number;
  /** corners drawn on it */
  bends?: number;
  /** the drawn runs it is made of (graph edge ids: pipe-run object ids, or
      a riser gap); empty on the provisional tree */
  edges?: string[];
}

export interface VrfTree {
  nodes: VrfTreeNode[];
  sections: VrfTreeSection[];
  /** from the zone order, not from the plan */
  provisional: boolean;
}

export type VrfMethod = "joint" | "branch-box" | "mixed";

export interface SizedSection {
  id: string;
  from: string;
  to: string;
  /** "main" = outdoor → first joint, header or box; "between" = on to a
      joint or a box; "branch" = joint or header → head, or the outdoor → its
      only head; "box" = box → head */
  role: "main" | "between" | "branch" | "box";
  downstreamIndex: number;
  liquidMm: number;
  gasMm: number;
  /** liquid went one size up (the after-first-joint or the height rule) */
  upsized: boolean;
  lengthM: number | null;
  bends: number;
  /** the drawn runs it is made of — the plan lights them together */
  edges: string[];
}

export interface SizedFitting {
  nodeId: string;
  kind: "joint" | "header" | "box";
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
    | "no-table"
    | "branch-after-header"
    | "header-not-direct"
    | "header-excludes-head"
    | "no-fitting-part"
    | "no-size"
    | "not-box-head"
    | "box-count-over"
    | "box-empty"
    | "branch-after-box"
    | "after-first-joint-over"
    | "total-over"
    | "farthest-over"
    | "farthest-equiv-over"
    | "via-box-over"
    | "odu-to-box-over"
    | "first-joint-to-box-over"
    | "after-box-over"
    | "box-heads-total-over"
    | "bends-over"
    | "box-height-over"
    | "outdoor-above-over"
    | "outdoor-below-over"
    | "head-height-over"
    | "charge-over";
  message: string;
  fix?: string;
}

export interface SizedTree {
  sections: SizedSection[];
  fittings: SizedFitting[];
  findings: TreeFinding[];
  /** how the heads connect, and so which of the outdoor's tables sized it */
  method: VrfMethod;
  /** metres of liquid pipe per size ("9.52" → m), drawn sections only */
  liquidM: Record<string, number>;
  /** outdoor → farthest head, when every section on that path is drawn */
  farthestM: number | null;
  /** the same with M per bend added, where the book gives M */
  farthestEquivM: number | null;
  /** every section's length added up, drawn trees only */
  totalM: number | null;
  /** grams to add on site, drawn trees only; null when the book's rule can't
      be worked */
  chargeG: number | null;
  /** the whole tree is drawn */
  drawn: boolean;
  provisional: boolean;
}

/** the liquid ladder "one size larger" climbs */
const LIQUID_LADDER = [6.35, 9.52, 12.7, 15.88, 19.05, 22.2];
const oneUp = (mm: number): number => LIQUID_LADDER.find((s) => s > mm + 1e-6) ?? mm;
const key = (mm: number): string => String(mm);
const fmtM = (m: number) => `${Math.round(m * 10) / 10} m`;

/** a size from a table keyed by downstream index or by downstream kW */
function sizeBy(rule: PipeSizingRule | undefined, index: number, kw: number): { liquid: number; gas: number } | null {
  if (!rule) return null;
  if (rule.method === "size_by_downstream_index") {
    const step = rule.steps.find((s) => index <= s.index_max);
    return step ? { liquid: step.liquid_mm, gas: step.gas_mm } : null;
  }
  const step = rule.steps.find((s) => kw <= s.kw_max + 1e-9);
  return step ? { liquid: step.liquid_mm, gas: step.gas_mm } : null;
}

/** a box head's series, for its pipe: the first letter of its model (M, S
    or P: Isaac, 2026-09-28) */
const seriesOf = (model: string): "M" | "S" | "P" | null => {
  const c = model.charAt(0);
  return c === "M" || c === "S" || c === "P" ? c : null;
};

/** the zones in list order, before anything is drawn: the outdoor, a joint
    per stop but the last, each joint feeding its stop and the next joint,
    the last joint feeding the last two (the book's Fig. 12-2-1A without a
    header). A stop is a City Multi head, or a branch box carrying the heads
    that go on one (`boxed`): as few boxes as the biggest box's ports need,
    the heads shared evenly between them.
    One stop hangs straight off the outdoor. */
export function provisionalVrfTree(
  oduId: string,
  heads: { id: string; model: string }[],
  boxed: ReadonlySet<string> = new Set(),
  portsPerBox = 5
): VrfTree {
  const nodes: VrfTreeNode[] = [{ id: oduId, kind: "odu" }];
  const sections: VrfTreeSection[] = [];
  for (const h of heads) nodes.push({ id: h.id, kind: "idu", model: h.model });
  const stops: string[] = [];
  const onBoxes = heads.filter((h) => boxed.has(h.id));
  for (const h of heads) if (!boxed.has(h.id)) stops.push(h.id);
  /* as few boxes as the ports need, the heads shared evenly between them:
     six heads are 3 + 3 on two small boxes, not 5 + 1 (Isaac, 2026-09-29) */
  const boxCount = Math.ceil(onBoxes.length / Math.max(1, portsPerBox));
  let next = 0;
  for (let b = 0; b < boxCount; b++) {
    const box = `b:${b + 1}`;
    const take = Math.floor(onBoxes.length / boxCount) + (b < onBoxes.length % boxCount ? 1 : 0);
    nodes.push({ id: box, kind: "box" });
    for (const h of onBoxes.slice(next, next + take)) sections.push({ id: `s:${h.id}`, from: box, to: h.id, lengthM: null });
    next += take;
    stops.push(box);
  }
  if (stops.length === 1) {
    sections.push({ id: `s:${stops[0]}`, from: oduId, to: stops[0], lengthM: null });
  } else if (stops.length > 1) {
    let up = oduId;
    for (let i = 0; i < stops.length - 1; i++) {
      const j = `j:${i + 1}`;
      nodes.push({ id: j, kind: "joint" });
      sections.push({ id: `s:${j}`, from: up, to: j, lengthM: null });
      sections.push({ id: `s:${stops[i]}`, from: j, to: stops[i], lengthM: null });
      up = j;
    }
    const last = stops[stops.length - 1];
    sections.push({ id: `s:${last}`, from: up, to: last, lengthM: null });
  }
  return { nodes, sections, provisional: true };
}

/** the outdoor's table for this way of connecting */
function tableFor(pack: DataPack, odu: OutdoorUnit, method: VrfMethod): VrfPipeTable | undefined {
  const ref =
    method === "joint" ? odu.pipe_table_ref : method === "branch-box" ? odu.branch_box_table_ref : odu.mixed_table_ref;
  return ref ? pack.vrf_pipe_tables.find((t) => t.series === ref) : undefined;
}

/** size a VRF tree against its outdoor's table */
export function sizeVrfTree(pack: DataPack, odu: OutdoorUnit, tree: VrfTree): SizedTree {
  const findings: TreeFinding[] = [];
  const nodeById = new Map(tree.nodes.map((n) => [n.id, n]));
  const root = tree.nodes.find((n) => n.kind === "odu");
  const children = new Map<string, VrfTreeSection[]>();
  const incoming = new Map<string, VrfTreeSection>();
  let broken = false;
  for (const s of tree.sections) {
    if (incoming.has(s.to) || !nodeById.has(s.from) || !nodeById.has(s.to)) {
      broken = true;
      continue;
    }
    incoming.set(s.to, s);
    children.set(s.from, [...(children.get(s.from) ?? []), s]);
  }
  const hasBox = tree.nodes.some((n) => n.kind === "box");
  const cmDirect = tree.nodes.some((n) => n.kind === "idu" && nodeById.get(incoming.get(n.id)?.from ?? "")?.kind !== "box");
  const method: VrfMethod = hasBox ? (cmDirect ? "mixed" : "branch-box") : "joint";
  const empty: SizedTree = {
    sections: [],
    fittings: [],
    findings,
    method,
    liquidM: {},
    farthestM: null,
    farthestEquivM: null,
    totalM: null,
    chargeG: null,
    drawn: false,
    provisional: tree.provisional,
  };
  if (broken) {
    findings.push({ severity: "red", code: "not-a-tree", message: "The pipework joins back on itself", fix: "Every head needs one way back to the outdoor" });
    return empty;
  }
  const table = tableFor(pack, odu, method);
  if (!table) {
    findings.push({
      severity: "red",
      code: "no-table",
      message:
        method === "joint"
          ? `${odu.model} has no piping table in the book`
          : `${odu.model} doesn't take branch boxes${method === "mixed" ? " with City Multi heads" : ""}`,
    });
    return empty;
  }
  if (!root) return empty;

  const unitOf = (n: VrfTreeNode): IndoorUnit | undefined => pack.indoor_units.find((x) => x.model === n.model);
  /* a head's size: its capacity index (City Multi), else the model size its
     name prints (a box head: the book counts "the model size", p.74 Note 3) */
  const iduIndex = (n: VrfTreeNode): number => {
    const u = unitOf(n);
    return u?.capacity_index ?? u?.capacity_code ?? 0;
  };
  /* downstream index and kW per node, and every node reachable */
  const below = new Map<string, number>();
  const belowKw = new Map<string, number>();
  const seen = new Set<string>();
  const walk = (id: string): void => {
    if (seen.has(id)) return;
    seen.add(id);
    const n = nodeById.get(id)!;
    if (n.kind === "idu") {
      below.set(id, iduIndex(n));
      belowKw.set(id, unitOf(n)?.capacity_cool_kw ?? 0);
      return;
    }
    let idx = 0;
    let kw = 0;
    for (const s of children.get(id) ?? []) {
      walk(s.to);
      idx += below.get(s.to) ?? 0;
      kw += belowKw.get(s.to) ?? 0;
    }
    below.set(id, idx);
    belowKw.set(id, kw);
  };
  walk(root.id);
  if (tree.nodes.some((n) => n.kind === "idu" && !seen.has(n.id))) {
    findings.push({ severity: "red", code: "not-a-tree", message: "A head is not joined to the outdoor", fix: "Draw its run to a joint" });
  }
  const heads = tree.nodes.filter((n) => n.kind === "idu" && seen.has(n.id));
  const boxes = tree.nodes.filter((n) => n.kind === "box" && seen.has(n.id));
  const onBox = (h: VrfTreeNode) => nodeById.get(incoming.get(h.id)?.from ?? "")?.kind === "box";

  /* the first fitting: where the main from the outdoor ends, if a joint */
  const mainSection = (children.get(root.id) ?? [])[0];
  const firstFitting = mainSection && nodeById.get(mainSection.to)?.kind === "joint" ? mainSection.to : null;

  /* (1)-(4), top-down */
  const capDown = table.downstream_not_larger !== false;
  const sized = new Map<string, SizedSection>();
  const visit = (nodeId: string, parent: { liquid: number; gas: number } | null) => {
    for (const s of children.get(nodeId) ?? []) {
      const to = nodeById.get(s.to)!;
      const from = nodeById.get(s.from)!;
      const down = below.get(s.to) ?? 0;
      const downKw = belowKw.get(s.to) ?? 0;
      let role: SizedSection["role"];
      let size: { liquid: number; gas: number } | null;
      if (from.kind === "odu" && to.kind === "idu") {
        /* A LONE HEAD, no joint: piped at its own size, reduced at the
           outdoor — the outdoor's main size to a P20 was a 7/8" gas line on
           a 1/2" head (Isaac, 2026-09-29: "head's own size") */
        role = "branch";
        size = sizeBy(table.branch_sizing ?? table.pipe_sizing, down, downKw);
      } else if (from.kind === "odu") {
        role = "main";
        size = { liquid: odu.conn_liquid_mm, gas: odu.conn_gas_mm };
      } else if (to.kind === "idu" && from.kind === "box") {
        role = "box";
        const u = unitOf(to);
        const series = seriesOf(to.model ?? "");
        const code = u?.capacity_code;
        const row =
          series && code != null
            ? table.box_head_sizing?.find((r) => r.series === series && code >= r.code_min && code <= r.code_max)
            : undefined;
        size = row ? { liquid: row.liquid_mm, gas: row.gas_mm } : null;
      } else if (to.kind === "idu") {
        role = "branch";
        size = sizeBy(table.branch_sizing ?? table.pipe_sizing, down, downKw);
      } else {
        role = "between";
        size = sizeBy(table.pipe_sizing, down, downKw);
      }
      /* a box head wired straight to a joint or header: it needs its branch box */
      const u = to.kind === "idu" ? unitOf(to) : undefined;
      if (role === "branch" && u && !isVrfHead(pack, u) && isBoxHead(pack, odu, u))
        findings.push({
          severity: "red",
          code: "not-box-head",
          message: `${u.model} goes on a branch box, not a joint`,
          fix: "Run its pipe to a branch box",
        });
      /* a head a box can't take is reported once, by the box (below) */
      if (!size && role === "box" && u && !isBoxHead(pack, odu, u)) continue;
      if (!size) {
        findings.push({
          severity: "red",
          code: "no-size",
          message:
            role === "box"
              ? `The book gives no branch box pipe for ${to.model} on ${odu.model}`
              : `No pipe size in the book for P${down}`,
        });
        continue;
      }
      if (parent && capDown && role !== "box")
        size = { liquid: Math.min(size.liquid, parent.liquid), gas: Math.min(size.gas, parent.gas) };
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
        bends: s.bends ?? 0,
        edges: s.edges ?? [],
      });
      visit(s.to, size);
    }
  };
  visit(root.id, null);

  /* lengths along each path */
  const pathTo = (id: string): VrfTreeSection[] => {
    const out: VrfTreeSection[] = [];
    let cur = incoming.get(id);
    while (cur) {
      out.unshift(cur);
      cur = incoming.get(cur.from);
    }
    return out;
  };
  const lengthOf = (path: VrfTreeSection[]) => path.reduce((t, s) => t + (s.lengthM ?? 0), 0);
  const afterFirst = (path: VrfTreeSection[]) => {
    const i = firstFitting ? path.findIndex((s) => s.from === firstFitting) : -1;
    return i < 0 ? [] : path.slice(i);
  };
  const drawn = tree.sections.length > 0 && tree.sections.every((s) => s.lengthM != null);
  const L = table.limits;
  const bendM = L.bend_equiv_m_by_odu?.[odu.model];
  let farthestM: number | null = null;
  let farthestEquivM: number | null = null;
  let totalM: number | null = null;
  let toBoxM: number | null = null;
  let afterFirstM: number | null = null;
  if (drawn) {
    farthestM = 0;
    for (const h of heads) {
      const path = pathTo(h.id);
      const m = lengthOf(path);
      farthestM = Math.max(farthestM, m);
      const bends = path.reduce((t, s) => t + (s.bends ?? 0), 0);
      if (bendM != null) farthestEquivM = Math.max(farthestEquivM ?? 0, m + bendM * bends);
      if (L.max_bends_per_path != null && bends > L.max_bends_per_path)
        findings.push({
          severity: "red",
          code: "bends-over",
          message: `The run to ${h.model} has ${bends} bends, over the book's ${L.max_bends_per_path}`,
          fix: "Take corners out of the run",
        });
      /* past the first joint: to a City Multi head, or to its branch box */
      const toStop = onBox(h) ? path.slice(0, -1) : path;
      afterFirstM = Math.max(afterFirstM ?? 0, lengthOf(afterFirst(toStop)));
    }
    for (const b of boxes) toBoxM = Math.max(toBoxM ?? 0, lengthOf(pathTo(b.id)));
    totalM = tree.sections.reduce((t, s) => t + (s.lengthM ?? 0), 0);

    if (totalM > L.max_total_m)
      findings.push({ severity: "red", code: "total-over", message: `The pipework is ${fmtM(totalM)} in all, over the book's ${L.max_total_m} m` });
    /* the farthest head: a head on a box by the via-box figure where the book
       gives one, the rest by the plain farthest */
    const viaBox = L.max_farthest_via_box_m;
    const plain = heads.filter((h) => viaBox == null || !onBox(h)).map((h) => lengthOf(pathTo(h.id)));
    const boxed = viaBox == null ? [] : heads.filter(onBox).map((h) => lengthOf(pathTo(h.id)));
    const plainMax = plain.length ? Math.max(...plain) : 0;
    if (plainMax > L.max_farthest_actual_m)
      findings.push({
        severity: "red",
        code: "farthest-over",
        message: `The farthest head is ${fmtM(plainMax)} from the outdoor, over the book's ${L.max_farthest_actual_m} m`,
        fix: "Move the outdoor closer to the heads",
      });
    else if (farthestEquivM != null && L.max_farthest_equiv_m != null && farthestEquivM > L.max_farthest_equiv_m)
      findings.push({
        severity: "red",
        code: "farthest-equiv-over",
        message: `The farthest head is ${fmtM(farthestEquivM)} from the outdoor counting its bends, over the book's ${L.max_farthest_equiv_m} m`,
        fix: "Take bends out of the run, or move the outdoor closer",
      });
    const boxedMax = boxed.length ? Math.max(...boxed) : 0;
    if (viaBox != null && boxedMax > viaBox)
      findings.push({
        severity: "red",
        code: "via-box-over",
        message: `A head on a branch box is ${fmtM(boxedMax)} from the outdoor, over the book's ${viaBox} m`,
      });
    if (L.max_odu_to_box_m != null && toBoxM != null && toBoxM > L.max_odu_to_box_m)
      findings.push({
        severity: "red",
        code: "odu-to-box-over",
        message: `A branch box is ${fmtM(toBoxM)} from the outdoor, over the book's ${L.max_odu_to_box_m} m`,
        fix: "Move the branch box closer to the outdoor",
      });
    if (L.max_first_joint_to_box_m != null && firstFitting) {
      const m = Math.max(0, ...boxes.map((b) => lengthOf(afterFirst(pathTo(b.id)))));
      if (m > L.max_first_joint_to_box_m)
        findings.push({
          severity: "red",
          code: "first-joint-to-box-over",
          message: `A branch box is ${fmtM(m)} past the first joint, over the book's ${L.max_first_joint_to_box_m} m`,
        });
    }
    const boxLegs = heads.filter(onBox).map((h) => incoming.get(h.id)!.lengthM ?? 0);
    if (L.max_after_box_m != null && boxLegs.length && Math.max(...boxLegs) > L.max_after_box_m)
      findings.push({
        severity: "red",
        code: "after-box-over",
        message: `A head is ${fmtM(Math.max(...boxLegs))} from its branch box, over the book's ${L.max_after_box_m} m`,
        fix: "Move the branch box closer to its heads",
      });
    const legsTotal = boxLegs.reduce((t, m) => t + m, 0);
    if (L.max_box_to_heads_total_m != null && legsTotal > L.max_box_to_heads_total_m)
      findings.push({
        severity: "red",
        code: "box-heads-total-over",
        message: `The branch box pipes come to ${fmtM(legsTotal)}, over the book's ${L.max_box_to_heads_total_m} m`,
      });
  }

  /* levels: every node's height above the outdoor, from the risers drawn */
  const level = new Map<string, number>([[root.id, 0]]);
  const levelOf = (id: string): number => {
    if (level.has(id)) return level.get(id)!;
    const s = incoming.get(id);
    const v = s ? levelOf(s.from) + (s.riseM ?? 0) : 0;
    level.set(id, v);
    return v;
  };
  if (drawn && heads.length) {
    const levels = heads.map((h) => levelOf(h.id));
    const lowest = Math.min(...levels);
    const highest = Math.max(...levels);
    if (-lowest > L.max_lift_odu_above_m)
      findings.push({
        severity: "red",
        code: "outdoor-above-over",
        message: `The outdoor is ${Math.round(-lowest)} m above its lowest head, over the book's ${L.max_lift_odu_above_m} m`,
      });
    if (highest > L.max_lift_odu_below_m)
      findings.push({
        severity: "red",
        code: "outdoor-below-over",
        message: `The outdoor is ${Math.round(highest)} m below its highest head, over the book's ${L.max_lift_odu_below_m} m`,
      });
    /* branch box heights: between boxes (h2), and between the heads on one box (h3) */
    const spread = (ids: string[]) => (ids.length > 1 ? Math.max(...ids.map(levelOf)) - Math.min(...ids.map(levelOf)) : 0);
    if (L.max_box_box_lift_m != null && spread(boxes.map((b) => b.id)) > L.max_box_box_lift_m)
      findings.push({
        severity: "red",
        code: "box-height-over",
        message: `The branch boxes are ${Math.round(spread(boxes.map((b) => b.id)))} m apart in height, over the book's ${L.max_box_box_lift_m} m`,
      });
    if (L.max_box_heads_lift_m != null)
      for (const b of boxes) {
        const ids = (children.get(b.id) ?? []).map((s) => s.to);
        if (spread(ids) > L.max_box_heads_lift_m)
          findings.push({
            severity: "red",
            code: "box-height-over",
            message: `The heads on one branch box are ${Math.round(spread(ids))} m apart in height, over the book's ${L.max_box_heads_lift_m} m`,
          });
      }
  }

  /* (1) PUHY: the main's liquid steps up with the farthest length (Table 1) */
  const up = table.odu_liquid_upsize?.[odu.model];
  if (up && farthestM != null && farthestM >= up.farthest_m_min && mainSection) {
    const m = sized.get(mainSection.id);
    if (m) m.liquidMm = up.liquid_mm;
  }

  /* (5) PUMY: the book's conditional liquid sizes */
  const headIndexes = new Set(heads.map(iduIndex));
  for (const rule of table.liquid_step_ups ?? []) {
    const on =
      (rule.farthest_over_m != null && farthestM != null && farthestM > rule.farthest_over_m) ||
      (rule.to_box_over_m != null && toBoxM != null && toBoxM > rule.to_box_over_m) ||
      (rule.heads_index ?? []).some((i) => headIndexes.has(i));
    if (!on) continue;
    for (const s of sized.values())
      if ((rule.roles as string[]).includes(s.role) && s.liquidMm < rule.liquid_mm) s.liquidMm = rule.liquid_mm;
  }
  for (const rule of table.branch_step_ups ?? []) {
    if (afterFirstM == null || afterFirstM <= rule.after_first_joint_over_m) continue;
    for (const s of sized.values())
      if (s.role === "branch" && s.downstreamIndex < rule.below_index && s.liquidMm < rule.liquid_mm) s.liquidMm = rule.liquid_mm;
  }

  /* (5a) PUHY: past 40 m from the first joint, the section where it is
     passed and everything after it one liquid size up, red past 90 m.
     A book with no step-up (PUMY) is red past its figure. */
  const limit = L.max_after_first_joint_m;
  const extended = L.extended_after_first_joint_m;
  if (firstFitting && drawn && limit != null && extended != null) {
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
  } else if (firstFitting && drawn && limit != null && afterFirstM != null && afterFirstM > limit) {
    findings.push({
      severity: "red",
      code: "after-first-joint-over",
      message: `The pipework runs ${fmtM(afterFirstM)} past the first joint, over the book's ${limit} m`,
      fix: "Move the first joint closer to the heads, or the outdoor",
    });
  }

  /* (5b) PUHY: heads more than 15 m from the base level take their own liquid
     one size up (never twice), red past the extended figure. Without a
     step-up (PUMY), heads off joints more than the figure apart are red. */
  const cmHeads = heads.filter((h) => !onBox(h));
  if (drawn && cmHeads.length > 1) {
    const base = cmHeads.map((h) => levelOf(h.id)).reduce((b, v) => (Math.abs(v) < Math.abs(b) ? v : b));
    const limitH = L.max_lift_idu_idu_m;
    const extendedH = L.extended_lift_idu_idu_m;
    let worst = 0;
    for (const h of cmHeads) {
      const diff = Math.abs(levelOf(h.id) - base);
      worst = Math.max(worst, diff);
      if (extendedH == null || diff <= limitH) continue;
      const own = incoming.get(h.id);
      const sec = own ? sized.get(own.id) : undefined;
      if (sec && !sec.upsized) {
        sec.liquidMm = oneUp(sec.liquidMm);
        sec.upsized = true;
      }
    }
    const cap = extendedH ?? limitH;
    if (worst > cap)
      findings.push({
        severity: "red",
        code: "head-height-over",
        message: `Two heads are ${Math.round(worst)} m apart in height, over the book's ${cap} m`,
      });
  }

  /* fittings */
  const fittings: SizedFitting[] = [];
  const boxParts = pack.parts
    .filter((p) => p.part_type === "branch-box" && p.ports != null)
    .sort((a, b) => (a.ports ?? 0) - (b.ports ?? 0));
  for (const n of tree.nodes) {
    if (!seen.has(n.id)) continue;
    const outs = children.get(n.id) ?? [];
    const down = below.get(n.id) ?? 0;
    const first = n.id === firstFitting;
    if (n.kind === "box") {
      if (!outs.length) {
        findings.push({ severity: "red", code: "box-empty", message: "A branch box feeds no heads", fix: "Run its heads to it, or delete it" });
        continue;
      }
      /* a box feeds heads, one per port: a joint or another box after it is
         a drawing the book has no answer for (Isaac's walk B, 2026-09-29) */
      if (outs.some((s) => nodeById.get(s.to)?.kind !== "idu"))
        findings.push({
          severity: "red",
          code: "branch-after-box",
          message: "A branch box feeds heads only",
          fix: "Run each head to its own port, and take the next box off the main with a joint",
        });
      const part = boxParts.find((p) => (p.ports ?? 0) >= outs.length)?.model ?? null;
      fittings.push({ nodeId: n.id, kind: "box", part, downstreamIndex: down, branches: outs.length, first: false });
      if (!part)
        findings.push({ severity: "red", code: "no-fitting-part", message: `No branch box takes ${outs.length} heads`, fix: "Split them over two boxes" });
      for (const s of outs) {
        const h = nodeById.get(s.to);
        const u = h ? unitOf(h) : undefined;
        if (h?.kind === "idu" && u && !isBoxHead(pack, odu, u))
          findings.push({
            severity: "red",
            code: "not-box-head",
            message: isVrfHead(pack, u) ? `${u.model} goes on a joint, not a branch box` : `${odu.model}'s branch boxes can't take ${u.model}`,
          });
      }
      continue;
    }
    if (n.kind !== "joint") continue;
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
  const bb = odu.branch_boxes;
  if (boxes.length && bb && boxes.length > bb.max_boxes)
    findings.push({
      severity: "red",
      code: "box-count-over",
      message: `${boxes.length} branch boxes, and ${odu.model} takes up to ${bb.max_boxes}`,
    });

  const liquidM: Record<string, number> = {};
  for (const s of sized.values())
    if (s.lengthM != null) liquidM[key(s.liquidMm)] = (liquidM[key(s.liquidMm)] ?? 0) + s.lengthM;

  /* the charge to add, and the outdoor's maximum */
  let chargeG: number | null = null;
  const rule = table.additional_charge;
  if (drawn && farthestM != null && rule.method === "per_meter_by_liquid_size_by_farthest") {
    chargeG = evaluateVrfCharge(rule, {
      liquidM,
      farthestM,
      connectedIndex: below.get(root.id) ?? 0,
      connectedKw: belowKw.get(root.id) ?? 0,
      oduModel: odu.model,
      iduModels: heads.map((h) => h.model ?? ""),
    });
    if (chargeG != null && odu.max_charge_kg != null && odu.precharged_kg != null) {
      const total = odu.precharged_kg + chargeG / 1000;
      if (total > odu.max_charge_kg + 1e-9)
        findings.push({
          severity: "red",
          code: "charge-over",
          message: `The system holds ${Math.round(total * 10) / 10} kg of refrigerant, over ${odu.model}'s ${odu.max_charge_kg} kg`,
          fix: "Shorten the pipework",
        });
    }
  }

  return {
    sections: tree.sections.map((s) => sized.get(s.id)).filter((s): s is SizedSection => s != null),
    fittings,
    findings,
    method,
    liquidM,
    farthestM,
    farthestEquivM,
    totalM,
    chargeG,
    drawn,
    provisional: tree.provisional,
  };
}

/** the tree as DRAWN on the plan: from the outdoor through the system's
    refrigerant runs, joints, branch boxes and risers (graph.ts). A riser, or
    a joint with one run on, is passed through — its lengths add into one
    section; a branch box is always a node. A run
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
  /* a corner drawn on a run is a bend (the book's M counts them) */
  const bendsOf = new Map<string, number>();
  for (const o of doc.objects)
    if (o.type === "pipe-run" && o.geometry.kind === "polyline")
      bendsOf.set(o.id, Math.max(0, o.geometry.points.length - 2));
  type Step = { to: string; lengthM: number | null; riseM: number; bends: number; edge: string };
  const adj = new Map<string, Step[]>();
  for (const e of graph.edges) {
    const bends = bendsOf.get(e.id) ?? 0;
    adj.set(e.a, [...(adj.get(e.a) ?? []), { to: e.b, lengthM: e.lengthM, riseM: e.riseM, bends, edge: e.id }]);
    adj.set(e.b, [...(adj.get(e.b) ?? []), { to: e.a, lengthM: e.lengthM, riseM: -e.riseM, bends, edge: e.id }]);
  }
  /* walk out from the outdoor; every edge is used once, in the direction it
     is first met */
  const usedEdge = new Set<string>();
  const out = new Map<string, Step[]>();
  const seen = new Set([oduId]);
  const queue = [oduId];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const n of adj.get(cur) ?? []) {
      if (usedEdge.has(n.edge)) continue;
      usedEdge.add(n.edge);
      out.set(cur, [...(out.get(cur) ?? []), n]);
      if (!seen.has(n.to)) {
        seen.add(n.to);
        queue.push(n.to);
      }
    }
  }
  /* keep the outdoor, the heads and the joints that branch; pass the rest */
  const keep = (id: string): boolean =>
    id === oduId ||
    headModel.has(id) ||
    graph.nodes.get(id)?.type === "branch-box" ||
    (graph.nodes.get(id)?.type === "joint" && (out.get(id)?.length ?? 0) >= 2);
  const nodes: VrfTreeNode[] = [{ id: oduId, kind: "odu" }];
  const sections: VrfTreeSection[] = [];
  const joined = new Set<string>();
  const add = (
    from: string,
    to: string,
    lengthM: number | null,
    riseM: number,
    bends: number,
    guard: Set<string>,
    edges: string[]
  ) => {
    if (keep(to)) {
      sections.push({ id: `${from}>${to}`, from, to, lengthM, riseM, bends, edges });
      if (guard.has(to)) return;
      guard.add(to);
      if (headModel.has(to)) {
        joined.add(to);
        nodes.push({ id: to, kind: "idu", model: headModel.get(to) });
      } else {
        nodes.push({ id: to, kind: graph.nodes.get(to)?.type === "branch-box" ? "box" : "joint" });
      }
      for (const n of out.get(to) ?? []) add(to, n.to, n.lengthM, n.riseM, n.bends, guard, [n.edge]);
      return;
    }
    /* pass through: a riser, a joint with one run on, a unit not of this tree */
    for (const n of out.get(to) ?? [])
      add(
        from,
        n.to,
        lengthM == null || n.lengthM == null ? null : lengthM + n.lengthM,
        riseM + n.riseM,
        bends + n.bends,
        guard,
        [...edges, n.edge]
      );
  };
  const guard = new Set<string>([oduId]);
  for (const n of out.get(oduId) ?? []) add(oduId, n.to, n.lengthM, n.riseM, n.bends, guard, [n.edge]);
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
  /* before the drawing: the heads a branch box takes go on boxes */
  const boxed = new Set(
    heads
      .filter((h) => {
        const u = pack.indoor_units.find((x) => x.model === h.model);
        return u != null && !isVrfHead(pack, u) && isBoxHead(pack, odu, u);
      })
      .map((h) => h.id)
  );
  const ports = Math.max(1, ...pack.parts.filter((p) => p.part_type === "branch-box").map((p) => p.ports ?? 0));
  const tree =
    drawn && heads.length > 0 && joined === heads.length
      ? drawn.tree
      : provisionalVrfTree(oduAlloc.id, heads, boxed, ports);
  return { ...sizeVrfTree(pack, odu, tree), joined, heads: heads.length };
}

/** the section that feeds a head, sized */
export const headSection = (tree: SizedTree, headId: string): SizedSection | null =>
  tree.sections.find((s) => s.to === headId) ?? null;
