/* Where a system is up to, in one line: the words a system's card says at
   rest (docs/studio-zones-and-systems.md, "A card at rest is its name, type
   and brand, and one line"). A failing combination or a short zone takes the
   line, in red; otherwise the line is the next thing to do. */

import type { DesignDocument, DesignSystem } from "./document";
import type { DataPack } from "./packs/schema";
import type { SizingBasis } from "./loads";
import { allocationsOf, hasAllocations } from "./allocations";
import { roomVerdict, trayItems } from "./builder";
import { systemKind, systemZones } from "./zones";
import { blockingFindings, systemFindings } from "./verdict";
import { installState } from "./install";

export interface CardStatus {
  text: string;
  tone: "quiet" | "ok" | "bad";
}

export function cardStatus(
  doc: DesignDocument,
  pack: DataPack | null,
  basis: SizingBasis,
  sys: DesignSystem
): CardStatus {
  const zones = systemZones(doc, sys.id);
  const empty = { text: zones.length ? "No units yet" : "No zones", tone: "quiet" as const };
  if (!pack) return empty;
  if (blockingFindings(systemFindings(doc, pack, sys)).length) {
    return { text: "Combination fails", tone: "bad" };
  }
  if (systemKind(doc, sys) === "empty") return empty;
  for (const zone of zones) {
    const v = roomVerdict(doc, pack, basis, zone);
    if (v.word === "Undersized" && v.loadKw) {
      const pct = Math.round((v.coverKw / v.loadKw) * 100);
      return { text: `${String(zone.props.name ?? "Zone")} short, ${pct}%`, tone: "bad" };
    }
  }
  const units = hasAllocations(sys) ? allocationsOf(sys).filter((a) => a.model).length : 0;
  const toPlace = trayItems(doc, pack).filter((t) => t.systemId === sys.id).length;
  if (toPlace > 0) {
    return { text: `${units} ${units === 1 ? "unit" : "units"}, ${toPlace} to place`, tone: "quiet" };
  }
  if (installState(doc, pack, sys) !== "complete") {
    return { text: "Install questions next", tone: "quiet" };
  }
  return { text: "Ready for the design sheet", tone: "ok" };
}
