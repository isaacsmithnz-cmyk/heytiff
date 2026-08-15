"use client";

import type { SummaryRoomRow, SummarySystem } from "@/lib/studio/summary";

/* One card per system: the verdict up top, then a row per room.

   The room is the row because that is how the document stores it — an indoor
   unit carries `props.roomId`, while the outdoor, the pipe and the components
   carry only a systemId. A multi therefore reads as three heads on one
   outdoor rather than one unit serving three rooms, which is what a single
   equipment list beside three room names used to imply.

   So: a split keeps its outdoor in Equipment and has no shared section at
   all. A multi says "Shared" against each head's outdoor and adds a final
   row — on the SAME three columns — carrying what those rooms have in
   common. This file renders; summary.ts computes. */

const fmt = (n: number | null, unit: string): string =>
  n == null ? "—" : `${n % 1 === 0 ? n : n.toFixed(1)} ${unit}`;
const pct = (n: number | null): string => (n == null ? "—" : `${n}%`);

/** covered / short / unknown → the figure block's state class. Semantic, and
    deliberately not the page accent (see the design-system note in memory). */
const tone = (status: SummaryRoomRow["status"], value: number | null): string =>
  value == null ? "na" : status === "covered" ? "ok" : "under";

function Figures({
  cells,
}: {
  cells: { value: string; label: string; tone?: string }[];
}) {
  return (
    <div className="ds-rmfigs">
      {cells.map((c) => (
        <div key={c.label} className={c.tone ?? ""}>
          <b>{c.value}</b>
          <span>{c.label}</span>
        </div>
      ))}
    </div>
  );
}

function Pairs({
  rows,
}: {
  rows: { role: string; value: React.ReactNode; note?: string; qty?: string }[];
}) {
  return (
    <div className="ds-eqlist">
      {rows.map((r) => (
        <div key={r.role} className="ds-eq">
          <span className="ds-eq-role">{r.role}</span>
          <b>
            {r.value}
            {r.note && <em>{r.note}</em>}
          </b>
          <span className="ds-eq-q">{r.qty ?? ""}</span>
        </div>
      ))}
    </div>
  );
}

function RoomRow({
  room,
  sys,
}: {
  room: SummaryRoomRow;
  sys: SummarySystem | null;
}) {
  const pipe =
    sys && sys.pipeLiquidMm != null && sys.pipeGasMm != null
      ? `ø${sys.pipeLiquidMm} / ø${sys.pipeGasMm}`
      : null;

  return (
    <div className="ds-rrow">
      <div className="ds-rcol">
        <span className="ds-rcap">Room</span>
        <div className="ds-rm">
          <div className="ds-rm-top">
            <b>{room.name}</b>
            {room.level && <span className="ds-lvl">{room.level}</span>}
          </div>
          <Figures
            cells={[
              { value: fmt(room.areaM2, "m²"), label: "Area" },
              { value: fmt(room.loadKw, "kW"), label: "Load" },
              {
                value: fmt(room.capacityKw, "kW"),
                label: "Capacity",
                tone: room.capacityKw == null ? "na" : undefined,
              },
              {
                value: pct(room.pct),
                label: "Covered",
                tone: tone(room.status, room.pct),
              },
            ]}
          />
        </div>
      </div>

      <div className="ds-rcol">
        <div className="ds-rcaprow">
          <span className="ds-rcap">Equipment</span>
        </div>
        {sys ? (
          <Pairs
            rows={[
              { role: "Brand", value: sys.brandLabel },
              ...(sys.styleLabel
                ? [{ role: "Style", value: sys.styleLabel }]
                : []),
              {
                role: "Indoor",
                value: room.indoorModel ?? "—",
              },
              {
                role: "Outdoor",
                /* a shared outdoor names itself once, in the row below —
                   repeating it per head would say every room has its own */
                value: sys.sharedOutdoor ? (
                  <span className="ds-pill">Shared</span>
                ) : (
                  sys.outdoorModel ?? "—"
                ),
              },
              ...(pipe ? [{ role: "Pipe size", value: pipe }] : []),
              ...(sys.refrigerant
                ? [{ role: "Refrigerant", value: sys.refrigerant }]
                : []),
            ]}
          />
        ) : (
          <Pairs rows={[{ role: "—", value: "Nothing chosen" }]} />
        )}
      </div>

      <div className="ds-rcol">
        <span className="ds-rcap">Components</span>
        {sys ? (
          <Pairs
            rows={[
              ...(sys.totalPipeM != null && !sys.sharedOutdoor
                ? [
                    {
                      role: "Pipe length",
                      value: pipe ?? "Run",
                      qty: `${sys.totalPipeM} m`,
                    },
                  ]
                : []),
              ...sys.components.map((c) => ({
                role: c.role,
                value: c.name,
                note: c.sub || undefined,
                qty: c.value,
              })),
            ]}
          />
        ) : (
          <Pairs rows={[{ role: "—", value: "Nothing chosen" }]} />
        )}
      </div>
    </div>
  );
}

