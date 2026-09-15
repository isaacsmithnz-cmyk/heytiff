"use client";

import { Icon } from "@/components/shell/icon";
import type { VehicleLog } from "../logic";
import { historyLine, historyMeta } from "./derive";

/* One line of history, and a door.

   A row used to be a line of text with a pencil hiding at its right edge: you
   could correct an entry from the card, but not read it — the docket behind
   a fill, the invoice behind a service, who logged it and where. Now the row
   is a button that opens the entry on its own screen, and correcting moves
   there with everything else. The pencil is gone; what is left on the row is
   the one line, a quiet second line (who, where, corrected), whether the
   paper was kept, and the date. */
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
    <button type="button" className="vm-evrow" onClick={() => onOpen(log)}>
      <span className="vm-evl">
        <b>{historyLine(log)}</b>
        {meta && <em>{meta}</em>}
      </span>
      <span className="vm-evr">
        {log.hasReceipt && <span>{log.kind === "fuel" ? "Receipt kept" : "Record kept"}</span>}
        <span className="vm-evdate">{log.when}</span>
        <Icon name="chevR" size={14} />
      </span>
    </button>
  );
}
