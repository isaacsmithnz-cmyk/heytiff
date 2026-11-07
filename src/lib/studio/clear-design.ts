/* CLEAR DESIGN (the next flow; replaces the menu's Start again, which could
   not be undone or kept). The dialog says what comes off the plans and what
   stays, in real counts. "Keep this version" saves the design as it stands as
   an option beside the cleared one. The cleared one keeps the design's id, so
   the job's link still finds it. */

import { startedAgain, type DesignDocument, type DesignVariantRef } from "./document";
import { isGrille } from "./grilles";
import { isNote } from "./notes";
import { isAirflowMark } from "./airflow-marks";

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** the two lists the dialog shows, leaving out what the design hasn't got */
export function clearList(doc: DesignDocument): { off: string[]; stays: string[] } {
  const n = (test: (o: DesignDocument["objects"][number]) => boolean) => doc.objects.filter(test).length;
  const systems = doc.systems.length;
  const units = n((o) => o.type === "unit");
  const grilles = n(isGrille);
  const ducts = n((o) => o.type === "duct-run");
  const pipes = n((o) => o.type === "pipe-run" || o.type === "drain-run" || o.type === "cable-run");
  const arrows = n(isAirflowMark);
  const notes = n(isNote);
  const rooms = n((o) => o.type === "room");
  return {
    off: [
      systems || units ? `${count(systems, "system")} and ${systems === 1 ? "its" : "their"} ${count(units, "unit")}` : "",
      [grilles ? count(grilles, "grille") : "", ducts ? count(ducts, "duct run") : ""].filter(Boolean).join(", "),
      pipes ? count(pipes, "pipe, drain and cable run", "pipe, drain and cable runs") : "",
      arrows ? count(arrows, "airflow arrow") : "",
      notes ? count(notes, "note") : "",
    ].filter(Boolean),
    stays: [
      doc.floors.length ? `${count(doc.floors.length, "floor")} and ${doc.floors.length === 1 ? "its" : "their"} plans` : "",
      doc.floors.some((f) => f.scaleMmPerUnit) ? "Scale and north" : "",
      rooms ? `${count(rooms, "room")} and ${rooms === 1 ? "its load" : "their loads"}` : "",
      doc.reading ? "Tiff's read of the drawings" : "",
    ].filter(Boolean),
  };
}

/** the label the kept version will go by */
export const keptLabelOf = (doc: DesignDocument): string => doc.meta.variantLabel ?? "Option 1";

/** the design cleared, and the version kept beside it under a new id */
export function clearKeeping(
  doc: DesignDocument,
  keptId: string,
  now: string
): { cleared: DesignDocument; kept: DesignDocument; roster: DesignVariantRef[] } {
  const label = keptLabelOf(doc);
  const existing: DesignVariantRef[] = doc.variants.length > 0 ? doc.variants : [{ id: doc.id, label }];
  const roster: DesignVariantRef[] = [
    ...existing.map((v) => (v.id === doc.id ? { id: keptId, label } : v)),
    { id: doc.id, label: `Option ${existing.length + 1}` },
  ];
  const fresh = startedAgain(doc, now);
  return {
    cleared: { ...fresh, meta: { ...fresh.meta, variantLabel: `Option ${existing.length + 1}` }, variants: roster },
    kept: { ...doc, id: keptId, meta: { ...doc.meta, variantLabel: label, updatedAt: now }, variants: roster },
    roster,
  };
}
