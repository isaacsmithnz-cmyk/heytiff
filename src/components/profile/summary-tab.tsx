"use client";

import { Icon } from "@/components/shell/icon";
import { LicenceCard } from "@/components/cards/licence-card";
import { licenceStatus } from "@/lib/staff/licence";
import { formatAuDate } from "@/lib/au-dates";
import type { StaffProfile } from "@/lib/staff/profile";
import { uniformSummary } from "@/lib/staff/uniform";
import type { StaffLicence } from "@/lib/staff/types";
import { IdentityBlock } from "./identity-block";
import { DetailPanel, DetailPanels } from "./detail";
import type {
  AssignedVehicle,
  ProfileActions,
  ProfileHeader,
  ProfileMode,
  SectionKey,
} from "./types";

/* Summary — the landing tab, and the only one that reads rather than edits.

   TWO RULES BUILT IT, and everything else follows from them.

   ONE PANEL PER TAB, in tab order, named the same. The panel headings ARE the
   tab names, so the overview and the strip above it can never describe the
   card differently, and "Open ›" on each panel is the same navigation the tab
   is — you can drive the whole card from here without reading the strip.

   IF THE IDENTITY BLOCK SAYS IT, A PANEL DOESN'T. Name, preferred name, role,
   status, start date, tenure and the assigned vehicle are all up there, so
   none of them appear below — which is what took Summary from a screen and a
   half down to one screen. The rule has teeth: it is why Personal opens on
   Date of birth rather than on First name.

   AND IT READS AS A CARD, not as a form you can't type in. The panels are
   tight — small caps labels, one line each, no 46px of air per fact — because
   Summary's job is to be glanced at. The assigned vehicle used to have four
   rows of its own down here; it is a plate in the strip above now, and the
   plate is a link into Fleet, which owns everything the four rows copied.

   Blanks are DASHES, not "Not set". Nothing here is editable, so a blank has
   no button behind it and nothing to say beyond "nothing" — and eight "Not
   set"s down one column read as an error state rather than as a card someone
   hasn't finished. */
export function SummaryTab({
  header,
  profile,
  licences,
  vehicle,
  today,
  orgState,
  mode,
  actions,
  onGo,
}: {
  header: ProfileHeader;
  profile: StaffProfile | null;
  licences: StaffLicence[];
  vehicle: AssignedVehicle | null;
  today: string;
  /** the org's home state, so an unset holiday state can be RESOLVED rather
      than described. See the Holiday state row. */
  orgState: string | null;
  mode: ProfileMode;
  actions: Pick<ProfileActions, "onSetPhoto" | "onClearPhoto">;
  onGo: (key: SectionKey) => void;
}) {
  return (
    <>
      <IdentityBlock header={header} vehicle={vehicle} actions={actions} />

      <DetailPanels tight>
        <DetailPanel title="Personal" wide split onOpen={() => onGo("personal")}>
          <Row label="Date of birth" value={formatAuDate(profile?.birthday)} />
          <Row label="Email" value={header.email} small />
          <Row label="Mobile" value={profile?.phone} />
          <Row label="Address" value={profile?.address} small />
          <Row label="Employment" value={profile?.employment_type} />
          {/* ONE row, not four: "Shirt L · Trousers 92 · Boots 10" is the whole
              answer a uniform order needs, and four rows of sizes would push
              the panel past everything above it that gets read more often. The
              sizes themselves are set on Personal, where "Open ›" already
              goes. */}
          <Row label="Uniform" value={uniformSummary(profile)} small />
          {/* RESOLVED, not described. This row used to read "Same as
              organisation", which is a sentence about a setting rather than an
              answer to "which public holidays does this person get paid for".
              The org's own state is the answer; the qualifier below only says
              where it came from, so an inherited value and an overridden one
              can be told apart at a glance. */}
          {mode === "admin" && (
            <Row
              label="Holiday state"
              value={profile?.state || orgState}
              sub={profile?.state ? undefined : orgState ? "Organisation default" : undefined}
            />
          )}
        </DetailPanel>

        <DetailPanel title="Emergency" onOpen={() => onGo("emergency")}>
          <Row label="Name" value={profile?.emergency_name} />
          <Row label="Relationship" value={profile?.emergency_relationship} />
          <Row label="Phone" value={profile?.emergency_phone} />
        </DetailPanel>

        <DetailPanel title="Work rights" onOpen={() => onGo("workrights")}>
          <Row label="Right to work" value={profile?.work_rights_status} />
          <Row label="Visa" value={profile?.visa_type} />
          <Row label="Expiry" value={formatAuDate(profile?.visa_expiry)} />
        </DetailPanel>

        {/* The licences are CARDS, not rows — they are things you carry in a
            wallet, and the same CR80 object the Compliance tab issues them as.
            Across the bottom at full width because three of them side by side
            is the fastest read of "what is this person ticketed for" on the
            screen, and the expiry does the talking. */}
        <DetailPanel title="Licences & tickets" wide plain onOpen={() => onGo("licences")}>
          {licences.length === 0 ? (
            <div className="ro-empty">
              <span className="ei">
                <Icon name="shield" size={20} />
              </span>
              <b>No licences on file</b>
              <em>Driver licences, ARC tickets and white cards are added in Compliance.</em>
            </div>
          ) : (
            <div className="liccards">
              {licences.map((l) => (
                <LicenceCard
                  key={l.id}
                  typeName={l.typeName}
                  licenceNumber={l.licenceNumber}
                  // formatAuDate returns an em dash for a null, and the card
                  // wants an explicit null for "no expiry" — its status pill
                  // reads "No expiry" rather than showing a dash twice
                  expiry={l.expiryDate ? formatAuDate(l.expiryDate) : null}
                  status={licenceStatus(l.expiryDate, today)}
                />
              ))}
            </div>
          )}
        </DetailPanel>
      </DetailPanels>
    </>
  );
}

/** A Summary row: a value, or the dash that means we don't hold one. */
function Row({
  label,
  value,
  small,
  sub,
}: {
  label: string;
  value?: React.ReactNode;
  small?: boolean;
  sub?: React.ReactNode;
}) {
  const empty = value === null || value === undefined || value === "";
  return (
    <div className="pdrow">
      <dt>{label}</dt>
      <dd>
        {empty ? (
          <span className="pdnone" aria-label="not recorded">
            —
          </span>
        ) : (
          <span className={small ? "pdv sm" : "pdv"}>{value}</span>
        )}
        {sub ? <span className="pdsub">{sub}</span> : null}
      </dd>
    </div>
  );
}
