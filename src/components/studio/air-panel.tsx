"use client";

/* THE AIR, A SCREEN OF THE COLUMN (the next flow; board "Air view"). What each
   room needs against the grilles on its plan, and the same air over the plan
   itself while this screen is open. */

import { Tray } from "@/components/parts/tabs";
import type { DesignDocument } from "@/lib/studio/document";
import type { DataPack } from "@/lib/studio/packs/schema";
import { systemAir } from "@/lib/studio/airflow";
import { airRows, speedWords, type AirRoomRow } from "@/lib/studio/air-view";
import { StackGroup, StackHead, StackRow, StackScreen, StackSection } from "./stack";

export type AirShow = "air" | "speed";

const SHOW = [
  { value: "air", label: "Airflow" },
  { value: "speed", label: "Velocity" },
] as const;

const VERDICT: Record<AirRoomRow["verdict"], { word: string; tone: "good" | "bad" }> = {
  good: { word: "Good", tone: "good" },
  fast: { word: "Too fast", tone: "bad" },
  none: { word: "No grille", tone: "bad" },
};

export function AirPanel({
  doc,
  pack,
  systemId,
  show,
  onShow,
  onBack,
  onOpenRoom,
  onAddGrille,
}: {
  doc: DesignDocument;
  pack: DataPack;
  systemId: string;
  show: AirShow;
  onShow: (s: AirShow) => void;
  onBack: () => void;
  onOpenRoom: (id: string) => void;
  onAddGrille: () => void;
}) {
  const sys = doc.systems.find((s) => s.id === systemId);
  if (!sys) return null;
  const units = systemAir(doc, pack, sys);
  const rows = airRows(doc, pack, sys);
  const missing = rows.some((r) => r.verdict === "none");
  return (
    <StackScreen
      label={`Air, ${sys.name}`}
      foot={
        missing ? (
          <button type="button" className="ds-stack-main" onClick={onAddGrille}>
            Add a grille
          </button>
        ) : null
      }
    >
      <StackHead
        back={sys.name}
        onBack={onBack}
        name="Air"
        sub={units.map((u) => `${u.model}, ${Math.round(u.ls).toLocaleString("en-AU")} L/s`).join("; ")}
      />
      <StackGroup>
        <StackRow name="On the plan">
          <Tray ariaLabel="On the plan" options={SHOW} value={show} onChange={onShow} />
        </StackRow>
      </StackGroup>
      <StackSection>Rooms</StackSection>
      <StackGroup>
        {rows.map((r) => (
          <StackRow
            key={r.roomId}
            name={r.name}
            sub={`${Math.round(r.ls)} L/s, ${r.grilleWords}`}
            more={speedWords(r)}
            value={VERDICT[r.verdict].word}
            tone={VERDICT[r.verdict].tone}
            chevron
            onPress={() => onOpenRoom(r.roomId)}
          />
        ))}
      </StackGroup>
    </StackScreen>
  );
}
