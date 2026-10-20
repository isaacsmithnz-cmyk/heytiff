"use client";

import { useContext, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/parts/button";
import { Chooser } from "@/components/parts/chooser";
import { ConfirmDialog } from "@/components/parts/dialog";
import { Field, TextInput } from "@/components/parts/field";
import { Fade } from "@/components/parts/fade";
import { Menu, type MenuItem } from "@/components/parts/menu";
import { Dot, StateWord } from "@/components/parts/state";
import { Switch } from "@/components/parts/tick";
import { TimeField } from "@/components/parts/time-field";
import { WindowsContext } from "@/components/records/records-context";
import { PhotoBadge } from "@/components/profile/photo-badge";
import { PersonalCard } from "@/components/profile/personal-card";
import { EmergencyCard } from "@/components/profile/emergency-card";
import { ComplianceCard } from "@/components/profile/compliance-card";
import { QualificationsCard } from "@/components/profile/qualifications-card";
import { WorkRightsCard } from "@/components/profile/workrights-card";
import { WorkRightsModal } from "@/components/profile/work-rights-modal";
import { SignatureCard } from "@/components/profile/signature-card";
import { PayrollCard } from "@/components/profile/payroll-card";
import { PermissionsCard } from "@/components/profile/permissions-card";
import { NotesCard } from "@/components/profile/notes-card";
import type { AssignedVehicle, PayFields, PermissionsCtx, ProfileActions, ProfileHeader } from "@/components/profile/types";
import { PersonForm } from "@/components/team/person-form";
import { RegularDaysOffForm } from "@/components/making/regular-days-off-form";
import { saveStaffSection } from "@/app/actions/staff";
import { deleteStaffCard } from "@/app/actions/members";
import { saveMyHours } from "@/app/actions/timepay";
import { setScheduleCapacity } from "@/app/actions/workboard";
import { setLeaveBalance } from "@/app/actions/leave";
import { staffHref, vehiclePageHref } from "@/lib/shell/links";
import { fmtAuWeekdayDateLong } from "@/lib/au-dates";
import { ruleWords, type RegularDayOff } from "@/lib/team/regular-days-off";
import { LEAVE_LABEL, type BalanceKind, type BalanceSource, type LeaveKind, type LeaveStatus } from "@/lib/timepay/leave";
import type { StaffLicence } from "@/lib/staff/types";
import type { StaffProfile } from "@/lib/staff/profile";
import type { StaffLicenceRecord } from "@/lib/staff/licence-records";
import type { WorkRightsRecord } from "@/lib/staff/work-rights-records";
import type { StoredDocument } from "@/lib/documents/query";

/* TEAM, A PERSON (v2, step 5; the board "Team, a person"). The head: their
   photo or initials, the name, one line (what they do, how long they've
   been with you) and their state, with Actions on the right. Then three
   columns of groups under thin lines, everything on one page, each group
   with its own Edit that opens its form in place: the staff card's own
   edit cycle (SectionCard: the draft is the mode, a save keeps you where you
   are, a refused save keeps what you typed and marks the field).

     Details, Emergency, Licences and tickets, Qualifications
     Normal week (with Counts toward the schedule and hours a day),
       Regular days off, Leave, Work rights, Signature (yours only)
     Vehicle, Pay, Access, Notes about them

   Actions (rule 53): Invite to join on a card nobody has claimed, Copy the
   link, Print, then what ends it: Deactivate (or Reactivate), and Delete for
   a card nothing on the records points at. Each that ends something asks. */

export type WeekFacts = {
  start: string;
  end: string;
  /** Mon 0 … Sun 6 */
  days: number[];
  perDay: number | null;
  breakMinutes: number;
  breakPaid: boolean;
  weekHours: number | null;
  /** their own hours, not the workspace's */
  ownHours: boolean;
  ownDays: boolean;
};

type BalanceCell = { available: number; balanceHours: number; asAt: string; source: BalanceSource } | null;

export type PersonLeave = {
  annual: BalanceCell;
  personal: BalanceCell;
  coming: { id: string; kind: LeaveKind; startDate: string; endDate: string; hours: number; status: LeaveStatus }[];
};

export type PersonPageData = {
  header: ProfileHeader & { userId: string | null; importedFrom: string | null; isMaster: boolean };
  profile: StaffProfile | null;
  licences: StaffLicence[];
  licenceTerms: Record<string, StaffLicenceRecord[]>;
  licenceDocuments: Record<string, StoredDocument[]>;
  workRightsChecks: WorkRightsRecord[];
  workRightsDocuments: StoredDocument[];
  vehicle: AssignedVehicle | null;
  today: string;
  warnDays: number;
  org: string | null;
  orgState: string | null;
  aliases: string[];
  addressLookup: boolean;
  isSelf: boolean;
  /** present only with `financials` */
  payroll: PayFields | null;
  rosteredWeek: number | null;
  permissions: PermissionsCtx;
  /** null on your own page: notes are written about someone */
  notes: { notes: string | null } | null;
  week: WeekFacts;
  /** the Schedule's crew row, read with `workboard`; null when not linked */
  crew: { staffUuid: string; included: boolean; dailyMinutes: number } | null;
  canManageCrew: boolean;
  linkedToSm8: boolean;
  /** the reader has `workboard`, so the crew row is theirs to read */
  showCrew: boolean;
  /** present only with `timepay_all` */
  leave: PersonLeave | null;
  /** `team`, setLeaveBalance's gate */
  canSetBalances: boolean;
  regularDaysOff: RegularDayOff[];
  deletable: boolean;
  inviteRoles: string[];
  initialSec?: string;
};

const DAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DAY_LONG = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

const hrs = (n: number) => (Math.round(n * 10) / 10).toString();
const clock = (t: string) => t.toLowerCase();
const firstOf = (name: string) => name.trim().split(/\s+/)[0] ?? name;

/** A group's head: its title, and its one door. */
function Head({ name, children, count }: { name: string; count?: number; children?: React.ReactNode }) {
  return (
    <div className="pdlh jump">
      <span>
        {name}
        {count != null && <span className="tm2-hcount"> {count}</span>}
      </span>
      {children && <span className="acts">{children}</span>}
    </div>
  );
}

function Door({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button className="jumpb" type="button" onClick={onClick}>
      {children}
    </button>
  );
}

/* ── Normal week ── */

function NormalWeek({
  week,
  isSelf,
  crew,
  canManageCrew,
  linked,
  showCrew,
  name,
}: {
  week: WeekFacts;
  isSelf: boolean;
  crew: PersonPageData["crew"];
  canManageCrew: boolean;
  linked: boolean;
  showCrew: boolean;
  name: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [start, setStart] = useState(week.start);
  const [end, setEnd] = useState(week.end);
  const [days, setDays] = useState<number[]>(week.days);
  const [busy, startSave] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [counted, setCounted] = useState(crew?.included ?? false);
  const [daily, setDaily] = useState(crew?.dailyMinutes ?? 480);

  const save = (s: string | null, e: string | null, d: number[] | null) => {
    setError(null);
    startSave(async () => {
      const res = await saveMyHours(s, e, d);
      if (!res.ok) return setError(res.error);
      setEditing(false);
      router.refresh();
    });
  };

  /* A switch saves itself (rule 32). Only this person's row is written; the
     action takes the crew editor's own shape and gate. */
  const saveCrew = (included: boolean, dailyMinutes: number) => {
    if (!crew) return;
    const was = { included: counted, dailyMinutes: daily };
    setCounted(included);
    setDaily(dailyMinutes);
    setError(null);
    startSave(async () => {
      const res = await setScheduleCapacity([{ staffUuid: crew.staffUuid, included, dailyMinutes }]);
      if (res.ok) return router.refresh();
      setCounted(was.included);
      setDaily(was.dailyMinutes);
      setError(res.error);
    });
  };

  const line = [
    `${clock(week.start)} to ${clock(week.end)}`,
    week.breakMinutes > 0 ? `${week.breakMinutes} minute ${week.breakPaid ? "paid" : "unpaid"} break` : null,
    week.weekHours != null ? `${hrs(week.weekHours)} hours` : null,
  ]
    .filter(Boolean)
    .join(", ");

  const dailyOptions = Array.from({ length: 24 }, (_, i) => (i + 1) * 30).map((m) => ({
    value: String(m),
    label: `${hrs(m / 60)} hours a day`,
  }));

  return (
    <section className="pdlcard psec-group tm2-week" aria-label="Normal week">
      <Head name="Normal week">{isSelf && !editing && <Door onClick={() => setEditing(true)}>Edit hours</Door>}</Head>
      {editing ? (
        <div className="tm2-weekform">
          <div className="tm2-weekclocks">
            <Field label="Start">
              <TimeField value={start} onChange={setStart} label="Start" disabled={busy} />
            </Field>
            <Field label="Finish">
              <TimeField value={end} onChange={setEnd} label="Finish" disabled={busy} />
            </Field>
          </div>
          <div className="tm2-dows" role="group" aria-label="Days I normally work">
            {DAY_SHORT.map((d, i) => (
              <button
                key={d}
                type="button"
                className="tm2-dow"
                aria-label={DAY_LONG[i]}
                aria-pressed={days.includes(i)}
                disabled={busy}
                onClick={() => setDays((cur) => (cur.includes(i) ? cur.filter((x) => x !== i) : [...cur, i].sort()))}
              >
                {d}
              </button>
            ))}
          </div>
          <div className="tm2-formacts">
            {(week.ownHours || week.ownDays) && (
              <Button kind="quiet" disabled={busy} onClick={() => save(null, null, null)}>
                Use the workspace&apos;s hours
              </Button>
            )}
            <Button kind="second" disabled={busy} onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button kind="main" disabled={busy} onClick={() => save(start, end, days)}>
              {busy ? "Saving the hours" : "Save hours"}
            </Button>
          </div>
        </div>
      ) : (
        <>
          <dl className="tm2-days">
            {DAY_SHORT.map((d, i) => (
              <div key={d} className="tm2-day">
                <dt>{d}</dt>
                <dd>{week.days.includes(i) && week.perDay != null ? hrs(week.perDay) : week.days.includes(i) ? "On" : ""}</dd>
              </div>
            ))}
          </dl>
          <p className="tm2-sub">
            {line}
            {!week.ownHours && !week.ownDays ? ", the workspace's hours" : ""}
          </p>
        </>
      )}
      {showCrew &&
        (crew ? (
          <div className="tm2-crew">
            <Switch
              checked={counted}
              disabled={!canManageCrew || busy}
              onChange={(on) => saveCrew(on, daily)}
              label="Counts toward the schedule"
            />
            {canManageCrew ? (
              <Chooser
                aria-label={`Hours a day ${name} counts for`}
                className="tm2-dailych"
                size={32}
                options={dailyOptions}
                value={String(daily)}
                disabled={busy || !counted}
                onChange={(v) => saveCrew(counted, Number(v))}
              />
            ) : (
              <span className="tm2-sub">{hrs(daily / 60)} hours a day</span>
            )}
          </div>
        ) : (
          !linked && <p className="tm2-sub">Not linked to anyone in ServiceM8, so the Schedule can&apos;t count them yet.</p>
        ))}
      {error && (
        <p className="tm2-err" role="alert">
          <Dot hue="red" />
          {error}
        </p>
      )}
    </section>
  );
}

/* ── Regular days off ── */

function RegularDaysOff({ rules, staffId, name, today }: { rules: RegularDayOff[]; staffId: string; name: string; today: string }) {
  const [open, setOpen] = useState(false);
  const live = rules.filter((r) => !r.toDate || r.toDate >= today);
  return (
    <section className="pdlcard psec-group" aria-label="Regular days off">
      <Head name="Regular days off">
        <Door onClick={() => setOpen(true)}>{live.length ? "Edit days off" : "Add days off"}</Door>
      </Head>
      {live.length === 0 ? (
        <p className="tm2-none">No regular days off</p>
      ) : (
        <dl className="pdl">
          {live.map((r) => (
            <div key={r.id} className="pdrow">
              <dt>{r.reason}</dt>
              <dd>
                <span className="pdv sm">{ruleWords(r)}</span>
              </dd>
            </div>
          ))}
        </dl>
      )}
      {open && <RegularDaysOffForm staffProfileId={staffId} name={name} today={today} onClose={() => setOpen(false)} />}
    </section>
  );
}

/* ── Leave ── */

const BALANCE_KINDS: readonly BalanceKind[] = ["annual", "personal"];
const KIND_WORD: Record<BalanceKind, string> = { annual: "Annual", personal: "Personal" };

function Leave({ leave, staffId, canSet }: { leave: PersonLeave; staffId: string; canSet: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<BalanceKind, string>>({ annual: "", personal: "" });
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const open = () => {
    setError(null);
    setDraft({
      annual: leave.annual ? String(leave.annual.balanceHours) : "",
      personal: leave.personal ? String(leave.personal.balanceHours) : "",
    });
    setEditing(true);
  };

  /* Editing replaces the ENTITLEMENT, as the team Leave view's does; the app
     keeps netting live bookings off it, so "available" is never written back. */
  const save = () => {
    setError(null);
    start(async () => {
      for (const kind of BALANCE_KINDS) {
        const typed = draft[kind].trim();
        const was = leave[kind]?.balanceHours;
        if (typed === "" || Number(typed) === was) continue;
        const res = await setLeaveBalance({ staffProfileId: staffId, kind, balanceHours: Number(typed) });
        if (!res.ok) return setError(res.error);
      }
      setEditing(false);
      router.refresh();
    });
  };

  const valid = BALANCE_KINDS.every((k) => draft[k].trim() === "" || Number(draft[k]) >= 0);

  return (
    <section className="pdlcard psec-group" aria-label="Leave">
      <Head name="Leave">{canSet && !editing && <Door onClick={open}>Edit balances</Door>}</Head>
      {editing ? (
        <div className="tm2-weekform">
          {BALANCE_KINDS.map((k) => (
            <Field key={k} label={`${KIND_WORD[k]} entitlement, in hours`}>
              <TextInput type="number" min={0} step={0.5} value={draft[k]} disabled={busy} onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))} />
            </Field>
          ))}
          <div className="tm2-formacts">
            <Button kind="second" disabled={busy} onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button kind="main" disabled={busy || !valid} onClick={save}>
              {busy ? "Saving the balances" : "Save balances"}
            </Button>
          </div>
        </div>
      ) : (
        <dl className="pdl">
          {BALANCE_KINDS.map((k) => {
            const c = leave[k];
            return (
              <div key={k} className="pdrow">
                <dt>{KIND_WORD[k]}</dt>
                <dd>
                  {c ? (
                    <>
                      <span className="pdv sm">{hrs(c.available)} hours</span>
                      {c.available !== c.balanceHours && <span className="pdsub">of {hrs(c.balanceHours)}, the rest booked</span>}
                    </>
                  ) : (
                    <span className="pdnone">Not set</span>
                  )}
                </dd>
              </div>
            );
          })}
          <div className="pdrow">
            <dt>Coming up</dt>
            <dd>
              {leave.coming.length === 0 ? (
                <span className="pdnone">Nothing booked</span>
              ) : (
                leave.coming.map((r) => (
                  <span key={r.id} className="pdv sm tm2-leave">
                    {fmtAuWeekdayDateLong(r.startDate)}
                    {r.endDate !== r.startDate ? ` to ${fmtAuWeekdayDateLong(r.endDate)}` : ""}, {LEAVE_LABEL[r.kind].toLowerCase()},{" "}
                    {r.status === "approved" ? "approved" : "waiting for a decision"}
                  </span>
                ))
              )}
            </dd>
          </div>
        </dl>
      )}
      {error && (
        <p className="tm2-err" role="alert">
          <Dot hue="red" />
          {error}
        </p>
      )}
    </section>
  );
}

