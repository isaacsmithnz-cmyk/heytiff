"use client";

/* SYSTEMS AS SCREENS, DRAWN AS A PHONE'S (the next flow; the bar and panel
   mock, https://claude.ai/artifact/66ykUj2YGgQ1Y5DWWyWKa1, then "Yes, build
   it", 21 November 2026, after Isaac: "pretend the right panel is an iphone
   screen", "look hard into what needs to be there and what doesnt").

   The column holds only what you use while designing: what to pick up and
   drop on the plan, what each zone is still missing, and the one thing you
   clicked. Drawing is the toolbar's, never a button here. A screen's one
   action sits top right in blue words (Add system, Edit); actions in a list
   are rows in blue; nothing is labelled over a group, no line of description
   sits under a name, and a button says only what it does (Build system),
   never "Next:", as Help teaches the order (20 November 2026). Rooms are
   zones, as the toolbar's Zone tool and Help say them. */

import { useState, type CSSProperties, type DragEvent } from "react";
import type { DesignDocument } from "@/lib/studio/document";
import { canLeaveOut } from "@/lib/studio/left-out";
import type { QuotedOption } from "@/lib/studio/from-quote";
import type { DataPack } from "@/lib/studio/packs/schema";
import type { SizingBasis } from "@/lib/studio/loads";
import { KIND_WORD, systemKind, systemZones, unclaimedZones, zoneIdsOf } from "@/lib/studio/zones";
import { brandName } from "@/lib/studio/verdict";
import { roomLoadKw, type RoomObj } from "@/lib/studio/loads-room";
import { cardStatus } from "@/lib/studio/status";
import { equipmentList, installAnswers, installQuestions, NOT_SURE, type InstallQuestion } from "@/lib/studio/install";
import { stillQuoted } from "@/lib/studio/install-from-quote";
import { systemAir } from "@/lib/studio/airflow";
import { systemRows, zonesLoadKw, type UnitRow, type ZoneRow } from "@/lib/studio/system-rows";
import type { TrayItem } from "@/lib/studio/builder";
import { Switch } from "@/components/parts/tick";
import { Icon } from "@/components/shell/icon";
import { RACK_DRAG, type PlacingUnit } from "./canvas";
import { StackDot, StackGroup, StackHead, StackRow, StackScreen } from "./stack";
import { VariationButton } from "./variation-menu";

const kwText = (kw: number | null) => (kw == null ? "" : `${kw.toFixed(1)} kW`);
const zonesWord = (n: number) => (n === 1 ? "1 zone" : `${n} zones`);

/** a status tone in the stack's words */
const toneOf = (tone: string): "good" | "look" | "bad" | undefined =>
  tone === "ok" || tone === "good" ? "good" : tone === "bad" ? "bad" : tone === "warn" || tone === "look" ? "look" : undefined;

const Lead = ({ icon, colour }: { icon: string; colour?: string | null }) => (
  <span className={`ds-stack-lead${colour ? " unit" : ""}`} style={colour ? ({ "--ds-unit": colour } as CSSProperties) : undefined} aria-hidden="true">
    <Icon name={icon} size={18} />
  </span>
);

