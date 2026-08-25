"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import {
  NODES,
  EDGES,
  LAYERS,
  layerOf,
  nodeById,
  drawsFrom,
  feeds,
  standaloneIds,
  neighbourhood,
  type MapNode,
  type NodeKind,
} from "@/lib/hq/system-map";

/* The family-tree board for /hq/map. Nodes render as cards in three layer
   columns (features → engines → data); edges are measured off the live DOM and
   drawn as beziers in an SVG underlay, so the layout keeps itself correct as
   registry entries come and go. Click a piece to light up its family and open
   the inspector; everything else dims. */

const KIND_META: Record<NodeKind, { label: string; color: string }> = {
  surface: { label: "Surface", color: "#6aa2ff" },
  feature: { label: "Feature", color: "#00e5c0" },
  engine: { label: "Engine", color: "#b48bff" },
  store: { label: "Data store", color: "#ffcf5c" },
  external: { label: "External", color: "#8b959e" },
};

type Wire = {
  d: string;
  from: string;
  to: string;
  planned: boolean;
};

/** Column layout: layer index → its groups (insertion order) → their nodes. */
function columns(): { title: string; groups: { name: string; nodes: MapNode[] }[] }[] {
  return LAYERS.map((layer, li) => {
    const groups: { name: string; nodes: MapNode[] }[] = [];
    for (const n of NODES) {
      if (layerOf(n) !== li) continue;
      let g = groups.find((x) => x.name === n.group);
      if (!g) {
        g = { name: n.group, nodes: [] };
        groups.push(g);
      }
      g.nodes.push(n);
    }
    return { title: layer.title, groups };
  });
}

const COLS = columns();
const STANDALONE = new Set(standaloneIds());

