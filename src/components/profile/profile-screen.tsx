"use client";

import { useState } from "react";
import { flushSync } from "react-dom";
import Link from "next/link";
import type { StaffProfile } from "@/lib/staff/profile";
import type { StaffLicence } from "@/lib/staff/types";
import type { MyPay } from "@/lib/staff/my-pay";
import { profileCompleteness } from "@/lib/staff/completeness";
import { Overview } from "./overview";
import { SectionDone } from "./section-card";
import { PersonalCard } from "./personal-card";
import { EmergencyCard } from "./emergency-card";
import { ComplianceCard } from "./compliance-card";
import { SignatureCard } from "./signature-card";
import { QualificationsCard } from "./qualifications-card";
import { WorkRightsCard } from "./workrights-card";
import { PayrollCard } from "./payroll-card";
import { PermissionsCard } from "./permissions-card";
import { NotesCard } from "./notes-card";
import { MyPayCard } from "./my-pay-card";
import type { StaffLicenceRecord } from "@/lib/staff/licence-records";
import type { WorkRightsRecord } from "@/lib/staff/work-rights-records";
import { WorkRightsModal } from "./work-rights-modal";
import type { StoredDocument } from "@/lib/documents/query";
import {
  sectionFromParam,
  type AdminExtras,
  type AssignedVehicle,
  type ProfileActions,
  type ProfileHeader,
  type ProfileMode,
  type SectionKey,
} from "./types";

/* The staff card: one page for the person, and a form behind each card.

   NO TABS SINCE 2026-09-29. The card opens on the Overview (overview.tsx):
   the whole person on one screen, with a section shown only once it has
   something in it and everything still empty gathered into Still to add.
   Each card's Edit opens its SECTION — the same forms the tabs used to hold —
   straight into edit mode, and saving or cancelling comes back (SectionDone).
   The breadcrumb grows a step while a section is open, and the person's name
   in it is the way back.

   THE ACTIVE VIEW IS STATE ABOVE THE DATA, and that is still the reason this
   screen survives a save: every save revalidates, so the server re-renders
   the whole thing, and anything kept in the DOM would snap back. `?sec=` is
   written with history.replaceState (not a router push) so a refresh or a
   shared link lands on the same view without a navigation.

   Admin-only sections are OMITTED, never rendered-then-hidden: adminExtras
   keys the page didn't pass produce no card and no section, mirroring the
   server allowlists exactly. */

/** What each section is called in the breadcrumb while it is open. */
const SECTION_NAMES: Record<Exclude<SectionKey, "summary">, string> = {
  personal: "Personal details",
  emergency: "Emergency contact",
  licences: "Licences and tickets",
  workrights: "Work rights",
  mypay: "My pay",
  payroll: "Payroll",
  permissions: "Permissions",
  notes: "Notes",
};

/* A section with ONE form closes back to the Overview when it is saved or
   cancelled. Licences are a wall you manage several things on, so they stay
   open until you leave. */
const CLOSES_ON_DONE: ReadonlySet<SectionKey> = new Set([
  "personal",
  "emergency",
  "workrights",
  "payroll",
  "permissions",
  "notes",
]);

