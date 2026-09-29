"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { Plate } from "@/components/fleet/plate";
import { LicenceCard } from "@/components/cards/licence-card";
import { Icon } from "@/components/shell/icon";
import { formatAuDate } from "@/lib/au-dates";
import { avatarGround } from "@/lib/staff/avatar";
import type { Completeness } from "@/lib/staff/completeness";
import { splitFrom } from "@/lib/staff/cost-split";
import { licenceStatus } from "@/lib/staff/licence";
import type { MyPay } from "@/lib/staff/my-pay";
import type { StaffProfile } from "@/lib/staff/profile";
import type { StaffLicence } from "@/lib/staff/types";
import { uniformSummary } from "@/lib/staff/uniform";
import { isNoVisa, isNotCleared } from "@/lib/staff/work-rights";
import { ROLE_COPY } from "@/lib/roles-shared";
import { PhotoBadge, PHOTO_INPUT_ID } from "./photo-badge";
import { ACCESS } from "./permissions-card";
import { SPLIT_META } from "./payroll-card";
import type {
  AdminExtras,
  AssignedVehicle,
  ProfileActions,
  ProfileHeader,
  ProfileMode,
  SectionKey,
} from "./types";

/* The staff card, on one screen — the whole person, no tabs.

   WHY THE TABS WENT (Isaac, 2026-09-29): the tabbed Summary "takes up so much
   of the screen… it's just all over the place", and a new starter's card —
   a grid of dashes and Adds — "looked pretty poor". Options were drawn side by
   side (claude.ai artifact No2p6rkyi2DeSvTevtPrdV) and he picked the one this
   builds: ONLY WHAT'S ON FILE.

   A SECTION APPEARS ONCE IT HAS SOMETHING IN IT. Everything still empty is
   gathered into one list, Still to add, split into what the business is
   obliged to hold and what it would like. So a new starter's card is a header,
   a short strip and a tidy checklist; as their details come in the list
   shrinks and the cards appear. A card never shows a blank row — the blank is
   on the list, once.

   EVERY DOOR OPENS A FORM. A card's Edit opens that section straight into its
   form, an Add opens it on the very field, and saving or cancelling comes back
   here (see SectionDone in section-card). The forms are the sections as they
   were; only the way in changed.

   THE LAYOUT: the person on the left two-thirds (Personal beside Emergency and
   Work rights, then the licences as the plastic cards they are), the admin
   column on the right (Payroll, Permissions, Notes). Colour where Isaac asked
   for it and nowhere else: the emergency card's red head, a hue of the
   person's own behind their initials, and the cost split's three colours. */

type Go = (key: SectionKey, withEdit?: boolean, field?: keyof StaffProfile) => void;

