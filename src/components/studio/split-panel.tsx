"use client";

import { useMemo, useState } from "react";
import { Icon } from "@/components/shell/icon";
import type {
  DesignDocument,
  DesignObject,
  DesignSystem,
  Floor,
} from "@/lib/studio/document";
import { newId } from "@/lib/studio/document";
import type { DataPack } from "@/lib/studio/packs/schema";
import { formatArea } from "@/lib/studio/geometry";
import {
  CLIMATE_ZONES,
  type BuildingType,
  type SizingBasis,
} from "@/lib/studio/loads";
import { roomAreaM2, roomLoadKw, type RoomObj } from "@/lib/studio/loads-room";
import { roomsServedBy, roomCoverage, type RoomCoverage } from "@/lib/studio/coverage";
import { systemBadge, type BadgeStatus, type PairProposal } from "@/lib/studio/split";
import { buildMaterials } from "@/lib/studio/materials";
import { moduleFor } from "@/lib/studio/modules";
import type { SystemType } from "@/lib/studio/document";
import { SystemTypeChooser } from "./system-type-chooser";
import { UnitBrowser } from "./unit-browser";
import type { PlacingUnit } from "./canvas";

/* Split-system UI (Stage 4) — panel layout follows the original builder's
   right panel (heytiff-skin reference): system TABS across the top, the
   outdoor-unit hero (loading % chip · model · capacity bar · kW-of-kW), then
   the Rooms | Units | Parts pill sections, one visible at a time. All numbers
   come from the engines (split/loads/materials/select) — this file renders
   and arms intents only. */

const SYSTEM_COLOURS = ["#2E68FF", "#E4572E", "#17A398", "#9B5DE5", "#F5A623", "#D63384"];

/* ─────────────────────────── helpers ─────────────────────────── */

/* room-load derivation lives in lib (loads-room.ts) so the coverage engine can
   share it; re-exported here for existing importers (studio.tsx). */
export { roomLoadKw } from "@/lib/studio/loads-room";

/* ─────────────────────────── systems panel ─────────────────────────── */

export function SystemsPanel({
  doc,
  pack,
  packVersion,
  activeSystemId,
  onActivate,
  onMutate,
  selectedRoomId,
  onSelectRoom,
}: {
  doc: DesignDocument;
  pack: DataPack | null;
  packVersion: string;
  activeSystemId: string | null;
  onActivate: (id: string | null) => void;
  onMutate: (fn: (d: DesignDocument) => DesignDocument) => void;
  selectedRoomId: string | null;
  onSelectRoom: (id: string | null) => void;
}) {
  const [adding, setAdding] = useState(false);

  const systems = doc.systems;
  const active =
    systems.find((s) => s.id === activeSystemId) ?? systems[0] ?? null;

  /** Type-first: create the system as the chosen module, then activate it.
      No wizard, no auto-browser — rooms come next, units after that. */
  const createSystem = (type: SystemType) => {
    const n = systems.length;
    const id = newId("sys");
    onMutate((d) => ({
      ...d,
      systems: [
        ...d.systems,
        {
          id,
          type,
          brand: "mitsubishi-electric",
          colour: SYSTEM_COLOURS[n % SYSTEM_COLOURS.length],
          name: `System ${n + 1}`,
          settings: {},
        },
      ],
      // the design pins the pack version it was built against (Stage 2)
      packPins: {
        ...d.packPins,
        "mitsubishi-electric": d.packPins["mitsubishi-electric"] ?? packVersion,
      },
    }));
    onActivate(id);
    setAdding(false);
  };

  const rooms = roomsServedBy(doc, active?.id ?? null);
  const basis: SizingBasis = doc.settings.sizingBasis;

  /* the type chooser: no systems yet, or the user is adding another. It doesn't
     need the pack — picking a type and drawing/configuring rooms all work
     offline; only unit selection later needs product data. */
  if (systems.length === 0 || adding) {
    return (
      <SystemTypeChooser
        onChoose={createSystem}
        onCancel={adding ? () => setAdding(false) : undefined}
      />
    );
  }

  return (
    <div className="ds-syscard ds-rp">
      {/* ── system tabs (reference: rp-systab-bar) ── */}
      <div className="ds-rp-tabs" role="tablist" aria-label="Systems">
        {systems.map((s) => (
          <button
            key={s.id}
            role="tab"
            aria-selected={s.id === active?.id}
            className={`ds-rp-tab${s.id === active?.id ? " on" : ""}`}
            onClick={() => onActivate(s.id)}
            title={`${s.name} · ${moduleFor(s.type).label}`}
          >
            <span className="ds-sysdot" style={{ background: s.colour }} />
            <span className="ds-rp-tabname">{s.name}</span>
          </button>
        ))}
        <button
          className="ds-rp-tabadd"
          onClick={() => setAdding(true)}
          title="Add system"
        >
          <Icon name="plus" size={12} />
        </button>
      </div>

      {active && pack && moduleFor(active.type).available && (
        <ActiveSystem
          key={active.id}
          doc={doc}
          pack={pack}
          system={active}
          basis={basis}
          rooms={rooms}
          selectedRoomId={selectedRoomId}
          onSelectRoom={onSelectRoom}
          onMutate={onMutate}
          onActivate={onActivate}
        />
      )}

      {active && !moduleFor(active.type).available && (
        <div className="ds-rp-coming">
          <div className="ds-empty-t">{moduleFor(active.type).label}</div>
          <div className="ds-empty-s">
            This system type arrives at {moduleFor(active.type).comingStage}. The
            room process works today; unit selection and materials come with the
            module.
          </div>
        </div>
      )}
    </div>
  );
}

