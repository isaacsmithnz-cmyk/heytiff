/* Design Studio — the refrigerant pipes that can't exist, refused as they are
   drawn (Isaac, 2026-09-29: "refuse the pipe"). A head takes one pipe and never
   feeds another head. A VRF or split outdoor takes one pipe: a second has to
   land on the first, which makes a joint. A multi's outdoor takes one pipe per
   head. Drain and cable runs are not refrigerant and are never refused here.

   On a VRF, what a pipe may JOIN is refused too (Isaac, 2026-09-29, "still
   allows a complete wrong drawing"): an M, S or P-series head goes on a
   branch box, never a joint or the outdoor; a City Multi head goes on a
   joint, never a box; a box takes one pipe in and the rest go to heads, so
   boxes never feed boxes and nothing branches after one.

   Pure: the canvas asks before it starts a run (end = null) and again before
   it commits one, and shows the reason where the pipe snaps back. */

import type { DesignDocument, DesignObject } from "./document";
import { attachOf, type Attach } from "./graph";
import { allocationsOf, hasAllocations } from "./allocations";
import type { DataPack } from "./packs/schema";
import { isBoxHead } from "./multi";
import { isVrfHead } from "./vrf";

const pipesOn = (doc: DesignDocument, id: string) =>
  doc.objects.filter(
    (o) =>
      o.type === "pipe-run" &&
      (attachOf(o.props.startAttach)?.id === id || attachOf(o.props.endAttach)?.id === id)
  ).length;

const unitOf = (doc: DesignDocument, a: Attach | null): DesignObject | undefined =>
  a?.kind === "unit" ? doc.objects.find((o) => o.id === a.id && o.type === "unit") : undefined;

const roleOf = (u: DesignObject | undefined) => (u ? String(u.props.role ?? "") : "");
const nameOf = (u: DesignObject) => (typeof u.props.model === "string" && u.props.model) || "This head";

const ends = (o: DesignObject) => [attachOf(o.props.startAttach), attachOf(o.props.endAttach)];

/** why a refrigerant pipe from `start` to `end` can't exist, or null when it
    can. `end` null asks about starting one there. `landingOn` is the run a
    click lands on, where a joint will go (the joint is `start` or `end`, as
    `{ kind: "joint", id: "" }` before it exists). */
export function pipeRefusal(
  doc: DesignDocument,
  systemId: string,
  start: Attach | null,
  end: Attach | null,
  pack?: DataPack | null,
  landingOn?: string
): string | null {
  const a = unitOf(doc, start);
  const b = unitOf(doc, end);
  if (roleOf(a) === "idu" && roleOf(b) === "idu")
    return "A head never feeds another head. Run it to a joint, a box or the outdoor.";
  if (start && end && start.kind === end.kind && start.id === end.id) return "A pipe needs two ends";
  const sys = doc.systems.find((s) => s.id === systemId);
  if (sys?.type === "vrf") {
    const why = vrfRefusal(doc, sys.id, start, end, a, b, pack ?? null, landingOn);
    if (why) return why;
  }
  for (const u of [a, b]) {
    if (!u) continue;
    const on = pipesOn(doc, u.id);
    if (roleOf(u) === "idu" && on >= 1) return `${nameOf(u)} already has its pipe`;
    if (roleOf(u) !== "odu" || !sys) continue;
    if ((sys.type === "vrf" || sys.type === "split" || sys.type === "ducted") && on >= 1)
      return sys.type === "vrf"
        ? "The outdoor takes one pipe. Land this one on it to make a joint."
        : "The outdoor already has its pipe";
    if (sys.type === "multi-split" && hasAllocations(sys)) {
      const heads = allocationsOf(sys).filter((x) => x.role === "idu").length;
      if (heads > 0 && on >= heads) return "The outdoor already has a pipe for every head";
    }
  }
  return null;
}

function vrfRefusal(
  doc: DesignDocument,
  systemId: string,
  start: Attach | null,
  end: Attach | null,
  a: DesignObject | undefined,
  b: DesignObject | undefined,
  pack: DataPack | null,
  landingOn: string | undefined
): string | null {
  const byId = new Map(doc.objects.map((o) => [o.id, o]));
  const isHead = (x: Attach | null) => roleOf(unitOf(doc, x)) === "idu";
  const pipes = doc.objects.filter((o) => o.type === "pipe-run" && o.systemId === systemId);

  // a joint on a box's pipe to a head would branch after the box
  if (landingOn) {
    const run = byId.get(landingOn);
    if (run && ends(run).some((x) => x?.kind === "branch-box") && ends(run).some(isHead))
      return "Nothing branches after a branch box. Run each head to its own port.";
  }

  if (start?.kind === "branch-box" && end?.kind === "branch-box")
    return "Branch boxes don't feed each other. Take each box off the main with a joint.";

  // a box takes one pipe in; every other pipe on it goes to a head
  for (const [box, other] of [
    [start, end],
    [end, start],
  ] as const) {
    if (box?.kind !== "branch-box" || !other || isHead(other)) continue;
    const feeds = pipes.filter((o) => {
      const [s, e] = ends(o);
      const far = s?.id === box.id ? e : e?.id === box.id ? s : undefined;
      return far !== undefined && !isHead(far);
    }).length;
    if (feeds >= 1) return "A branch box takes one pipe in. The rest go to its heads.";
  }

  if (!pack) return null;
  const oduModel = doc.objects.find(
    (o) => o.type === "unit" && o.systemId === systemId && roleOf(o) === "odu"
  )?.props.model;
  const odu = pack.outdoor_units.find((o) => o.model === oduModel) ?? null;
  for (const [head, other] of [
    [a, end],
    [b, start],
  ] as const) {
    if (!head || roleOf(head) !== "idu" || !other) continue;
    const row = pack.indoor_units.find((u) => u.model === head.props.model);
    if (!row) continue;
    const onBox = other.kind === "branch-box";
    const onJoint = other.kind === "joint" || roleOf(unitOf(doc, other)) === "odu";
    if (onJoint && isBoxHead(pack, odu, row) && !isVrfHead(pack, row))
      return `${row.model} goes on a branch box. Run it to a box.`;
    if (onBox && isVrfHead(pack, row) && !isBoxHead(pack, odu, row))
      return `${row.model} goes on a joint, not a branch box.`;
  }
  return null;
}
