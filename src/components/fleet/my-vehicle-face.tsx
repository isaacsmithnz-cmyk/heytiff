"use client";

import { useState } from "react";
import { useFleetActions } from "./fleet-state";
import { FaceSwitch } from "@/components/me/face-switch";
import type { OwnFleet } from "./assets-screen";
import { MyVehicle, type VehicleFace } from "./my-vehicle";

/* /dashboard/my-vehicle — the staff lens on the fleet, as a FACE of the Me
   card. Same component and same narrow payload as the Assets tab; what's
   different is that it needs no capability and never mentions a register.

   FOUR FACES INSIDE THIS ONE. Vehicle is the truck as it stands — hero, quick
   logging, the fact tiles. The other three are the log, split by the question
   you came with: Fuel (fill-ups and odometer readings, with the economy figure
   they produce), Issues (what you reported, open first), Services.

   IT WAS ONE FACE CALLED HISTORY and it was every log of every kind in one
   column — "History is too broad. Where can you see the issues that you have
   logged? Or your last services?" (Isaac, 2026-08-23). It still shows every
   log, which is the fix the History face was built for in the first place;
   what changed is that finding one no longer means reading all of them.

   The strip lives on `FaceSwitch` rather than the card's edge, because this
   component no longer owns a card — Me does, and its strip holds the five
   destinations. */

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
  const [face, setFace] = useState<VehicleFace>("vehicle");
  const openIssues = own.logs.filter((l) => l.kind === "issue" && l.status === "open").length;

  return (
    <div className="wb2-card">
      <div className="ppanel2">
        <FaceSwitch
          ariaLabel="Your vehicle"
          idPrefix="mvt"
          panelPrefix="mvp"
          active={face}
          onGo={(k) => setFace(k as VehicleFace)}
          items={[
            { key: "vehicle", label: "Vehicle" },
            { key: "fuel", label: "Fuel" },
            {
              /* The count is what is still WRONG, not how many faults this ute
                 has ever had — the same rule Claims follows with "n open".
                 Deliberately untinted: the vehicle face already carries the
                 red chip, and a second alarm on the switch would be the one
                 number said twice. */
              key: "issues",
              label: "Issues",
              count: openIssues,
              countLabel: (n) => `${n} still open`,
            },
            { key: "services", label: "Services" },
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
