"use client";

import { useState } from "react";
import Link from "next/link";
import type { StaffProfile } from "@/lib/staff/profile";
import type { StaffLicence } from "@/lib/staff/types";
import type { MyPay } from "@/lib/staff/my-pay";
import { profileCompleteness, type CompletenessSection } from "@/lib/staff/completeness";
import { CompletenessBanner } from "./completeness-banner";
import { ProfileRail } from "./profile-rail";
import { ProfileTabs, type NavItem } from "./profile-tabs";
import { PersonalCard } from "./personal-card";
import { EmergencyCard } from "./emergency-card";
import { ComplianceCard } from "./compliance-card";
import { QualificationsCard } from "./qualifications-card";
import { WorkRightsCard } from "./workrights-card";
import { VehicleCard } from "./vehicle-card";
import { TrainingCard } from "./training-card";
import { PayrollCard } from "./payroll-card";
import { PermissionsCard } from "./permissions-card";
import { NotesCard } from "./notes-card";
import { MyPayCard } from "./my-pay-card";
import {
  isSectionKey,
  type AdminExtras,
  type AssignedVehicle,
  type ProfileActions,
  type ProfileHeader,
  type ProfileMode,
  type SectionKey,
} from "./types";

/* The staff card — one client component over real props, replacing an HTML
   string plus a delegated-event script.

   WHAT MOVED, AND WHY IT MATTERS

   The active section used to live only in DOM classes, written by a click
   handler. The server markup always marked Personal active and every card
   locked, so the moment a save revalidated the page — which every save does —
   React swapped in a fresh subtree and the screen jumped back to Personal with
   every card re-locked. Here the active section is state ABOVE the data, so
   new props change values and nothing else. `?sec=` is written back with
   history.replaceState (not a router push) so a refresh or a shared link lands
   on the same card without a navigation, and the server reads it from its own
   searchParams — no useSearchParams, so no Suspense boundary around the page.

   The section list is data, and admin-only sections are OMITTED, never
   rendered-then-hidden: adminExtras keys that the page didn't pass produce no
   nav entry and no section. That mirrors the server allowlists exactly.

   THE LAYOUT (redesign). One card holds the lot: a dark rail on the left
   carrying the derived identity — photo, name, role, status, tenure, licence
   count, assigned vehicle — and, to its right, the section tabs over the
   panel. What the rail shows, no card repeats: the plastic staff card that
   used to head Personal was a second copy of it, so Personal now opens
   straight onto the fields.

   Above the panel sits what is still missing, from lib/staff/completeness —
   the same model that puts an amber dot on a tab. Answering it moves you to
   the owning section AND opens that card's form, which is what `editing`
   below is for: it rides in the panel's key, so the section remounts and the
   card starts in edit mode from state rather than an effect. */

const NAV_ITEMS: NavItem[] = [
  { key: "personal", label: "Personal details" },
  { key: "emergency", label: "Emergency contact" },
  { key: "licences", label: "Compliance" },
  { key: "workrights", label: "Work rights" },
  { key: "vehicle", label: "Assigned vehicle" },
  { key: "training", label: "Training" },
  { key: "mypay", label: "My pay" },
  { key: "payroll", label: "Payroll", admin: true },
  { key: "permissions", label: "Permissions", admin: true },
  { key: "notes", label: "Notes & flags", admin: true },
];

