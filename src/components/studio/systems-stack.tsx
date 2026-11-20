"use client";

/* SYSTEMS AS SCREENS (the next flow; the Clean layout page of the Studio
   rework mocks). The right column's first screen lists the systems; a press
   pushes that system's screen, with its rooms, what's left to place, and the
   ways on: Edit system, Install details, the air. A room pushes the room's own
   screen. The next step is always the one button at the foot, in the same
   words everywhere, and it says only what it does (Build system, Install
   details), never "Next:": Help teaches the order (Isaac, 20 November 2026:
   "remove suggestions like next build system, just say build system", "a
   help guide will do the teaching"). */

import { useState } from "react";
import type { DesignDocument } from "@/lib/studio/document";
import { canLeaveOut, leftOutRooms } from "@/lib/studio/left-out";
import type { QuotedOption } from "@/lib/studio/from-quote";
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


/** the brand an option was quoted in: its outdoor's maker, off the pack */
function quotedBrandName(pack: DataPack | null, o: QuotedOption): string {
  const model = o.outdoor?.model ?? o.heads.find((h) => h.model)?.model ?? null;
  const row = pack && model ? (pack.outdoor_units.find((u) => u.model === model) ?? pack.indoor_units.find((u) => u.model === model)) : null;
  return pack && row ? brandName(pack, row.brand) : "";
}

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
  onLeaveOut,
  onPutBack,
  quoted = [],
  onAddQuoted,
}: {
  doc: DesignDocument;
  pack: DataPack | null;
  basis: SizingBasis;
  next: { label: string } | null;
  onNext: () => void;
  onOpen: (id: string) => void;
  /** the job's quote's options not in the design yet (from-quote.ts) */
  quoted?: QuotedOption[];
  onAddQuoted?: (o: QuotedOption) => void;
  /** these rooms off the design, kept (left-out.ts) */
  onLeaveOut: (ids: string[]) => void;
  onPutBack: (ids: string[]) => void;
  onAddSystem: () => void;
  onOpenRooms: () => void;
  onOpenRoom: (id: string) => void;
  onAddVariant: () => void;
  onSwitchVariant: (id: string) => void;
  onRenameVariant: (label: string) => void;
}) {
  const free = unclaimedZones(doc);
  const rooms = doc.objects.filter((o) => o.type === "room").length;
  const leavable = free.filter((z) => canLeaveOut(doc, z.id));
  const freeKw = free.reduce((t, z) => t + (roomLoadKw(doc, z) ?? 0), 0);
  const out = leftOutRooms(doc);
  const [outOpen, setOutOpen] = useState(false);
  return (
    <StackScreen
      label="Systems"
      foot={
        next ? (
          <button type="button" className="ds-stack-main" onClick={onNext}>
            {next.label}
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
      {quoted.length > 0 && onAddQuoted && (
        <>
          <StackSection>From the quote</StackSection>
          {quoted.map((o) => (
            <StackGroup key={o.index}>
              <StackRow
                name={o.accepted ? `${o.name}, accepted` : o.name}
                sub={[quotedBrandName(pack, o), o.kind].filter(Boolean).join(" ")}
              >
                <button type="button" className="ds-stack-small" onClick={() => onAddQuoted(o)}>
                  Add to design
                </button>
              </StackRow>
              {o.outdoor && <StackRow name="Outdoor" value={o.outdoor.model ?? o.outdoor.code} />}
              {o.heads.map((h, i) => (
                <StackRow
                  key={i}
                  name={h.roomName ?? h.room}
                  value={h.roomId ? (h.model ?? h.code) : "No room on the plan"}
                  tone={h.roomId && h.model ? undefined : "look"}
                />
              ))}
            </StackGroup>
          ))}
        </>
      )}
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
            {leavable.length > 0 && (
              <StackRow name={`${free.length === 1 ? "1 room" : `${free.length} rooms`}, ${freeKw.toFixed(1)} kW`} sub="Not air conditioned?">
                <button type="button" className="ds-stack-small" onClick={() => onLeaveOut(leavable.map((z) => z.id))}>
                  {leavable.length === 1 ? "Leave it out" : "Leave them out"}
                </button>
              </StackRow>
            )}
            {free.map((z) => (
              <StackRow key={z.id} name={String(z.props.name ?? "Room")} value={kwText(roomLoadKw(doc, z))} chevron onPress={() => onOpenRoom(z.id)} />
            ))}
          </StackGroup>
        </>
      )}
      {out.length > 0 && (
        <>
          <StackSection>Left out</StackSection>
          <StackGroup>
            <StackRow
              name={out.length === 1 ? "1 room" : `${out.length} rooms`}
              sub={out.map((o) => String(o.props.name ?? "Room")).join(", ")}
              chevron={!outOpen}
              onPress={() => setOutOpen((v) => !v)}
            />
            {outOpen &&
              out.map((o) => (
                <StackRow key={o.id} name={String(o.props.name ?? "Room")}>
                  <button type="button" className="ds-stack-small" onClick={() => onPutBack([o.id])}>
                    Put back
                  </button>
                </StackRow>
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
  litRoomId = null,
}: {
  doc: DesignDocument;
  pack: DataPack | null;
  basis: SizingBasis;
  systemId: string;
  /** the room picked on the plan while this system is open: its row lit */
  litRoomId?: string | null;
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
        {next.label}
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
          <StackRow key={z.id} name={String(z.props.name ?? "Room")} value={kwText(roomLoadKw(doc, z))} lit={z.id === litRoomId} chevron onPress={() => onOpenRoom(z.id)} />
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