export function Overview({
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
  extras,
  myPay,
  onGo,
}: {
  header: ProfileHeader;
  profile: StaffProfile | null;
  licences: StaffLicence[];
  vehicle: AssignedVehicle | null;
  today: string;
  warnDays: number;
  /** the org's home state, so an unset holiday state reads as the answer */
  orgState: string | null;
  mode: ProfileMode;
  actions: Pick<ProfileActions, "onSetPhoto" | "onClearPhoto">;
  completeness: Completeness;
  /** admin only, and a key that is absent is not rendered — see ProfileScreen */
  extras: {
    payroll?: AdminExtras["payroll"];
    showPayroll: boolean;
    permissions?: AdminExtras["permissions"];
    notes?: string | null;
    showNotes: boolean;
  };
  /** self only */
  myPay?: MyPay | null;
  onGo: Go;
}) {
  const p = profile;
  const uniform = uniformSummary(p);
  const holiday = p?.state || orgState;

  const personalRows: Array<[string, ReactNode]> = [];
  if (p?.birthday) personalRows.push(["Date of birth", formatAuDate(p.birthday)]);
  if (p?.address) personalRows.push(["Address", p.address]);
  if (uniform) personalRows.push(["Uniform", uniform]);
  /* Holiday state always resolves (the org's own state), so it rides along
     only once the card has something of the person's to show — it is not a
     reason for the card to exist. */
  if (personalRows.length && mode === "admin" && holiday) {
    personalRows.push([
      "Holiday state",
      p?.state ? (
        p.state
      ) : (
        <>
          {holiday}
          <span className="pov-sub">Organisation default</span>
        </>
      ),
    ]);
  }

  const hasEmergency = Boolean(p?.emergency_name || p?.emergency_phone);
  const rights = workRights(p, today, warnDays);
  const pay = extras.showPayroll ? (extras.payroll ?? null) : null;
  const hasPay = pay?.hourly_wage != null;
  const perms = extras.permissions;

  const todo = stillToAdd({ p, completeness, licences, header, uniform, showPayroll: extras.showPayroll, hasPay, onGo });

  const left = (
    <>
      {(personalRows.length > 0 || hasEmergency || rights) && (
        <div className="pov-pair">
          {personalRows.length > 0 && (
            <Card title="Personal" link="Edit" onLink={() => onGo("personal", true)}>
              <Rows rows={personalRows} />
            </Card>
          )}
          {(hasEmergency || rights) && (
            <div className="pov-col">
              {hasEmergency && <Emergency p={p!} onEdit={() => onGo("emergency", true)} />}
              {rights && (
                <Card title="Work rights" link="Edit" onLink={() => onGo("workrights", true)}>
                  <p className={`pov-line ${rights.tone}`}>{rights.lead}</p>
                  {rights.sub && <p className="pov-sub">{rights.sub}</p>}
                </Card>
              )}
            </div>
          )}
        </div>
      )}

      {licences.length > 0 && (
        <section className="pov-band" aria-label="Licences and tickets">
          <div className="pov-ch">
            <h2>Licences and tickets</h2>
            <button type="button" className="pov-lnk" onClick={() => onGo("licences", true)}>
              Add<span className="sr-only"> a licence or ticket</span>
            </button>
          </div>
          <div className="pov-lics">
            {licences.map((l) => (
              <LicenceCard
                key={l.id}
                typeName={l.typeName}
                licenceNumber={l.licenceNumber}
                expiry={l.expiryDate ? formatAuDate(l.expiryDate) : null}
                status={licenceStatus(l.expiryDate, today, warnDays)}
                onOpen={() => onGo("licences")}
              />
            ))}
          </div>
        </section>
      )}

      {todo.required.length + todo.optional.length > 0 && <StillToAdd {...todo} />}
    </>
  );

  const right =
    mode === "admin" ? (
      <>
        {hasPay && <Payroll pay={pay!} onEdit={() => onGo("payroll", true)} />}
        {perms && (
          <Card
            title="Permissions"
            admin
            link={perms.editable ? "Edit" : "Open"}
            onLink={() => onGo("permissions", perms.editable)}
          >
            <Rows
              rows={[
                ["Role", perms.role ? ROLE_COPY[perms.role].label : "Not set"],
                ["Access", `${ACCESS.filter(([c]) => perms.caps.has(c)).length} of ${ACCESS.length} areas`],
              ]}
            />
          </Card>
        )}
        {extras.showNotes &&
          (extras.notes?.trim() ? (
            <Card title="Notes" admin link="Edit" onLink={() => onGo("notes", true)}>
              <p className="pov-note">{extras.notes}</p>
            </Card>
          ) : (
            <button type="button" className="pov-lnk pov-quiet" onClick={() => onGo("notes", true)}>
              Write a note
            </button>
          ))}
      </>
    ) : myPay ? (
      <MyPayCard pay={myPay} onOpen={() => onGo("mypay")} />
    ) : null;

  return (
    <div className="pov">
      <Head header={header} vehicle={vehicle} actions={actions} completeness={completeness} onGo={onGo} />

      <Strip header={header} p={p} />

      <div className={right ? "pov-zones" : "pov-zones solo"}>
        <div className="pov-l">{left}</div>
        {right && <div className="pov-r">{right}</div>}
      </div>
    </div>
  );
}

/* ── the head: who, the van, and how much of the record is in ── */

