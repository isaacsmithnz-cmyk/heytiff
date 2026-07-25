"use client";

import { useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/shell/icon";
import type { StaffProfile } from "@/lib/staff/profile";
import type { StaffLicence } from "@/lib/staff/types";
import type { MyPay } from "@/lib/staff/my-pay";
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
   nav entry and no section. That mirrors the server allowlists exactly. */

const NAV_ITEMS: { key: SectionKey; label: string; icon: string; admin?: boolean }[] = [
  { key: "personal", label: "Personal details", icon: "user" },
  { key: "emergency", label: "Emergency contact", icon: "phone" },
  { key: "licences", label: "Compliance", icon: "shield" },
  { key: "workrights", label: "Work rights", icon: "passport" },
  { key: "vehicle", label: "Assigned vehicle", icon: "truck" },
  { key: "training", label: "Training", icon: "grad" },
  { key: "mypay", label: "My pay", icon: "dollar" },
  { key: "payroll", label: "Payroll", icon: "dollar", admin: true },
  { key: "permissions", label: "Permissions", icon: "usershield", admin: true },
  { key: "notes", label: "Notes & flags", icon: "note", admin: true },
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

  const go = (key: SectionKey) => {
    setActive(key);
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

  const admins = available.filter((n) => n.admin);
  const mains = available.filter((n) => !n.admin);

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

        <Hero header={header} />

        <div className="pgrid">
          <nav className="pnav">
            {mains.map((n) => (
              <NavButton key={n.key} item={n} active={active} onGo={go} />
            ))}
            {admins.length > 0 && (
              <>
                <div className="ndiv" />
                <div className="ngl">Admin only</div>
                {admins.map((n) => (
                  <NavButton key={n.key} item={n} active={active} onGo={go} />
                ))}
              </>
            )}
          </nav>

          <div className="ppanel">
            {/* keyed on the section so the panel's entrance animation replays */}
            <section key={active} className="psec on" data-sec={active}>
              {active === "personal" && (
                <PersonalCard
                  profile={profile}
                  mode={mode}
                  org={org}
                  initials={header.initials}
                  addressLookup={addressLookup}
                  today={today}
                  onSave={actions.onSave}
                />
              )}
              {active === "emergency" && (
                <EmergencyCard profile={profile} mode={mode} org={org} onSave={actions.onSave} />
              )}
              {active === "licences" && (
                <>
                  <ComplianceCard
                    licences={licences}
                    today={today}
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
                  org={org}
                  today={today}
                  onSave={actions.onSave}
                />
              )}
              {active === "vehicle" && <VehicleCard assigned={vehicle} />}
              {active === "training" && <TrainingCard />}
              {active === "mypay" && myPay && <MyPayCard pay={myPay} />}
              {active === "payroll" && showPayroll && (
                <PayrollCard pay={extras.payroll ?? null} onSave={actions.onSave} />
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
  );
}

function NavButton({
  item,
  active,
  onGo,
}: {
  item: { key: SectionKey; label: string; icon: string; admin?: boolean };
  active: SectionKey;
  onGo: (k: SectionKey) => void;
}) {
  const on = item.key === active;
  return (
    <button
      type="button"
      className={`pn${item.admin ? " adminrow" : ""}${on ? " on" : ""}`}
      data-psec={item.key}
      aria-current={on ? "true" : undefined}
      onClick={() => onGo(item.key)}
    >
      <span className="pi">
        <Icon name={item.icon} size={17} />
      </span>
      {item.label}
      {item.admin && (
        <span className="lock">
          <Icon name="lock" size={15} />
        </span>
      )}
    </button>
  );
}

function Hero({ header }: { header: ProfileHeader }) {
  return (
    <div className="phead">
      <div className="mesh">
        <i className="m1" />
        <i className="m2" />
      </div>
      <div className="inner">
        <div className="pphoto">
          <div className="inn">{header.initials}</div>
        </div>
        <div className="pid">
          <h1>
            {header.name}
            {header.nickname ? <em>“{header.nickname}”</em> : null}
          </h1>
          <div className="sub">
            <span>
              <Icon name="truck" size={14} />
              {header.role}
            </span>
            <span className="dot" />
            <span>{header.employmentType}</span>
            <span className="dot" />
            <span>Started {header.started}</span>
          </div>
        </div>
        <div className="pquick">
          <div className="q">
            <b>{header.licenceCount}</b>
            <em>Licences</em>
          </div>
          <div className="q">
            <b>{header.years}</b>
            <em>Years</em>
          </div>
        </div>
        <span className="badge active" style={{ alignSelf: "flex-start" }}>
          <span className="d" />
          {header.status}
        </span>
      </div>
    </div>
  );
}