export function SystemsList({
  doc,
  pack,
  basis,
  onOpen,
  onAddSystem,
  onOpenRooms,
  onAddVariant,
  onSwitchVariant,
  onRenameVariant,
  onLeaveOut,
  quoted = [],
  onAddQuoted,
}: {
  doc: DesignDocument;
  pack: DataPack | null;
  basis: SizingBasis;
  onOpen: (id: string) => void;
  /** the job's quote's options not in the design yet (from-quote.ts) */
  quoted?: QuotedOption[];
  onAddQuoted?: (o: QuotedOption) => void;
  /** these zones off the design, kept (left-out.ts) */
  onLeaveOut: (ids: string[]) => void;
  onAddSystem: () => void;
  onOpenRooms: () => void;
  onAddVariant: () => void;
  onSwitchVariant: (id: string) => void;
  onRenameVariant: (label: string) => void;
}) {
  const free = unclaimedZones(doc);
  const zones = doc.objects.filter((o) => o.type === "room").length;
  const leavable = free.filter((z) => canLeaveOut(doc, z.id));
  return (
    <StackScreen label="Systems">
      <StackHead name="Systems" nav={{ label: "Add system", onPress: onAddSystem }} />
      {onAddQuoted &&
        quoted.map((o) => (
          <StackGroup key={o.index}>
            <StackRow lead={<span className="ds-stack-quote" aria-hidden="true">&ldquo;</span>} name={o.name} />
            {o.outdoor && <StackRow name="Outdoor" value={o.outdoor.model ?? o.outdoor.code} />}
            {o.heads.map((h, i) => (
              <StackRow
                key={i}
                name={h.roomName ?? h.room}
                value={h.roomId ? (h.model ?? h.code) : "No zone on the plan"}
                tone={h.roomId && h.model ? undefined : "look"}
              />
            ))}
            <StackRow blue lead={<Lead icon="plus" />} name="Add to the design" onPress={() => onAddQuoted(o)} />
          </StackGroup>
        ))}
      {doc.systems.length > 0 && (
        <StackGroup>
          {doc.systems.map((sys) => {
            const kind = systemKind(doc, sys);
            const n = systemZones(doc, sys.id).length;
            const status = cardStatus(doc, pack, basis, sys);
            const type = kind === "empty" ? "Not built" : KIND_WORD[kind];
            return (
              <StackRow
                key={sys.id}
                lead={<StackDot colour={sys.colour} />}
                name={sys.name}
                sub={`${type}, ${zonesWord(n)}`}
                value={status.text}
                tone={toneOf(status.tone)}
                chevron
                onPress={() => onOpen(sys.id)}
              />
            );
          })}
        </StackGroup>
      )}
      {free.length > 0 && (
        <StackGroup>
          <StackRow
            name={`${zonesWord(free.length)} on no system`}
            sub={free.map((z) => String(z.props.name ?? "Zone")).join(", ")}
          >
            {leavable.length > 0 ? (
              <button type="button" className="ds-stack-navact" onClick={() => onLeaveOut(leavable.map((z) => z.id))}>
                Leave out
              </button>
            ) : null}
          </StackRow>
        </StackGroup>
      )}
      <StackGroup>
        <StackRow name="Zones" value={String(zones)} chevron onPress={onOpenRooms} />
        <StackRow name="Options">
          <VariationButton doc={doc} onAddVariant={onAddVariant} onSwitchVariant={onSwitchVariant} onRenameVariant={onRenameVariant} />
        </StackRow>
      </StackGroup>
    </StackScreen>
  );
}

/* THE UNIT ITSELF, NOT THE ROW (Isaac, 20 November 2026: "its hard to
   place with it being the whole card"). The plan draws the armed unit under
   the pointer at its real size, turned to the wall it nears, with its air
   (canvas.tsx, the placement ghost); the browser's own picture of the row
   rode over it. A blank one in its place leaves the unit alone. */
