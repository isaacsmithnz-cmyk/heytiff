"use client";
/* ── the VRF schematic: the pipework tree as a diagram, from the outdoor down
   through its joints, headers and branch boxes to every head, each section in
   its size's colour with its sizes and length (Isaac, 2026-09-29: "I want to
   be able to see the schematic separately on the page to verify that it has
   been drawn correctly").

   It is drawn from the same sized tree the sheet and the plan read
   (vrf-tree.ts), so it can never disagree with them: the plan's tree once the
   pipework reaches every head, else the heads in zone order. A picked section
   or fitting says what it is under the drawing. */

import { useEffect, useMemo, useState } from "react";
import type { DesignDocument, DesignSystem } from "@/lib/studio/document";
import type { DataPack } from "@/lib/studio/packs/schema";
import { allocationsOf } from "@/lib/studio/allocations";
import { blockingFindings, combinationWord, strayFittingIds, systemFindings } from "@/lib/studio/verdict";
import { systemVrfTree, type SizedFitting, type SizedSection } from "@/lib/studio/vrf-tree";
import { TUBE_SIZES_MM, pairSize, setRunSizes, sizeTone, tubeSize, type PipeUnits } from "@/lib/studio/pipe-sizes";
import { attachOf, buildSystemGraph, manualRiserM, mountOf, setMount } from "@/lib/studio/graph";
import { polylineLength, unitsToMeters } from "@/lib/studio/geometry";
import { deleteFromSchematic, type SchematicTarget } from "@/lib/studio/joints";

const COL = 132;
const ROW = 92;
const RISER_ROW = 156;
const PAD = 24;
const HEAD_W = 116;
const ODU_W = 150;

interface Placed {
  x: number;
  y: number;
}

