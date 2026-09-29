/* Design Studio — the refrigerant pipes that can't exist, refused as they are
   drawn (Isaac, 2026-09-29: "refuse the pipe"). A head takes one pipe and never
   feeds another head. A VRF or split outdoor takes one pipe: a second has to
   land on the first, which makes a joint. A multi's outdoor takes one pipe per
   head. Drain and cable runs are not refrigerant and are never refused here.

   Pure: the canvas asks before it starts a run (end = null) and again before
   it commits one, and shows the reason where the pipe snaps back. */

import type { DesignDocument, DesignObject } from "./document";
import { attachOf, type Attach } from "./graph";
import { allocationsOf, hasAllocations } from "./allocations";

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

/** why a refrigerant pipe from `start` to `end` can't exist, or null when it
    can. `end` null asks about starting one there. */
export function pipeRefusal(
  doc: DesignDocument,
  systemId: string,
  start: Attach | null,
  end: Attach | null
): string | null {
  const a = unitOf(doc, start);
  const b = unitOf(doc, end);
  if (roleOf(a) === "idu" && roleOf(b) === "idu")
    return "A head never feeds another head. Run it to a joint, a box or the outdoor.";
  if (start && end && start.kind === end.kind && start.id === end.id) return "A pipe needs two ends";
  const sys = doc.systems.find((s) => s.id === systemId);
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