const BLANK =
  typeof Image === "undefined"
    ? null
    : Object.assign(new Image(), { src: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" });

/* A unit row's drag: the unit armed on its way out, as the rack's was, so a
   drop anywhere on the plan puts it down (the canvas commits what's armed) */
function useDrag(onArmPlace: (p: PlacingUnit | null) => void) {
  const [held, setHeld] = useState<string | null>(null);
  const dragOf = (tray: TrayItem | null) =>
    tray
      ? {
          onDragStart: (e: DragEvent<HTMLElement>) => {
            if (e.dataTransfer) {
              e.dataTransfer.setData("text/plain", tray.model);
              e.dataTransfer.setData(RACK_DRAG, JSON.stringify(tray.placing));
              e.dataTransfer.effectAllowed = "copy";
              if (BLANK) e.dataTransfer.setDragImage?.(BLANK, 0, 0);
            }
            setHeld(tray.allocationId);
            onArmPlace(tray.placing);
          },
          onDragEnd: () => {
            setHeld(null);
            onArmPlace(null);
          },
        }
      : undefined;
  return { held, dragOf };
}

export function SystemScreen({
  doc,
  pack,
  basis,
  systemId,
  claiming,
  onBack,
  onOpenRoom,
  onAddZones,
  onClaimDone,
  onBuild,
  onInstall,
  onAir,
  onArmPlace,
  onToggleZone,
  litRoomId = null,
}: {
  doc: DesignDocument;
  pack: DataPack | null;
  basis: SizingBasis;
  systemId: string;
  /** the zone picked on the plan while this system is open: its row lit */
  litRoomId?: string | null;
  /** its zones being picked: the zones with a switch each */
  claiming: boolean;
  onBack: () => void;
  onOpenRoom: (id: string) => void;
  onAddZones: () => void;
  onClaimDone: () => void;
  onBuild: () => void;
  onInstall: () => void;
  onAir: () => void;
  onArmPlace: (p: PlacingUnit | null) => void;
  /** a zone switched on or off this system */
  onToggleZone: (zoneId: string, on: boolean) => void;
}) {
  const { held, dragOf } = useDrag(onArmPlace);
  const [installOpen, setInstallOpen] = useState(false);
  const sys = doc.systems.find((s) => s.id === systemId);
  if (!sys) return null;
  const kind = systemKind(doc, sys);
  if (installOpen && pack && kind !== "empty") {
    return <InstallList doc={doc} pack={pack} systemId={systemId} onBack={() => setInstallOpen(false)} onOpen={onInstall} />;
  }
  /* a system with no units yet is its zones, picked with a switch each */
  if (kind === "empty" || claiming) {
    return (
      <SystemZones
        doc={doc}
        systemId={systemId}
        built={kind !== "empty"}
        onBack={onBack}
        onBuild={onBuild}
        onDone={onClaimDone}
        onToggleZone={onToggleZone}
      />
    );
  }
  const zones = systemZones(doc, sys.id);
  const status = cardStatus(doc, pack, basis, sys);
  const rows = systemRows(doc, pack, basis, sys);
  const asked = pack ? equipmentList(doc, pack, sys) : null;
  const hasAir = pack ? systemAir(doc, pack, sys).length > 0 : false;
  const load = zonesLoadKw(zones.map((z) => roomLoadKw(doc, z)));
  const brand = pack && sys.brand ? brandName(pack, sys.brand) : null;

  const unitRow = (name: string, unit: UnitRow, key: string) => (
    <StackRow
      key={key}
      lead={<Lead icon="unit" colour={unit.missing === "To place" ? null : sys.colour} />}
      name={name}
      sub={unit.model}
      value={unit.missing ?? undefined}
      tone={unit.missing ? "look" : undefined}
      drag={dragOf(unit.tray)}
      held={held === unit.allocationId}
      onPress={unit.tray ? () => onArmPlace(unit.tray!.placing) : undefined}
    />
  );
  const zoneRow = (r: ZoneRow, i: number) => (
    <StackRow
      key={`${r.zoneId}:${i}`}
      lead={<Lead icon="unit" colour={r.unit && r.missing !== "To place" ? sys.colour : null} />}
      name={r.name}
      sub={
        r.unit ? (
          <>
            {r.unit.model}
            {r.of ? `, ${r.of.index} of ${r.of.count}` : ""}
            {r.fit ? (
              <>
                , <span className="ds-stack-look">{r.fit.toLowerCase()}</span>
              </>
            ) : null}
          </>
        ) : undefined
      }
      value={r.missing ?? undefined}
      tone={r.missing ? "look" : undefined}
      lit={r.zoneId === litRoomId}
      held={!!r.unit && held === r.unit.allocationId}
      drag={r.unit ? dragOf(r.unit.tray) : undefined}
      chevron={!r.unit?.tray}
      onPress={r.unit?.tray ? () => onArmPlace(r.unit!.tray!.placing) : () => onOpenRoom(r.zoneId)}
    />
  );

  return (
    <StackScreen label={sys.name}>
      <StackHead back="Systems" onBack={onBack} name={sys.name} nav={{ label: "Edit", onPress: onBuild }} />
      {status.tone === "bad" && (
        <StackGroup>
          <StackRow danger lead={<Lead icon="x" />} name={status.text} sub={status.why} chevron onPress={onBuild} />
        </StackGroup>
      )}
      <StackGroup>
        <StackRow name={KIND_WORD[kind]} sub={brand ?? undefined} />
        <StackRow name="Heat load" sub={zonesWord(zones.length)} value={kwText(load)} strong />
      </StackGroup>
      <StackGroup>
        {rows.outdoor && unitRow("Outdoor", rows.outdoor, "outdoor")}
        {rows.ducted && unitRow("Ducted unit", rows.ducted, "ducted")}
        {rows.zones.map(zoneRow)}
        <StackRow blue lead={<Lead icon="plus" />} name="Add zones" onPress={onAddZones} />
      </StackGroup>
      <StackGroup>
        {hasAir && <StackRow name="Air" chevron onPress={onAir} />}
        <StackRow name="Install details" value={asked ? `${asked.answered} of ${asked.total}` : ""} chevron onPress={() => setInstallOpen(true)} />
      </StackGroup>
    </StackScreen>
  );
}

/* A SYSTEM'S ZONES, A SWITCH EACH (Isaac, 21 November 2026: "maybe a blue
   switch as its a mouse"). Every zone on the plan, the biggest load first; a
   switch saves itself, so a zone switched on is on the system at once and
   lights on the plan, where clicking a zone switches it too. A zone on
   another system says so, and switching it on moves it. The heat load is the
   zones switched on, so you stop when it suits one outdoor. The small zones
   are one row until it's opened. */
const SMALL_KW = 1;
export function SystemZones({
  doc,
  systemId,
  built,
  onBack,
  onBuild,
  onDone,
  onToggleZone,
}: {
  doc: DesignDocument;
  systemId: string;
  built: boolean;
  onBack: () => void;
  onBuild: () => void;
  onDone: () => void;
  onToggleZone: (zoneId: string, on: boolean) => void;
}) {
  const [allOpen, setAllOpen] = useState(false);
  const sys = doc.systems.find((s) => s.id === systemId);
  if (!sys) return null;
  const mine = new Set(zoneIdsOf(sys));
  const ownerOf = (id: string) => doc.systems.find((s) => s.id !== sys.id && zoneIdsOf(s).includes(id)) ?? null;
  const all = doc.objects
    .filter((o): o is RoomObj => o.type === "room")
    .map((z) => ({ z, kw: roomLoadKw(doc, z) }))
    .sort((a, b) => (b.kw ?? 0) - (a.kw ?? 0));
  const shown = all.filter((x) => allOpen || mine.has(x.z.id) || (x.kw ?? 0) >= SMALL_KW);
  const small = all.filter((x) => !shown.includes(x));
  const on = all.filter((x) => mine.has(x.z.id));
  const load = zonesLoadKw(on.map((x) => x.kw));
  return (
    <StackScreen
      label={sys.name}
      foot={
        built ? (
          <button type="button" className="ds-stack-second" onClick={onDone}>
            Done
          </button>
        ) : on.length > 0 ? (
          <button type="button" className="ds-stack-main" onClick={onBuild}>
            Build system
          </button>
        ) : null
      }
    >
      <StackHead back="Systems" onBack={onBack} name={sys.name} />
      <StackGroup>
        <StackRow name="Heat load" sub={zonesWord(on.length)} value={kwText(load) || "0.0 kW"} strong />
      </StackGroup>
      <StackGroup>
        {shown.map(({ z, kw }) => {
          const owner = ownerOf(z.id);
          const name = String(z.props.name ?? "Zone");
          return (
            <StackRow key={z.id} name={name} sub={owner ? `On ${owner.name}` : undefined} value={kwText(kw)}>
              <Switch checked={mine.has(z.id)} onChange={(v) => onToggleZone(z.id, v)} label={<span className="sr-only">{name}</span>} />
            </StackRow>
          );
        })}
        {small.length > 0 && (
          <StackRow
            name={`${small.length} more, ${kwText(zonesLoadKw(small.map((x) => x.kw))) || "0.0 kW"}`}
            sub={small.map((x) => String(x.z.props.name ?? "Zone")).join(", ")}
            chevron
            onPress={() => setAllOpen(true)}
          />
        )}
      </StackGroup>
    </StackScreen>
  );
}

/* INSTALL DETAILS, A ROW A QUESTION (the bar and panel mock, "Yes, build
   it", 21 November 2026): each question by its short name, its answer under
   it, and Quoted while the answer is still the quote's
   (install-from-quote.ts), or To answer in orange. A row opens the
   questions, as Install details always has, to answer or change it. */
const SHORT: Record<string, string> = {
  "outdoor-sits": "Outdoor",
  "outdoor-drain": "Outdoor's water",
  controls: "Controls",
  "head-fixings": "Heads fix to",
  condensate: "Condensate",
  "electrical-work": "Electrical",
  "branch-joints": "Branches",
};

/** a question's answer in words: its ticked options, each with its own
    follow-ups' answers after it ("On a wall, heavy-duty bracket") */
function answerWords(q: InstallQuestion, answers: Record<string, string[]>): string {
  const ticks = answers[q.id] ?? [];
  if (ticks.includes(NOT_SURE)) return "Not sure yet";
  return q.options
    .filter((o) => ticks.includes(o.id))
    .map((o) => {
      const more = (o.followUps ?? []).map((f) => answerWords(f, answers)).filter(Boolean);
      return [o.label, ...more.map((m) => m.charAt(0).toLowerCase() + m.slice(1))].join(", ");
    })
    .join(" and ");
}

function InstallList({
  doc,
  pack,
  systemId,
  onBack,
  onOpen,
}: {
  doc: DesignDocument;
  pack: DataPack;
  systemId: string;
  onBack: () => void;
  onOpen: () => void;
}) {
  const sys = doc.systems.find((s) => s.id === systemId);
  if (!sys) return null;
  const answers = installAnswers(doc, sys);
  const quoted = (sys.settings.installQuoted ?? {}) as Record<string, unknown>;
  return (
    <div className="ds-install">
    <StackScreen label="Install details">
      <StackHead back={sys.name} onBack={onBack} name="Install details" />
      <StackGroup>
        {installQuestions(doc, pack, sys).map((q) => {
          const words = answerWords(q, answers);
          const fromQuote = !!words && stillQuoted(quoted[q.id], answers[q.id]);
          return (
            <StackRow
              key={q.id}
              name={SHORT[q.id] ?? q.text}
              sub={words || undefined}
              value={words ? (fromQuote ? "Quoted" : undefined) : "To answer"}
              tone={words ? undefined : "look"}
              chevron
              onPress={onOpen}
            />
          );
        })}
      </StackGroup>
    </StackScreen>
    </div>
  );
}
