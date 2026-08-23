"use client";

import { useState } from "react";
import { useFleetActions } from "./fleet-state";
import { FaceSwitch } from "@/components/me/face-switch";
import type { OwnFleet } from "./assets-screen";
import { MyVehicle } from "./my-vehicle";

/* /dashboard/my-vehicle — the staff lens on the fleet, as a FACE of the Me
   card. Same component and same narrow payload as the Assets tab; what's
   different is that it needs no capability and never mentions a register.

   TWO FACES INSIDE THIS ONE. Vehicle is the truck as it stands — hero, quick
   logging, the fact tiles; History is every log ever taken on it. The old
   single page showed the newest eight logs and simply ended: log nine existed
   in the table and nowhere on screen.

   That pair used to be the card's own tab strip. It is `FaceSwitch` now,
   because this component no longer owns a card — Me does, and its strip holds
   the five destinations. Nothing about which logs are reachable changed. */

export function MyVehicleFace({
  own,
  today,
  viewerStaffId,
}: {
  own: OwnFleet;
  today: string;
  viewerStaffId: string | null;
}) {
  const actions = useFleetActions();
  const [face, setFace] = useState<"vehicle" | "history">("vehicle");

  return (
    <div className="wb2-card">
      <div className="ppanel2">
        <FaceSwitch
          ariaLabel="Your vehicle"
          idPrefix="mvt"
          panelPrefix="mvp"
          active={face}
          onGo={(k) => setFace(k as "vehicle" | "history")}
          items={[
            { key: "vehicle", label: "Vehicle" },
            {
              key: "history",
              label: "History",
              count: own.logs.length,
              countLabel: (n) => `${n} logged`,
            },
          ]}
        />
        {/* No `key`, no `.psec2` — the vehicle and its log history swap in
            place, like Team's directory. The pair remounts the face and fades
            it in (see me-screen.tsx). */}
        <section id={`mvp-${face}`} role="tabpanel" aria-labelledby={`mvt-${face}`} tabIndex={-1}>
          <MyVehicle
            face={face}
            vehicle={own.vehicle}
            pickable={own.pickable}
            logs={own.logs}
            error={actions.error}
            onLog={actions.addLog}
            onEditLog={actions.editLog}
            onDeleteLog={actions.deleteLog}
            viewerStaffId={viewerStaffId}
            today={today}
          />
        </section>
      </div>
    </div>
  );
}
