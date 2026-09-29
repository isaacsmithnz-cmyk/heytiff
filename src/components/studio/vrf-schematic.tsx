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

import { useMemo, useState } from "react";
import type { DesignDocument, DesignSystem } from "@/lib/studio/document";
import type { DataPack } from "@/lib/studio/packs/schema";
import { allocationsOf } from "@/lib/studio/allocations";
import { combinationWord } from "@/lib/studio/verdict";
import { systemVrfTree, type SizedFitting, type SizedSection } from "@/lib/studio/vrf-tree";
import { pairSize, sizeTone, type PipeUnits } from "@/lib/studio/pipe-sizes";

const COL = 132;
const ROW = 92;
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
}: {
  doc: DesignDocument;
  pack: DataPack;
  sys: DesignSystem;
  units: PipeUnits;
}) {
  const tree = useMemo(() => systemVrfTree(pack, sys, doc), [pack, sys, doc]);
  const [picked, setPicked] = useState<string | null>(null);

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
        pos.set(id, { x: PAD + leaf * COL + COL / 2, y: PAD + 18 + d * ROW });
        leaf++;
        return;
      }
      for (const c of ch) place(c.to, d + 1);
      const xs = ch.map((c) => pos.get(c.to)?.x).filter((x): x is number => x != null);
      pos.set(id, { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: PAD + 18 + d * ROW });
    };
    place(root, 0);
    const fit = new Map<string, SizedFitting>(tree.fittings.map((f) => [f.nodeId, f]));
    return {
      root,
      pos,
      fit,
      w: Math.max(PAD * 2 + leaf * COL, ODU_W + PAD * 2),
      h: PAD * 2 + 36 + depth * ROW + 26,
    };
  }, [tree]);

  const allocs = allocationsOf(sys);
  const oduModel = allocs.find((a) => a.role === "odu")?.model ?? "Outdoor";
  const zoneName = (headId: string) => {
    const roomId = allocs.find((a) => a.id === headId)?.roomId;
    const room = roomId ? doc.objects.find((o) => o.id === roomId) : undefined;
    return room ? String(room.props.name ?? "") : "";
  };
  const headModel = (id: string) => allocs.find((a) => a.id === id)?.model ?? "";
  const word = combinationWord(doc, pack, sys);

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

  const pickedSection = tree.sections.find((s) => s.id === picked);
  const pickedFitting = picked ? fit.get(picked) : undefined;

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
      <div className="ds-schem-scroll">
        <svg
          width={layout.w}
          height={layout.h}
          viewBox={`0 0 ${layout.w} ${layout.h}`}
          role="img"
          aria-label={`Pipework schematic for ${sys.name}`}
        >
          {tree.sections.map((s) => {
            const a = pos.get(s.from);
            const b = pos.get(s.to);
            if (!a || !b) return null;
            const mid = a.y + ROW * 0.45;
            const on = picked === s.id;
            return (
              <g
                key={s.id}
                className={`ds-schem-sec${on ? " on" : ""}`}
                style={{ color: `var(--pipe-${sizeTone(s.gasMm)})` }}
                onClick={() => setPicked(on ? null : s.id)}
              >
                <path d={`M${a.x} ${a.y} V${mid} H${b.x} V${b.y}`} />
                {/* a wide invisible twin so a thin line is easy to click */}
                <path className="hit" d={`M${a.x} ${a.y} V${mid} H${b.x} V${b.y}`} />
                <text x={b.x + 6} y={mid + 16}>
                  {pairSize(s.liquidMm, s.gasMm, units)}
                </text>
                {s.lengthM != null && (
                  <text className="len" x={b.x + 6} y={mid + 30}>
                    {`${s.lengthM.toFixed(1)} m`}
                  </text>
                )}
              </g>
            );
          })}
          {[...pos].map(([id, p]) => {
            if (id === layout.root)
              return (
                <g key={id} className="ds-schem-odu-n">
                  <rect x={p.x - ODU_W / 2} y={p.y - 18} width={ODU_W} height={28} rx={4} />
                  <text x={p.x} y={p.y + 1}>
                    {oduModel}
                  </text>
                </g>
              );
            const f = fit.get(id);
            const on = picked === id;
            if (f?.kind === "box")
              return (
                <g key={id} className={`ds-schem-box${on ? " on" : ""}`} onClick={() => setPicked(on ? null : id)}>
                  <rect x={p.x - 38} y={p.y - 11} width={76} height={22} rx={3} />
                  <text x={p.x} y={p.y + 4}>
                    {(f.part ?? "Box").replace(/^PAC-/, "")}
                  </text>
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
              <g key={id} className="ds-schem-head">
                <rect x={p.x - HEAD_W / 2} y={p.y} width={HEAD_W} height={36} rx={4} />
                <text x={p.x} y={p.y + 15}>
                  {headModel(id)}
                </text>
                <text className="zone" x={p.x} y={p.y + 29}>
                  {zoneName(id)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      {(pickedSection || pickedFitting) && (
        <dl className="ds-schem-card">
          {pickedSection && (
            <>
              <div>
                <dt>Pipe</dt>
                <dd>{`${nameOf(pickedSection.from)} to ${nameOf(pickedSection.to)}`}</dd>
              </div>
              <div>
                <dt>Liquid / gas</dt>
                <dd>{both(pickedSection)}</dd>
              </div>
              {pickedSection.lengthM != null && (
                <div>
                  <dt>Length</dt>
                  <dd>{`${pickedSection.lengthM.toFixed(1)} m`}</dd>
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
                .map((s) => (
                  <div key={s.id}>
                    <dt>{`Out to ${nameOf(s.to)}`}</dt>
                    <dd>{both(s)}</dd>
                  </div>
                ))}
            </>
          )}
        </dl>
      )}
    </section>
  );
}

/** every VRF system in the design, one schematic each — the Schematic tab */
export function SchematicView({
  doc,
  pack,
  units,
}: {
  doc: DesignDocument;
  pack: DataPack | null;
  units: PipeUnits;
}) {
  const vrfs = doc.systems.filter((s) => s.type === "vrf");
  return (
    <div className="ds-schem-page">
      {!pack ? null : vrfs.length === 0 ? (
        <p className="ds-schem-empty">No VRF system in this design yet.</p>
      ) : (
        vrfs.map((s) => <VrfSchematic key={s.id} doc={doc} pack={pack} sys={s} units={units} />)
      )}
    </div>
  );
}