/* ── Vehicle: read-only facts, from the register ── */

function Vehicle({ vehicle }: { vehicle: AssignedVehicle | null }) {
  const v = vehicle?.vehicle;
  const next = v
    ? v.serviceIntervalKm
      ? `At ${(v.lastServiceOdo + v.serviceIntervalKm).toLocaleString("en-AU")} km`
      : v.serviceDays != null
        ? v.serviceDays < 0
          ? "Overdue"
          : `In ${v.serviceDays} days`
        : null
    : null;
  return (
    <section className="pdlcard psec-group" aria-label="Vehicle">
      <Head name="Vehicle" />
      {v ? (
        <>
          <dl className="pdl">
            <div className="pdrow">
              <dt>Drives</dt>
              <dd>
                <span className="pdv sm">{[v.model || v.name || v.make, v.plate].filter(Boolean).join(" ")}</span>
              </dd>
            </div>
            {v.motorised && (
              <div className="pdrow">
                <dt>Odometer</dt>
                <dd>
                  <span className="pdv sm">{v.odometer.toLocaleString("en-AU")} km</span>
                </dd>
              </div>
            )}
            {next && (
              <div className="pdrow">
                <dt>Next service</dt>
                <dd>
                  <span className="pdv sm">{next}</span>
                </dd>
              </div>
            )}
          </dl>
          <Link className="tm2-link" href={vehiclePageHref(v.id)}>
            Open the vehicle
          </Link>
        </>
      ) : (
        <p className="tm2-none">No vehicle assigned.</p>
      )}
    </section>
  );
}