function Head({
  header,
  vehicle,
  actions,
  completeness,
  onGo,
}: {
  header: ProfileHeader;
  vehicle: AssignedVehicle | null;
  actions: Pick<ProfileActions, "onSetPhoto" | "onClearPhoto">;
  completeness: Completeness;
  onGo: Go;
}) {
  const role = header.role && header.role !== "—" ? header.role : null;
  const started = header.started !== "—";
  /* "Lead Installer, since Jun 2020 (6.1 years)" — one sentence. The tenure
     rides in brackets because it is the start date said again as a length. */
  const since = started
    ? `since ${header.started}${header.years !== "—" ? ` (${header.years} years)` : ""}`
    : null;
  const line = [role, since].filter(Boolean).join(", ");
  const sentence = line ? line.charAt(0).toUpperCase() + line.slice(1) : null;
  const v = vehicle?.vehicle;

  return (
    <div className="pident pov-head">
      <PhotoBadge
        photoUrl={header.photoUrl}
        initials={header.initials}
        name={header.name}
        ground={avatarGround(header.name)}
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
        {sentence && <div className="sub">{sentence}</div>}
      </div>

      {v && (
        /* `?v=` and not a path segment: the app shell keys its outlet on
           pathname, so a link that changes the path remounts the page it
           lands on. Assets reads the param and opens that vehicle. */
        <div className="pov-van">
          <span className="pov-k">Van</span>
          <Link className="vehjump" href={`/dashboard/assets?v=${v.id}`}>
            <Plate plate={v.plate} state={v.plateState} size="lg" />
            <span className="sr-only">Open {v.plate} in Fleet</span>
          </Link>
        </div>
      )}

      <Record c={completeness} onGo={onGo} />
    </div>
  );
}

/* THE RECORD LINE — how much of the card is on file, and the one action.
   It goes when there is nothing left to say: a complete record is the normal
   state of a card, and "11 of 11 on file" in the header was a fact about the
   screen, not about the person. The action is the page's one filled button,
   and it opens the FIRST required gap on its own field. */
function Record({ c, onGo }: { c: Completeness; onGo: Go }) {
  if (c.complete) return null;
  const first = c.missing.find((f) => f.required);
  return (
    <div className="pov-rec">
      <span className="pov-count">
        {c.filled} of {c.total} on file
      </span>
      <span className="pprog" aria-hidden="true">
        <i className={c.requiredMissing === 0 ? "ok" : "warn"} style={{ width: `${c.percent}%` }} />
      </span>
      {first && (
        <button
          type="button"
          className="pbtn primary"
          onClick={() => onGo(first.section as SectionKey, true, first.key)}
        >
          {c.requiredMissing === 1
            ? `Add ${first.label.toLowerCase()}`
            : `Add the ${c.requiredMissing} required details`}
        </button>
      )}
    </div>
  );
}

/* ── the strip: the four facts you look up most, and only the ones we hold ── */