export function SystemMap() {
  const boardRef = useRef<HTMLDivElement>(null);
  const nodeRefs = useRef(new Map<string, HTMLButtonElement>());
  const [wires, setWires] = useState<Wire[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);

  const measure = useCallback(() => {
    const board = boardRef.current;
    if (!board) return;
    const base = board.getBoundingClientRect();
    const rect = (id: string) => {
      const el = nodeRefs.current.get(id);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        left: r.left - base.left,
        right: r.right - base.left,
        midY: r.top - base.top + r.height / 2,
      };
    };
    const next: Wire[] = [];
    for (const e of EDGES) {
      const a = rect(e.from);
      const b = rect(e.to);
      const na = nodeById(e.from);
      const nb = nodeById(e.to);
      if (!a || !b || !na || !nb) continue;
      const ca = layerOf(na);
      const cb = layerOf(nb);
      let d: string;
      if (ca === cb) {
        // same-column relation: loop out through the gap on the right
        const x = Math.max(a.right, b.right);
        d = `M ${a.right} ${a.midY} C ${x + 46} ${a.midY}, ${x + 46} ${b.midY}, ${b.right} ${b.midY}`;
      } else {
        const [sx, sy, ex, ey] =
          ca < cb ? [a.right, a.midY, b.left, b.midY] : [a.left, a.midY, b.right, b.midY];
        const mx = (sx + ex) / 2;
        d = `M ${sx} ${sy} C ${mx} ${sy}, ${mx} ${ey}, ${ex} ${ey}`;
      }
      next.push({ d, from: e.from, to: e.to, planned: e.status === "planned" });
    }
    setWires(next);
  }, []);

  useLayoutEffect(() => {
    measure();
    const board = boardRef.current;
    if (!board || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(board);
    return () => ro.disconnect();
  }, [measure]);

  useEffect(() => {
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [measure]);

  const focusId = hovered ?? selected;
  const family = selected ? neighbourhood(selected) : null;

  const wireClass = (w: Wire) => {
    let cls = "hq-map-wire";
    if (w.planned) cls += " planned";
    if (focusId) {
      if (w.from === focusId) cls += " out";
      else if (w.to === focusId) cls += " in";
      else if (selected) cls += " off";
    }
    return cls;
  };

  const nodeClass = (n: MapNode) => {
    let cls = "hq-map-node";
    if (selected === n.id) cls += " sel";
    else if (family && !family.has(n.id)) cls += " dim";
    return cls;
  };

  return (
    <div className="hq-map-layout">
      <div className="hq-map-scroll">
        <div
          className="hq-map-board"
          ref={boardRef}
          onClick={(e) => {
            if (e.target === e.currentTarget) setSelected(null);
          }}
        >
          <svg className="hq-map-svg" aria-hidden="true">
            {wires.map((w, i) => (
              <path key={i} className={wireClass(w)} d={w.d} />
            ))}
          </svg>

          {COLS.map((col) => (
            <div className="hq-map-col" key={col.title}>
              <div className="hq-map-col-h">{col.title}</div>
              {col.groups.map((g) => (
                <div className="hq-map-group" key={g.name}>
                  <div className="hq-map-group-h">{g.name}</div>
                  {g.nodes.map((n) => {
                    const km = KIND_META[n.kind];
                    return (
                      <button
                        key={n.id}
                        type="button"
                        className={nodeClass(n)}
                        style={{ "--nk": km.color } as CSSProperties}
                        ref={(el) => {
                          if (el) nodeRefs.current.set(n.id, el);
                          else nodeRefs.current.delete(n.id);
                        }}
                        onClick={() => setSelected(selected === n.id ? null : n.id)}
                        onMouseEnter={() => setHovered(n.id)}
                        onMouseLeave={() => setHovered(null)}
                      >
                        <span className="hq-map-node-name">{n.name}</span>
                        <span className="hq-map-node-blurb">{n.blurb}</span>
                        {(n.status === "building" || n.status === "planned" || STANDALONE.has(n.id)) && (
                          <span className="hq-map-node-tags">
                            {n.status === "building" && <i className="hq-map-tag building">building</i>}
                            {n.status === "planned" && <i className="hq-map-tag planned">planned</i>}
                            {STANDALONE.has(n.id) && <i className="hq-map-tag alone">standalone</i>}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      <Inspector selected={selected ? nodeById(selected) ?? null : null} onJump={setSelected} />
    </div>
  );
}

function Inspector({
  selected,
  onJump,
}: {
  selected: MapNode | null;
  onJump: (id: string) => void;
}) {
  if (!selected) {
    const alone = [...STANDALONE].map((id) => nodeById(id)).filter(Boolean) as MapNode[];
    return (
      <aside className="hq-map-side">
        <div className="hq-map-side-h">Key</div>
        <div className="hq-map-legend">
          {(Object.keys(KIND_META) as NodeKind[]).map((k) => (
            <span className="hq-map-leg" key={k}>
              <i style={{ background: KIND_META[k].color }} />
              {KIND_META[k].label}
            </span>
          ))}
          <span className="hq-map-leg">
            <svg width="26" height="8" aria-hidden="true">
              <path d="M1 4 H25" className="hq-map-leg-dash" />
            </svg>
            Planned link
          </span>
        </div>
        <div className="hq-map-side-h" style={{ marginTop: 22 }}>
          Standalone pieces
        </div>
        <p className="hq-map-side-p">Self-contained on purpose — no wires in or out.</p>
        <div className="hq-map-conns">
          {alone.map((n) => (
            <button key={n.id} type="button" className="hq-map-conn" onClick={() => onJump(n.id)}>
              <span className="hq-map-conn-name">{n.name}</span>
              <span className="hq-map-conn-label">{n.blurb}</span>
            </button>
          ))}
        </div>
        <p className="hq-map-side-foot">
          {NODES.length} pieces · {EDGES.length} connections. Grows with the product — new
          entries go in <code>system-map.ts</code>.
        </p>
      </aside>
    );
  }

  const km = KIND_META[selected.kind];
  const uses = drawsFrom(selected.id);
  const fed = feeds(selected.id);
  return (
    <aside className="hq-map-side">
      <div className="hq-map-side-kind">
        <span className="hq-map-kindchip" style={{ "--nk": km.color } as CSSProperties}>
          {km.label}
        </span>
        {selected.status === "building" && <i className="hq-map-tag building">building</i>}
        {selected.status === "planned" && <i className="hq-map-tag planned">planned</i>}
      </div>
      <div className="hq-map-side-name">{selected.name}</div>
      <div className="hq-map-side-group">{selected.group}</div>
      <p className="hq-map-side-p">{selected.detail ?? selected.blurb}</p>
      {selected.href && (
        <a className="hq-map-open" href={selected.href}>
          Open {selected.name} ↗
        </a>
      )}

      <ConnList title="Draws from" edges={uses} pick={(e) => e.to} onJump={onJump} />
      <ConnList title="Feeds" edges={fed} pick={(e) => e.from} onJump={onJump} />
      {uses.length === 0 && fed.length === 0 && (
        <p className="hq-map-side-p">
          <b>Standalone</b> — no wires in or out. It can move, break or ship without touching
          anything else.
        </p>
      )}

      {selected.paths && selected.paths.length > 0 && (
        <>
          <div className="hq-map-side-h" style={{ marginTop: 20 }}>
            In the code
          </div>
          <div className="hq-map-paths">
            {selected.paths.map((p) => (
              <code key={p}>{p}</code>
            ))}
          </div>
        </>
      )}
    </aside>
  );
}

function ConnList({
  title,
  edges,
  pick,
  onJump,
}: {
  title: string;
  edges: ReturnType<typeof drawsFrom>;
  pick: (e: ReturnType<typeof drawsFrom>[number]) => string;
  onJump: (id: string) => void;
}) {
  if (edges.length === 0) return null;
  return (
    <>
      <div className="hq-map-side-h" style={{ marginTop: 20 }}>
        {title}
      </div>
      <div className="hq-map-conns">
        {edges.map((e, i) => {
          const other = nodeById(pick(e));
          if (!other) return null;
          return (
            <button key={i} type="button" className="hq-map-conn" onClick={() => onJump(other.id)}>
              <span className="hq-map-conn-name">
                {other.name}
                {e.status === "planned" && <i className="hq-map-tag planned">planned</i>}
              </span>
              <span className="hq-map-conn-label">{e.label}</span>
            </button>
          );
        })}
      </div>
    </>
  );
}