/* ── the page ── */

export function PersonPage({ data, actions }: { data: PersonPageData; actions: ProfileActions }) {
  const router = useRouter();
  const host = useContext(WindowsContext);
  const { header, profile, isSelf } = data;
  const actRef = useRef<HTMLButtonElement>(null);
  const [menu, setMenu] = useState(false);
  const [asking, setAsking] = useState<null | "deactivate" | "delete">(null);
  const [inviting, setInviting] = useState(false);
  const [checksOpen, setChecksOpen] = useState(false);
  const [payShown, setPayShown] = useState(false);
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  /* A door that names a group (`?sec=licences`, `?sec=workrights`: Home's
     list) brings it into view. The page has no tabs to open. */
  useEffect(() => {
    if (!data.initialSec) return;
    const el = document.getElementById(`tm2-sec-${data.initialSec}`);
    if (el && typeof el.scrollIntoView === "function") el.scrollIntoView({ block: "start" });
  }, [data.initialSec]);

  const active = header.status === "Active";
  const unclaimed = !header.userId;
  const canInvite = unclaimed && data.inviteRoles.length > 0;

  const run = (action: () => Promise<{ ok: boolean; error?: string }>, done: () => void) => {
    setError(null);
    start(async () => {
      const res = await action();
      if (!res.ok) return setError(res.error ?? "That didn't work.");
      done();
    });
  };

  const items: MenuItem[] = [
    ...(canInvite ? [{ key: "invite", label: "Invite to join" }] : []),
    { key: "copy", label: "Copy the link" },
    { key: "print", label: "Print" },
    ...(active ? [] : [{ key: "reactivate", label: "Reactivate", disabled: busy }]),
    ...(active ? [{ key: "deactivate", label: "Deactivate", danger: true, disabled: busy }] : []),
    ...(data.deletable ? [{ key: "delete", label: "Delete the card", danger: true, disabled: busy }] : []),
  ];

  const onAction = (key: string) => {
    if (key === "invite") setInviting(true);
    else if (key === "copy")
      void navigator.clipboard
        .writeText(`${window.location.origin}${staffHref(header.id)}`)
        .then(() => host?.toast("Link copied"))
        .catch(() => setError("The link couldn't be copied. Your browser may not allow it here."));
    else if (key === "print") window.print();
    /* One press: putting someone back is the undo, and an undo that asks
       twice is a worse undo. */ else if (key === "reactivate")
      run(
        () => saveStaffSection(header.id, "personal", { status: "Active" }),
        () => {
          host?.toast(`${header.name} is back on the team`);
          router.refresh();
        },
      );
    else if (key === "deactivate" || key === "delete") setAsking(key);
  };

  const role = header.role && header.role !== "—" ? header.role : null;
  const since = header.started !== "—" ? `with you since ${header.started}` : null;
  const line = [role, since].filter(Boolean).join(", ");
  const sentence = line ? line.charAt(0).toUpperCase() + line.slice(1) : null;
  const first = firstOf(header.nickname || header.name);

  return (
    <div className="tm2 tm2-p">
      <header className="tm2-phead">
        <div className="pident tm2-photo">
          <PhotoBadge photoUrl={header.photoUrl} initials={header.initials} name={header.name} onSet={actions.onSetPhoto} onClear={actions.onClearPhoto} />
        </div>
        <div className="tm2-pid">
          <div className="tm2-pname">
            <h1>
              <Fade>{header.name}</Fade>
            </h1>
            {sentence && <span className="tm2-count">{sentence}</span>}
          </div>
          {!active ? (
            <StateWord tone="info">Left the team</StateWord>
          ) : unclaimed ? (
            <StateWord tone="info">{header.importedFrom ? `From ${header.importedFrom}, hasn't joined yet` : "Hasn't joined yet"}</StateWord>
          ) : null}
        </div>
        <Button ref={actRef} kind="second" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
          Actions
        </Button>
        <Menu
          anchor={actRef}
          open={menu}
          onClose={() => setMenu(false)}
          onSelect={(key) => {
            setMenu(false);
            onAction(key);
          }}
          items={items}
          label={`Actions on ${header.name}`}
          align="end"
        />
      </header>

      {error && (
        <p className="tm2-err" role="alert">
          <Dot hue="red" />
          {error}
        </p>
      )}

      <div className="tm2-cols">
        <div className="tm2-col">
          <div id="tm2-sec-personal">
            <PersonalCard
              group={{ title: "Details", editLabel: "Edit details" }}
              profile={profile}
              mode="admin"
              email={header.email}
              addressLookup={data.addressLookup}
              today={data.today}
              orgState={data.orgState}
              aliases={data.aliases}
              onSaveAliases={actions.onSaveAliases}
              onSave={actions.onSave}
            />
          </div>
          <div id="tm2-sec-emergency">
            <EmergencyCard group={{ title: "Emergency", editLabel: "Edit emergency contact" }} profile={profile} mode="admin" org={data.org} onSave={actions.onSave} />
          </div>
          <div id="tm2-sec-licences">
            <ComplianceCard
              layout="rows"
              licences={data.licences}
              staffId={header.id}
              records={data.licenceTerms}
              documents={data.licenceDocuments}
              today={data.today}
              warnDays={data.warnDays}
              onAdd={actions.onAddLicence}
              onUpdate={actions.onUpdateLicence}
              onRemove={actions.onRemoveLicence}
              onRecordTerm={actions.onRecordLicenceTerm}
              onAttachDoc={actions.onAttachLicenceDoc}
              onRemoveTerm={actions.onRemoveLicenceTerm}
            />
          </div>
          <QualificationsCard group={{ title: "Qualifications", editLabel: "Edit qualifications" }} profile={profile} mode="admin" onSave={actions.onSave} />
        </div>

        <div className="tm2-col">
          <NormalWeek
            week={data.week}
            isSelf={isSelf}
            crew={data.crew}
            canManageCrew={data.canManageCrew}
            linked={data.linkedToSm8}
            showCrew={data.showCrew}
            name={header.name}
          />
          <RegularDaysOff rules={data.regularDaysOff} staffId={header.id} name={header.name} today={data.today} />
          {data.leave && <Leave leave={data.leave} staffId={header.id} canSet={data.canSetBalances} />}
          <div id="tm2-sec-workrights">
            <WorkRightsCard
              group={{ title: "Work rights", editLabel: "Edit work rights" }}
              checkCount={data.workRightsChecks.length}
              lastChecked={data.workRightsChecks[0]?.checkedOn ?? null}
              onOpenChecks={actions.onRecordWorkRightsCheck ? () => setChecksOpen(true) : undefined}
              profile={profile}
              mode="admin"
              today={data.today}
              warnDays={data.warnDays}
              onSave={actions.onSave}
            />
          </div>
          {/* yours only: a signature is the person's own mark */}
          {isSelf && <SignatureCard />}
        </div>

        <div className="tm2-col">
          <Vehicle vehicle={data.vehicle} />
          {data.payroll &&
            (payShown ? (
              <PayrollCard group={{ title: "Pay", editLabel: "Edit pay" }} pay={data.payroll} rosteredWeek={data.rosteredWeek} onSave={actions.onSave} />
            ) : (
              <section className="pdlcard psec-group" aria-label="Pay">
                <Head name="Pay">
                  <Door onClick={() => setPayShown(true)}>Show pay</Door>
                </Head>
              </section>
            ))}
          <div id="tm2-sec-permissions">
            <PermissionsCard group={{ title: "Access", editLabel: "Edit access" }} ctx={data.permissions} onSave={actions.onSave} />
          </div>
          {data.notes && (
            <div id="tm2-sec-notes">
              <NotesCard group={{ title: `Notes about ${first}`, editLabel: "Edit note" }} notes={data.notes} onSave={actions.onSave} />
            </div>
          )}
        </div>
      </div>

      {checksOpen && actions.onRecordWorkRightsCheck && (
        <WorkRightsModal
          staffId={header.id}
          subject={isSelf ? null : header.name}
          records={data.workRightsChecks}
          documents={data.workRightsDocuments}
          today={data.today}
          warnDays={data.warnDays}
          onRecord={actions.onRecordWorkRightsCheck}
          onAttach={actions.onAttachWorkRightsDoc ?? (async () => ({ ok: true as const }))}
          onRemoveCheck={actions.onRemoveWorkRightsCheck ?? (async () => ({ ok: true as const }))}
          onClose={() => setChecksOpen(false)}
        />
      )}

      {inviting && (
        <PersonForm
          roles={data.inviteRoles}
          prefill={{ email: header.email, staffProfileId: header.id, name: header.name }}
          onClose={() => setInviting(false)}
        />
      )}

      {asking === "deactivate" && (
        <ConfirmDialog
          heading={`Deactivate ${header.name}?`}
          confirm="Deactivate them"
          busy={busy}
          onClose={() => setAsking(null)}
          onConfirm={() =>
            /* DEACTIVATE WRITES, through the personal section's own save:
               `status` is already in its allowlist and `team` its gate. */
            run(
              () => saveStaffSection(header.id, "personal", { status: "Inactive" }),
              () => {
                setAsking(null);
                host?.toast(`${header.name} has left the team`);
                router.refresh();
              },
            )
          }
        >
          They go to People who have left, with everything on their card. Reactivate puts them back.
        </ConfirmDialog>
      )}

      {asking === "delete" && (
        <ConfirmDialog
          heading={`Delete ${header.name}'s card?`}
          confirm="Delete the card"
          busy={busy}
          onClose={() => setAsking(null)}
          onConfirm={() =>
            run(
              () => deleteStaffCard(header.id),
              () => {
                setAsking(null);
                host?.toast(`${header.name}'s card deleted`);
                router.push("/dashboard/team");
              },
            )
          }
        >
          Nothing on the records points at this card, so it goes for good. Anyone who has worked here keeps Deactivate instead.
        </ConfirmDialog>
      )}
    </div>
  );
}