/* ── the active system: a plan-first flow — Rooms, then Units ── */

function ActiveSystem({
  doc,
  pack,
  system,
  basis,
  rooms,
  selectedRoomId,
  onSelectRoom,
  onMutate,
  onActivate,
}: {
  doc: DesignDocument;
  pack: DataPack;
  system: DesignSystem;
  basis: SizingBasis;
  rooms: RoomObj[];
  selectedRoomId: string | null;
  onSelectRoom: (id: string | null) => void;
  onMutate: (fn: (d: DesignDocument) => DesignDocument) => void;
  onActivate: (id: string | null) => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  const deleteSystem = () => {
    onMutate((d) => ({
      ...d,
      systems: d.systems.filter((x) => x.id !== system.id),
      objects: d.objects.filter((o) => o.systemId !== system.id),
    }));
    onActivate(null);
  };

  /* rooms of OTHER systems this one could serve (multi-system spaces) */
  const servedIds = new Set(rooms.map((r) => r.id));
  const adoptable = doc.objects.filter(
    (o): o is RoomObj =>
      o.type === "room" && o.geometry.kind === "polygon" && !servedIds.has(o.id)
  );
  const floorName = (id: string) => doc.floors.find((f) => f.id === id)?.name ?? "";

  const adoptRoom = (roomId: string) =>
    onMutate((d) => ({
      ...d,
      systems: d.systems.map((s) => {
        if (s.id !== system.id) return s;
        const cur = Array.isArray(s.settings.roomIds)
          ? (s.settings.roomIds as string[])
          : [];
        return cur.includes(roomId)
          ? s
          : { ...s, settings: { ...s.settings, roomIds: [...cur, roomId] } };
      }),
    }));

  /* releasing stops SERVING the room; an already-placed unit keeps its
     attribution stamp (it is physically in that room) */
  const releaseRoom = (roomId: string) =>
    onMutate((d) => ({
      ...d,
      systems: d.systems.map((s) =>
        s.id === system.id
          ? {
              ...s,
              settings: {
                ...s.settings,
                roomIds: (Array.isArray(s.settings.roomIds)
                  ? (s.settings.roomIds as string[])
                  : []
                ).filter((id) => id !== roomId),
              },
            }
          : s
      ),
    }));

  return (
    <>
      {/* ── system header: type (the name lives in the tab above) + delete ── */}
      <div className="ds-rp-syshead">
        <div>
          <div className="ds-rp-systype-cap">System type</div>
          <div className="ds-rp-systype">{moduleFor(system.type).label}</div>
        </div>
        <button
          className="ds-rp-del"
          title="Delete system"
          aria-label="Delete system"
          onClick={() => setConfirmDelete(true)}
        >
          <Icon name="x" size={15} />
        </button>
      </div>
      {confirmDelete && (
        <div className="ds-rp-delwarn" role="alertdialog">
          <div className="ds-rp-delwarn-msg">
            <Icon name="alert" size={14} />
            This will delete the system and its objects.
          </div>
          <div className="ds-rp-delwarn-actions">
            <button className="ds-rm-btn secondary" onClick={() => setConfirmDelete(false)}>
              Cancel
            </button>
            <button className="ds-rp-delwarn-go" onClick={deleteSystem}>
              Delete
            </button>
          </div>
        </div>
      )}

      {/* Rooms — select one to choose & place its units on the room card below */}
      <div className="ds-rp-step">
        <div className="ds-rp-sec">
          <div className="ds-rp-sech">
            <b>Rooms</b>
          </div>
          {rooms.length === 0 ? (
            <div className="ds-insp-hint">
              Add rooms by drawing their boundaries on the plan with the{" "}
              <b>Room tool (R)</b> or <b>Polygon tool (G)</b>.
            </div>
          ) : (
            rooms.map((r) => {
              const kw = roomLoadKw(doc, r);
              const area = roomAreaM2(doc, r);
              const cov = roomCoverage(doc, pack, r, basis);
              const shared = r.systemId !== system.id;
              return (
                <button
                  key={r.id}
                  className={`ds-rp-room${r.id === selectedRoomId ? " on" : ""}`}
                  onClick={() => onSelectRoom(r.id)}
                  title={
                    cov.status === "covered"
                      ? "Load covered"
                      : cov.status === "under"
                        ? `${(cov.loadKw! - cov.coveredKw).toFixed(1)} kW short`
                        : "Calibrate the floor to compute the load"
                  }
                >
                  <i className={`ds-covdot ${cov.status}`} />
                  <span className="ds-rp-roomname">{String(r.props.name ?? "Room")}</span>
                  {shared && (
                    <span className="ds-rp-shared">
                      shared
                      <i
                        role="button"
                        aria-label="Stop serving this room"
                        title="Stop serving this room"
                        onClick={(e) => {
                          e.stopPropagation();
                          releaseRoom(r.id);
                        }}
                      >
                        ✕
                      </i>
                    </span>
                  )}
                  <span className="ds-rp-roommeta">
                    {area != null ? formatArea(area) : "—"} ·{" "}
                    {kw != null
                      ? `${cov.coveredKw.toFixed(1)}/${kw.toFixed(1)} kW`
                      : "—"}
                  </span>
                </button>
              );
            })
          )}
        </div>

        {adoptable.length > 0 && (
          <div className="ds-rp-sec">
            <div className="ds-rp-sech">
              <b>Serve an existing room</b>
            </div>
            {adoptable.map((r) => {
              const cov = roomCoverage(doc, pack, r, basis);
              return (
                <button
                  key={r.id}
                  className="ds-rp-adoptrow"
                  onClick={() => adoptRoom(r.id)}
                  title="Add this room to the system"
                >
                  <i className={`ds-covdot ${cov.status}`} />
                  <span className="ds-rp-roomname">
                    {String(r.props.name ?? "Room")}
                    <em> · {floorName(r.floorId)}</em>
                  </span>
                  <span className="ds-rp-roommeta">
                    {cov.status === "under" && cov.loadKw != null
                      ? `${(cov.loadKw - cov.coveredKw).toFixed(1)} kW short`
                      : cov.loadKw != null
                        ? `${cov.loadKw.toFixed(1)} kW`
                        : "—"}
                  </span>
                  <Icon name="plus" size={12} />
                </button>
              );
            })}
          </div>
        )}

        {rooms.length === 0 ? (
          <div className="ds-rp-warn">
            <Icon name="alert" size={14} />
            Add at least one room to continue.
          </div>
        ) : (
          <div className="ds-prop-note">
            Select a room to choose and place its units.
          </div>
        )}
      </div>
    </>
  );
}

/* ── a unit card: drag it onto the plan to place that unit (Slice 3) ── */

export function UnitCard({
  role,
  label,
  model,
  widthMm,
  depthMm,
  placed,
  onArmPlace,
  onRecall,
}: {
  role: "idu" | "odu";
  label: string;
  model: string;
  widthMm: number;
  depthMm: number;
  placed: boolean;
  onArmPlace: (p: PlacingUnit | null) => void;
  /** pull an already-placed unit back off the plan → the card is draggable again */
  onRecall?: () => void;
}) {
  return (
    <div
      className={`ds-ucard${placed ? " placed" : ""}`}
      data-testid={`unit-card-${role}`}
      draggable={!placed}
      onDragStart={(e) => {
        if (placed) return;
        if (e.dataTransfer) {
          // Firefox needs data set for the drag to start at all
          e.dataTransfer.setData("text/plain", model);
          e.dataTransfer.effectAllowed = "copy";
        }
        // arm the canvas: the to-scale ghost tracks the drag, drop places it
        onArmPlace({ role, model, widthMm, depthMm });
      }}
      onDragEnd={() => onArmPlace(null)}
    >
      <div className="ds-ucard-main">
        <span className="ds-ucard-role">{label}</span>
        <b className="ds-ucard-model">{model}</b>
      </div>
      {placed ? (
        <>
          <span className="ds-ucard-badge">
            <Icon name="check" size={11} />
            Placed
          </span>
          {onRecall && (
            <button
              className="ds-ucard-recall"
              onClick={onRecall}
              title="Recall — take this unit back off the plan"
              aria-label={`Recall ${label}`}
            >
              <Icon name="rotate" size={11} />
              Recall
            </button>
          )}
        </>
      ) : (
        <span className="ds-ucard-drag">
          <Icon name="hand" size={13} />
          drag to plan
        </span>
      )}
    </div>
  );
}

/* ── load-coverage banner: covered / kW short, for one room ── */

function CoverageBanner({ cov, nudge }: { cov: RoomCoverage; nudge: boolean }) {
  const solid = Math.min(cov.pct ?? 0, 100);
  const withPending =
    cov.loadKw && cov.loadKw > 0
      ? Math.min(((cov.coveredKw + cov.pendingKw) / cov.loadKw) * 100, 100)
      : 0;
  return (
    <div className={`ds-cov ${cov.status}`}>
      <div className="ds-cov-head">
        <span className="ds-cov-t">Load coverage</span>
        {cov.status === "covered" ? (
          <span className="ds-cov-verdict ok">
            <Icon name="check" size={12} />
            Load covered
          </span>
        ) : cov.status === "under" ? (
          <span className="ds-cov-verdict short">
            {(cov.loadKw! - cov.coveredKw).toFixed(1)} kW short
          </span>
        ) : (
          <span className="ds-cov-verdict unknown">no load — calibrate</span>
        )}
      </div>
      <div className="ds-cov-bar">
        <i className="pending" style={{ width: `${withPending}%` }} />
        <i className="solid" style={{ width: `${solid}%` }} />
      </div>
      <div className="ds-cov-meta">
        {cov.coveredKw.toFixed(1)}
        {cov.pendingKw > 0 ? ` (+${cov.pendingKw.toFixed(1)} pending)` : ""} /{" "}
        {cov.loadKw != null ? cov.loadKw.toFixed(1) : "—"} kW
        {cov.pct != null ? ` · ${cov.pct}%` : ""}
        {cov.oversized ? " · oversized" : ""}
      </div>
      {cov.contributors.length > 1 && (
        <div className="ds-cov-sys">
          {cov.contributors.map((c) => (
            <span key={c.unitId}>
              <i className="ds-sysdot" style={{ background: c.colour }} />
              {c.systemName} · {c.kw.toFixed(1)} kW
            </span>
          ))}
        </div>
      )}
      {nudge && (
        <div className="ds-cov-nudge">
          This system is fully placed — add another system to this room to cover
          the rest.
        </div>
      )}
    </div>
  );
}

/* ── room units editor (relocated onto the room card): pick a pair, drag the
   cards onto the plan, see this room's coverage + pipework. Anchored to the
   ACTIVE system. ── */

export function RoomUnitsSection({
  doc,
  pack,
  system,
  room,
  basis,
  onMutate,
  onArmPlace,
}: {
  doc: DesignDocument;
  pack: DataPack | null;
  system: DesignSystem;
  room: RoomObj;
  basis: SizingBasis;
  onMutate: (fn: (d: DesignDocument) => DesignDocument) => void;
  onArmPlace: (p: PlacingUnit | null) => void;
}) {
  const [browsing, setBrowsing] = useState(false);
  const loadKw = roomLoadKw(doc, room);

  const mine = doc.objects.filter((o) => o.systemId === system.id && o.type === "unit");
  const placedIdu = mine.find((o) => o.props.role === "idu") ?? null;
  const placedOdu = mine.find((o) => o.props.role === "odu") ?? null;
  const iduModel = String(placedIdu?.props.model ?? system.settings.pairIdu ?? "");
  const oduModel = String(placedOdu?.props.model ?? system.settings.pairOdu ?? "");
  const iduSpec = pack?.indoor_units.find((u) => u.model === iduModel) ?? null;
  const oduSpec = pack?.outdoor_units.find((u) => u.model === oduModel) ?? null;
  const runs = doc.objects.filter((o) => o.systemId === system.id && o.type === "pipe-run");
  const risers = doc.objects.filter((o) => o.systemId === system.id && o.type === "riser");
  const cov = pack ? roomCoverage(doc, pack, room, basis) : null;

  /* recall: pull a placed unit back off the plan. The pair selection stays
     (the card reappears as draggable); refrigerant runs/risers on this system
     are dropped too — they anchor to the units, so they'd dangle otherwise. */
  const recall = (unitId: string) =>
    onMutate((d) => ({
      ...d,
      objects: d.objects.filter(
        (o) =>
          o.id !== unitId &&
          !(o.systemId === system.id && (o.type === "pipe-run" || o.type === "riser"))
      ),
    }));

  /* choosing sizes against THIS room; placement is by dragging the cards.
     Swapping to a DIFFERENT pair drops any already-placed units + pipework of
     this system so the plan matches the new selection (re-drag to place). */
  const choose = (pair: PairProposal) => {
    const changed = pair.idu.model !== iduModel || pair.odu.model !== oduModel;
    onMutate((d) => ({
      ...d,
      systems: d.systems.map((s) =>
        s.id === system.id
          ? {
              ...s,
              settings: {
                ...s.settings,
                pairIdu: pair.idu.model,
                pairOdu: pair.odu.model,
                roomId: room.id,
              },
            }
          : s
      ),
      objects: changed
        ? d.objects.filter(
            (o) =>
              !(
                o.systemId === system.id &&
                (o.type === "unit" || o.type === "pipe-run" || o.type === "riser")
              )
          )
        : d.objects,
    }));
    setBrowsing(false);
  };

  return (
    <div className="ds-insp-units">
      <div className="ds-insp-sech">
        <b>Units</b>
        {iduModel && (
          <button
            className="ds-rp-change"
            onClick={() => setBrowsing(true)}
            title={
              placedIdu || placedOdu
                ? "Swap the unit — this takes the placed unit(s) off the plan"
                : "Swap the chosen unit"
            }
          >
            Change
          </button>
        )}
      </div>

      {!iduModel ? (
        <button
          className="ds-tbbtn ds-choose ds-insp-selectunits"
          onClick={() => setBrowsing(true)}
        >
          <Icon name="search" size={14} />
          Select units
        </button>
      ) : (
        <>
          <UnitCard
            role="idu"
            label="Indoor unit"
            model={iduModel}
            widthMm={iduSpec?.width_mm ?? 800}
            depthMm={iduSpec?.depth_mm ?? 300}
            placed={Boolean(placedIdu)}
            onArmPlace={onArmPlace}
            onRecall={placedIdu ? () => recall(placedIdu.id) : undefined}
          />
          <UnitCard
            role="odu"
            label="Outdoor unit"
            model={oduModel}
            widthMm={oduSpec?.width_mm ?? 900}
            depthMm={oduSpec?.depth_mm ?? 330}
            placed={Boolean(placedOdu)}
            onArmPlace={onArmPlace}
            onRecall={placedOdu ? () => recall(placedOdu.id) : undefined}
          />
          {(!placedIdu || !placedOdu) && (
            <div className="ds-prop-note">Drag each card onto the plan to place it.</div>
          )}
        </>
      )}

      {cov && iduModel && (
        <CoverageBanner
          cov={cov}
          nudge={cov.status === "under" && Boolean(placedIdu) && Boolean(placedOdu)}
        />
      )}

      {placedIdu && placedOdu && (
        <div className="ds-insp-pipes">
          <div className="ds-insp-sech">
            <b>Pipework</b>
            <span className="ds-rp-secn">{runs.length + risers.length}</span>
          </div>
          {runs.length + risers.length === 0 ? (
            <div className="ds-insp-hint">
              Draw the refrigerant run with the <b>Pipe (P)</b> tool — it snaps to
              unit anchors. Risers (<b>I</b>) join floors.
            </div>
          ) : (
            <>
              {runs.map((r, i) => (
                <div key={r.id} className="ds-rp-part">
                  <span>Run {i + 1}</span>
                  <span className="ds-rp-partmeta">
                    {(r.props.startAttach ? 1 : 0) + (r.props.endAttach ? 1 : 0)}/2 ends
                  </span>
                </div>
              ))}
              {risers.map((r) => (
                <div key={r.id} className="ds-rp-part">
                  <span>Riser ⇅{String(r.props.group ?? "A")}</span>
                  <span className="ds-rp-partmeta">{String(r.props.heightM ?? 3)} m</span>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {browsing && pack && (
        <UnitBrowser
          pack={pack}
          loadKw={loadKw}
          basis={basis}
          nextRole="idu"
          onChoose={choose}
          onClose={() => setBrowsing(false)}
        />
      )}
    </div>
  );
}

/* ───────────── inspectors for selected system objects ───────────── */

export function SystemObjectInspector({
  doc,
  obj,
  floor,
  onMutate,
  onSelect,
}: {
  doc: DesignDocument;
  obj: DesignObject;
  floor: Floor;
  onMutate: (fn: (d: DesignDocument) => DesignDocument) => void;
  onSelect: (id: string | null) => void;
}) {
  const system = doc.systems.find((s) => s.id === obj.systemId);
  const del = () => {
    onMutate((d) => ({ ...d, objects: d.objects.filter((o) => o.id !== obj.id) }));
    onSelect(null);
  };

  if (obj.type === "unit") {
    const isIdu = String(obj.props.role).toUpperCase() === "IDU";
    const floorRooms = doc.objects.filter(
      (o) => o.type === "room" && o.floorId === obj.floorId
    );
    const serveRoom = (roomId: string) =>
      onMutate((d) => {
        const room = d.objects.find((o) => o.id === roomId);
        const foreign = room && obj.systemId && room.systemId !== obj.systemId;
        const sys = foreign ? d.systems.find((s) => s.id === obj.systemId) : null;
        const cur = Array.isArray(sys?.settings.roomIds)
          ? (sys!.settings.roomIds as string[])
          : [];
        return {
          ...d,
          // picking a foreign room adopts it, same as dropping into it would
          systems:
            foreign && sys && !cur.includes(roomId)
              ? d.systems.map((s) =>
                  s.id === sys.id
                    ? { ...s, settings: { ...s.settings, roomIds: [...cur, roomId] } }
                    : s
                )
              : d.systems,
          objects: d.objects.map((o) => {
            if (o.id !== obj.id) return o;
            const props: Record<string, unknown> = { ...o.props, roomLock: true };
            if (roomId) props.roomId = roomId;
            else delete props.roomId;
            return { ...o, props };
          }),
        };
      });
    return (
      <aside className="ds-inspector">
        <span className="ds-cardt">{isIdu ? "Indoor unit" : "Outdoor unit"}</span>
        <div className="ds-insp-row">
          <span>Model</span>
          <b>{String(obj.props.model ?? "—")}</b>
        </div>
        <div className="ds-insp-row">
          <span>System</span>
          <b>{system?.name ?? "—"}</b>
        </div>
        <div className="ds-insp-row">
          <span>Floor</span>
          <b>{floor.name}</b>
        </div>
        {isIdu && (
          <label className="ds-insp-field">
            <span>Serves room</span>
            <select
              value={String(obj.props.roomId ?? "")}
              onChange={(e) => serveRoom(e.target.value)}
            >
              <option value="">— not attributed —</option>
              {floorRooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {String(r.props.name ?? "Room")}
                </option>
              ))}
            </select>
          </label>
        )}
        <button className="ds-insp-delete" onClick={del}>
          <Icon name="x" size={14} />
          Delete unit
        </button>
      </aside>
    );
  }

  if (obj.type === "riser") {
    return (
      <aside className="ds-inspector">
        <span className="ds-cardt">Riser</span>
        <label className="ds-insp-field">
          <span>Group (same letter joins floors)</span>
          <input
            value={String(obj.props.group ?? "A")}
            maxLength={1}
            onChange={(e) =>
              onMutate((d) => ({
                ...d,
                objects: d.objects.map((o) =>
                  o.id === obj.id
                    ? { ...o, props: { ...o.props, group: e.target.value.toUpperCase() || "A" } }
                    : o
                ),
              }))
            }
          />
        </label>
        <label className="ds-insp-field">
          <span>Vertical rise to next floor (m)</span>
          <input
            inputMode="decimal"
            value={String(obj.props.heightM ?? 3)}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              onMutate((d) => ({
                ...d,
                objects: d.objects.map((o) =>
                  o.id === obj.id
                    ? { ...o, props: { ...o.props, heightM: Number.isFinite(v) ? v : 3 } }
                    : o
                ),
              }));
            }}
          />
        </label>
        <button className="ds-insp-delete" onClick={del}>
          <Icon name="x" size={14} />
          Delete riser
        </button>
      </aside>
    );
  }

  // pipe-run
  return (
    <aside className="ds-inspector">
      <span className="ds-cardt">Refrigerant run</span>
      <div className="ds-insp-row">
        <span>System</span>
        <b>{system?.name ?? "—"}</b>
      </div>
      <div className="ds-insp-row">
        <span>Attached</span>
        <b>
          {(obj.props.startAttach ? 1 : 0) + (obj.props.endAttach ? 1 : 0)} of 2 ends
        </b>
      </div>
      <button className="ds-insp-delete" onClick={del}>
        <Icon name="x" size={14} />
        Delete run
      </button>
    </aside>
  );
}

/* ─────────────────────────── materials view ─────────────────────────── */

export function MaterialsView({
  doc,
  pack,
}: {
  doc: DesignDocument;
  pack: DataPack | null;
}) {
  const schedule = useMemo(() => buildMaterials(doc, pack), [doc, pack]);

  if (schedule.systems.length === 0) {
    return (
      <div className="ds-panel-card">
        <div className="ds-empty">
          <span className="ds-empty-ic">
            <Icon name="receipt" size={22} />
          </span>
          <div className="ds-empty-t">An empty design is an empty schedule</div>
          <div className="ds-empty-s">
            Add a system and place its units on the Design step — the takeoff
            builds itself from what you draw. Nothing here is ever typed in by
            hand.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="ds-panel-card ds-materials">
      {schedule.systems.map((s) => (
        <section key={s.systemId} className="ds-mat-sys">
          <header>
            <span className="ds-sysdot" style={{ background: s.colour }} />
            <h3>{s.name}</h3>
            <span className="ds-mat-type">
              {s.type} · {s.brand}
            </span>
          </header>
          {s.units.length > 0 && (
            <table className="ds-mat-table">
              <thead>
                <tr>
                  <th>Unit</th>
                  <th></th>
                  <th>Qty</th>
                </tr>
              </thead>
              <tbody>
                {s.units.map((u) => (
                  <tr key={u.model}>
                    <td className="ds-mat-model">{u.model}</td>
                    <td>{u.description}</td>
                    <td>{u.qty}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {s.pipe.length > 0 && (
            <table className="ds-mat-table">
              <thead>
                <tr>
                  <th>Pipe (pair coil)</th>
                  <th></th>
                  <th>Length</th>
                </tr>
              </thead>
              <tbody>
                {s.pipe.map((p, i) => (
                  <tr key={i}>
                    <td className="ds-mat-model">
                      ø{p.liquid_mm} / ø{p.gas_mm}
                    </td>
                    <td>liquid / gas mm</td>
                    <td>{p.lengthM} m</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {s.charge && (
            <div className="ds-mat-charge">
              Additional refrigerant: <b>{s.charge.grams} g</b>
              <span> — {s.charge.note}</span>
            </div>
          )}
          {s.notes.map((n, i) => (
            <div key={i} className="ds-mat-note">
              <Icon name="ruler" size={12} />
              {n}
            </div>
          ))}
          {s.units.length === 0 && s.pipe.length === 0 && (
            <div className="ds-mat-note">Nothing placed for this system yet.</div>
          )}
        </section>
      ))}
    </div>
  );
}

/* ─────────────────────────── job pack view ─────────────────────────── */

const BADGE_WORD: Record<BadgeStatus, string> = {
  green: "OK",
  amber: "Check",
  red: "Issues",
  empty: "Empty",
};

export function JobView({
  doc,
  pack,
  onMutate,
}: {
  doc: DesignDocument;
  pack: DataPack | null;
  onMutate: (fn: (d: DesignDocument) => DesignDocument) => void;
}) {
  const schedule = useMemo(() => buildMaterials(doc, pack), [doc, pack]);

  const setMeta = (k: "jobNumber" | "client" | "site", v: string) =>
    onMutate((d) => ({ ...d, meta: { ...d.meta, [k]: v } }));

  const setSetting = (patch: Partial<DesignDocument["settings"]>) =>
    onMutate((d) => ({ ...d, settings: { ...d.settings, ...patch } }));

  const zone = parseInt(doc.settings.climateZone ?? "", 10);
  const activeZone = Number.isFinite(zone) ? zone : 5;

  /* whole-job unit rollup across systems (common-consumables style) */
  const rollup = new Map<string, { qty: number; description: string }>();
  for (const s of schedule.systems)
    for (const u of s.units) {
      const cur = rollup.get(u.model) ?? { qty: 0, description: u.description };
      cur.qty += u.qty;
      rollup.set(u.model, cur);
    }

  const empty = schedule.systems.length === 0;

  return (
    <div className="ds-panel-card ds-job">
      <div className="ds-job-form">
        <span className="ds-cardt">Job details</span>
        <div className="ds-job-fields">
          <label>
            <span>Job number</span>
            <input
              autoComplete="off"
              value={doc.meta.jobNumber}
              onChange={(e) => setMeta("jobNumber", e.target.value)}
              placeholder="e.g. 2026-014"
            />
          </label>
          <label>
            <span>Client</span>
            <input
              autoComplete="off"
              value={doc.meta.client}
              onChange={(e) => setMeta("client", e.target.value)}
              placeholder="Client name"
            />
          </label>
          <label>
            <span>Site</span>
            <input
              autoComplete="off"
              value={doc.meta.site}
              onChange={(e) => setMeta("site", e.target.value)}
              placeholder="Site address"
            />
          </label>
        </div>
        <span className="ds-cardt ds-job-settingst">Load settings</span>
        <div className="ds-job-fields">
          <label>
            <span>Climate zone</span>
            <select
              value={String(activeZone)}
              onChange={(e) => setSetting({ climateZone: e.target.value })}
            >
              {Object.entries(CLIMATE_ZONES).map(([z, info]) => (
                <option key={z} value={z}>
                  {info.label} — {info.cities.split(",")[0]}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Building type</span>
            <select
              value={(doc.settings.buildingType as BuildingType) ?? "residential"}
              onChange={(e) => setSetting({ buildingType: e.target.value })}
            >
              <option value="residential">Residential</option>
              <option value="light_commercial">Light commercial</option>
              <option value="commercial">Commercial</option>
            </select>
          </label>
          <label>
            <span>Size on</span>
            <select
              value={doc.settings.sizingBasis}
              onChange={(e) =>
                setSetting({ sizingBasis: e.target.value as SizingBasis })
              }
            >
              <option value="cooling">Cooling</option>
              <option value="heating">Heating</option>
              <option value="worst-of-both">Worst of both</option>
            </select>
          </label>
        </div>

        <button
          className="ds-tbbtn ds-job-print"
          onClick={() => window.print()}
          disabled={empty}
        >
          <Icon name="download" size={14} />
          Print / Save PDF
        </button>
        {empty && (
          <div className="ds-insp-hint">
            The job pack fills in once a system has units placed.
          </div>
        )}
      </div>

      {/* the printable pack — a print stylesheet shows only this */}
      <div className="ds-jobpack" id="ds-jobpack">
        <header className="ds-jobpack-head">
          <div>
            <h1>{doc.meta.name || "Design"}</h1>
            <div className="ds-jobpack-meta">
              {doc.meta.jobNumber && <span>Job {doc.meta.jobNumber}</span>}
              {doc.meta.client && <span>{doc.meta.client}</span>}
              {doc.meta.site && <span>{doc.meta.site}</span>}
            </div>
          </div>
          <div className="ds-jobpack-brand">HeyTiff Design Studio</div>
        </header>

        {empty ? (
          <p className="ds-insp-hint">Nothing designed yet.</p>
        ) : (
          <>
            <section className="ds-jobpack-sec">
              <h2>Systems overview</h2>
              <table className="ds-mat-table">
                <thead>
                  <tr>
                    <th>System</th>
                    <th>Type</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {doc.systems.map((s) => {
                    const v = systemBadge(doc, pack, s);
                    return (
                      <tr key={s.id}>
                        <td className="ds-mat-model">{s.name}</td>
                        <td>{s.type}</td>
                        <td>{BADGE_WORD[v.status]}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>

            {schedule.systems.map((s) => (
              <section key={s.systemId} className="ds-jobpack-sec">
                <h2>{s.name} — materials</h2>
                {s.units.length > 0 && (
                  <table className="ds-mat-table">
                    <thead>
                      <tr>
                        <th>Model</th>
                        <th></th>
                        <th>Qty</th>
                      </tr>
                    </thead>
                    <tbody>
                      {s.units.map((u) => (
                        <tr key={u.model}>
                          <td className="ds-mat-model">{u.model}</td>
                          <td>{u.description}</td>
                          <td>{u.qty}</td>
                        </tr>
                      ))}
                      {s.pipe.map((p, i) => (
                        <tr key={`p${i}`}>
                          <td className="ds-mat-model">
                            ø{p.liquid_mm} / ø{p.gas_mm} pair coil
                          </td>
                          <td>liquid / gas mm</td>
                          <td>{p.lengthM} m</td>
                        </tr>
                      ))}
                      {s.charge && s.charge.grams > 0 && (
                        <tr>
                          <td className="ds-mat-model">Additional refrigerant</td>
                          <td>{s.charge.note}</td>
                          <td>{s.charge.grams} g</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                )}
                {s.notes.map((n, i) => (
                  <div key={i} className="ds-mat-note">
                    {n}
                  </div>
                ))}
              </section>
            ))}

            {rollup.size > 0 && (
              <section className="ds-jobpack-sec">
                <h2>Whole-job unit schedule</h2>
                <table className="ds-mat-table">
                  <thead>
                    <tr>
                      <th>Model</th>
                      <th></th>
                      <th>Qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...rollup.entries()]
                      .sort((a, b) => a[0].localeCompare(b[0]))
                      .map(([model, r]) => (
                        <tr key={model}>
                          <td className="ds-mat-model">{model}</td>
                          <td>{r.description}</td>
                          <td>{r.qty}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </section>
            )}

            <footer className="ds-jobpack-foot">
              Verify all selections against manufacturer documentation. Loads are
              rule-of-thumb estimates.
            </footer>
          </>
        )}
      </div>
    </div>
  );
}
