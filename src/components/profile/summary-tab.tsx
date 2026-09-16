"use client";

import type { ReactNode } from "react";
import { formatAuDate } from "@/lib/au-dates";
import { PROFILE_FIELDS, type Completeness } from "@/lib/staff/completeness";
import { licenceStatus } from "@/lib/staff/licence";
import type { StaffProfile } from "@/lib/staff/profile";
import type { StaffLicence } from "@/lib/staff/types";
import { uniformSummary } from "@/lib/staff/uniform";
import { workRightsLine, type StateTone } from "@/lib/staff/work-rights-summary";
import { IdentityBlock } from "./identity-block";
import type {
  AssignedVehicle,
  ProfileActions,
  ProfileHeader,
  ProfileMode,
  SectionKey,
} from "./types";

/* Summary — the landing tab, and the checklist that fills itself in.

   REDRAWN AGAIN 2026-09-16, and the reason is worth keeping. The first draw
   (2026-09-15) was correct to the laws and unreadable anyway. Isaac, on it:
   "it's actually quite hard to scan because everything looks the same — it
   says name, and then the name underneath it is almost the same." He was
   describing arithmetic, not taste. Nine roles — group title, field label,
   field value, ticket number, expiry, count, link, tab, sentence — were all
   set at 13/500 or 14/400: one pixel apart, and the weight ran BACKWARDS, so
   a label was heavier than the value it introduced. Two greys were carrying
   hierarchy that size should have carried. The scale has eight sizes; that
   screen used three.

   SO THE PAGE IS TIERED NOW, and the tiers are far enough apart to scan:
   the name at 32/700, the standing line at 24/400, a group's title at 20/600
   in ink, a field's label at 12/500 quiet and its value at 16/600 in ink.
   Four steps of size, a weight step and a colour step between a label and its
   answer.

   AND THE PAIR TURNED SIDEWAYS. Label over value in a three-column grid makes
   the eye zigzag — read down, jump right, read down — which is the slowest
   way to look one fact up. Label BESIDE value in a fixed 132px column gives
   one column of scaffolding and one column of answers, ruled between rows: a
   ledger. A staff card is a record you look things up in, not prose you read
   through. Personal and Emergency sit side by side because Emergency is three
   fields and never earned a band of its own.

   THE RIGHT TO WORK LEFT THE ROW OF TICKETS and became the standing line (see
   lib/staff/work-rights-summary). It is not a ticket, nothing on it expires
   the way a White card does, and it decides whether this person can be sent
   to a job at all — drawn as a grey box beside a grey box, it was the one
   thing you could not pick out.

   ABSENCE IS SAID ONCE. Every blank used to be announced twice: an amber
   "Required" beside the field AND in the count above it. On a card with four
   gaps that made absence the loudest thing on the screen, in the page's only
   strong colour, while everything on file sat quiet — the look of a form
   nobody filled in. Now the count owns it, and it is the page's one heavy
   object: an ink button that opens the first gap. Ink doing the primary
   action is the job the laws already give it. A blank in a cell is a plain
   Add, or a dash where nobody is short of it.

   IF THE IDENTITY ROW SAYS IT, A GROUP DOESN'T: name, status, role, start and
   the assigned vehicle live up there and nowhere below, which is why Personal
   opens on Date of birth. */