export function ProfileScreen({
  mode,
  header,
  profile,
  licences,
  vehicle,
  today,
  org,
  adminExtras,
  myPay,
  initialSec,
  addressLookup = false,
  actions,
}: {
  mode: ProfileMode;
  header: ProfileHeader;
  profile: StaffProfile | null;
  licences: StaffLicence[];
  vehicle: AssignedVehicle | null;
  /** AU calendar date, so licence status agrees with the dashboard */
  today: string;
  /** the org's trading name — the issuer line on every plastic card */
  org: string | null;
  /** admin mode only; a key that is absent is not rendered at all */
  adminExtras?: AdminExtras;
  /** self mode only — never read through a financials-gated path */
  myPay?: MyPay | null;
  /** from the page's own searchParams, so deep links open the right card */
  initialSec?: string;
  /** Boolean(GOOGLE_MAPS_API_KEY), computed on the server. Threaded rather
      than read here because the KEY ITSELF must never reach a client bundle —
      only the yes/no does. */
  addressLookup?: boolean;
  actions: ProfileActions;
}) {
  const extras = mode === "admin" ? (adminExtras ?? {}) : {};
  const showPayroll = mode === "admin" && extras.payroll !== undefined;
  const showPermissions = mode === "admin" && !!extras.permissions;
  const showNotes = mode === "admin" && extras.notes !== undefined;
  const showMyPay = mode === "self" && !!myPay;

  const available = NAV_ITEMS.filter((n) => {
    if (n.key === "payroll") return showPayroll;
    if (n.key === "permissions") return showPermissions;
    if (n.key === "notes") return showNotes;
    if (n.key === "mypay") return showMyPay;
    return true;
  });

  const [active, setActive] = useState<SectionKey>(() => {
    const wanted = isSectionKey(initialSec) ? initialSec : null;
    return wanted && available.some((n) => n.key === wanted) ? wanted : "personal";
  });

  /* Bumped whenever the checklist asks a card to open its form. It rides in
     the panel's key, so the section remounts and SectionCard can seed its
     draft from state — no effect, and asking twice for the SAME section still
     works because the nonce moved. 0 means "nobody asked". */
  const [editing, setEditing] = useState<{ section: SectionKey; nonce: number } | null>(null);

  const go = (key: SectionKey, withEdit = false) => {
    setActive(key);
    setEditing(withEdit ? { section: key, nonce: (editing?.nonce ?? 0) + 1 } : null);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("sec", key);
      // replaceState, not router.push: this is which card you're looking at,
      // not a navigation — a push would re-run the server render and re-mount
      // the very cards this screen exists to keep still.
      window.history.replaceState(null, "", url.toString());
    }
    document.querySelector(".outlet")?.scrollTo({ top: 0 });
  };

  /* The checklist only ever names a section that has a field in it, and those
     three are always available — but route through `available` anyway so a
     future gate can't strand the button on a tab that isn't there. */
  const fix = (section: CompletenessSection) => {
    if (available.some((n) => n.key === section)) go(section, true);
  };

  const completeness = profileCompleteness(profile);
  // asked for THIS section, and only until you move off it
  const startEditing = editing?.section === active ? editing.nonce : 0;

  return (
    <div className="page in">
      <div className="prof">
        <div className="pbar">
          <div className="crumb">
            {mode === "self" ? (
              <b>My profile</b>
            ) : (
              <>
                <Link href="/dashboard/team">Team</Link>
                <span className="sep">/</span>
                <Link href="/dashboard/team">Staff</Link>
                <span className="sep">/</span>
                <b>{header.name}</b>
              </>
            )}
          </div>
        </div>

        <div className="pcard">
          <ProfileRail header={header} org={org} vehicle={vehicle} />

          <div className="pmain">
            <ProfileTabs
              items={available}
              active={active}
              attention={completeness.sectionsMissing}
              onGo={go}
            />

            <CompletenessBanner completeness={completeness} onFix={fix} />

            <div className="ppanel">
              {/* keyed on the section so the panel's entrance animation replays
                  — and on the edit nonce, so "fill this in" remounts the card
                  into edit mode */}
              <section
                key={`${active}#${startEditing}`}
                id={`psec-${active}`}
                role="tabpanel"
                aria-labelledby={`pftab-${active}`}
                tabIndex={-1}
                className="psec on"
                data-sec={active}
              >
                {active === "personal" && (
                  <PersonalCard
                    profile={profile}
                    mode={mode}
                    addressLookup={addressLookup}
                    today={today}
                    email={header.email}
                    startEditing={startEditing > 0}
                    onSave={actions.onSave}
                  />
                )}
                {active === "emergency" && (
                  <EmergencyCard
                    profile={profile}
                    mode={mode}
                    org={org}
                    startEditing={startEditing > 0}
                    onSave={actions.onSave}
                  />
                )}
                {active === "licences" && (
                  <>
                    <ComplianceCard
                      licences={licences}
                      today={today}
                      org={org}
                      onAdd={actions.onAddLicence}
                      onRemove={actions.onRemoveLicence}
                    />
                    <QualificationsCard profile={profile} mode={mode} onSave={actions.onSave} />
                  </>
                )}
                {active === "workrights" && (
                  <WorkRightsCard
                    profile={profile}
                    mode={mode}
                    today={today}
                    startEditing={startEditing > 0}
                    onSave={actions.onSave}
                  />
                )}
                {active === "vehicle" && <VehicleCard assigned={vehicle} />}
                {active === "training" && <TrainingCard />}
                {active === "mypay" && myPay && <MyPayCard pay={myPay} />}
                {active === "payroll" && showPayroll && (
                  <PayrollCard
                    pay={extras.payroll ?? null}
                    rosteredWeek={extras.rosteredWeek ?? null}
                    onSave={actions.onSave}
                  />
                )}
                {active === "permissions" && extras.permissions && (
                  <PermissionsCard ctx={extras.permissions} onSave={actions.onSave} />
                )}
                {active === "notes" && showNotes && (
                  <NotesCard notes={extras.notes ?? null} onSave={actions.onSave} />
                )}
              </section>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