function Strip({ header, p }: { header: ProfileHeader; p: StaffProfile | null }) {
  const facts: Array<[string, string]> = [];
  if (p?.phone) facts.push(["Mobile", p.phone]);
  if (header.email) facts.push(["Email", header.email]);
  if (p?.start_date) facts.push(["Started", formatAuDate(p.start_date)]);
  if (p?.employment_type) facts.push(["Employment", p.employment_type]);
  if (!facts.length) return null;
  return (
    <dl className="pov-strip">
      {facts.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/* ── a card, and its rows ── */

function Card({
  title,
  link,
  onLink,
  admin = false,
  children,
}: {
  title: string;
  link: string;
  onLink: () => void;
  admin?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="pov-card" aria-label={title}>
      <div className="pov-ch">
        <h2>
          {title}
          {admin && <span className="pov-adm">Admin only</span>}
        </h2>
        <button type="button" className="pov-lnk" onClick={onLink}>
          {link}
          <span className="sr-only"> {title}</span>
        </button>
      </div>
      {children}
    </section>
  );
}

function Rows({ rows }: { rows: Array<[string, ReactNode]> }) {
  return (
    <dl className="pov-rows">
      {rows.map(([k, v]) => (
        <div key={k} className="pov-row">
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/* THE ONE CARD THAT SHOUTS. Isaac: "a bright red header, white writing". It is
   the card somebody reads in a hurry, so the name and the number are the
   largest type in the body, and the number is what you would dial. */
function Emergency({ p, onEdit }: { p: StaffProfile; onEdit: () => void }) {
  return (
    <section className="pov-card pov-sos" aria-label="Emergency contact">
      <div className="pov-sosh">
        <h2>Emergency contact</h2>
        <button type="button" className="pov-lnk" onClick={onEdit}>
          Edit<span className="sr-only"> emergency contact</span>
        </button>
      </div>
      <div className="pov-sosb">
        {p.emergency_name && <p className="pov-who">{p.emergency_name}</p>}
        {p.emergency_relationship && <p className="pov-sub">{p.emergency_relationship}</p>}
        {p.emergency_phone && <p className="pov-tel">{p.emergency_phone}</p>}
      </div>
    </section>
  );
}

/* The right to work in one line and its evidence under it. The lead carries
   the answer; the tone is the dashboard chip's, from the same rules, so a
   lapsing visa warns here exactly when it raises a chip there. */
function workRights(
  p: StaffProfile | null,
  today: string,
  warnDays: number,
): { lead: string; sub: string | null; tone: "ok" | "warn" | "bad" | "mute" } | null {
  const status = p?.work_rights_status?.trim();
  if (!status) return null;
  if (isNotCleared(status)) return { lead: "Not cleared to work", sub: status, tone: "bad" };
  if (isNoVisa(status)) return { lead: status, sub: "Full working rights", tone: "ok" };
  const visa = p?.visa_type?.trim() || "Visa";
  if (p?.visa_expiry) {
    const s = licenceStatus(p.visa_expiry, today, warnDays);
    if (s.tone === "bad") return { lead: status, sub: `${visa} expired ${formatAuDate(p.visa_expiry)}`, tone: "bad" };
    if (s.tone === "warn") return { lead: status, sub: `${visa}: ${s.label.toLowerCase()}`, tone: "warn" };
    return { lead: status, sub: `${visa}, expires ${formatAuDate(p.visa_expiry)}`, tone: "mute" };
  }
  return { lead: status, sub: visa, tone: "mute" };
}

/* ── money: never on screen until asked for ──
   Isaac: hidden "just in case someone walks past". Not blurred and not a row
   of dots — both "looked weird" — the figure's own slot holds a quiet button
   the same height as the figure, so asking for it moves nothing. It hides
   again whenever the card is left, because the state lives in the card. */
function Hidden({ what, children }: { what: string; children: ReactNode }) {
  const [shown, setShown] = useState(false);
  return (
    <div className="pov-fig">
      {shown ? (
        <>
          <span className="pov-amt">{children}</span>
          <button type="button" className="pov-lnk pov-hide" onClick={() => setShown(false)}>
            Hide<span className="sr-only"> {what}</span>
          </button>
        </>
      ) : (
        <button type="button" className="pbtn ghost pov-sm" onClick={() => setShown(true)}>
          <Icon name="eye" size={16} />
          Show {what}
        </button>
      )}
    </div>
  );
}

const money = (n: number) => `$${n.toFixed(2)}`;

function Payroll({
  pay,
  onEdit,
}: {
  pay: NonNullable<AdminExtras["payroll"]>;
  onEdit: () => void;
}) {
  const split = splitFrom(pay.cost_split);
  const rows: Array<[string, ReactNode]> = [];
  if (pay.contracted_hours != null) rows.push(["Hours", `${pay.contracted_hours} a week`]);
  if (pay.utilisation != null) rows.push(["Utilisation", `${pay.utilisation}%`]);
  return (
    <Card title="Payroll" admin link="Edit" onLink={onEdit}>
      <Hidden what="wage">
        {money(pay.hourly_wage!)}
        <small>{pay.pay_basis === "salary" ? "an hour, salaried" : "an hour"}</small>
      </Hidden>
      {rows.length > 0 && <Rows rows={rows} />}
      {/* the split is a proportion, and a proportion has a shape: one bar in
          the payroll card's own three colours, the figures under it */}
      <div className="pov-split">
        <span className="pov-k">Cost split</span>
        <span className="pov-sbar" aria-hidden="true">
          {SPLIT_META.map((m, i) => (
            <i key={m.label} style={{ width: `${split[i]}%`, background: m.color }} />
          ))}
        </span>
        <span className="pov-slg">
          {SPLIT_META.map((m, i) => (
            <span key={m.label}>
              <i style={{ background: m.color }} aria-hidden="true" />
              <b>{split[i]}%</b> {m.label}
            </span>
          ))}
        </span>
      </div>
    </Card>
  );
}

function MyPayCard({ pay, onOpen }: { pay: MyPay; onOpen: () => void }) {
  return (
    <Card title="My pay" link="Open" onLink={onOpen}>
      {pay.rate != null ? (
        <Hidden what="pay rate">
          {money(pay.rate)}
          <small>an hour</small>
        </Hidden>
      ) : (
        <p className="pov-sub">No rate set yet</p>
      )}
      <Rows rows={[["Super", `${pay.superPct}%`]]} />
    </Card>
  );
}

/* ── Still to add ──
   The blanks, said once. REQUIRED is what the business is obliged to hold
   (lib/staff/completeness, plus a wage for whoever runs the pay); OPTIONAL is
   what it would like. Each row opens the form on the thing it names. */

type Todo = { key: string; title: string; sub?: string; go: () => void };

function stillToAdd({
  p,
  completeness,
  licences,
  header,
  uniform,
  showPayroll,
  hasPay,
  onGo,
}: {
  p: StaffProfile | null;
  completeness: Completeness;
  licences: StaffLicence[];
  header: ProfileHeader;
  uniform: string | null;
  showPayroll: boolean;
  hasPay: boolean;
  onGo: Go;
}): { required: Todo[]; optional: Todo[] } {
  const miss = completeness.missing;
  const required: Todo[] = [];
  const optional: Todo[] = [];

  const personal = miss.filter((f) => f.section === "personal" && f.required);
  if (personal.length) {
    required.push({
      key: "personal",
      title: "Personal details",
      sub: sentenceCase(personal.map((f) => f.label.toLowerCase()).join(", ")),
      go: () => onGo("personal", true, personal[0].key),
    });
  }
  if (miss.some((f) => f.key === "work_rights_status")) {
    required.push({
      key: "workrights",
      title: "Work rights",
      sub: "Citizenship or visa",
      go: () => onGo("workrights", true, "work_rights_status"),
    });
  }
  if (showPayroll && !hasPay) {
    required.push({
      key: "payroll",
      title: "Pay",
      sub: "Wage, hours and the install, service and admin split",
      go: () => onGo("payroll", true),
    });
  }

  if (!p?.phone) {
    optional.push({ key: "phone", title: "Mobile number", go: () => onGo("personal", true, "phone") });
  }
  if (!p?.emergency_name || !p?.emergency_phone) {
    const field = !p?.emergency_name ? "emergency_name" : "emergency_phone";
    optional.push({
      key: "emergency",
      title: "Emergency contact",
      sub: !p?.emergency_name && !p?.emergency_phone ? "Name and phone" : !p?.emergency_name ? "Name" : "Phone",
      go: () => onGo("emergency", true, field),
    });
  }
  if (!licences.length) {
    optional.push({
      key: "licences",
      title: "Licences and tickets",
      sub: "Driver licence, ARC, white card",
      go: () => onGo("licences", true),
    });
  }
  if (!uniform) {
    optional.push({ key: "uniform", title: "Uniform sizes", sub: "Shirt, trousers, boots", go: () => onGo("personal", true, "shirt_size") });
  }
  if (!header.photoUrl) {
    optional.push({ key: "photo", title: "Photo", go: () => document.getElementById(PHOTO_INPUT_ID)?.click() });
  }
  return { required, optional };
}

const sentenceCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function StillToAdd({ required, optional }: { required: Todo[]; optional: Todo[] }) {
  const group = (label: string, items: Todo[], req: boolean) =>
    items.length > 0 && (
      <div className="pov-tg" role="group" aria-label={label}>
        <h3 className={req ? "req" : undefined}>{label}</h3>
        {items.map((t) => (
          <div key={t.key} className="pov-ti">
            <span className={req ? "pov-ring req" : "pov-ring"} aria-hidden="true" />
            <div>
              <b>{t.title}</b>
              {t.sub && <span>{t.sub}</span>}
            </div>
            <button type="button" className="pbtn ghost pov-sm" onClick={t.go}>
              Add<span className="sr-only"> {t.title.toLowerCase()}</span>
            </button>
          </div>
        ))}
      </div>
    );
  return (
    <section className="pov-card pov-todo" aria-label="Still to add">
      <div className="pov-ch">
        <h2>Still to add</h2>
      </div>
      {group("Required", required, true)}
      {group("Optional", optional, false)}
    </section>
  );
}