export function VrfSchematic({
  doc,
  pack,
  sys,
  units,
  onEdit,
}: {
  doc: DesignDocument;
  pack: DataPack;
  sys: DesignSystem;
  units: PipeUnits;
  /** change the document from the schematic (Delete, Erase): the host's own
      mutate, so its undo takes it back. Absent, the schematic only reads. */
  onEdit?: (fn: (d: DesignDocument) => DesignDocument) => void;
}) {
  const tree = useMemo(() => systemVrfTree(pack, sys, doc), [pack, sys, doc]);
  const [picked, setPicked] = useState<string | null>(null);
  /* the size being set by hand on the picked section, while its form is open */
  const [sizing, setSizing] = useState<{ id: string; liquidMm: number; gasMm: number } | null>(null);

  /* a system with a riser gets taller rows, so the riser's three lines sit
     clear of the pipe's own sizes (Isaac, 2026-09-30: "all of that's just a
     little bit too close together") */
  const row = tree?.sections.some((x) => x.edges.some((e) => e.startsWith("riser-gap:"))) ? RISER_ROW : ROW;
  const layout = useMemo(() => {
    if (!tree || !tree.sections.length) return null;
    const kids = new Map<string, SizedSection[]>();
    const tos = new Set<string>();
    for (const s of tree.sections) {
      kids.set(s.from, [...(kids.get(s.from) ?? []), s]);
      tos.add(s.to);
    }
    const root = tree.sections.find((s) => !tos.has(s.from))?.from ?? tree.sections[0].from;
    const pos = new Map<string, Placed>();
    let leaf = 0;
    let depth = 0;
    const seen = new Set<string>();
    const place = (id: string, d: number) => {
      if (seen.has(id)) return;
      seen.add(id);
      depth = Math.max(depth, d);
      const ch = (kids.get(id) ?? []).filter((s) => !seen.has(s.to));
      if (!ch.length) {
        pos.set(id, { x: PAD + leaf * COL + COL / 2, y: PAD + 18 + d * row });
        leaf++;
        return;
      }
      for (const c of ch) place(c.to, d + 1);
      const xs = ch.map((c) => pos.get(c.to)?.x).filter((x): x is number => x != null);
      pos.set(id, { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: PAD + 18 + d * row });
    };
    place(root, 0);
    const fit = new Map<string, SizedFitting>(tree.fittings.map((f) => [f.nodeId, f]));
    return {
      root,
      pos,
      fit,
      w: Math.max(PAD * 2 + leaf * COL, ODU_W + PAD * 2),
      /* room under the lowest heads for their floor and height */
      h: PAD * 2 + 36 + depth * row + 42,
    };
  }, [tree, row]);

  const allocs = allocationsOf(sys);
  const oduModel = allocs.find((a) => a.role === "odu")?.model ?? "Outdoor";
  const zoneName = (headId: string) => {
    const roomId = allocs.find((a) => a.id === headId)?.roomId;
    const room = roomId ? doc.objects.find((o) => o.id === roomId) : undefined;
    return room ? String(room.props.name ?? "") : "";
  };
  const headModel = (id: string) => allocs.find((a) => a.id === id)?.model ?? "";
  const word = combinationWord(doc, pack, sys);
  /* a failing system says why under its name, in the rail's words */
  const reds = word === "Fails" ? blockingFindings(systemFindings(doc, pack, sys)) : [];

  /* DELETE on the schematic (Isaac, 2026-09-29): what is picked goes — a
     section's drawn runs, a joint (its run put back together), a box, or a
     loose pipe — through the host, so ⌘Z brings it back */
  const targetOf = (id: string | null): SchematicTarget | null => {
    if (!id) return null;
    if (id.startsWith("loose:")) return { kind: "runs", ids: [id.slice(6)] };
    if (id.startsWith("stray:")) {
      const o = doc.objects.find((x) => x.id === id.slice(6));
      if (!o) return null;
      return o.type === "branch-box" ? { kind: "box", id: o.id } : o.type === "riser" ? { kind: "riser", id: o.id } : { kind: "joint", id: o.id };
    }
    if (!tree || !layout) return null;
    const f = layout.fit.get(id);
    if (f) return f.kind === "box" ? { kind: "box", id } : { kind: "joint", id };
    const sec = tree.sections.find((x) => x.id === id);
    const runs = new Set(doc.objects.filter((o) => o.type === "pipe-run").map((o) => o.id));
    const ids = sec ? sec.edges.filter((e) => runs.has(e)) : [];
    return ids.length ? { kind: "runs", ids } : null;
  };
  const target = targetOf(picked);
  const erase = () => {
    if (!onEdit || !target) return;
    onEdit((d) => deleteFromSchematic(d, target));
    setPicked(null);
  };
  useEffect(() => {
    if (!onEdit || !target) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable) return;
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      e.preventDefault();
      onEdit((d) => deleteFromSchematic(d, target));
      setPicked(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onEdit, target]);

  if (!tree || !layout) {
    return (
      <section className="ds-schem">
        <header className="ds-schem-h">
          <h3>{sys.name}</h3>
        </header>
        <p className="ds-schem-empty">Add an outdoor and heads to see the pipework.</p>
      </section>
    );
  }

  const { pos, fit } = layout;
  const nameOf = (id: string) =>
    id === layout.root
      ? "Outdoor unit"
      : headModel(id) ||
        (fit.get(id)?.kind === "box" ? "Branch box" : fit.get(id)?.kind === "header" ? "Header" : "Joint");
  const both = (s: SizedSection) =>
    `${pairSize(s.liquidMm, s.gasMm, units)} (${pairSize(s.liquidMm, s.gasMm, units === "in" ? "mm" : "in")})`;

  /* HOW EACH SECTION IS DRAWN (Isaac, 2026-09-29, on walk C). Off a joint
     or header the branches leave the T sideways, so the pipe into it runs
     straight down to the T and the split is AT the fitting. Off a branch box
     each head has its own port and its own pipe — a box is not a joint, and
     a shared header line made it read like an outdoor. Ports run along the
     box's foot in the order of the heads under it; a pipe going out sideways
     drops to a lane of its own first, the farthest out on the highest lane,
     so no two cross. Anything else (off the outdoor) drops, turns, drops. */
  const boxW = (id: string) => Math.max(76, (tree.sections.filter((s) => s.from === id).length || 1) * 28 + 12);
  const route = (s: SizedSection): { d: string; label: { x: number; y: number }; riser: { x: number; y: number } } | null => {
    const a = pos.get(s.from);
    const b = pos.get(s.to);
    if (!a || !b) return null;
    const f = fit.get(s.from);
    if (f && f.kind !== "box")
      return {
        d: `M${a.x} ${a.y} H${b.x} V${b.y}`,
        label: { x: b.x + 6, y: a.y + 16 },
        riser: { x: b.x, y: a.y + 52 },
      };
    if (f?.kind === "box") {
      const outs = tree.sections
        .filter((x) => x.from === s.from)
        .sort((x, y) => (pos.get(x.to)?.x ?? 0) - (pos.get(y.to)?.x ?? 0));
      const w = boxW(s.from);
      const i = outs.findIndex((x) => x.id === s.id);
      const px = a.x - w / 2 + ((i + 0.5) * w) / outs.length;
      const foot = a.y + 11;
      if (Math.abs(b.x - px) < 1)
        return { d: `M${px} ${foot} V${b.y}`, label: { x: b.x + 6, y: b.y - 24 }, riser: { x: px, y: foot + (b.y - foot) * 0.3 } };
      const left = b.x < px;
      const side = outs.filter((x) => {
        const bx = pos.get(x.to)?.x ?? 0;
        const xi = outs.indexOf(x);
        const xp = a.x - w / 2 + ((xi + 0.5) * w) / outs.length;
        return left ? bx < xp - 1 : bx > xp + 1;
      });
      const rank = left ? side.indexOf(s) : side.length - 1 - side.indexOf(s);
      const lane = foot + 10 + rank * 10;
      return {
        d: `M${px} ${foot} V${lane} H${b.x} V${b.y}`,
        label: { x: b.x + 6, y: b.y - 24 },
        riser: { x: b.x, y: lane + (b.y - lane) * 0.25 },
      };
    }
    const mid = a.y + row * 0.45;
    return {
      d: `M${a.x} ${a.y} V${mid} H${b.x} V${b.y}`,
      label: { x: b.x + 6, y: mid + 16 },
      /* under the pipe's sizes, clear of them */
      riser: { x: b.x, y: mid + 44 },
    };
  };

  /* PIPES THAT GO NOWHERE (verdict.ts loosePipes) are no part of the tree,
     so they'd be invisible here: each is drawn as a red dashed stub off the
     fitting or unit it leaves, or listed under the drawing when it leaves
     nothing on it, and a click offers to erase it (Isaac, 2026-09-29). */
  const loose = doc.objects
    .filter(
      (o) =>
        o.type === "pipe-run" &&
        o.systemId === sys.id &&
        (!attachOf(o.props.startAttach) || !attachOf(o.props.endAttach))
    )
    .map((o) => {
      const at = attachOf(o.props.startAttach) ?? attachOf(o.props.endAttach);
      /* a joint the tree passes through is not drawn: stub off the node its
         section starts from */
      const touching = at
        ? new Set(
            doc.objects
              .filter(
                (r) =>
                  r.type === "pipe-run" &&
                  (attachOf(r.props.startAttach)?.id === at.id || attachOf(r.props.endAttach)?.id === at.id)
              )
              .map((r) => r.id)
          )
        : new Set<string>();
      const via = at && !pos.has(at.id) ? tree.sections.find((x) => x.edges.some((e) => touching.has(e))) : undefined;
      const anchorId = at ? (pos.has(at.id) ? at.id : (via?.to ?? null)) : null;
      const scale = doc.floors.find((f) => f.id === o.floorId)?.scaleMmPerUnit ?? null;
      const pts = o.geometry.kind === "polyline" ? o.geometry.points : [];
      return {
        id: o.id,
        anchorId,
        from: at ? (anchorId ? nameOf(anchorId) : "a joint") : null,
        lengthM: scale != null && pts.length > 1 ? unitsToMeters(polylineLength(pts), scale) : null,
      };
    });
  const pickedLoose = loose.find((l) => `loose:${l.id}` === picked);
  /* joints that branch nothing and boxes with no pipe: no part of the tree,
     so listed under the drawing like a loose pipe, to be deleted */
  const stray = (() => {
    const { joints, boxes, risers } = strayFittingIds(doc, sys);
    const riserWhat = (id: string) => {
      const o = doc.objects.find((x) => x.id === id);
      const floor = doc.floors.find((f) => f.id === o?.floorId)?.name ?? "its floor";
      return `Riser ${String(o?.props.group ?? "A")} has no pipe on ${floor}`;
    };
    return [
      ...risers.map((id) => ({ id, what: riserWhat(id) })),
      ...joints.map((id) => ({ id, what: "Joint not connected" })),
      ...boxes.map((id) => ({ id, what: "Branch box not connected" })),
    ];
  })();
  const pickedStray = stray.find((x) => `stray:${x.id}` === picked);



  const pickedSection = tree.sections.find((s) => s.id === picked);
  const pickedFitting = picked ? fit.get(picked) : undefined;

  /* HEIGHTS (Isaac, 2026-09-30): each unit and box on the plan stands at its
     floor's height in the stack plus its own height on the floor; the book's
     lift limits read how far each is above or below the outdoor. Shown on
     the drawing once anything differs, and set on the picked one. */
  const showLevels = Object.values(tree.levels).some((v) => v !== 0);
  /* RISERS (Isaac, 2026-09-30: "I can't see the riser on the schematic"):
     a section that goes up or down a riser wears it — a marker on its pipe
     with the riser's letter and height — and once the system is on more than
     one floor every head says which floor it is on */
  const risersOf = (() => {
    const graph = buildSystemGraph(doc.objects, doc.floors, sys.id);
    const floorName = (id: string | undefined) => doc.floors.find((f) => f.id === id)?.name ?? "a floor";
    const out = new Map<
      string,
      {
        group: string;
        lengthM: number;
        manual: boolean;
        up: boolean;
        from: string;
        to: string;
        pieces: string;
        /** the section's pipe before its first riser and after its last */
        beforeM: number;
        afterM: number;
      }[]
    >();
    for (const sec of tree.sections) {
      /* the section's pipe on each floor, apart from the riser itself, so
         the run from the riser to the next junction reads on its own
         (Isaac, 2026-09-30: "I can't see the distance between riser A and
         the next junction") */
      const perFloor = new Map<string, number>();
      for (const e of sec.edges) {
        const run = doc.objects.find((o) => o.id === e && o.type === "pipe-run");
        const m = graph.edges.find((x) => x.id === e)?.lengthM;
        if (run && m != null) perFloor.set(run.floorId, (perFloor.get(run.floorId) ?? 0) + m);
      }
      const pieces = [...perFloor]
        .filter(([, m]) => m > 0.05)
        .map(([f, m]) => `${Math.round(m * 10) / 10} m on ${floorName(f)}`)
        .join(", ");
      /* the pipe before the riser and after it, each labelled on its own
         stretch of the drawing (Isaac, 2026-09-30: "the five point five
         metres should move next to that section of pipe") */
      const gaps = sec.edges.map((e, i) => (e.startsWith("riser-gap:") ? i : -1)).filter((i) => i >= 0);
      const runM = (ids: string[]) => ids.reduce((t, e) => t + (graph.edges.find((x) => x.id === e)?.lengthM ?? 0), 0);
      const beforeM = gaps.length ? runM(sec.edges.slice(0, gaps[0])) : 0;
      const afterM = gaps.length ? runM(sec.edges.slice(gaps[gaps.length - 1] + 1)) : 0;
      for (const e of sec.edges) {
        if (!e.startsWith("riser-gap:")) continue;
        const g = graph.edges.find((x) => x.id === e);
        const lower = g ? graph.nodes.get(g.a) : undefined;
        const upper = g ? graph.nodes.get(g.b) : undefined;
        if (!g || !lower || !upper) continue;
        /* which way this section takes it: toward its downstream end */
        const up = (tree.levels[sec.to] ?? 0) >= (tree.levels[sec.from] ?? 0);
        out.set(sec.id, [
          ...(out.get(sec.id) ?? []),
          {
            group: String(lower.props.group ?? "A"),
            lengthM: g.lengthM ?? 0,
            manual: manualRiserM(lower) != null,
            up,
            from: floorName((up ? lower : upper).floorId),
            to: floorName((up ? upper : lower).floorId),
            pieces,
            beforeM,
            afterM,
          },
        ]);
      }
    }
    return out;
  })();
  const floorOf = (id: string) => {
    const o = doc.objects.find((x) => x.id === id);
    return o ? doc.floors.find((f) => f.id === o.floorId) : undefined;
  };
  const manyFloors =
    new Set(tree.sections.flatMap((x) => [x.from, x.to]).map((id) => floorOf(id)?.id).filter(Boolean)).size > 1;
  const metres = (v: number) => `${Math.round(Math.abs(v) * 10) / 10} m`;
  const levelTag = (id: string) => {
    const v = tree.levels[id];
    return v == null ? null : v === 0 ? "0 m" : `${v > 0 ? "+" : "\u2212"}${metres(v)}`;
  };
  const levelWords = (id: string) => {
    const v = tree.levels[id];
    if (v == null) return null;
    if (v === 0) return "level with the outdoor";
    return `${metres(v)} ${v > 0 ? "above" : "below"} the outdoor`;
  };
  const pickedUnit =
    picked && (picked === layout.root || (pos.has(picked) && !fit.has(picked))) ? picked : null;
  const heightTarget = pickedUnit ?? (pickedFitting?.kind === "box" ? pickedFitting.nodeId : null);
  const heightObj = heightTarget ? doc.objects.find((o) => o.id === heightTarget) : undefined;
  const heightFloor = heightObj ? doc.floors.find((f) => f.id === heightObj.floorId) : undefined;

  return (
    <section className="ds-schem">
      <header className="ds-schem-h">
        <h3>{sys.name}</h3>
        <span className="ds-schem-odu">{oduModel}</span>
        {word && <span className={`ds-schem-word${word === "Fails" ? " bad" : ""}`}>{word}</span>}
        <span className="ds-schem-src">
          {tree.drawn ? "As drawn on the plan" : "From the zones, until the pipework reaches every head"}
        </span>
      </header>
      {/* NOT PIPED YET (Isaac, 2026-09-30: "there's no pipe work connecting to
          zone five and zone six. But it's showing up on the schematic as
          though they are"): until the drawing reaches every head the pipes
          here are the zones' order, dashed, and the heads it misses are named */}
      {!tree.drawn && tree.joined > 0 && tree.unjoined.length > 0 && (
        <p className="ds-schem-unpiped">
          {`Not piped to the outdoor yet: ${tree.unjoined.map((id) => zoneName(id) || headModel(id)).join(", ")}`}
        </p>
      )}
      {reds.length > 0 && (
        <ul className="ds-schem-why">
          {reds.map((f, i) => (
            <li key={i}>{f.fix ? `${f.message}. ${f.fix}.` : `${f.message}.`}</li>
          ))}
        </ul>
      )}
      <div className="ds-schem-scroll">
        <svg
          width={layout.w}
          height={layout.h}
          viewBox={`0 0 ${layout.w} ${layout.h}`}
          role="img"
          aria-label={`Pipework schematic for ${sys.name}`}
        >
          {tree.sections.map((s) => {
            const r = route(s);
            if (!r) return null;
            const on = picked === s.id;
            return (
              <g
                key={s.id}
                className={`ds-schem-sec${on ? " on" : ""}${tree.drawn ? "" : " guess"}`}
                style={{ color: `var(--pipe-${sizeTone(s.gasMm)})` }}
                onClick={() => setPicked(on ? null : s.id)}
              >
                <path d={r.d} />
                {/* a wide invisible twin so a thin line is easy to click */}
                <path className="hit" d={r.d} />
                <text x={r.label.x} y={r.label.y}>
                  {pairSize(s.liquidMm, s.gasMm, units)}
                </text>
                {(() => {
                  /* with a riser in it, the length here is the pipe before
                     the riser; the pipe after it is labelled on its own
                     stretch below */
                  const rz = risersOf.get(s.id)?.[0];
                  const m = rz ? rz.beforeM : s.lengthM;
                  return m != null && m > 0.05 ? (
                    <text className="len" x={r.label.x} y={r.label.y + 14}>
                      {`${m.toFixed(1)} m`}
                    </text>
                  ) : null;
                })()}
                {(risersOf.get(s.id) ?? []).map((rz, k) => (
                  <g key={k} className="ds-schem-riser" transform={`translate(${r.riser.x} ${r.riser.y + k * 52})`}>
                    <circle r={9} />
                    <text className="id" y={4}>
                      {rz.group}
                    </text>
                    {/* what it is, then what it does */}
                    <text className="name" x={16} y={4}>
                      {`Riser ${rz.group}`}
                    </text>
                    <text className="rise" x={16} y={21}>
                      {`${Math.round(rz.lengthM * 10) / 10} m ${rz.up ? "up" : "down"} to ${rz.to}`}
                    </text>
                  </g>
                ))}
                {(() => {
                  const rs = risersOf.get(s.id) ?? [];
                  const last = rs[rs.length - 1];
                  if (!last || last.afterM <= 0.05) return null;
                  const b = pos.get(s.to);
                  if (!b) return null;
                  /* halfway down the stretch between the riser's words and
                     the next fitting or head */
                  const top = r.riser.y + (rs.length - 1) * 52 + 30;
                  return (
                    <text className="len" x={r.riser.x + 6} y={(top + b.y) / 2 + 4}>
                      {`${last.afterM.toFixed(1)} m`}
                    </text>
                  );
                })()}
              </g>
            );
          })}
          {loose.map((l, k) => {
            const p = l.anchorId ? pos.get(l.anchorId) : undefined;
            if (!p) return null;
            const on = picked === `loose:${l.id}`;
            const x2 = p.x + 44 + k * 10;
            const y2 = p.y + 28;
            return (
              <g key={l.id} className={`ds-schem-loose${on ? " on" : ""}`} onClick={() => setPicked(on ? null : `loose:${l.id}`)}>
                <path d={`M${p.x} ${p.y} H${x2} V${y2}`} />
                <path className="hit" d={`M${p.x} ${p.y} H${x2} V${y2}`} />
                <circle cx={x2} cy={y2} r={4} />
                <text x={x2 + 7} y={y2 + 4}>
                  Not connected
                </text>
              </g>
            );
          })}
          {[...pos].map(([id, p]) => {
            const on = picked === id;
            if (id === layout.root)
              return (
                <g key={id} className={`ds-schem-odu-n${on ? " on" : ""}`} onClick={() => setPicked(on ? null : id)}>
                  <rect x={p.x - ODU_W / 2} y={p.y - 18} width={ODU_W} height={28} rx={4} />
                  <text x={p.x} y={p.y + 1}>
                    {oduModel}
                  </text>
                </g>
              );
            const f = fit.get(id);
            if (f?.kind === "box")
              return (
                <g key={id} className={`ds-schem-box${on ? " on" : ""}`} onClick={() => setPicked(on ? null : id)}>
                  <rect x={p.x - boxW(id) / 2} y={p.y - 11} width={boxW(id)} height={22} rx={3} />
                  <text x={p.x} y={p.y + 4}>
                    {(f.part ?? "Box").replace(/^PAC-/, "")}
                  </text>
                  {showLevels && levelTag(id) && (
                    <text className="lvl" x={p.x + boxW(id) / 2 + 6} y={p.y + 4}>
                      {levelTag(id)}
                    </text>
                  )}
                </g>
              );
            if (f)
              return (
                <g key={id} className={`ds-schem-joint${on ? " on" : ""}`} onClick={() => setPicked(on ? null : id)}>
                  {f.kind === "header" ? (
                    <rect x={p.x - 16} y={p.y - 5} width={32} height={10} />
                  ) : (
                    <rect x={p.x - 6} y={p.y - 6} width={12} height={12} />
                  )}
                </g>
              );
            return (
              <g key={id} className={`ds-schem-head${on ? " on" : ""}`} onClick={() => setPicked(on ? null : id)}>
                <rect x={p.x - HEAD_W / 2} y={p.y} width={HEAD_W} height={36} rx={4} />
                <text x={p.x} y={p.y + 15}>
                  {headModel(id)}
                </text>
                <text className="zone" x={p.x} y={p.y + 29}>
                  {zoneName(id)}
                </text>
                {(showLevels || manyFloors) && (levelTag(id) || floorOf(id)) && (
                  <text className="lvl" x={p.x} y={p.y + 52}>
                    {[manyFloors ? floorOf(id)?.name : null, showLevels ? levelTag(id) : null].filter(Boolean).join(", ")}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
      {stray.length > 0 && (
        <div className="ds-schem-loose-list">
          {stray.map((x) => (
            <button key={x.id} type="button" className="ds-schem-loose-btn" onClick={() => setPicked(`stray:${x.id}`)}>
              {x.what}
            </button>
          ))}
        </div>
      )}
      {loose.some((l) => !l.anchorId) && (
        <div className="ds-schem-loose-list">
          {loose
            .filter((l) => !l.anchorId)
            .map((l) => (
              <button key={l.id} type="button" className="ds-schem-loose-btn" onClick={() => setPicked(`loose:${l.id}`)}>
                {`Pipe not connected${l.lengthM != null ? `, ${l.lengthM.toFixed(1)} m` : ""}`}
              </button>
            ))}
        </div>
      )}
      {(pickedLoose || pickedStray || pickedSection || pickedFitting || pickedUnit) && (
        /* THE PICKED THING, pinned under the drawing with what can be done to
           it (Isaac, 2026-09-29): Delete for anything, Override for a pipe's
           size — the same place a duct will take its size by hand */
        <div className="ds-schem-inspect" role="region" aria-label="Selected on the schematic">
          <dl className="ds-schem-card">
            {pickedUnit && (
              <div>
                <dt>{pickedUnit === layout.root ? "Outdoor unit" : "Indoor unit"}</dt>
                <dd>
                  {pickedUnit === layout.root
                    ? oduModel
                    : [headModel(pickedUnit), zoneName(pickedUnit)].filter(Boolean).join(", ")}
                </dd>
              </div>
            )}
            {heightTarget && (
              <div>
                <dt>Height</dt>
                <dd>
                  {heightObj
                    ? [
                        mountOf(heightObj) === 0
                          ? `On ${heightFloor?.name ?? "its floor"}`
                          : `${metres(mountOf(heightObj))} ${mountOf(heightObj) > 0 ? "above" : "below"} ${heightFloor?.name ?? "its floor"}`,
                        heightTarget === layout.root ? null : levelWords(heightTarget),
                      ]
                        .filter(Boolean)
                        .join(", ")
                    : "Not on the plan yet"}
                </dd>
              </div>
            )}
            {pickedStray && (
              <div>
                <dt>On the plan</dt>
                <dd>{pickedStray.what}</dd>
              </div>
            )}
            {pickedLoose && (
              <>
                <div>
                  <dt>Pipe</dt>
                  <dd>{pickedLoose.from ? `From ${pickedLoose.from}, not connected at the other end` : "Not connected at either end"}</dd>
                </div>
                {pickedLoose.lengthM != null && (
                  <div>
                    <dt>Length</dt>
                    <dd>{`${pickedLoose.lengthM.toFixed(1)} m`}</dd>
                  </div>
                )}
              </>
            )}
            {pickedSection && (
              <>
                <div>
                  <dt>Pipe</dt>
                  <dd>{`${nameOf(pickedSection.from)} to ${nameOf(pickedSection.to)}`}</dd>
                </div>
                <div>
                  <dt>{pickedSection.override ? "Liquid / gas, set by hand" : "Liquid / gas"}</dt>
                  <dd>{both(pickedSection)}</dd>
                </div>
                {pickedSection.override && (
                  <div>
                    <dt>{"The book's size"}</dt>
                    <dd>{pairSize(pickedSection.override.bookLiquidMm, pickedSection.override.bookGasMm, units)}</dd>
                  </div>
                )}
                {pickedSection.lengthM != null && (
                  <div>
                    <dt>Length</dt>
                    <dd>{`${pickedSection.lengthM.toFixed(1)} m`}</dd>
                  </div>
                )}
                {(risersOf.get(pickedSection.id) ?? []).map((rz, k) => (
                  <div key={`riser${k}`}>
                    <dt>{`Riser ${rz.group}`}</dt>
                    <dd>
                      {`${Math.round(rz.lengthM * 10) / 10} m, ${rz.from} to ${rz.to}${rz.manual ? ", set by hand" : ""}`}
                    </dd>
                  </div>
                ))}
                {(risersOf.get(pickedSection.id)?.[0]?.pieces ?? "") && (
                  <div>
                    <dt>Pipe on the floors</dt>
                    <dd>{risersOf.get(pickedSection.id)![0].pieces}</dd>
                  </div>
                )}
              </>
            )}
            {pickedFitting && (
              <>
                <div>
                  <dt>{pickedFitting.kind === "box" ? "Branch box" : pickedFitting.kind === "header" ? "Header" : "Joint"}</dt>
                  <dd>{pickedFitting.part ?? "No part in the book"}</dd>
                </div>
                {tree.sections
                  .filter((s) => s.to === pickedFitting.nodeId)
                  .map((s) => (
                    <div key={s.id}>
                      <dt>In</dt>
                      <dd>{both(s)}</dd>
                    </div>
                  ))}
                {tree.sections
                  .filter((s) => s.from === pickedFitting.nodeId)
                  .map((s) => {
                    const port = pickedFitting.ports?.find((p) => p.to === s.to);
                    const fits = port?.reducer
                      ? [port.reducer.liquid, port.reducer.gas]
                          .filter((r): r is NonNullable<typeof r> => r != null)
                          .map((r) => r.part ?? `${r.fromMm} to ${r.toMm} mm joint`)
                          .join(" + ")
                      : "";
                    return (
                      <div key={s.id}>
                        <dt>{`Out to ${nameOf(s.to)}${port ? ` (port ${port.port})` : ""}`}</dt>
                        <dd>{`${both(s)}${fits ? `, needs ${fits} at the box` : ""}`}</dd>
                      </div>
                    );
                  })}
              </>
            )}
          </dl>
          {onEdit && pickedSection && sizing?.id === pickedSection.id && (
            <div className="ds-schem-size">
              {(["liquidMm", "gasMm"] as const).map((k) => (
                <label key={k}>
                  <span>{k === "liquidMm" ? "Liquid" : "Gas"}</span>
                  <select
                    value={sizing[k]}
                    onChange={(e) => setSizing({ ...sizing, [k]: Number(e.target.value) })}
                  >
                    {TUBE_SIZES_MM.map((mm) => (
                      <option key={mm} value={mm}>
                        {tubeSize(mm, units)}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
              <button
                type="button"
                className="ds-schem-act primary"
                onClick={() => {
                  const edges = pickedSection.edges;
                  const size = { liquidMm: sizing.liquidMm, gasMm: sizing.gasMm };
                  onEdit((d) => setRunSizes(d, edges, size));
                  setSizing(null);
                }}
              >
                Save size
              </button>
              <button type="button" className="ds-schem-act" onClick={() => setSizing(null)}>
                Cancel
              </button>
            </div>
          )}
          {onEdit && heightObj && (
            <label className="ds-schem-mount">
              <span>Height above the floor</span>
              <input
                key={heightObj.id}
                type="number"
                step={0.1}
                min={-20}
                max={200}
                defaultValue={mountOf(heightObj) || ""}
                placeholder="0"
                onBlur={(e) => {
                  const v = e.currentTarget.value.trim();
                  const m = v === "" ? 0 : Number(v);
                  if (!Number.isFinite(m) || m === mountOf(heightObj)) return;
                  const id = heightObj.id;
                  onEdit((d) => setMount(d, id, m));
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                }}
              />
              <span>m</span>
            </label>
          )}
          {onEdit && (
            <div className="ds-schem-actions">
              {pickedSection && pickedSection.edges.length > 0 && sizing?.id !== pickedSection.id && (
                <button
                  type="button"
                  className="ds-schem-act"
                  onClick={() =>
                    setSizing({ id: pickedSection.id, liquidMm: pickedSection.liquidMm, gasMm: pickedSection.gasMm })
                  }
                >
                  Override size
                </button>
              )}
              {pickedSection?.override && (
                <button
                  type="button"
                  className="ds-schem-act"
                  onClick={() => {
                    const edges = pickedSection.edges;
                    onEdit((d) => setRunSizes(d, edges, null));
                  }}
                >
                  {"Use the book's size"}
                </button>
              )}
              {target && (
                <button type="button" className="ds-schem-act bad" onClick={erase}>
                  Delete
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/** every VRF system in the design, one schematic each — the Schematic tab */
export function SchematicView({
  doc,
  pack,
  units,
  onEdit,
}: {
  doc: DesignDocument;
  pack: DataPack | null;
  units: PipeUnits;
  onEdit?: (fn: (d: DesignDocument) => DesignDocument) => void;
}) {
  const vrfs = doc.systems.filter((s) => s.type === "vrf");
  return (
    <div className="ds-schem-page">
      {!pack ? null : vrfs.length === 0 ? (
        <p className="ds-schem-empty">No VRF system in this design yet.</p>
      ) : (
        vrfs.map((s) => <VrfSchematic key={s.id} doc={doc} pack={pack} sys={s} units={units} onEdit={onEdit} />)
      )}
    </div>
  );
}
