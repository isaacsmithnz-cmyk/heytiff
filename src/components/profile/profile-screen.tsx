"use client";

import { useState } from "react";
import { flushSync } from "react-dom";
import Link from "next/link";
import type { StaffProfile } from "@/lib/staff/profile";
import type { StaffLicence } from "@/lib/staff/types";
import type { MyPay } from "@/lib/staff/my-pay";
import { profileCompleteness, type CompletenessSection } from "@/lib/staff/completeness";
import { CompletionStrip } from "./completion-strip";
import { ProfileTabs, type NavItem } from "./profile-tabs";
import { SummaryTab } from "./summary-tab";
import { PersonalCard } from "./personal-card";
import { EmergencyCard } from "./emergency-card";
import { ComplianceCard } from "./compliance-card";
import { QualificationsCard } from "./qualifications-card";
import { WorkRightsCard } from "./workrights-card";
import { TrainingCard } from "./training-card";
import { PayrollCard } from "./payroll-card";
import { PermissionsCard } from "./permissions-card";
import { NotesCard } from "./notes-card";
import { MyPayCard } from "./my-pay-card";
import {
  sectionFromParam,
  type AdminExtras,
  type AssignedVehicle,
  type ProfileActions,
  type ProfileHeader,
  type ProfileMode,
  type SectionKey,
} from "./types";

/* The staff card — the maintenance board's surface, holding a person.

   WHAT THIS SCREEN IS NOW. A breadcrumb with the completion strip at its end,
   one row of tabs, and ONE persistent white card. Summary leads and reads;
   every tab after it is a section you fill in. It borrows `.wb2-vtabs` /
   `.wb2-card` from the board rather than growing a second copy — including the
   view transition below, so switching tabs swaps the information while the
   surface stays put.

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

   THE IDENTITY IS INSIDE THE CARD, on Summary, not above the tabs — it was a
   page header carrying a person next to a card that opened with its own
   headline, which read as two headers stacked. See identity-block.

   `editing` is unchanged: it rides in the panel's key, so answering "fill in
   missing details" remounts the section and the card starts in edit mode from
   state rather than an effect. */

const NAV_ITEMS: NavItem[] = [
  { key: "summary", label: "Summary" },
  // "Personal" and "Emergency", not "Personal details" and "Emergency
  // contact": nine tabs at full length overflow one row on a 1440 laptop, and
  // each section's own head spells its name out. See shell.css.
  { key: "personal", label: "Personal" },
  { key: "emergency", label: "Emergency" },
  { key: "licences", label: "Compliance" },
  { key: "workrights", label: "Work rights" },
  { key: "training", label: "Training" },
  { key: "mypay", label: "My pay" },
  { key: "payroll", label: "Payroll", admin: true },
  { key: "permissions", label: "Permissions", admin: true },
  { key: "notes", label: "Notes", admin: true },
];

export function ProfileScreen({
  mode,
  header,
  profile,
  licences,
  vehicle,
  today,
  org,
  orgState = null,
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
  /** the org's home state. Summary resolves an unset holiday state against it
      rather than printing "Same as organisation" — an answer, not a sentence
      about a setting. */
  orgState?: string | null;
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
    const wanted = sectionFromParam(initialSec);
    return wanted && available.some((n) => n.key === wanted) ? wanted : "summary";
  });

  /* Bumped whenever the strip asks a section to open its form. It rides in the
     panel's key, so the section remounts and SectionCard can seed its draft
     from state — no effect, and asking twice for the SAME section still works
     because the nonce moved. 0 means "nobody asked". */
  const [editing, setEditing] = useState<{ section: SectionKey; nonce: number } | null>(null);

  /* The board's switch: the information swaps, the surface stays. `.wb2-card`
     carries `view-transition-name: wbcard`, so the box morphs while the
     outgoing panel drifts up and the incoming rises. No View Transitions
     support and the panel simply re-keys with the same vertical entrance. */
  const [fallbackSwap, setFallbackSwap] = useState(0);

  const go = (key: SectionKey, withEdit = false) => {
    const apply = () => {
      setActive(key);
      setEditing(withEdit ? { section: key, nonce: (editing?.nonce ?? 0) + 1 } : null);
    };

    const doc = document as Document & { startViewTransition?: (cb: () => void) => void };
    if (key !== active && typeof doc.startViewTransition === "function") {
      doc.startViewTransition(() => flushSync(apply));
    } else {
      apply();
      if (key !== active) setFallbackSwap((n) => n + 1);
    }

    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("sec", key);
      // replaceState, not router.push: this is which section you're looking
      // at, not a navigation — a push would re-run the server render and
      // re-mount the very cards this screen exists to keep still.
      window.history.replaceState(null, "", url.toString());
    }
    document.querySelector(".outlet")?.scrollTo({ top: 0 });
  };

  /* The strip only ever names a section that has a field in it. `summary` is
     among them now (the photo lives there), and it is always available — but
     route through `available` anyway so a future gate can't strand the button
     on a tab that isn't there. */
  const fix = (section: CompletenessSection) => {
    if (!available.some((n) => n.key === section)) return;
    // Summary has no form to open — the camera badge is the control, and it is
    // already on screen the moment you arrive.
    go(section, section !== "summary");
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

          <CompletionStrip completeness={completeness} onFix={fix} />
        </div>

        <div className="pcard2">
          <ProfileTabs
            items={available}
            active={active}
            attention={completeness.sectionCounts}
            onGo={go}
          />

          <div className="wb2-card">
            <div className="ppanel2">
              {/* keyed on the section so the panel's entrance animation replays
                  — and on the edit nonce, so "fill this in" remounts the
                  section into edit mode */}
              <section
                key={`${active}#${startEditing}#${fallbackSwap}`}
                id={`psec-${active}`}
                role="tabpanel"
                aria-labelledby={`pftab-${active}`}
                tabIndex={-1}
                className="psec2"
                data-sec={active}
              >
                {active === "summary" && (
                  <SummaryTab
                    header={header}
                    profile={profile}
                    licences={licences}
                    vehicle={vehicle}
                    today={today}
                    org={org}
                    orgState={orgState}
                    mode={mode}
                    actions={actions}
                    onGo={go}
                  />
                )}
                {active === "personal" && (
                  <PersonalCard
                    profile={profile}
                    mode={mode}
                    addressLookup={addressLookup}
                    today={today}
                    orgState={orgState}
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