export function SummaryTab({
  header,
  profile,
  licences,
  vehicle,
  today,
  warnDays,
  orgState,
  mode,
  actions,
  completeness,
  onGo,
}: {
  header: ProfileHeader;
  profile: StaffProfile | null;
  licences: StaffLicence[];
  vehicle: AssignedVehicle | null;
  today: string;
  warnDays: number;
  /** the org's home state, so an unset holiday state can be RESOLVED rather
      than described. See the Holiday state cell. */
  orgState: string | null;
  mode: ProfileMode;
  actions: Pick<ProfileActions, "onSetPhoto" | "onClearPhoto">;
  completeness: Completeness;
  /** open a tab; `true` opens it straight into its form, on `field` */
  onGo: (key: SectionKey, withEdit?: boolean, field?: keyof StaffProfile) => void;
}) {
  const addPersonal = (field?: keyof StaffProfile) => onGo("personal", true, field);
  const addEmergency = (field?: keyof StaffProfile) => onGo("emergency", true, field);
  const rights = workRightsLine(profile, today, warnDays);

  return (
    <div className="psum">
      <IdentityBlock
        header={header}
        vehicle={vehicle}
        actions={actions}
        onAddStart={() => addPersonal("start_date")}
      />

      <Standing line={rights} />
      <Record c={completeness} onGo={onGo} />

      <div className="psum-pair">
        <Group title="Personal" link="Edit" onLink={() => addPersonal()}>
          <Row label="Date of birth" value={formatAuDate(profile?.birthday)} field="birthday" onAdd={addPersonal} />
          <Row label="Mobile" value={profile?.phone} field="phone" onAdd={addPersonal} />
          {/* the sign-in address on your own card, the contact address on a
              colleague's — either way not a column this card writes, so never
              an Add */}
          <Row label="Email" value={header.email} />
          <Row label="Address" value={profile?.address} field="address" onAdd={addPersonal} />
          <Row label="Employment" value={profile?.employment_type} field="employment_type" onAdd={addPersonal} />
          {/* ONE row, not four: "Shirt L, Trousers 92, Boots 10" is the whole
              answer a uniform order needs. The sizes are set on Personal. */}
          <Row label="Uniform" value={uniformSummary(profile)} />
          {/* RESOLVED, not described. "Same as organisation" is a sentence
              about a setting; the org's own state is the answer to "which
              public holidays is this person paid for", and the line under it
              says where it came from. */}
          {mode === "admin" && (
            <Row
              label="Holiday state"
              value={profile?.state || orgState}
              sub={profile?.state ? undefined : orgState ? "Organisation default" : undefined}
            />
          )}
        </Group>

        <Group title="Emergency contact" link="Edit" onLink={() => addEmergency()}>
          <Row
            label="Name"
            value={profile?.emergency_name}
            field="emergency_name"
            addName="Emergency contact name"
            onAdd={addEmergency}
          />
          <Row label="Relationship" value={profile?.emergency_relationship} />
          <Row
            label="Phone"
            value={profile?.emergency_phone}
            field="emergency_phone"
            addName="Emergency contact phone"
            onAdd={addEmergency}
          />
        </Group>
      </div>

      <Group title="Licences and tickets" link="Manage" onLink={() => onGo("licences")} plain>
        {/* A LIST, NOT A ROW OF TILES. Two tiles in a 1000px row look
            unfinished at any quality, because there are two; a ruled list
            reads as a record at one row and still reads at twelve, which is
            what a tradesperson's ticket wall actually holds. */}
        {licences.length > 0 && (
          <div className="psum-tix">
            {licences.map((l) => {
              const status = licenceStatus(l.expiryDate, today, warnDays);
              /* a ticket in date shows WHEN it lapses, quietly; one inside the
                 window or past it shows the same clause the dashboard's chip
                 raises, in the chip's colour — one rule, lib/staff/licence */
              const foot =
                status.tone === "ok"
                  ? { label: `Expires ${formatAuDate(l.expiryDate)}`, tone: "mute" as StateTone }
                  : status;
              return (
                <button
                  key={l.id}
                  type="button"
                  className="psum-tix-r"
                  aria-label={`Open ${l.typeName}`}
                  onClick={() => onGo("licences")}
                >
                  <span className="t">{l.typeName}</span>
                  <span className="s">{l.licenceNumber || ""}</span>
                  <span className={`e ${foot.tone}`}>{foot.label}</span>
                </button>
              );
            })}
          </div>
        )}
        <div className={licences.length > 0 ? "psum-more" : undefined}>
          <button type="button" className="psum-addl" onClick={() => onGo("licences", true)}>
            Add a licence or ticket
          </button>
        </div>
      </Group>
    </div>
  );
}

/* THE STANDING LINE — the one thing the screen says out loud, at the reading
   size the scale keeps for exactly this (24/400, one per screen).

   The lead carries the rank in its colour; the evidence follows it, quiet
   unless the evidence itself is what wants attention. Nothing recorded, and
   there is no clearance to state: the line says the gap, and the ink action
   under it is the way to fill it. */
