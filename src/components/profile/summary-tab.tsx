"use client";

import type { ReactNode } from "react";
import { formatAuDate } from "@/lib/au-dates";
import { PROFILE_FIELDS, type Completeness } from "@/lib/staff/completeness";
import { licenceStatus } from "@/lib/staff/licence";
import type { StaffProfile } from "@/lib/staff/profile";
import type { StaffLicence } from "@/lib/staff/types";
import { uniformSummary } from "@/lib/staff/uniform";
import { workRightsTile, type TileTone } from "@/lib/staff/work-rights-summary";
import { IdentityBlock } from "./identity-block";
import type {
  AssignedVehicle,
  ProfileActions,
  ProfileHeader,
  ProfileMode,
  SectionKey,
} from "./types";

/* Summary — the landing tab, and the checklist that fills itself in.

   Redrawn 2026-09-15 from the worker-profile handoff, to the laws in
   docs/design.md. The page answers one question — is this person's record
   complete, and are they cleared to work — and everything on it is shaped by
   that.

   THE IDENTITY ROW carries the person and, at its right, the completion line:
   how many details are on file, a warn word and bar while a required one is
   missing, the OK word and bar once the card is cleared. It used to be a strip
   in the breadcrumb row; the tabs' counts carry the gaps to the other tabs.

   THREE GROUPS follow, each a hairline top, a quiet label, and a three-column
   grid of facts. A blank the business is short of is an ADD — the same door
   the section's own form opens through — and reads Required where payroll or
   the law needs it. A blank nobody is short of (a relationship, a uniform
   size) is a dash. The two are told apart by lib/staff/completeness, the one
   model the tabs' counts read, so the Adds on this page and the counts on the
   tabs can never disagree.

   THE TICKETS AND THE RIGHT TO WORK ARE ONE ROW OF TILES, the right to work
   first: it is the ticket the others are worthless without. Every tile is a
   door to the tab that manages it, and the state on each is a word in its
   colour — the only colour on the page besides the completion line.

   IF THE IDENTITY ROW SAYS IT, A GROUP DOESN'T: name, role, status, start and
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
  /** open a tab; `true` opens it straight into its form */
  onGo: (key: SectionKey, withEdit?: boolean) => void;
}) {
  const addPersonal = () => onGo("personal", true);
  const addEmergency = () => onGo("emergency", true);
  const rights = workRightsTile(profile, today, warnDays);

  return (
    <div className="psum">
      <IdentityBlock
        header={header}
        vehicle={vehicle}
        actions={actions}
        completeness={completeness}
        onAddStart={addPersonal}
      />

      <Group title="Personal" link="Edit" onLink={addPersonal}>
        <Cell label="Date of birth" value={formatAuDate(profile?.birthday)} field="birthday" onAdd={addPersonal} />
        <Cell label="Mobile" value={profile?.phone} field="phone" onAdd={addPersonal} />
        {/* the sign-in address on your own card, the contact address on a
            colleague's — either way not a column this card writes, so never
            an Add */}
        <Cell label="Email" value={header.email} />
        <Cell label="Address" value={profile?.address} field="address" onAdd={addPersonal} />
        <Cell label="Employment" value={profile?.employment_type} field="employment_type" onAdd={addPersonal} />
        {/* ONE cell, not four: "Shirt L, Trousers 92, Boots 10" is the whole
            answer a uniform order needs. The sizes are set on Personal. */}
        <Cell label="Uniform" value={uniformSummary(profile)} />
        {/* RESOLVED, not described. "Same as organisation" is a sentence
            about a setting; the org's own state is the answer to "which
            public holidays is this person paid for", and the line under it
            says where it came from. */}
        {mode === "admin" && (
          <Cell
            label="Holiday state"
            value={profile?.state || orgState}
            sub={profile?.state ? undefined : orgState ? "Organisation default" : undefined}
          />
        )}
      </Group>

      <Group title="Emergency contact" link="Edit" onLink={addEmergency}>
        <Cell
          label="Name"
          value={profile?.emergency_name}
          field="emergency_name"
          addName="Emergency contact name"
          onAdd={addEmergency}
        />
        <Cell label="Relationship" value={profile?.emergency_relationship} />
        <Cell
          label="Phone"
          value={profile?.emergency_phone}
          field="emergency_phone"
          addName="Emergency contact phone"
          onAdd={addEmergency}
        />
      </Group>

      <Group
        title="Licences, tickets and work rights"
        link="Manage"
        onLink={() => onGo("licences")}
        plain
      >
        <div className="psum-tiles">
          {/* The right to work, first. Unset, the tile is the way into the
              form and wears the warn tint — a required blank, not decoration;
              set, it reads the status and opens the tab. */}
          <Tile
            title={rights.title}
            sub={rights.sub}
            foot={rights.foot}
            required={rights.unset}
            open={rights.unset ? "Add work rights" : "Open Work rights"}
            onOpen={() => onGo("workrights", rights.unset)}
          />
          {licences.map((l) => {
            const status = licenceStatus(l.expiryDate, today, warnDays);
            return (
              <Tile
                key={l.id}
                title={l.typeName}
                sub={l.licenceNumber || null}
                /* a ticket in date shows WHEN it lapses, quietly; one inside
                   the window or past it shows the same clause the dashboard's
                   chip raises, in the chip's colour — one rule, lib/staff/licence */
                foot={
                  status.tone === "ok"
                    ? { label: `Expires ${formatAuDate(l.expiryDate)}`, tone: "mute" }
                    : status
                }
                open={`Open ${l.typeName}`}
                onOpen={() => onGo("licences")}
              />
            );
          })}
        </div>
        {/* the row is never empty — the right to work is always in it — so
            the empty state is the one action, under the tile */}
        {licences.length === 0 && (
          <div className="psum-more">
            <button type="button" className="psum-addl" onClick={() => onGo("licences", true)}>
              Add a licence or ticket
            </button>
          </div>
        )}
      </Group>
    </div>
  );
}

