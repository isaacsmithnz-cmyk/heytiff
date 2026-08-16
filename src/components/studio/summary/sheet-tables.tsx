/* The sheet's shared table bodies — the ONE place each shape is written.
   SummaryView (screen) and PrintDoc (paper) both render these, from the same
   merged SummaryModel, so the paper can never disagree with the screen.

   Everything here renders; summary.ts computes. */

import type {
  PicklistRow,
  SheetLine,
  SummaryRoomRow,
  SummarySystem,
} from "@/lib/studio/summary";

export const fmt = (n: number | null, unit: string): string =>
  n == null ? "—" : `${n % 1 === 0 ? n : n.toFixed(1)} ${unit}`;
export const pct = (n: number | null): string => (n == null ? "—" : `${n}%`);

/** covered / short / unknown → the cell's state class. Semantic, and
    deliberately not the page accent (see the design-system note in memory). */
export const tone = (
  status: SummaryRoomRow["status"],
  value: number | null
): string => (value == null ? "na" : status === "covered" ? "ok" : "under");

/** One row per room: where it is, what stands in it, how it measures.
    The room is the row because that is what the document stores — an indoor
    unit is stamped with `props.roomId`; everything else is system-scope. */
export function RoomsTable({ rooms }: { rooms: SummaryRoomRow[] }) {
  return (
    <table className="ds-mat-table serve">
      <thead>
        <tr>
          <th>Room</th>
          <th>Level</th>
          <th>Indoor unit</th>
          <th className="num">Area</th>
          <th className="num">Load</th>
          <th className="num">Capacity</th>
          <th className="num">Covered</th>
        </tr>
      </thead>
      <tbody>
        {rooms.map((r) => (
          <tr key={r.roomId}>
            <td className="ds-mat-model">{r.name}</td>
            <td>{r.level}</td>
            <td className={r.indoorModel ? "mono" : "none"}>
              {r.indoorModel ?? "No unit placed"}
            </td>
            <td className="num">{fmt(r.areaM2, "m²")}</td>
            <td className="num">{fmt(r.loadKw, "kW")}</td>
            <td className={`num${r.capacityKw == null ? " na" : ""}`}>
              {fmt(r.capacityKw, "kW")}
            </td>
            <td className={`num ${tone(r.status, r.pct)}`}>{pct(r.pct)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* "Item", not "Model": these tables carry rows that are not models — a pair
   coil, a refrigerant top-up. No checkboxes anywhere: the picklist becomes
   tickable ON THE SERVICEM8 JOB CARD (one checklist item per line) when the
   push lands; the sheet only states the list. */
export function LinesTable({ lines }: { lines: (SheetLine | PicklistRow)[] }) {
  return (
    <table className="ds-mat-table take">
      <thead>
        <tr>
          <th>Item</th>
          <th>Description</th>
          <th className="num">Qty</th>
        </tr>
      </thead>
      <tbody>
        {lines.map((l) => (
          <tr key={`${l.name}-${l.sub}`}>
            <td className="ds-mat-model">{l.name}</td>
            <td>{l.sub}</td>
            <td className="num">{l.qty}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** The parent machine, stated once at the top of its system — the brand gets
    its presence here, on the one line that is genuinely the brand's. */
export function OutdoorBlock({ sys }: { sys: SummarySystem }) {
  const desc = [
    sys.outdoorCapacityKw != null ? fmt(sys.outdoorCapacityKw, "kW") : null,
    sys.refrigerant,
    sys.prechargedKg != null ? `${sys.prechargedKg} kg pre-charged` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="ds-odu">
      <span className="ds-tcap">Outdoor unit</span>
      <div className="ds-odu-m">
        <b>{sys.brandLabel}</b>
        {sys.outdoorModel && <span>{sys.outdoorModel}</span>}
        {!sys.outdoorModel && <span className="none">Not chosen yet</span>}
      </div>
      {desc && <div className="ds-odu-d">{desc}</div>}
    </div>
  );
}
