import { auDayOf, fmtAuWeekdayDate, fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import { expiryDue } from "@/lib/expiry-due";
import type { OrgCredential } from "@/lib/org/credentials";

/* THE HOME CALENDAR'S ITEMS: rows in, calendar items out.

   The calendar is company-wide: public and school holidays, company events
   (a shutdown is an event with a range), the noticeboard's events, and the
   admin dates the business must renew (a vehicle's rego, insurance and green
   slip; the business's own licences and cover). No job bookings, nobody's
   leave, nothing made up: no Example rows, no BAS, no test and tag, because
   HeyTiff holds no record of either.

   Pure: no database, no clock. `./query` reads the rows and hands them here
   with the day it read them on; the model (`./model`, the view maths) takes
   what this returns. Every id is namespaced by where it came from, so two
   sources can never collide and a selection survives a reload:
   ph: sch: ev: nt: veh:<id>:rego|insurance|ctp cred:.

   LATE IS THE LIST'S WORD, AND THE BELL'S RULE. An admin item's `overdue` is
   `expiryDue`'s state (the bell's `expiryState`, the rule every chip and the
   register read) at the org's window, counted on the day `./query` hands in:
   the workspace's day, the one Home's list places the same date on with the
   same `expiryDue`, so a rego the list calls Late is overdue here and one it
   calls Today is not. For a workspace in Sydney's zone (and every one without
   ServiceM8) that is the bell's day too. "Due" (inside the window, not late)
   is the same predicate again, which is why the calendar carries `warnDays`
   rather than a number of its own. */

/* ── the item ──

   The model (lib/calendar/model.ts, from the calendar-model pull request)
   declares this same shape. Whichever of the two lands second should make
   one import the other's rather than keep two copies. */

export type CalCat = "hol" | "school" | "event" | "admin";

/** What an admin row's button, or the panel's first action, opens. */
export type CalAction = { label: string; href: string } | "edit";

export type CalItem = {
  /** Namespaced by source: ph:, sch:, ev:, nt:, veh:<id>:rego, cred:. */
  id: string;
  cat: CalCat;
  /** ISO yyyy-mm-dd, inclusive. */
  start: string;
  /** ISO yyyy-mm-dd, inclusive: the last day, the same as `start` for one day. */
  end: string;
  title: string;
  /** The shorter title a month cell has room for: "Trailer rego". */
  monthTitle?: string | null;
  /** The month cell's second line for admin: the plate. Defaults to "Due". */
  monthMeta?: string | null;
  /** Wall-clock start and end, "06:45": local to the yard, never an instant. */
  time?: string | null;
  timeEnd?: string | null;
  /** The agenda and rail line under the title: "From Assets.", "The yard." */
  sub?: string | null;
  /** The panel's sentence: "The rego on TC22BJ runs out on Tue 20 Oct." */
  description?: string | null;
  facts?: ReadonlyArray<readonly [string, string]>;
  action?: CalAction | null;
  /** Admin only: past its date, by the bell's own rule. */
  overdue?: boolean;
  /** An event that closes the business for its range. */
  shutdown?: boolean;
  /** School holidays: the day students go back (ISO), and the season. */
  back?: string | null;
  season?: string | null;
  /** A repeating company event: the series its rows share, and the rule they
      were counted from (calendar_events.repeat, read by repeat.ts). */
  seriesId?: string | null;
  repeat?: unknown;
};

/** Everything the Home calendar is drawn from. The model's frame is the
    first four fields (today, the window, the state), so this passes as it is. */
export type CompanyCalendar = {
  /** The workspace's day (`railDay`): the one "Your day" draws above the
      calendar and the list places its rows on. */
  today: string;
  /** The 1st of this month. */
  windowStart: string;
  /** The last day of the 11th month after this one: twelve months in all. */
  windowEnd: string;
  /** The state whose holidays these are ("NSW"), or "" where the workspace
      has not said, in which case there are no holidays to name it by. */
  stateName: string;
  items: CalItem[];
  /** The org's expiry window (lib/expiry.ts): the calendar's Due is admin
      due inside it, the same days the bell warns on. */
  warnDays: number;
  /** Whether this viewer may add to the calendar (`team`, as posting a notice). */
  canAdd: boolean;
  /** Whether there are school holidays for this state at all; without them
      the School holidays filter is not offered. */
  hasSchool: boolean;
};

/* ── the rows ./query reads ── */

export type HolidayRow = { date: string; name: string };

export type SchoolHolidayRow = {
  season: string;
  startsOn: string;
  endsOn: string;
  studentsBack: string | null;
};

export type CalendarEventRow = {
  id: string;
  kind: "event" | "shutdown";
  title: string;
  startsOn: string;
  endsOn: string;
  startsAt: string | null;
  endsAt: string | null;
  location: string | null;
  audience: string | null;
  note: string | null;
  seriesId: string | null;
  repeat: unknown;
  createdBy: string | null;
  createdAt: string | null;
};

export type NoticeEventRow = {
  id: string;
  title: string;
  date: string;
  time: string | null;
  location: string | null;
};

export type VehicleExpiryRow = {
  id: string;
  name: string | null;
  plate: string | null;
  status: string | null;
  regoExpiry: string | null;
  insuranceExpiry: string | null;
  ctpExpiry: string | null;
};

/* ── the window ── */

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The calendar's twelve months: the 1st of today's month to the last day of
    the 11th month after it. Null when `today` is not a day. */
export function companyWindow(today: string): { windowStart: string; windowEnd: string } | null {
  const m = ISO_DAY.exec(today);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  if (mo < 1 || mo > 12) return null;
  /* Day 0 of a month is the last day of the one before it. */
  const end = new Date(Date.UTC(y, mo - 1 + 12, 0)).toISOString().slice(0, 10);
  return { windowStart: `${m[1]}-${m[2]}-01`, windowEnd: end };
}

/* ── small words ── */

/** A stored day as an ISO day, or null: a driver may hand a date back with a
    time on it, and anything else is not a day to draw. */
function dayOf(v: string | null | undefined): string | null {
  const s = String(v ?? "").slice(0, 10);
  if (!ISO_DAY.test(s)) return null;
  const t = Date.parse(`${s}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s ? s : null;
}

/** A Postgres `time` ("06:45:00") or "06:45" as "06:45", or null. */
export function wallClock(v: string | null | undefined): string | null {
  const m = /^(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(String(v ?? "").trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h <= 23 && min <= 59 ? `${String(h).padStart(2, "0")}:${m[2]}` : null;
}

/** Trimmed, ending in a full stop unless it already ends a sentence. */
function sentence(v: string | null | undefined): string | null {
  const s = String(v ?? "").trim().replace(/\s+/g, " ");
  if (!s) return null;
  return /[.!?…]$/.test(s) ? s : `${s}.`;
}

const clean = (v: string | null | undefined): string | null => String(v ?? "").trim() || null;

/* "Public liability" reads "public liability" inside a sentence; "ARC
   authorisation" keeps its capitals, because a second capital says the
   first is part of a name. */
function lowerFirst(s: string): string {
  return s.length > 1 && s[1] === s[1].toLowerCase() ? s[0].toLowerCase() + s.slice(1) : s;
}

/* ── holidays ── */

/** Public holidays, as the org's own table holds them (suppressed days are
    already gone): the model writes their words, from the state. */
export function holidayItems(rows: readonly HolidayRow[]): CalItem[] {
  const out: CalItem[] = [];
  for (const r of rows) {
    const d = dayOf(r.date);
    const title = clean(r.name);
    if (!d || !title) continue;
    out.push({ id: `ph:${d}`, cat: "hol", start: d, end: d, title });
  }
  return out;
}

/** School holidays: one item per break, with the day students go back when
    the department has published it. */
export function schoolItems(rows: readonly SchoolHolidayRow[]): CalItem[] {
  const out: CalItem[] = [];
  for (const r of rows) {
    const s = dayOf(r.startsOn);
    const e = dayOf(r.endsOn);
    if (!s || !e || e < s) continue;
    out.push({
      id: `sch:${s}`,
      cat: "school",
      start: s,
      end: e,
      title: "School holidays",
      back: dayOf(r.studentsBack),
      season: clean(r.season)?.toLowerCase() ?? null,
    });
  }
  return out;
}

/* ── events ── */

/** The company's own events, shutdowns included. Anyone who could add one can
    change it, so the panel's action is Edit. */
export function eventItems(rows: readonly CalendarEventRow[], names?: ReadonlyMap<string, string>): CalItem[] {
  const out: CalItem[] = [];
  for (const r of rows) {
    const s = dayOf(r.startsOn);
    const e = dayOf(r.endsOn) ?? s;
    const title = clean(r.title);
    if (!s || !e || e < s || !title) continue;
    const shutdown = r.kind === "shutdown";
    const where = clean(r.location);
    const who = clean(r.audience);
    const note = sentence(r.note);
    const added = auDayOf(r.createdAt ?? "");
    const by = r.createdBy ? names?.get(r.createdBy) : undefined;
    const facts: [string, string][] = [];
    if (where) facts.push(["Where", where]);
    if (who) facts.push(["Who", who]);
    if (added) facts.push(["Added", by ? `${by}, ${fmtAuWeekdayDayMonth(added)}` : fmtAuWeekdayDayMonth(added)]);
    out.push({
      id: `ev:${r.id}`,
      cat: "event",
      start: s,
      end: e,
      title,
      /* A shutdown closes the day; it has no hours (the table refuses them). */
      time: shutdown ? null : wallClock(r.startsAt),
      timeEnd: shutdown ? null : wallClock(r.endsAt),
      sub: [sentence(where), note].filter(Boolean).join(" ") || null,
      description: note,
      facts,
      action: "edit",
      shutdown,
      seriesId: r.seriesId ?? null,
      repeat: r.seriesId ? r.repeat ?? null : null,
    });
  }
  return out;
}

/** The noticeboard's events, read-only here: they are posted, answered and
    changed on the board, so the action goes there. */
export function noticeItems(rows: readonly NoticeEventRow[]): CalItem[] {
  const out: CalItem[] = [];
  for (const r of rows) {
    const d = dayOf(r.date);
    const title = clean(r.title);
    if (!d || !title) continue;
    const where = clean(r.location);
    const facts: [string, string][] = [];
    if (where) facts.push(["Where", where]);
    facts.push(["From", "Notices"]);
    out.push({
      id: `nt:${r.id}`,
      cat: "event",
      start: d,
      end: d,
      title,
      time: wallClock(r.time),
      sub: sentence(where),
      facts,
      action: { label: "Open notice", href: "/dashboard/notices" },
    });
  }
  return out;
}

/* ── admin: the fleet ── */

type Renewal = "rego" | "insurance" | "ctp";

/* What each date is called in a sentence and as a fact label. The green slip
   is CTP's name on every NSW form, and the chip's word for it. */
const RENEWAL_WORD = { rego: "rego", insurance: "insurance", ctp: "green slip" } as const satisfies Record<
  Renewal,
  string
>;
const RENEWAL_LABEL = { rego: "Rego", insurance: "Insurance", ctp: "Green slip" } as const satisfies Record<
  Renewal,
  string
>;
const RENEWAL_ORDER: readonly Renewal[] = ["rego", "insurance", "ctp"];

const expiryOf = (v: VehicleExpiryRow, k: Renewal): string | null =>
  k === "rego" ? v.regoExpiry : k === "insurance" ? v.insuranceExpiry : v.ctpExpiry;

/** A vehicle's three renewal dates, each its own item; a date nobody entered
    is no item. A sold vehicle has nothing to renew. A vehicle with no status
    at all is kept: that is the `neq` trap (a NULL is not "not sold" to SQL),
    which is why this filter is here and not in the query. */
export function vehicleItems(rows: readonly VehicleExpiryRow[], today: string, warnDays: number): CalItem[] {
  const out: CalItem[] = [];
  for (const v of rows) {
    if (v.status === "sold") continue;
    const name = clean(v.name);
    const plate = clean(v.plate);
    const known = name ?? plate ?? "Unnamed vehicle";
    const who = name && plate ? `${name}, ${plate}` : known;
    for (const k of RENEWAL_ORDER) {
      const due = expiryDue(dayOf(expiryOf(v, k)), today, warnDays);
      if (!due) continue;
      const overdue = due.state === "bad";
      const what = RENEWAL_WORD[k];
      out.push({
        id: `veh:${v.id}:${k}`,
        cat: "admin",
        start: due.due,
        end: due.due,
        title: `${who} ${what}`,
        monthTitle: `${known} ${what}`,
        /* The plate, when the title in the cell has not already said it. */
        monthMeta: name && plate ? plate : null,
        sub: overdue ? "Overdue. From Assets." : "From Assets.",
        description: `The ${what} on ${plate ?? known} ${overdue ? "ran out" : "runs out"} on ${fmtAuWeekdayDayMonth(due.due)}.`,
        facts: [
          ["Vehicle", who],
          [RENEWAL_LABEL[k], `${overdue ? "Ran out" : "Runs out"} ${fmtAuWeekdayDate(due.due)}`],
          ["From", "Assets"],
        ],
        /* The vehicle's own renewal screen (`?screen=` is the Assets door the
           list's pull request opens; until then this opens the vehicle). */
        action: {
          label: `Renew ${what}`,
          href: `/dashboard/assets?v=${encodeURIComponent(v.id)}&screen=${k}`,
        },
        overdue,
      });
    }
  }
  return out;
}

/* ── admin: the business's own papers ── */

/** The business's licences and cover, each on the day it runs out. Only ever
    handed the OWNER's read (the Organisation screen admits no one else);
    a card with no expiry is no item. */
export function credentialItems(cards: readonly OrgCredential[], today: string, warnDays: number): CalItem[] {
  const out: CalItem[] = [];
  for (const c of cards) {
    const due = expiryDue(dayOf(c.expiryDate), today, warnDays);
    const name = clean(c.name);
    if (!due || !name) continue;
    const overdue = due.state === "bad";
    const issuer = clean(c.issuer);
    const insurance = c.kind === "insurance";
    /* "Public liability" is the cover's name; the calendar's title says what
       kind of thing it is, unless the name already does. */
    const named = /\b(insurance|cover|policy)\b/i.test(name);
    const noun = insurance && !named ? `${lowerFirst(name)} cover` : lowerFirst(name);
    const on = fmtAuWeekdayDayMonth(due.due);
    const from = issuer ? ` ${insurance ? "with" : "from"} ${issuer}` : "";
    const facts: [string, string][] = [];
    if (issuer) facts.push([insurance ? "Insurer" : "Issuer", issuer]);
    facts.push([overdue ? "Ran out" : "Runs out", fmtAuWeekdayDate(due.due)]);
    facts.push(["From", "Admin"]);
    out.push({
      id: `cred:${c.id}`,
      cat: "admin",
      start: due.due,
      end: due.due,
      title: insurance && !named ? `${name} insurance` : name,
      monthTitle: name,
      sub: `${overdue ? "Overdue. " : ""}${issuer ? `${sentence(issuer)} ` : ""}From Admin.`,
      description: `Your ${noun}${from} ${overdue ? "ran out" : "runs out"} on ${on}.`,
      facts,
      action: { label: "Renew", href: "/dashboard/admin/organization?sec=credentials" },
      overdue,
    });
  }
  return out;
}

/* ── all of it ── */

export type CompanyRows = {
  holidays: readonly HolidayRow[];
  school: readonly SchoolHolidayRow[];
  events: readonly CalendarEventRow[];
  notices: readonly NoticeEventRow[];
  vehicles: readonly VehicleExpiryRow[];
  credentials: readonly OrgCredential[];
};

/** Every item, ready for the model. Admin past the window's end is dropped
    (no view reaches it); admin before its start is kept, because a rego
    that ran out in June is still late, and Due puts late first. */
export function companyItems(
  rows: CompanyRows,
  at: { today: string; windowEnd: string; warnDays: number; names?: ReadonlyMap<string, string> },
): CalItem[] {
  const admin = [
    ...vehicleItems(rows.vehicles, at.today, at.warnDays),
    ...credentialItems(rows.credentials, at.today, at.warnDays),
  ].filter((x) => x.start <= at.windowEnd);
  return [
    ...holidayItems(rows.holidays),
    ...schoolItems(rows.school),
    ...eventItems(rows.events, at.names),
    ...noticeItems(rows.notices),
    ...admin,
  ];
}
