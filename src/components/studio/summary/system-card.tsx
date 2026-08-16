"use client";

import type { PicklistRow, SummaryRoomRow, SummarySystem } from "@/lib/studio/summary";
import { fmt, pct, tone, LinesTable, OutdoorBlock, RoomsTable } from "./sheet-tables";

/* One card per system, read top to bottom as a hierarchy:

     band      — what the system IS (name, kind, verdict)
     outdoor   — the parent machine, stated once, with the brand's presence
     rooms     — its children: the indoors that hang off it, one row per room
     materials — what it takes to fit them (consumables only)

   Nothing is said twice: units never appear in materials (the indoors are the
   rooms table, the outdoor is its block), pipe size lives only on its coil
   line, and the brand appears exactly once. The whole-job combined list is
   the Material picklist card at the sheet's foot. */

function VerdictChip({
  cells,
}: {
  cells: { value: string; label: string; tone?: string }[];
}) {
  /* the verdict rides its own WHITE chip on the tinted band: every state
     colour and label measured 4.1–4.4 on the six system tints; on white
     they clear 4.8 whatever colour the band carries */
  return (
    <div className="ds-band-v">
      {cells.map((c) => (
        <div key={c.label} className={c.tone ?? ""}>
          <b>{c.value}</b>
          <span>{c.label}</span>
        </div>
      ))}
    </div>
  );
}

export function SystemCard({ sys }: { sys: SummarySystem }) {
  return (
    <section
      className="ds-sysc sys"
      style={{ ["--sys" as string]: sys.colour }}
    >
      <header className="ds-band">
        <div className="ds-band-id">
          <h3>{sys.name}</h3>
          <span>{sys.kindLabel}</span>
        </div>
        <VerdictChip
          cells={[
            { value: fmt(sys.loadKw, "kW"), label: "Load" },
            { value: fmt(sys.capacityKw, "kW"), label: "Capacity" },
            {
              value: pct(sys.pct),
              label: "Covered",
              tone: tone(sys.status, sys.pct),
            },
          ]}
        />
      </header>

      <div className="ds-sysc-b">
        <OutdoorBlock sys={sys} />

        <span className="ds-tcap">
          {sys.rooms.length === 1 ? "Room served" : "Rooms served"}
        </span>
        <RoomsTable rooms={sys.rooms} />

        {sys.lines.length > 0 && (
          <>
            <span className="ds-tcap">Materials</span>
            <LinesTable lines={sys.lines} />
          </>
        )}
      </div>
    </section>
  );
}

/** Rooms no system serves. The same rooms table, so a gap in the design
    states its own size instead of hiding as blanks elsewhere. */
export function UnservedCard({ rooms }: { rooms: SummaryRoomRow[] }) {
  const load = rooms.reduce<number | null>(
    (a, r) => (r.loadKw == null ? a : (a ?? 0) + r.loadKw),
    null
  );
  return (
    <section className="ds-sysc none">
      <header className="ds-band">
        <div className="ds-band-id">
          <h3>Not served yet</h3>
          <span>
            {rooms.length === 1 ? "1 room has" : `${rooms.length} rooms have`} no
            unit
          </span>
        </div>
        <VerdictChip
          cells={[
            { value: String(rooms.length), label: rooms.length === 1 ? "Room" : "Rooms" },
            {
              value: fmt(load == null ? null : Math.round(load * 10) / 10, "kW"),
              label: "Load",
              tone: "under",
            },
          ]}
        />
      </header>
      <div className="ds-sysc-b">
        <RoomsTable rooms={rooms} />
      </div>
    </section>
  );
}

/** The whole job's combined pick — every system, units and consumables.
    Plain rows on purpose: ticking happens on the ServiceM8 job card (one
    checklist item per line) once the push exists, not on the sheet. */
export function PicklistCard({ rows }: { rows: PicklistRow[] }) {
  return (
    <section className="ds-sysc pick">
      <header className="ds-band">
        <div className="ds-band-id">
          <h3>Material picklist</h3>
          <span>every system combined</span>
        </div>
      </header>
      <div className="ds-sysc-b">
        <LinesTable lines={rows} />
      </div>
    </section>
  );
}
