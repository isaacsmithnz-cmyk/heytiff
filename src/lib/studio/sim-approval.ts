/* Design Studio — "this simulation is ready to show a customer".

   A simulation is a MODEL of a design, and a model can be wrong: the floor is
   uncalibrated, the pairing is odd, the room drifts the wrong way. So the
   simulation only reaches a customer when somebody has watched it run and said
   so. That tick is what this module stores and reads.

   Three rules make it safe, and they are all here rather than in the views:

   1. It is per FLOOR, because "is this simulating correctly" is a judgement
      about one floor's run — buildSimModel is per floor.
   2. It PINS to the design as it stood. The tick carries a fingerprint of the
      document; any edit to the design makes every tick stale. There is no such
      thing as an approval that survived an edit, so you cannot accidentally
      send a simulation of a design you have since changed.
   3. The OPTION is all-or-nothing: offered only when every floor that CAN
      simulate has a live tick. A customer cannot tell which floors they are
      missing, so a part-approved design offers nothing at all.

   Pure — no React, no I/O — so both sheets and jest read the same verdict. */

import type { DesignDocument, SimApproval } from "./document";
import type { DataPack } from "./packs/schema";
import { buildSimModel } from "./sim";
import { floorDisplayName } from "./plans";

/* ── the fingerprint ──────────────────────────────────────────────────────
   What "the design changed" MEANS. Everything the simulation and the sheet
   are derived from is in here; nothing else is.

   Deliberately excluded:
   - `meta` — renaming the job, or typing the client's address, is not a
     change to the design. Withdrawing a shared simulation because somebody
     fixed a typo would train people to ignore the whole mechanism.
   - `simApprovals` itself — it would fingerprint its own writing and no tick
     could ever be fresh.
   - `variants`, `planImport`, `jobLink` — provenance and editing sessions,
     not the thing being simulated.

   Plan sheets ARE included (they are what the rooms sit on) but only as
   identity and placement; a re-upload that lands the same sheet in the same
   place is the same design. */

/** Canonical JSON: object keys sorted at every depth, so two documents that
    differ only in property order fingerprint the same. `props` is an open
    Record whose key order nobody controls — a re-save must not read as an
    edit. */
function canonical(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  const rec = v as Record<string, unknown>;
  const keys = Object.keys(rec).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(rec[k])}`).join(",")}}`;
}

/** 64 bits as two FNV-1a passes over the same bytes with different offsets.
    One 32-bit hash collides at about one pair in four billion, and a
    collision here reads a STALE approval as fresh — the one failure this
    module exists to prevent. Two passes make that cost nothing to buy. */
function hash64(s: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x85ebca6b) >>> 0;
  }
  return `${a.toString(36)}${b.toString(36)}`;
}

/** The design as the simulation sees it — stable across re-saves, different
    after any edit that could change how a room behaves. */
export function designFingerprint(doc: DesignDocument): string {
  return hash64(
    canonical({
      settings: doc.settings,
      packPins: doc.packPins,
      floors: doc.floors.map((f) => ({
        id: f.id,
        level: f.level,
        name: f.name,
        scale: f.scaleMmPerUnit,
        northDeg: f.northDeg,
        plans: f.plans.map((p) => ({
          id: p.id,
          ref: p.imageRef,
          x: p.x,
          y: p.y,
          w: p.width,
          h: p.height,
          crop: p.crop ?? null,
        })),
      })),
      systems: doc.systems.map((s) => ({
        id: s.id,
        type: s.type,
        brand: s.brand,
        settings: s.settings,
      })),
      objects: doc.objects.map((o) => ({
        id: o.id,
        type: o.type,
        systemId: o.systemId,
        floorId: o.floorId,
        plane: o.plane,
        geometry: o.geometry,
        props: o.props,
      })),
    })
  );
}

/* ── reading and writing the tick ── */

/** A tick that was made against the design as it stands right now. A stored
    approval whose fingerprint no longer matches is not "expired" — it simply
    is not an approval, and every read here treats it that way. */
function isLive(a: SimApproval, fingerprint: string): boolean {
  return a.fingerprint === fingerprint;
}

export function isFloorApproved(doc: DesignDocument, floorId: string): boolean {
  const fp = designFingerprint(doc);
  return doc.simApprovals.some((a) => a.floorId === floorId && isLive(a, fp));
}

/** Tick or untick one floor. Ticking replaces any stored row for that floor —
    a stale one is not history worth keeping, it is a claim that is no longer
    true. Untick removes the row outright for the same reason. */
export function setFloorApproval(
  doc: DesignDocument,
  floorId: string,
  on: boolean,
  now: string = new Date().toISOString()
): DesignDocument {
  const rest = doc.simApprovals.filter((a) => a.floorId !== floorId);
  if (!on) return { ...doc, simApprovals: rest };
  return {
    ...doc,
    simApprovals: [
      ...rest,
      { floorId, fingerprint: designFingerprint(doc), at: now },
    ],
  };
}

/* ── the verdict both sheets ask for ── */

export interface SimFloorRef {
  id: string;
  name: string;
}

export interface SimApprovalState {
  /** floors that CAN simulate — buildSimModel finds handlers on them. A floor
      with nothing on it must never block the option by being unapprovable. */
  simulatable: SimFloorRef[];
  /** simulatable floors carrying a live tick */
  approved: SimFloorRef[];
  /** simulatable floors with no live tick — what is holding the option back */
  pending: SimFloorRef[];
  /** floors whose tick went stale when the design changed. Named separately
      because it is a DIFFERENT sentence: somebody approved this, and then an
      edit withdrew it. A client holding the link watched the option vanish. */
  lapsed: SimFloorRef[];
  /** the sheet offers a way into the simulation. Every simulatable floor is
      ticked, and there is at least one to tick. */
  offered: boolean;
}

export function simApprovalState(
  doc: DesignDocument,
  pack: DataPack | null
): SimApprovalState {
  const fp = designFingerprint(doc);
  const live = new Set(
    doc.simApprovals.filter((a) => isLive(a, fp)).map((a) => a.floorId)
  );
  const stale = new Set(
    doc.simApprovals.filter((a) => !isLive(a, fp)).map((a) => a.floorId)
  );

  const simulatable: SimFloorRef[] = [];
  const approved: SimFloorRef[] = [];
  const pending: SimFloorRef[] = [];
  const lapsed: SimFloorRef[] = [];

  for (const f of doc.floors) {
    if (buildSimModel(doc, pack, f.id).handlers.length === 0) continue;
    const ref = { id: f.id, name: floorDisplayName(f) };
    simulatable.push(ref);
    if (live.has(f.id)) approved.push(ref);
    else {
      pending.push(ref);
      if (stale.has(f.id)) lapsed.push(ref);
    }
  }

  return {
    simulatable,
    approved,
    pending,
    lapsed,
    offered: simulatable.length > 0 && pending.length === 0,
  };
}