export function ProfileScreen({
  mode,
  header,
  profile,
  licences,
  licenceTerms = {},
  licenceDocuments = {},
  workRightsChecks = [],
  workRightsDocuments = [],
  vehicle,
  today,
  warnDays,
  org,
  orgState = null,
  adminExtras,
  myPay,
  initialSec,
  addressLookup = false,
  aliases = [],
  actions,
}: {
  mode: ProfileMode;
  header: ProfileHeader;
  profile: StaffProfile | null;
  licences: StaffLicence[];
  /* The terms behind the tickets, their paperwork, and the VIEWER's own
     reminders — keyed by licence id, loaded once for the wall rather than per
     card. Defaulted so a caller that has none of it still renders. */
  licenceTerms?: Record<string, StaffLicenceRecord[]>;
  licenceDocuments?: Record<string, StoredDocument[]>;
  /* One person's right-to-work checks, their evidence, and the VIEWER's own
     reminders. Not keyed by anything — a person has exactly one right to work. */
  workRightsChecks?: WorkRightsRecord[];
  workRightsDocuments?: StoredDocument[];
  vehicle: AssignedVehicle | null;
  /** AU calendar date, so licence status agrees with the dashboard */
  today: string;
  /** The org's expiry window — lib/expiry.ts. Every status on this screen reads it. */
  warnDays: number;
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
  /** The nicknames the person goes by (staff_aliases), oldest first. */
  aliases?: string[];
  actions: ProfileActions;
}) {
  const extras = mode === "admin" ? (adminExtras ?? {}) : {};
  const showPayroll = mode === "admin" && extras.payroll !== undefined;
  const showPermissions = mode === "admin" && !!extras.permissions;
  const showNotes = mode === "admin" && extras.notes !== undefined;
  const showMyPay = mode === "self" && !!myPay;

  const allowed = (key: SectionKey) => {
    if (key === "payroll") return showPayroll;
    if (key === "permissions") return showPermissions;
    if (key === "notes") return showNotes;
    if (key === "mypay") return showMyPay;
    return true;
  };

  const [active, setActive] = useState<SectionKey>(() => {
    const wanted = sectionFromParam(initialSec);
    return wanted && allowed(wanted) ? wanted : "summary";
  });

  /* Bumped whenever a card asks a section to open its form. It rides in the
     panel's key, so the section remounts and SectionCard can seed its draft
     from state — no effect, and asking twice for the SAME section still works
     because the nonce moved. 0 means "nobody asked". */
  const [editing, setEditing] = useState<{ section: SectionKey; nonce: number; field?: string } | null>(null);

  /* The board's switch: the information swaps, the surface stays. `.wb2-card`
     carries `view-transition-name: wbcard`, so the box morphs while the
     outgoing panel drifts up and the incoming rises. No View Transitions
     support and the panel simply re-keys with the same vertical entrance. */
  const [fallbackSwap, setFallbackSwap] = useState(0);
  /* The checks modal. Its own state rather than a section, because right to
     work stays ONE tab — the checks are what is behind it, not a sibling. */
  const [checksOpen, setChecksOpen] = useState(false);

  /* `field` is the column an Add on the Overview pointed at; the section opens
     its form on that control. It rides in the same state as the ask, so it
     is cleared with it. */
  const go = (key: SectionKey, withEdit = false, field?: string) => {
    const apply = () => {
      setActive(key);
      setEditing(withEdit ? { section: key, nonce: (editing?.nonce ?? 0) + 1, field } : null);
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
      if (key === "summary") url.searchParams.delete("sec");
      window.history.replaceState(null, "", url.toString());
    }
    document.querySelector(".outlet")?.scrollTo({ top: 0 });
  };

  const completeness = profileCompleteness(profile);
  // asked for THIS section, and only until you move off it
  const startEditing = editing?.section === active ? editing.nonce : 0;
  const focusField = startEditing > 0 ? editing?.field : undefined;

  return (
    /* Paper to the frame, and the tabs are the band (2026-09-20). The way
       back keeps its own line above them: it belongs to Team, not to the
       card's sections. */
    <div className="page in full">
      <div className="wrap">
        <div className="stg pcard2">
          <div className="wb2-crumbline">
          <div className="crumb">
            {/* The trail grows a step while a section is open, and the step
                before it is the way back to the Overview. Team is a link;
                the person is a button, because going back to them is a change
                of view on this page, not a navigation. */}
            {mode === "admin" && (
              <>
                <Link href="/dashboard/team">Team</Link>
                <span className="sep">/</span>
              </>
            )}
            {active === "summary" ? (
              <b>{mode === "self" ? "My profile" : header.name}</b>
            ) : (
              <>
                <button type="button" className="crumb-back" onClick={() => go("summary")}>
                  {mode === "self" ? "My profile" : header.name}
                </button>
                <span className="sep">/</span>
                <b>{SECTION_NAMES[active]}</b>
              </>
            )}
          </div>
          </div>

          <div className="wb2-card">
            <div className="wb2-panel">
            <div className="ppanel2">
              {/* Keyed on the edit nonce, so "fill this in" remounts the
                  section into edit mode, and on `fallbackSwap` for the
                  recovery remount. NOT for an animation any more: `.psec2`
                  used to fade the panel in on every switch and no longer
                  does — this card matches Team's, which just changes its
                  children. The remount is invisible without it. */}
              <SectionDone.Provider value={CLOSES_ON_DONE.has(active) ? () => go("summary") : null}>
              <section
                key={`${active}#${startEditing}#${fallbackSwap}`}
                id={`psec-${active}`}
                aria-label={active === "summary" ? header.name : SECTION_NAMES[active]}
                tabIndex={-1}
                className="psec2"
                data-sec={active}
              >
                {active === "summary" && (
                  <Overview
                    header={header}
                    profile={profile}
                    licences={licences}
                    vehicle={vehicle}
                    today={today}
                    warnDays={warnDays}
                    orgState={orgState}
                    mode={mode}
                    actions={actions}
                    completeness={completeness}
                    extras={{
                      payroll: extras.payroll,
                      showPayroll,
                      permissions: extras.permissions,
                      notes: extras.notes?.notes ?? null,
                      showNotes,
                    }}
                    myPay={showMyPay ? myPay : null}
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
                    aliases={aliases}
                    onSaveAliases={actions.onSaveAliases}
                    /* SELF ONLY, and passing it is the gate. The action moves
                       whoever the SESSION is, so on an admin's view of a
                       colleague it would change the admin's own address while
                       showing the colleague's name. Personal renders the
                       control only when handed one. */
                    onChangeSignInEmail={
                      mode === "self" ? actions.onChangeSignInEmail : undefined
                    }
                    startEditing={startEditing > 0}
                    focusField={focusField}
                    onSave={actions.onSave}
                  />
                )}
                {active === "emergency" && (
                  <EmergencyCard
                    profile={profile}
                    mode={mode}
                    org={org}
                    startEditing={startEditing > 0}
                    focusField={focusField}
                    onSave={actions.onSave}
                  />
                )}
                {active === "licences" && (
                  <>
                    <ComplianceCard
                      licences={licences}
                      staffId={header.id}
                      records={licenceTerms}
                      documents={licenceDocuments}
                      today={today}
            warnDays={warnDays}
                      onAdd={actions.onAddLicence}
                      onUpdate={actions.onUpdateLicence}
                      onRemove={actions.onRemoveLicence}
                      onRecordTerm={actions.onRecordLicenceTerm}
                      onAttachDoc={actions.onAttachLicenceDoc}
                      onRemoveTerm={actions.onRemoveLicenceTerm}
                      startAdding={startEditing > 0}
                    />
                    <QualificationsCard profile={profile} mode={mode} onSave={actions.onSave} />
                    {/* yours only: a signature is the person's own mark */}
                    {mode === "self" && <SignatureCard />}
                  </>
                )}
                {active === "workrights" && (
                  <WorkRightsCard
                    checkCount={workRightsChecks.length}
                    lastChecked={workRightsChecks[0]?.checkedOn ?? null}
                    onOpenChecks={actions.onRecordWorkRightsCheck ? () => setChecksOpen(true) : undefined}
                    profile={profile}
                    mode={mode}
                    today={today}
            warnDays={warnDays}
                    startEditing={startEditing > 0}
                    focusField={focusField}
                    onSave={actions.onSave}
                  />
                )}
                {active === "mypay" && myPay && <MyPayCard pay={myPay} />}

                {active === "payroll" && showPayroll && (
                  <PayrollCard
                    pay={extras.payroll ?? null}
                    rosteredWeek={extras.rosteredWeek ?? null}
                    onSave={actions.onSave}
                    startEditing={startEditing > 0}
                  />
                )}
                {active === "permissions" && extras.permissions && (
                  <PermissionsCard ctx={extras.permissions} onSave={actions.onSave} startEditing={startEditing > 0} />
                )}
                {active === "notes" && showNotes && (
                  <NotesCard notes={extras.notes ?? null} onSave={actions.onSave} startEditing={startEditing > 0} />
                )}
              </section>
              </SectionDone.Provider>

                {checksOpen && actions.onRecordWorkRightsCheck && (
                  <WorkRightsModal
                    staffId={header.id}
                    subject={mode === "admin" ? header.name : null}
                    records={workRightsChecks}
                    documents={workRightsDocuments}
                    today={today}
            warnDays={warnDays}
                    onRecord={actions.onRecordWorkRightsCheck}
                    onAttach={actions.onAttachWorkRightsDoc ?? (async () => ({ ok: true as const }))}
                    onRemoveCheck={actions.onRemoveWorkRightsCheck ?? (async () => ({ ok: true as const }))}
                    onClose={() => setChecksOpen(false)}
                  />
                )}

            </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
