"use client";

import type { VehicleLog } from "../logic";
import { historyLine, historyMeta } from "./derive";

/* One line of history, and a door.

   The row is a button that opens the entry on its own screen, and correcting
   lives there with everything else. What the row says: the one line, a quiet
   second line (who, where, corrected), whether the paper was kept, and the
   date. */
export function EventRow({
  log,
  eco,
  onOpen,
}: {
  log: VehicleLog;
  /** L/100km for this fill, when derivable. */
  eco?: number;
  onOpen: (log: VehicleLog) => void;
}) {
  const meta = historyMeta(log, eco);
  return (
    <button type="button" className="rcw-evrow" onClick={() => onOpen(log)}>
      <span className="rcw-histk">
        <b>{historyLine(log)}</b>
        {meta && <span>{meta}</span>}
      </span>
      {log.hasReceipt && <span className="rcw-histfig">{log.kind === "fuel" ? "Receipt kept" : "Record kept"}</span>}
      <span className="rcw-histfig">{log.when}</span>
    </button>
  );
}

/** The vehicle a sub-screen is about, under its title: the name and the plate. */
export function VehicleLead({ name, plate }: { name: string; plate: React.ReactNode }) {
  return (
    <div className="rcw-vlead">
      <span>{name}</span>
      {plate}
    </div>
  );
}