/** A group: a hairline top, a quiet label, the way into its tab, and either a
    three-column grid of facts or, `plain`, whatever it holds. */
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
      {plain ? children : <dl className="psum-grid">{children}</dl>}
    </section>
  );
}

/** A fact: label over value. A blank is an Add when `field` names something
    the completeness model counts (with Required beside it when the model says
    so), and a dash otherwise. */
function Cell({
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
  /** the Add's accessible name, where the cell's label alone is ambiguous */
  addName?: string;
  onAdd?: () => void;
}) {
  const spec = field ? PROFILE_FIELDS.find((f) => f.key === field) : undefined;
  const empty = value === null || value === undefined || value === "";
  return (
    <div className="psum-c">
      <dt>{label}</dt>
      <dd>
        {!empty ? (
          <span className="psum-v">{value}</span>
        ) : spec && onAdd ? (
          <span className="psum-add">
            <button type="button" className="psum-addl" onClick={onAdd}>
              Add
              <i className="sr-only"> {addName ?? label}</i>
            </button>
            {spec.required && <span className="psum-req">Required</span>}
          </span>
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

/** A tile in the row of tickets: a door, three lines, the last one the state
    in its colour. */
function Tile({
  title,
  sub,
  foot,
  required = false,
  open,
  onOpen,
}: {
  title: string;
  sub: string | null;
  foot: { label: string; tone: TileTone };
  /** a required blank: the warn tint, and the Required word for its foot */
  required?: boolean;
  /** what the door is for, for a screen reader */
  open: string;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      className={`psum-tile${required ? " req" : ""}`}
      aria-label={open}
      onClick={onOpen}
    >
      <span className="t">{title}</span>
      {sub ? <span className="s">{sub}</span> : null}
      <span className={`f ${foot.tone}`}>{foot.label}</span>
    </button>
  );
}