export function SystemCard({ sys }: { sys: SummarySystem }) {
  const pipe =
    sys.pipeLiquidMm != null && sys.pipeGasMm != null
      ? `ø${sys.pipeLiquidMm} / ø${sys.pipeGasMm}`
      : null;

  return (
    <section
      className="ds-glass ds-sysc sys"
      style={{ ["--sys" as string]: sys.colour }}
    >
      <div className="ds-sysc-h">
        <span className="ds-sysdot2" />
        <h3>{sys.name}</h3>
        <span className="ds-sysc-kind">{sys.brandLabel}</span>
        <div className="ds-figs3">
          <div>
            <b>{fmt(sys.loadKw, "kW")}</b>
            <span>Load</span>
          </div>
          <div>
            <b>{fmt(sys.capacityKw, "kW")}</b>
            <span>Capacity</span>
          </div>
          <div className={tone(sys.status, sys.pct)}>
            <b>{pct(sys.pct)}</b>
            <span>Covered</span>
          </div>
        </div>
      </div>

      {sys.rooms.map((r) => (
        <RoomRow key={r.roomId} room={r} sys={sys} />
      ))}

      {/* only a multi or VRF earns this: a split's one outdoor lives in its
          Equipment list, and a Shared section there would be a section of one */}
      {sys.sharedOutdoor && (
        <div className="ds-rrow shared">
          <div className="ds-rcol">
            <span className="ds-rcap">Shared</span>
            <div className="ds-rm">
              <div className="ds-rm-top">
                <b>Outdoor</b>
                <span className="ds-pill">
                  Shared by {sys.rooms.length} rooms
                </span>
              </div>
              <Figures
                cells={[
                  { value: fmt(sys.capacityKw, "kW"), label: "Capacity" },
                  { value: String(sys.rooms.length), label: "Heads" },
                  {
                    value: sys.totalPipeM == null ? "—" : `${sys.totalPipeM} m`,
                    label: "Total pipe",
                    tone: sys.totalPipeM == null ? "na" : undefined,
                  },
                  {
                    value: pct(sys.pct),
                    label: "Covered",
                    tone: tone(sys.status, sys.pct),
                  },
                ]}
              />
            </div>
          </div>
          <div className="ds-rcol">
            <span className="ds-rcap">Equipment</span>
            <Pairs
              rows={[
                { role: "Brand", value: sys.brandLabel },
                { role: "Outdoor", value: sys.outdoorModel ?? "—" },
                ...(pipe ? [{ role: "Pipe size", value: pipe }] : []),
                ...(sys.refrigerant
                  ? [
                      {
                        role: "Refrigerant",
                        value: sys.refrigerant,
                        note:
                          sys.prechargedKg != null
                            ? `${sys.prechargedKg} kg pre-charged`
                            : undefined,
                      },
                    ]
                  : []),
              ]}
            />
          </div>
          <div className="ds-rcol">
            <span className="ds-rcap">Components</span>
            <Pairs
              rows={[
                ...(sys.totalPipeM != null
                  ? [
                      {
                        role: "Pipe length",
                        value: pipe ?? "Run",
                        qty: `${sys.totalPipeM} m`,
                      },
                    ]
                  : []),
                ...sys.components.map((c) => ({
                  role: c.role,
                  value: c.name,
                  note: c.sub || undefined,
                  qty: c.value,
                })),
              ]}
            />
          </div>
        </div>
      )}
    </section>
  );
}

/** Rooms no system serves. Their own card, on the same grid, so a gap in the
    design states its own size instead of hiding as blanks in a table. */
export function UnservedCard({ rooms }: { rooms: SummaryRoomRow[] }) {
  const area = rooms.reduce<number | null>(
    (a, r) => (r.areaM2 == null ? a : (a ?? 0) + r.areaM2),
    null
  );
  const load = rooms.reduce<number | null>(
    (a, r) => (r.loadKw == null ? a : (a ?? 0) + r.loadKw),
    null
  );
  return (
    <section className="ds-glass ds-sysc none">
      <div className="ds-sysc-h">
        <h3>Not served yet</h3>
        <div className="ds-figs3">
          <div>
            <b>{rooms.length}</b>
            <span>{rooms.length === 1 ? "Room" : "Rooms"}</span>
          </div>
          <div>
            <b>{fmt(area == null ? null : Math.round(area * 10) / 10, "m²")}</b>
            <span>Area</span>
          </div>
          <div className="under">
            <b>{fmt(load == null ? null : Math.round(load * 10) / 10, "kW")}</b>
            <span>Load</span>
          </div>
        </div>
      </div>
      {rooms.map((r) => (
        <RoomRow key={r.roomId} room={r} sys={null} />
      ))}
    </section>
  );
}
