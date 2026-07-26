"use client";

import { displayName } from "@/components/fleet/logic";
import type { AssignedVehicle, ProfileHeader } from "./types";

/* The dark rail down the left of the staff card — who this is, at a glance.

   It replaced the full-width hero, and in doing so it took the hero's job off
   the Personal card: the rail already shows the photo, the name, the role, the
   status and the headline facts, so the plastic staff card that used to sit at
   the top of Personal was saying all of it a second time. Personal now opens
   straight onto the fields.

   Every fact here is DERIVED — start date, tenure, licence count, the vehicle
   Fleet says is assigned. Nothing on the rail is editable, which is why it
   carries no Edit button: editing is per-card, on the card that owns the
   field. */
export function ProfileRail({
  header,
  org,
  vehicle,
}: {
  header: ProfileHeader;
  /** the org's trading name — the line under the name, as on the ID cards */
  org: string | null;
  vehicle: AssignedVehicle | null;
}) {
  const meta = [header.role, org].filter((s) => s && s !== "—");

  return (
    <aside className="prail">
      <div className="mesh" aria-hidden="true">
        <i className="m1" />
        <i className="m2" />
      </div>
      <div className="prail-in">
        <div className="pphoto">
          {header.photoUrl ? (
            /* a signed storage URL, not a build-time asset — next/image would
               want the host allowlisted, as on the ID cards */
            // eslint-disable-next-line @next/next/no-img-element
            <img className="inn" src={header.photoUrl} alt="" />
          ) : (
            <div className="inn">{header.initials}</div>
          )}
        </div>

        <div className="pid">
          <h1>
            {header.name}
            {header.nickname ? <em>“{header.nickname}”</em> : null}
          </h1>
          {/* the separator is glued to the word before it with a non-breaking
              space, so a narrow rail can only ever break AFTER the dot —
              stacked, this line used to wrap onto "· Diamond Air" */}
          {meta.length > 0 && <div className="sub">{meta.join("\u00a0· ")}</div>}
        </div>

        <span className={header.status === "Active" ? "badge active" : "badge off"}>
          <span className="d" />
          {header.status}
        </span>

        <dl className="pfacts">
          <Fact label="Started" value={header.started} />
          <Fact label="Tenure" value={header.years === "—" ? "—" : `${header.years} years`} />
          <Fact label="Licences" value={String(header.licenceCount)} />
          <Fact
            label="Vehicle"
            value={vehicle ? displayName(vehicle.vehicle) : "Unassigned"}
            muted={!vehicle}
          />
        </dl>
      </div>
    </aside>
  );
}

function Fact({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="pfact">
      <dt>{label}</dt>
      <dd className={muted ? "muted" : undefined}>{value}</dd>
    </div>
  );
}
