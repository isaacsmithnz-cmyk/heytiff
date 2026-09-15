"use client";

import Link from "next/link";
import { Plate } from "@/components/fleet/plate";
import type { Completeness } from "@/lib/staff/completeness";
import { PhotoBadge } from "./photo-badge";
import type { AssignedVehicle, ProfileActions, ProfileHeader } from "./types";

/* Who this is — the first row of Summary, inside the card.

   It began life as a dark rail down the left, then as a page header above the
   tabs. Both were the same mistake in different places: a second header, next
   to a card that opened with its own headline. It sits INSIDE the card now and
   opens Summary, because Summary's question is "who is this and what do we
   hold", and this is the "who".

   The name and the status on one line; under them one sentence — the role,
   and since when — and the plate of the assigned vehicle, which is a door
   into Fleet. At the row's right, the completion line (see Completion).

   EVERY FACT HERE IS DERIVED and none of it is editable — which is why the
   block carries no Edit button. Editing is per-section, on the tab that owns
   the field. The one control is the camera badge, and the photo is the one
   thing on this screen that has no field anywhere else. The start date is the
   exception the other way: it reads here, so when it is missing its Add is
   here too, rather than a blank the tab's count points at and nothing shows. */
export function IdentityBlock({
  header,
  vehicle,
  actions,
  completeness,
  onAddStart,
}: {
  header: ProfileHeader;
  vehicle: AssignedVehicle | null;
  actions: Pick<ProfileActions, "onSetPhoto" | "onClearPhoto">;
  completeness: Completeness;
  /** opens Personal's form, where the start date is set */
  onAddStart: () => void;
}) {
  const role = header.role && header.role !== "—" ? header.role : null;
  const started = header.started !== "—";
  /* "Lead Installer, since Jun 2020 (6.1 years)" — one sentence, not a chain
     of facts with dots between them. The tenure rides in brackets because it
     is the start date said again as a length, not a second fact. */
  const since = started
    ? `since ${header.started}${header.years !== "—" ? ` (${header.years} years)` : ""}`
    : null;
  const line = [role, since].filter(Boolean).join(", ");
  const sentence = line ? line.charAt(0).toUpperCase() + line.slice(1) : null;

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
        <div className="ptitle">
          <h1>
            {header.name}
            {header.nickname ? <em>“{header.nickname}”</em> : null}
          </h1>
          <span className={header.status === "Active" ? "badge active" : "badge off"}>
            <span className="d" />
            {header.status}
          </span>
        </div>
        <div className="sub">
          {sentence && <span>{sentence}</span>}
          {!started && (
            <span className="psum-add">
              <button type="button" className="psum-addl" onClick={onAddStart}>
                Add a start date
              </button>
              <span className="psum-req">Required</span>
            </span>
          )}
          <VehiclePlate vehicle={vehicle} />
        </div>
      </div>

      <Completion c={completeness} />
    </div>
  );
}

/* THE COMPLETION LINE — the page's answer, at the row's right.

   How many of the details the business asks for are on file, and a state word
   only when there is a state: a warn word while a required detail is missing
   (payroll or the law is blocked on it), the OK word once every detail is in.
   The bar draws the proportion in the same colour — warn until the required
   ones are in, OK from then, because "cleared to work" is the question and the
   optional details do not change the answer. Nothing renders on the other
   tabs: their counts say which section is short. */
function Completion({ c }: { c: Completeness }) {
  const cleared = c.requiredMissing === 0;
  return (
    <div className="pcompl">
      {c.requiredMissing > 0 ? (
        <b className="warn">
          {c.requiredMissing} required {c.requiredMissing === 1 ? "detail" : "details"} missing
        </b>
      ) : c.complete ? (
        <b className="ok">Profile complete</b>
      ) : null}
      <span>
        {c.filled} of {c.total} on file
      </span>
      <span className="pprog" aria-hidden="true">
        <i className={cleared ? "ok" : "warn"} style={{ width: `${c.percent}%` }} />
      </span>
    </div>
  );
}

/* THE VEHICLE IS A PLATE AND A DOOR, and it used to be four rows of panel.

   In a fleet of white Hiaces the plate is the only thing that tells one from
   another, so the plate IS the fact. Everything else about the vehicle —
   including its warnings — belongs to Fleet, one click away, where it is
   current rather than copied. Isaac's call: the staff card names the vehicle,
   it does not nag about it. Nobody assigned, nothing said: "Unassigned" was a
   fact about an absence, on a line that is a sentence about the person. */
function VehiclePlate({ vehicle }: { vehicle: AssignedVehicle | null }) {
  if (!vehicle) return null;
  const v = vehicle.vehicle;
  return (
    /* `?v=` and not a path segment: the app shell keys its outlet on
       pathname, so a link that changes the path remounts the page it lands
       on. Assets reads the param and opens that vehicle. */
    <Link className="vehjump" href={`/dashboard/assets?v=${v.id}`}>
      <Plate plate={v.plate} state={v.plateState} size="sm" />
      <span className="sr-only">Open {v.plate} in Fleet</span>
    </Link>
  );
}
