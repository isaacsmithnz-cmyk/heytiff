"use client";

import { displayName } from "@/components/fleet/logic";
import { PhotoBadge } from "./photo-badge";
import type { AssignedVehicle, ProfileActions, ProfileHeader } from "./types";

/* Who this is — the first block of Summary, inside the card.

   It began life as a dark rail down the left, then as a page header above the
   tabs. Both were the same mistake in different places: a second header, next
   to a card that opened with its own headline. It sits INSIDE the card now and
   opens Summary, because Summary's question is "who is this and what do we
   hold", and this is the "who".

   EVERY FACT HERE IS DERIVED and none of it is editable — which is why the
   block carries no Edit button. Editing is per-section, on the tab that owns
   the field. The one control is the camera badge, and the photo is the one
   thing on this screen that has no field anywhere else.

   What it shows, Summary's panels do not repeat: name, role, status, start
   date, tenure and the assigned vehicle all live here and nowhere below. The
   licence count used to as well, until the licence wall landed two panels
   further down saying it better. */
export function IdentityBlock({
  header,
  vehicle,
  actions,
}: {
  header: ProfileHeader;
  vehicle: AssignedVehicle | null;
  actions: Pick<ProfileActions, "onSetPhoto" | "onClearPhoto">;
}) {
  return (
    <div className="pident">
      <PhotoBadge
        photoUrl={header.photoUrl}
        initials={header.initials}
        name={header.name}
        onSet={actions.onSetPhoto}
        onClear={actions.onClearPhoto}
      />

      <div className="phid">
        <h1>
          {header.name}
          {header.nickname ? <em>“{header.nickname}”</em> : null}
        </h1>
        <div className="sub">
          {/* the role alone. The org's trading name used to follow it and says
              nothing here — every licence card below carries it as the issuer,
              and there is only ever one org on screen. */}
          {header.role && header.role !== "—" ? <span>{header.role}</span> : null}
          <span className={header.status === "Active" ? "badge active" : "badge off"}>
            <span className="d" />
            {header.status}
          </span>
        </div>
      </div>

      <dl className="pfstrip">
        <Fact label="Started" value={header.started} />
        <Fact label="Tenure" value={header.years === "—" ? "—" : `${header.years} years`} />
        <Fact
          label="Vehicle"
          value={vehicle ? displayName(vehicle.vehicle) : "Unassigned"}
          muted={!vehicle}
        />
      </dl>
    </div>
  );
}

function Fact({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="pfs">
      <dt>{label}</dt>
      <dd className={muted ? "muted" : undefined}>{value}</dd>
    </div>
  );
}