function Standing({ line }: { line: ReturnType<typeof workRightsLine> }) {
  return (
    <p className="psum-stand">
      <b className={line.leadTone}>{line.lead}</b>
      {line.rest ? (
        <>
          {" — "}
          <span className={line.restTone}>{line.rest}</span>
        </>
      ) : null}
    </p>
  );
}

/* THE RECORD LINE — how much of the card is on file, and the one action.

   The action is the page's only filled object, and it is ink: with no accent,
   ink does the primary action. It opens the FIRST required gap in
   PROFILE_FIELDS order, on its own tab, in its form, with the cursor in the
   field — so the button does what it says. The word "Required" no longer
   appears beside the blanks themselves; this line is where absence is
   counted, and counting it twice is what made the screen shout. */
function Record({
  c,
  onGo,
}: {
  c: Completeness;
  onGo: (key: SectionKey, withEdit?: boolean, field?: keyof StaffProfile) => void;
}) {
  const cleared = c.requiredMissing === 0;
  /* `missing` keeps PROFILE_FIELDS' order, so the first required entry is the
     one payroll or the law is blocked on soonest. `summary` holds one field
     (the photo) and it is not required, so a required gap always names a tab
     with a form behind it. */
  const first = c.missing.find((f) => f.required);
  return (
    <div className="psum-rec">
      {first && (
        <button
          type="button"
          className="pbtn primary"
          onClick={() => onGo(first.section as SectionKey, true, first.key)}
        >
          {c.requiredMissing === 1
            ? `Add ${first.label.toLowerCase()}`
            : `Add the ${c.requiredMissing} missing details`}
        </button>
      )}
      <span className={cleared && c.complete ? "psum-count ok" : "psum-count"}>
        {c.filled} of {c.total} on file
      </span>
      <span className="pprog" aria-hidden="true">
        <i className={cleared ? "ok" : "warn"} style={{ width: `${c.percent}%` }} />
      </span>
    </div>
  );
}

/** A group: a hairline top, its title in ink, the way into its tab, and
    either a ledger of facts or, `plain`, whatever it holds. */
function Group({
  title,
  link,
  onLink,
  plain = false,
  children,
}: {
  title: string;
  link: string;
  onLink: () => void;
  plain?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="psum-g" aria-label={title}>
      <div className="psum-gh">
        <h2 className="psum-h">{title}</h2>
        <button type="button" className="psum-lnk" onClick={onLink}>
          {link}
          <span className="sr-only"> {title}</span>
        </button>
      </div>
      {plain ? children : <dl className="psum-rows">{children}</dl>}
    </section>
  );
}

/** A fact: the label in its column, the answer beside it. A blank is an Add
    when `field` names something the completeness model counts, and a dash
    otherwise. The Required word lives on the record line, not here. */
function Row({
  label,
  value,
  sub,
  field,
  addName,
  onAdd,
}: {
  label: string;
  value?: ReactNode;
  sub?: ReactNode;
  /** the StaffProfile column, when the business is short of it */
  field?: keyof StaffProfile;
  /** the Add's accessible name, where the row's label alone is ambiguous */
  addName?: string;
  /** opens the section's form on this row's column */
  onAdd?: (field: keyof StaffProfile) => void;
}) {
  const spec = field ? PROFILE_FIELDS.find((f) => f.key === field) : undefined;
  const empty = value === null || value === undefined || value === "";
  return (
    <div className="psum-row">
      <dt>{label}</dt>
      <dd>
        {!empty ? (
          <span className="psum-v">{value}</span>
        ) : spec && onAdd && field ? (
          <button type="button" className="psum-addl" onClick={() => onAdd(field)}>
            Add
            <i className="sr-only"> {addName ?? label}</i>
          </button>
        ) : (
          <span className="psum-none" aria-label="not recorded">
            —
          </span>
        )}
        {sub ? <span className="psum-sub">{sub}</span> : null}
      </dd>
    </div>
  );
}
