"use client";

/* SYSTEMS AS SCREENS (the next flow; the Clean layout page of the Studio
   rework mocks). The right column's first screen lists the systems; a press
   pushes that system's screen, with its rooms, what's left to place, and the
   ways on: Edit system, Install details, the air. A room pushes the room's own
   screen. The next step is always the one button at the foot, in the same
   words everywhere. */

import type { DesignDocument } from "@/lib/studio/document";
import type { DataPack } from "@/lib/studio/packs/schema";
import type { SizingBasis } from "@/lib/studio/loads";
import { allocationsOf, hasAllocations, trayItems } from "@/lib/studio/builder";
import { KIND_WORD, systemKind, systemZones, unclaimedZones } from "@/lib/studio/zones";
import { brandName, combinationWord, connectionRatio } from "@/lib/studio/verdict";
import { coverOfText, systemCover } from "@/lib/studio/coverage";
import { roomLoadKw } from "@/lib/studio/loads-room";
import { cardStatus } from "@/lib/studio/status";
import { equipmentList, installState } from "@/lib/studio/install";
import { systemAir } from "@/lib/studio/airflow";
import type { PlacingUnit } from "./canvas";
import { Rack } from "./systems-panel";
import { StackDot, StackGroup, StackHead, StackRow, StackScreen, StackSection } from "./stack";
import { VariationButton } from "./variation-menu";

const kwText = (kw: number | null) => (kw == null ? "" : `${kw.toFixed(1)} kW`);

/** a status tone in the stack's words */
const toneOf = (tone: string): "good" | "look" | "bad" | undefined =>
  tone === "ok" || tone === "good" ? "good" : tone === "bad" ? "bad" : tone === "warn" || tone === "look" ? "look" : undefined;

export function SystemsList({
  doc,
  pack,
  basis,
  next,
  onNext,
  onOpen,
  onAddSystem,
  onOpenRooms,
  onOpenRoom,
  onAddVariant,
  onSwitchVariant,
  onRenameVariant,
}: {
  doc: DesignDocument;
  pack: DataPack | null;
  basis: SizingBasis;
  next: { label: string } | null;
  onNext: () => void;
  onOpen: (id: string) => void;
  onAddSystem: () => void;
  onOpenRooms: () => void;
  onOpenRoom: (id: string) => void;
  onAddVariant: () => void;
  onSwitchVariant: (id: string) => void;
  onRenameVariant: (label: string) => void;
}) {
  const free = unclaimedZones(doc);
  const rooms = doc.objects.filter((o) => o.type === "room").length;
  return (
    <StackScreen
      label="Systems"
      foot={
        next ? (
          <button type="button" className="ds-stack-main" onClick={onNext}>
            {`Next: ${next.label}`}
          </button>
        ) : null
      }
    >
      <StackHead
        name="Systems"
        action={
          <button type="button" className="ds-stack-small" onClick={onAddSystem}>
            Add system
          </button>
        }
      />
      {doc.systems.length > 0 && (
        <StackGroup>
          {doc.systems.map((sys) => {
            const kind = systemKind(doc, sys);
            const zones = systemZones(doc, sys.id);
            const status = cardStatus(doc, pack, basis, sys);
            const type = kind === "empty" ? "Not built" : KIND_WORD[kind];
            return (
              <StackRow
                key={sys.id}
                lead={<StackDot colour={sys.colour} />}
                name={sys.name}
                sub={`${type}, ${zones.length === 1 ? "1 room" : `${zones.length} rooms`}`}
                value={status.text}
                tone={toneOf(status.tone)}
                chevron
                onPress={() => onOpen(sys.id)}
              />
            );
          })}
        </StackGroup>
      )}
      <StackGroup>
        <StackRow name="Rooms" value={rooms === 1 ? "1 room" : `${rooms} rooms`} chevron onPress={onOpenRooms} />
        <StackRow name="Options">
          <VariationButton doc={doc} onAddVariant={onAddVariant} onSwitchVariant={onSwitchVariant} onRenameVariant={onRenameVariant} />
        </StackRow>
      </StackGroup>
      {free.length > 0 && (
        <>
          <StackSection>Rooms without a system</StackSection>
          <StackGroup>
            {free.map((z) => (
              <StackRow key={z.id} name={String(z.props.name ?? "Room")} value={kwText(roomLoadKw(doc, z))} chevron onPress={() => onOpenRoom(z.id)} />
            ))}
          </StackGroup>
        </>
      )}
    </StackScreen>
  );
}

