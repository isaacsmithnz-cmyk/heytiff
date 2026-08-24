"use client";

import Link from "next/link";
import { Plate } from "@/components/fleet/plate";
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
        <VehicleFact vehicle={vehicle} />
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

/* THE VEHICLE IS A PLATE AND A DOOR, and it used to be four rows of panel.

   The assignment had a panel of its own down the card — plate, make & model,
   next service, rego expiry — sitting under a strip that had already named the
   vehicle. That is the card's own rule broken ("if the identity block says it,
   a panel doesn't"), and it cost a whole panel to say what one identifier says:
   in a fleet of white Hiaces the plate is the only thing that tells one from
   another, so the plate IS the fact. Everything else about the vehicle —
   including its warnings — belongs to Fleet, one click away, where it is
   current rather than copied. Isaac's call: the staff card names the vehicle,
   it does not nag about it. */
function VehicleFact({ vehicle }: { vehicle: AssignedVehicle | null }) {
  if (!vehicle) return <Fact label="Vehicle" value="Unassigned" muted />;

  const v = vehicle.vehicle;
  return (
    <div className="pfs pfs-veh">
      <dt>Vehicle</dt>
      <dd>
        {/* `?v=` and not a path segment: the app shell keys its outlet on
            pathname, so a link that changes the path remounts the page it
            lands on. Assets reads the param and opens that vehicle. */}
        <Link className="vehjump" href={`/dashboard/assets?v=${v.id}`}>
          <Plate plate={v.plate} state={v.plateState} size="sm" />
          <span className="sr-only">Open {v.plate} in Fleet</span>
        </Link>
      </dd>
    </div>
  );
}