export function SystemScreen({
  doc,
  pack,
  basis,
  systemId,
  next,
  onNext,
  claiming,
  onBack,
  onOpenRoom,
  onAddZones,
  onClaimDone,
  onBuild,
  onInstall,
  onAir,
  onArmPlace,
}: {
  doc: DesignDocument;
  pack: DataPack | null;
  basis: SizingBasis;
  systemId: string;
  next: { label: string } | null;
  onNext: () => void;
  claiming: boolean;
  onBack: () => void;
  onOpenRoom: (id: string) => void;
  onAddZones: () => void;
  onClaimDone: () => void;
  onBuild: () => void;
  onInstall: () => void;
  onAir: () => void;
  onArmPlace: (p: PlacingUnit | null) => void;
}) {
  const sys = doc.systems.find((s) => s.id === systemId);
  if (!sys) return null;
  const kind = systemKind(doc, sys);
  const zones = systemZones(doc, sys.id);
  const status = cardStatus(doc, pack, basis, sys);
  const units = hasAllocations(sys) ? allocationsOf(sys).filter((a) => a.model) : [];
  const indoors = units.filter((a) => a.role !== "odu");
  const odu = units.find((a) => a.role === "odu")?.model ?? null;
  const rack = pack ? trayItems(doc, pack).filter((t) => t.systemId === sys.id) : [];
  const cover = pack && kind !== "empty" ? systemCover(doc, pack, sys, basis) : null;
  const ratio = pack ? connectionRatio(pack, sys) : null;
  const word = pack ? combinationWord(doc, pack, sys) : null;
  const asked = pack ? equipmentList(doc, pack, sys) : null;
  const install = pack ? installState(doc, pack, sys) : "not-asked";
  const hasAir = pack ? systemAir(doc, pack, sys).length > 0 : false;
  const canAdd = doc.objects.some((o) => o.type === "room" && !zones.some((z) => z.id === o.id));
  const type = kind === "empty" ? "Not built" : KIND_WORD[kind];
  const foot =
    kind === "empty" ? (
      zones.length > 0 ? (
        <button type="button" className="ds-stack-main" onClick={onBuild}>
          Build system
        </button>
      ) : null
    ) : next ? (
      <button type="button" className="ds-stack-main" onClick={onNext}>
        {`Next: ${next.label}`}
      </button>
    ) : null;

  return (
    <StackScreen label={sys.name} foot={foot}>
      <StackHead back="Systems" onBack={onBack} name={sys.name} sub={[type, pack ? brandName(pack, sys.brand) : ""].filter(Boolean).join(", ")} />
      {kind !== "empty" && (
        <StackGroup>
          {indoors.length === 1 && <StackRow name="Indoor" value={indoors[0].model} />}
          {indoors.length > 1 && <StackRow name="Indoor" value={`${indoors.length} units`} />}
          {odu && <StackRow name="Outdoor" value={odu} />}
          {cover && (
            <StackRow
              name="Cover"
              value={`${cover.coverKw.toFixed(1)} of ${coverOfText(cover)}`}
              tone={status.tone === "bad" ? "bad" : undefined}
            />
          )}
          {ratio && <StackRow name="Connection" value={`${ratio.pct}%`} />}
          {word && <StackRow name="Combination" value={word} tone={word === "Valid" ? "good" : "bad"} />}
        </StackGroup>
      )}
      {status.tone === "bad" && <p className="ds-stack-why">{status.why ?? status.text}</p>}
      {rack.length > 0 && (
        <>
          <StackSection>Units to place</StackSection>
          <StackGroup>
            <Rack pack={pack} items={rack} onArmPlace={onArmPlace} />
          </StackGroup>
        </>
      )}
      <StackSection>Rooms</StackSection>
      <StackGroup>
        {zones.map((z) => (
          <StackRow key={z.id} name={String(z.props.name ?? "Room")} value={kwText(roomLoadKw(doc, z))} chevron onPress={() => onOpenRoom(z.id)} />
        ))}
        {claiming ? (
          <StackRow name="Done adding rooms" onPress={onClaimDone} />
        ) : canAdd || zones.length === 0 ? (
          <StackRow name="Add rooms" onPress={onAddZones} />
        ) : null}
      </StackGroup>
      {kind !== "empty" && (
        <StackGroup>
          <StackRow name="Edit system" chevron onPress={onBuild} />
          <StackRow
            name="Install details"
            value={asked ? `${asked.answered} of ${asked.total}` : ""}
            tone={install === "complete" ? "good" : undefined}
            chevron
            onPress={onInstall}
          />
          {hasAir && <StackRow name="Air" chevron onPress={onAir} />}
        </StackGroup>
      )}
    </StackScreen>
  );
}
