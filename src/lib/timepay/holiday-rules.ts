/* Statutory public-holiday rules, per state/territory.

   Transcribed from the 2026 research pass (8 per-state dossiers, each re-checked
   by an adversarial verifier against the state's own Act and its official list).
   Where a verifier corrected the researcher, the correction won. This file is
   PAY-AFFECTING: nothing here is from memory, and where a source was silent or
   two sources disagreed the day was left OUT and recorded as a watch item.

   Two tiers, and the boundary is load-bearing:
   - `certain`  — computable forever: fixed dates, weekday-of-month formulas,
     Easter offsets, and each state's statutory weekend rules. Plus the gazetted
     one-offs table: announced non-formulaic days, enumerated as facts, never
     extrapolated to another year. Only these are ever written automatically.
   - `provisional` — proclamation-dependent (WA King's Birthday, VIC Grand Final
     Friday, the Anzac weekend declarations). Never auto-written; surfaced in the
     manager as confirm-first suggestions an admin accepts into `manual`.

   THE WEEKEND RULE IS PER HOLIDAY, NOT PER STATE. Every jurisdiction here runs
   at least two mechanics side by side: some days ADD (the weekend date stays a
   holiday and a weekday is granted on top), some TRANSFER (the weekend date
   stops being a holiday), and some do NEITHER. NSW alone has all three. A single
   shared "bump weekends to Monday" helper would misstate pay in every state, so
   the style is encoded on the rule, never on the state.

   Scope: STATEWIDE FULL DAYS ONLY. Part-day holidays (NT and SA 7pm–midnight
   Christmas Eve / New Year's Eve, QLD 6pm–midnight Christmas Eve), regional and
   show days, and bank-only holidays are excluded — each noted where its state's
   rules live. They are real and some are pay-affecting for evening shifts; they
   are simply not full statewide days and this calendar stores nothing else.

   Re-verification: the states publish only 1–2 years ahead. Re-check annually,
   and see the watch items at the foot of this file. */

export type RuleHoliday = { date: string; name: string };
export type ProvisionalHoliday = { name: string; usual: string };

export const RULE_STATES = ["NSW", "VIC", "QLD", "SA", "WA", "TAS", "NT", "ACT"] as const;

/** Easter Sunday for a year (Anonymous Gregorian computus), ISO date. */
export function easterSunday(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${year}-${pad(month)}-${pad(day)}`;
}

/* ---------------------------------------------------------------- calendar */

const SUN = 0;
const MON = 1;
const TUE = 2;
const SAT = 6;

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (year: number, month: number, day: number) => `${year}-${pad(month)}-${pad(day)}`;

/** Whole days since the epoch. UTC throughout, so no timezone or DST drift. */
function dayNum(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
}
function fromDayNum(n: number): string {
  const dt = new Date(n * 86_400_000);
  return iso(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}
const shift = (date: string, days: number) => fromDayNum(dayNum(date) + days);

/** 0 = Sunday … 6 = Saturday. (1970-01-01 was a Thursday.) */
const weekdayOf = (date: string) => (((dayNum(date) % 7) + 11) % 7);

/** The next `weekday` STRICTLY after `date` — "the following Monday". */
function nextWeekday(date: string, weekday: number): string {
  return shift(date, ((weekday - weekdayOf(date) + 7) % 7) || 7);
}
/** The nth `weekday` of a month — "the second Monday in June". */
function nthWeekday(year: number, month: number, weekday: number, n: number): string {
  const first = iso(year, month, 1);
  return shift(first, ((weekday - weekdayOf(first) + 7) % 7) + (n - 1) * 7);
}
/** That `weekday` on, or first following, a date — WA's "Monday on or first Monday following the 1st March". */
function weekdayOnOrAfter(year: number, month: number, day: number, weekday: number): string {
  const from = iso(year, month, day);
  return shift(from, (weekday - weekdayOf(from) + 7) % 7);
}

/* ------------------------------------------------------------- rule shapes */

type When =
  | { k: "fixed"; month: number; day: number }
  | { k: "nth"; month: number; weekday: number; n: number }
  | { k: "onOrAfter"; month: number; day: number; weekday: number }
  | { k: "easter"; delta: number };

/** What a weekend landing produces. `next` = that weekday after the base date;
    `on` = a fixed calendar date (QLD legislates the dates themselves); `free` =
    the next weekday not already taken (NSW's "the following Monday or Tuesday"). */
type Extra = { next?: number; on?: [number, number]; free?: true; name?: string };

/** Keyed by the weekday the BASE date falls on (6 Sat, 0 Sun, 1 Mon). `add`
    keeps the base date as a holiday too; `transfer` replaces it. */
type Weekend = { style: "add" | "transfer"; on: Record<number, Extra> };

type Rule = { name: string; when: When; weekend?: Weekend };

const fixed = (month: number, day: number): When => ({ k: "fixed", month, day });
const nth = (month: number, weekday: number, n: number): When => ({ k: "nth", month, weekday, n });
const onOrAfter = (month: number, day: number, weekday: number): When => ({ k: "onOrAfter", month, day, weekday });
const easter = (delta: number): When => ({ k: "easter", delta });

/** Sat or Sun → an ADDITIONAL following Monday. */
const addMon = (name: string): Weekend => ({ style: "add", on: { [SAT]: { next: MON, name }, [SUN]: { next: MON, name } } });
/** Sat → additional Monday; Sun → additional Tuesday (Monday is already Boxing Day). */
const addMonTue = (name: string): Weekend => ({ style: "add", on: { [SAT]: { next: MON, name }, [SUN]: { next: TUE, name } } });
/** Sat → additional Monday; Sun OR Mon → additional Tuesday. */
const addMonTueTue = (satName: string, tueName: string): Weekend => ({
  style: "add",
  on: { [SAT]: { next: MON, name: satName }, [SUN]: { next: TUE, name: tueName }, [MON]: { next: TUE, name: tueName } },
});
/** Sat or Sun → an ADDITIONAL day on the next weekday not already a holiday. */
const addFree = (name: string): Weekend => ({ style: "add", on: { [SAT]: { free: true, name }, [SUN]: { free: true, name } } });
/** Sat or Sun → the following Monday INSTEAD; the weekend date is not a holiday. */
const moveMon = (): Weekend => ({ style: "transfer", on: { [SAT]: { next: MON }, [SUN]: { next: MON } } });
/** Sun only → the following Monday INSTEAD. A Saturday landing stands. */
const moveSunOnly = (): Weekend => ({ style: "transfer", on: { [SUN]: { next: MON } } });
/** Sat → Monday INSTEAD; Sun → Tuesday INSTEAD. */
const moveMonTue = (): Weekend => ({ style: "transfer", on: { [SAT]: { next: MON }, [SUN]: { next: TUE } } });

/* ------------------------------------------------------------------ states */

/* NSW — Public Holidays Act 2010. nsw.gov.au/about-nsw/public-holidays and the
   NSW Industrial Relations "Guide to Public Holidays" PDF supply the wording.
   Names here match the 25 rows already seeded in prod from nsw.gov.au.
   THREE mechanics in one state: NYD/Christmas/Boxing ADD, Australia Day
   TRANSFERS, Anzac Day does neither. Conflating them is the likeliest pay bug. */
const NSW: Rule[] = [
  // "When New Year's Day, Christmas Day or Boxing Day fall on a Saturday or Sunday, there is to be
  // an additional public holiday on the following Monday or Tuesday" — nsw.gov.au Guide PDF.
  { name: "New Year's Day", when: fixed(1, 1), weekend: addFree("New Year's Day (additional day)") },
  // "Where Australia Day falls on a weekend, there is no public holiday on that day and instead the
  // following Monday is the public holiday" — Guide PDF. Next engaged 26 Jan 2030 (Sat).
  { name: "Australia Day", when: fixed(1, 26), weekend: moveMon() },
  { name: "Good Friday", when: easter(-2) }, // nsw.gov.au — NSW observes all four Easter days
  { name: "Easter Saturday", when: easter(-1) }, // nsw.gov.au
  { name: "Easter Sunday", when: easter(0) }, // nsw.gov.au — a full NSW holiday, unlike TAS
  { name: "Easter Monday", when: easter(1) }, // nsw.gov.au
  // "Anzac Day is always observed on the 25th April regardless of the day of the week" — Guide PDF.
  // No transfer and no standing substitute. The 2026/27 Anzac Mondays are gazetted one-offs below.
  { name: "Anzac Day", when: fixed(4, 25) },
  { name: "King's Birthday", when: nth(6, MON, 2) }, // nsw.gov.au — 8 Jun 2026, 14 Jun 2027
  { name: "Labour Day", when: nth(10, MON, 1) }, // nsw.gov.au — 5 Oct 2026, 4 Oct 2027
  { name: "Christmas Day", when: fixed(12, 25), weekend: addFree("Christmas Day (additional day)") },
  // The additional days cascade: 25 Dec Sat 2027 takes Mon 27, so Boxing Day's lands on Tue 28 —
  // four December holidays. Hence "next weekday not already a holiday", not a fixed +2.
  { name: "Boxing Day", when: fixed(12, 26), weekend: addFree("Boxing Day (additional day)") },
  // EXCLUDED — Bank Holiday, first Monday in August: "The Bank Holiday is not a declared public
  // holiday" (nsw.gov.au); binds retail bank branches only and Fair Work omits it. Would overpay.
  // EXCLUDED — Local Public Holidays and Local Event Days: ministerial order, area-specific, and
  // the guide states Local Event Days "are not a public holiday for work purposes".
];

/* VIC — Public Holidays Act 1993 (authorised v027), business.vic.gov.au lists.
   s6(a)+(b), (k)+(ka), (l)+(m) are separate appointing paragraphs = ADD;
   s6(c) is one paragraph joined by "or" = TRANSFER. */
const VIC: Rule[] = [
  { name: "New Year's Day", when: fixed(1, 1), weekend: addMon("New Year's Day (additional public holiday)") }, // s6(a)+(b)
  { name: "Australia Day", when: fixed(1, 26), weekend: moveMon() }, // s6(c) "or" = transfer
  { name: "Labour Day", when: nth(3, MON, 2) }, // s6(d) second Monday in March — VIC-specific
  { name: "Good Friday", when: easter(-2) }, // s6(e)
  { name: "Saturday before Easter Sunday", when: easter(-1) }, // s6(f) — statutory name, not "Easter Saturday"
  { name: "Easter Sunday", when: easter(0) }, // s6(fa), inserted by No. 29/2019
  { name: "Easter Monday", when: easter(1) }, // s6(g)
  // s6(h) is bare "25 April (ANZAC Day)" with no weekend provision: nothing is added or moved for
  // a Saturday (2026) or Sunday (2027) Anzac Day. Business Victoria and Fair Work both confirm.
  { name: "ANZAC Day", when: fixed(4, 25) },
  { name: "King's Birthday", when: nth(6, MON, 2) }, // s6(i)
  // s6(j) first Tuesday in November. Statewide by default; s8A lets a NON-METROPOLITAN council
  // swap it for a local day, which this statewide calendar cannot model — flag for regional staff.
  { name: "Melbourne Cup", when: nth(11, TUE, 1) },
  { name: "Christmas Day", when: fixed(12, 25), weekend: addMonTue("Christmas Day (additional public holiday)") }, // s6(k)+(ka)
  { name: "Boxing Day", when: fixed(12, 26), weekend: addMonTue("Boxing Day (additional public holiday)") }, // s6(l)+(m)
  // EXCLUDED — Friday before the AFL Grand Final (s6(ia)): a statutory holiday, but its DATE
  // follows the AFL fixture. Provisional below; the gazetted 2026 date is a one-off. The official
  // vic.gov.au iCal lists 2027-09-25 and 2028-09-30 for it — both SATURDAYS, so both are wrong.
  // EXCLUDED — s7(1)(a) ministerial gazette days/half-days: none gazetted for 2026–2028.
];

/* QLD — Holidays Act 1983, qld.gov.au/recreation/travel/holidays/public.
   Australia Day and Anzac Day TRANSFER; New Year/Christmas/Boxing ADD, and the
   Act names the added dates outright ("27 December only if 25 December is a
   Saturday or Sunday"), so they are fixed dates rather than offsets. */
const QLD: Rule[] = [
  {
    name: "New Year's Day",
    when: fixed(1, 1),
    // "2 January only if 1 January is a Sunday"; "3 January only if 1 January is a Saturday".
    weekend: {
      style: "add",
      on: {
        [SAT]: { on: [1, 3], name: "Additional New Year's public holiday (3 January)" },
        [SUN]: { on: [1, 2], name: "Additional New Year's public holiday (2 January)" },
      },
    },
  },
  { name: "Australia Day", when: fixed(1, 26), weekend: moveMon() }, // "or if 26 January is a Saturday or Sunday — the following Monday"
  { name: "Good Friday", when: easter(-2) },
  { name: "The day after Good Friday (Easter Saturday)", when: easter(-1) },
  { name: "Easter Sunday", when: easter(0) }, // "the Sunday following Good Friday" — QLD observes all four
  { name: "Easter Monday", when: easter(1) },
  // "on 25 April, or if 25 April is a Sunday — the following Monday". SATURDAY GETS NOTHING:
  // Sat 25 Apr 2026 is the holiday and Mon 27 Apr 2026 is an ordinary working day. The Sunday case
  // is a pure transfer — Sun 25 Apr 2027 is NOT a holiday, only Mon 26 Apr is.
  { name: "Anzac Day", when: fixed(4, 25), weekend: moveSunOnly() },
  { name: "Labour Day", when: nth(5, MON, 1) }, // first Monday in MAY (May since 2016; Oct 2013–15)
  { name: "King's Birthday", when: nth(10, MON, 1) }, // first Monday in OCTOBER — QLD has no June one
  {
    name: "Christmas Day",
    when: fixed(12, 25),
    // "27 December only if 25 December is a Saturday or Sunday"
    weekend: {
      style: "add",
      on: {
        [SAT]: { on: [12, 27], name: "Additional Christmas Day public holiday (27 December)" },
        [SUN]: { on: [12, 27], name: "Additional Christmas Day public holiday (27 December)" },
      },
    },
  },
  {
    name: "Boxing Day",
    when: fixed(12, 26),
    // "28 December only if 26 December is a Saturday or Sunday"
    weekend: {
      style: "add",
      on: {
        [SAT]: { on: [12, 28], name: "Additional Boxing Day public holiday (28 December)" },
        [SUN]: { on: [12, 28], name: "Additional Boxing Day public holiday (28 December)" },
      },
    },
  },
  // EXCLUDED — Christmas Eve, 24 Dec 6pm–midnight: statewide but a PART day (still pay-affecting
  // for evening shifts; this calendar stores full days only).
  // EXCLUDED — Royal Queensland Show (Ekka): Brisbane local government area only, and appointed
  // annually by the Minister rather than fixed in the Act. Other district show days likewise.
  // EXCLUDED — "special holidays": qld.gov.au states they are bank holidays and NOT public
  // holidays, so they carry no entitlement at all.
];

/* SA — Public Holidays Act 2023 (commenced 1 Jan 2024), safework.sa.gov.au.
   Three behaviours: Christmas/NYD/Proclamation ADD, Australia Day TRANSFERS,
   ANZAC Day gets neither. Pre-2024 SA logic is wrong on all three. */
const SA: Rule[] = [
  // s3(2) "If Christmas Day or New Year's Day falls on a Saturday or a Sunday, the following
  // Monday will be a public holiday in addition to that day."
  { name: "New Year's Day", when: fixed(1, 1), weekend: addMon("Additional public holiday for New Year's Day") },
  { name: "Australia Day", when: fixed(1, 26), weekend: moveMon() }, // s3(4) "instead of that day"
  { name: "Adelaide Cup Day", when: nth(3, MON, 2) }, // s3(1)(c) — FIXED in statute since 2024, no longer proclaimed
  { name: "Good Friday", when: easter(-2) }, // s3(1)(d)
  { name: "Easter Saturday", when: easter(-1) }, // s3(1)(e) "the day after Good Friday"
  { name: "Easter Sunday", when: easter(0) }, // s3(1)(f) — an SA holiday only since 1 Jan 2024
  { name: "Easter Monday", when: easter(1) }, // s3(1)(g)
  // No weekend provision anywhere in the Act for ANZAC Day. SafeWork SA: "There is no substitute or
  // additional public holiday when 25 April falls on a Saturday or Sunday."
  { name: "ANZAC Day", when: fixed(4, 25) },
  { name: "King's Birthday", when: nth(6, MON, 2) }, // s3(1)(i), statutory name "the Sovereign's Birthday"
  { name: "Labour Day", when: nth(10, MON, 1) }, // s3(1)(j) first Monday in October
  { name: "Christmas Day", when: fixed(12, 25), weekend: addMon("Additional public holiday for Christmas Day") }, // s3(2)
  // s3(3): "(a) where it falls on a Saturday, the following Monday ... in addition to that day;
  // (b) where it falls on a Sunday or a Monday, the following Tuesday ... in addition to that day."
  // SA has no separate statutory Boxing Day — 26 December is the Proclamation Day holiday.
  {
    name: "Proclamation Day holiday",
    when: fixed(12, 26),
    weekend: addMonTueTue(
      "Additional public holiday for Proclamation Day holiday",
      "Additional public holiday for Proclamation Day holiday",
    ),
  },
  // EXCLUDED — Christmas Eve and New Year's Eve part-days, 7pm–midnight (s4). Current law and
  // genuinely pay-affecting in that window, but not full days.
  // EXCLUDED — s3(5) substitution and s5 additional-day proclamations: not computable; none on
  // foot for 2026–2028. SA has no standing regional-only holidays at all.
  // WATCH — 25 Dec falling on a SUNDAY (next 2033): s3(2) as enacted gives "the following Monday",
  // which is already the Proclamation Day holiday, so nothing extra is emitted for Christmas and
  // s3(3)(b) supplies Tuesday 27 Dec. The dossier's prose instead described a four-day 25–28 block
  // for that case, contradicting the statutory text it quoted. We follow the Act verbatim and
  // deliberately do NOT invent a fourth day. Re-verify against SafeWork SA before December 2033.
];

/* WA — Public and Bank Holidays Act 1972, Second Schedule; wa.gov.au + the
   Wageline "Public holidays in Western Australia 2026 to 2027" PDF.
   "When New Year's Day, Anzac Day, or Christmas Day falls on a Saturday or
   Sunday the next following Monday is ALSO a public holiday" — "also" is
   load-bearing. Australia Day is the one WA day that moves instead. */
const WA: Rule[] = [
  { name: "New Year's Day", when: fixed(1, 1), weekend: addMon("Additional public holiday for New Year's Day") },
  // "Australia Day (26th January or, when that day falls on a Saturday or Sunday, the first Monday
  // following the 26th January)" — the Monday INSTEAD OF the 26th.
  { name: "Australia Day", when: fixed(1, 26), weekend: moveMon() },
  { name: "Labour Day", when: onOrAfter(3, 1, MON) }, // "Monday on or first Monday following the 1st March"
  { name: "Good Friday", when: easter(-2) },
  // WA gazettes Easter Sunday and s3(3) forbids substituting another day for it. WA does NOT
  // observe Easter Saturday — a source that lists one for WA is wrong (it may be pre-empting the
  // 2025 Bill). WA therefore has three Easter days, not four.
  { name: "Easter Sunday", when: easter(0) },
  { name: "Easter Monday", when: easter(1) },
  // Anzac Day ADDS: Sat 25 Apr 2026 stays a holiday AND Mon 27 Apr 2026 is one too
  // ("Anzac Day: Saturday 25 April & Monday 27 April" on the official Wageline table).
  { name: "Anzac Day", when: fixed(4, 25), weekend: addMon("Additional public holiday for Anzac Day") },
  { name: "Western Australia Day", when: onOrAfter(6, 1, MON) }, // "Monday on or first Monday following the 1st June"
  { name: "Christmas Day", when: fixed(12, 25), weekend: addMon("Additional public holiday for Christmas Day") },
  // Boxing Day has its own two clauses: Saturday → also the next Monday; Sunday OR MONDAY → also
  // the next Tuesday. The Monday branch exists because a Sunday Christmas pushes its own Monday
  // onto Boxing Day (next in 2033).
  {
    name: "Boxing Day",
    when: fixed(12, 26),
    weekend: addMonTueTue("Additional public holiday for Boxing Day", "Additional public holiday for Boxing Day"),
  },
  // EXCLUDED — King's Birthday: "day to be appointed for each year by proclamation published in the
  // Government Gazette at least 3 weeks before". No formula exists. Provisional below, with the
  // published 2026 and 2027 dates carried as gazetted one-offs.
  // EXCLUDED — regional King's Birthday alternatives (City of Karratha and Town of Port Hedland
  // observed Mon 3 Aug 2026 instead of 28 Sep): district proclamations under s8.
  // EXCLUDED — s7(1) special days and half-holidays: WA has no standing part-day holiday, and s6's
  // "Saturday shall be a bank holiday" is a BANK holiday only, irrelevant to pay.
  // WATCH — the Public and Bank Holidays Amendment Bill 2025 would, FROM 2028, move Labour Day to
  // the second Monday in March, WA Day to the second Monday in November, the King's Birthday to the
  // second Monday in June, and recognise Easter Saturday. As at July 2026 it had passed the
  // Assembly (23 Oct 2025) but sat at Legislative Council second reading — NOT law, so the rules
  // above are current law and 2028+ WA output must be re-checked after the Council vote.
];

/* TAS — Statutory Holidays Act 2000. legislation.tas.gov.au + WorkSafe Tasmania.
   Christmas ADDS; New Year's Day, Australia Day and Boxing Day TRANSFER; Anzac
   Day does neither. Tasmania observes neither Easter Saturday nor Easter Sunday. */
const TAS: Rule[] = [
  // s4(a) "New Year's Day (1 January), unless that day falls on a Saturday or Sunday, in which case
  // the Monday following" — "unless" = transfer, the weekend date stops being a holiday.
  { name: "New Year's Day", when: fixed(1, 1), weekend: moveMon() },
  { name: "Australia Day", when: fixed(1, 26), weekend: moveMon() }, // s4(b), same "unless" wording
  { name: "Eight Hours Day", when: nth(3, MON, 2) }, // s4(c) second Monday in March — TAS's Labour Day
  { name: "Good Friday", when: easter(-2) }, // s4(d)
  { name: "Easter Monday", when: easter(1) }, // s4(e)
  // s4(g) is bare "Anzac Day (25 April)" with none of the "unless"/"following Monday" machinery the
  // other paragraphs carry. WorkSafe TAS: "When Anzac Day falls on Saturday or Sunday, no substitute
  // or additional holiday is observed."
  { name: "Anzac Day", when: fixed(4, 25) },
  { name: "King's Birthday", when: nth(6, MON, 2) }, // s4(h) "the second Monday in June"
  // s4(i) makes 25 Dec a holiday unconditionally; s4(ia)/(ib) ADD the Monday (Sat) or Tuesday (Sun).
  { name: "Christmas Day", when: fixed(12, 25), weekend: addMonTue("Additional public holiday for Christmas Day") },
  // s4(j) Boxing Day TRANSFERS: Sat → the Monday following, Sun → the Tuesday following, and the
  // weekend date is NOT a holiday. Asymmetric with Christmas Day in the same Act.
  { name: "Boxing Day", when: fixed(12, 26), weekend: moveMonTue() },
  // EXCLUDED — Easter Tuesday: s6 confines it to Tasmanian State Service / non-national-system
  // employees ("generally Tasmanian Public Service only"), so it is not a general holiday even
  // though both official pages print it inside the statewide table.
  // EXCLUDED — every Schedule 1 regional day (Royal Hobart Regatta, King Island Show, Agfest,
  // Burnie Show, Royal Launceston Show, Flinders Island Show, Royal Hobart Show, Recreation Day,
  // Devonport Show): each applies only to named municipal areas. Recreation Day and the Regatta are
  // complementary, so no single date covers all of Tasmania.
  // EXCLUDED — Schedule 2 government holidays (Devonport Cup half day from 11am, Launceston Cup):
  // regional AND restricted to the same State Service class.
  // TAS has no statewide part-day holiday and no live proclamation power — a one-off statewide day
  // needs an amending Act (as in 2022 for the National Day of Mourning). Monitor legislation.
];

/* NT — Public Holidays Act 1981, Schedule 2. nt.gov.au/nt-public-holidays.
   Schedule 2 uses "and" for New Year/Christmas/Boxing (ADD) and "or" for
   Australia Day and Anzac Day (TRANSFER). */
const NT: Rule[] = [
  // "1 January (New Year's Day) and, if that day falls on a Saturday or Sunday, the following Monday"
  { name: "New Year's Day", when: fixed(1, 1), weekend: addMon("Additional public holiday for New Year's Day") },
  { name: "Australia Day", when: fixed(1, 26), weekend: moveMon() }, // "or, if that day falls on a Saturday or a Sunday, the following Monday"
  { name: "Good Friday", when: easter(-2) },
  { name: "Easter Saturday", when: easter(-1) }, // "The Saturday following Good Friday"
  { name: "Easter Sunday", when: easter(0) }, // "The Sunday following Good Friday" — NT observes all four
  { name: "Easter Monday", when: easter(1) },
  // "25 April (Anzac Day) or, if that day falls on a Sunday, the following Monday". A SATURDAY gets
  // nothing (Sat 25 Apr 2026 is the holiday, no Monday); a Sunday transfers wholly (Sun 25 Apr 2027
  // is NOT a holiday, only Mon 26 Apr).
  { name: "Anzac Day", when: fixed(4, 25), weekend: moveSunOnly() },
  { name: "May Day", when: nth(5, MON, 1) }, // "The first Monday in May (May Day)"
  { name: "King's Birthday", when: nth(6, MON, 2) }, // "The second Monday in June" — fixed by statute, not proclaimed
  { name: "Picnic Day", when: nth(8, MON, 1) }, // "The first Monday in August (Picnic Day)"
  { name: "Christmas Day", when: fixed(12, 25), weekend: addMon("Additional public holiday for Christmas Day") },
  // "26 December (Boxing Day) and: (a) if that day falls on a Saturday – the following Monday; or
  // (b) if that day falls on a Sunday or Monday – the following Tuesday". nt.gov.au names the
  // Saturday branch's extra day "Boxing Day Monday"; Fair Work names both branches "Additional
  // public holiday for Boxing Day". Both are official labels for the same day.
  { name: "Boxing Day", when: fixed(12, 26), weekend: addMonTueTue("Boxing Day Monday", "Additional public holiday for Boxing Day") },
  // EXCLUDED — Christmas Eve and New Year's Eve, 7pm–midnight part-days. No weekend rule attaches
  // to them; they simply are not full days.
  // EXCLUDED — the five show days (Alice Springs, Tennant Creek, Katherine, Darwin, Borroloola):
  // regional, and appointed annually by Gazette notice under s6, so not computable either.
  // EXCLUDED — s6/s7 gazetted additions and cancellations (28 days' notice, or less under s10 for a
  // nationally agreed day). Territory Day, 1 July, is NOT a public holiday despite the name.
];

/* ACT — Holidays Act 1958 (R11). act.gov.au official per-year PDFs.
   "and" vs "or" inside s3(1)(a) decides it: New Year/Christmas/Boxing ADD;
   Australia Day and Anzac Day TRANSFER. */
const ACT: Rule[] = [
  // s3(1)(a)(i) "1 January (New Year's day), AND, if that day falls on a Saturday or Sunday, the
  // following Monday" — confirmed by the official 2028 list showing both 1 Jan and Mon 3 Jan.
  { name: "New Year's Day", when: fixed(1, 1), weekend: addMon("New Year's Day — additional public holiday") },
  { name: "Australia Day", when: fixed(1, 26), weekend: moveMon() }, // s3(1)(a)(ii), "or" = transfer
  { name: "Canberra Day", when: nth(3, MON, 2) }, // 2nd Monday in March — ACT only
  { name: "Good Friday", when: easter(-2) },
  { name: "Easter Saturday (the day after Good Friday)", when: easter(-1) }, // s3(1)(a)(v), a holiday in its own right
  { name: "Easter Sunday", when: easter(0) }, // s3(1)(a)(vi)
  { name: "Easter Monday", when: easter(1) }, // s3(1)(a)(vii)
  // s3(1)(a)(viii) "25 April (Anzac Day), OR, if that day falls on a SUNDAY, the following Monday".
  // A Saturday gets nothing from the Act — Mon 27 Apr 2026 exists only because of a ministerial
  // declaration (NI2026-154), carried as a one-off below, never as a rule.
  { name: "Anzac Day", when: fixed(4, 25), weekend: moveSunOnly() },
  { name: "Reconciliation Day", when: onOrAfter(5, 27, MON) }, // 27 May, or the following Monday — always a Monday
  { name: "King's Birthday", when: nth(6, MON, 2) },
  { name: "Labour Day", when: nth(10, MON, 1) }, // first Monday in October
  // s3(1)(a)(xii)/(xiii): 25/26 December "AND — (A) if that day falls on a Saturday — the following
  // Monday; or (B) if that day falls on a Sunday — the following Tuesday".
  { name: "Christmas Day", when: fixed(12, 25), weekend: addMonTue("Christmas Day — additional public holiday") },
  { name: "Boxing Day", when: fixed(12, 26), weekend: addMonTue("Boxing Day — additional public holiday") },
  // EXCLUDED — the first Monday in August bank holiday (s4(1)(b)): not a public holiday, and the
  // official ACT PDFs warn it "do[es] not apply to everyone".
  // EXCLUDED — s3(1)(b) ministerial declarations and s3(2) cancellations. The ACT is the one
  // jurisdiction that can STRIP a listed holiday with a week's notice (NI2025-650 briefly did that
  // to Saturday 25 April 2026 before being revoked), so re-poll the ACT register at least annually.
  // ACT has no part-day and no regional-only holidays.
];

const CERTAIN: Record<string, Rule[]> = { NSW, VIC, QLD, SA, WA, TAS, NT, ACT };

/* ------------------------------------------------------- gazetted one-offs */

/* Announced days that no formula produces. Each is an ENUMERATED FACT for the
   stated year with its instrument cited — never extrapolated to another year.
   A year missing from this table gets nothing, which is the safe direction. */
const ONE_OFFS: { state: string; date: string; name: string }[] = [
  // NSW — additional Monday after a weekend Anzac Day, announced 15 Feb 2026 for 2026 AND 2027
  // only, as a trial feeding a public-holidays review commencing 2027. "The additional holiday on
  // Monday does not replace Anzac Day" — 25 April stays a holiday as well.
  // nsw.gov.au/ministerial-releases/minns-labor-government-announces-extra-public-holiday-year
  { state: "NSW", date: "2026-04-27", name: "Additional public holiday for Anzac Day" },
  { state: "NSW", date: "2027-04-26", name: "Additional public holiday for Anzac Day" },
  // ACT — NI2026-154 (notified 25 Mar 2026) declares Mon 27 Apr 2026 an ADDITIONAL public holiday
  // and revokes NI2025-650, which had instead stripped Saturday 25 Apr 2026 of holiday status.
  // legislation.act.gov.au/ni/2026-154/ . No such declaration exists for 2027 or 2028.
  { state: "ACT", date: "2026-04-27", name: "Anzac Day — additional public holiday" },
  // VIC — s6(ia) holiday whose date follows the AFL fixture. 2026 is settled and published
  // (business.vic.gov.au 2026 list, the official vic.gov.au iCal and Fair Work all agree);
  // Business Victoria still says "Subject to AFL schedule" for 2027 and 2028.
  { state: "VIC", date: "2026-09-25", name: "Friday before the AFL Grand Final" },
  // WA — the King's Birthday is proclaimed year by year. These two dates are published on the
  // wa.gov.au public-holidays service page and the Wageline 2026–2027 PDF; wa.gov.au states the
  // 2028 dates "will be published when confirmed", so 2028 is deliberately absent.
  { state: "WA", date: "2026-09-28", name: "King's Birthday" },
  { state: "WA", date: "2027-09-27", name: "King's Birthday" },
];

/* --------------------------------------------------------- provisional tier */

type ProvRule = ProvisionalHoliday & { years?: (year: number) => boolean };

/** 25 April falls on a Saturday or Sunday. */
const anzacOnWeekend = (year: number) => {
  const wd = weekdayOf(iso(year, 4, 25));
  return wd === SAT || wd === SUN;
};

const PROVISIONAL: Record<string, ProvRule[]> = {
  NSW: [
    {
      name: "Additional public holiday for Anzac Day",
      usual: "The Monday after a weekend Anzac Day — gazetted year by year. NSW ran it as a trial for 2026 and 2027 only, pending a review; check the ministerial release before assuming it recurs.",
      years: anzacOnWeekend,
    },
  ],
  VIC: [
    {
      name: "Friday before the AFL Grand Final",
      usual: "Usually the last Friday in September — the date follows the AFL fixture, published by Business Victoria once the season is set.",
    },
  ],
  WA: [
    {
      name: "King's Birthday",
      usual: "A Monday in late September or early October — proclaimed each year in the Government Gazette at least 3 weeks ahead.",
    },
  ],
  ACT: [
    {
      name: "Anzac Day — additional public holiday",
      usual: "The Monday after a SATURDAY Anzac Day — the Act provides nothing, so it needs a ministerial declaration (NI2026-154 made one for 2026). A Sunday Anzac Day transfers automatically instead.",
      years: (year) => weekdayOf(iso(year, 4, 25)) === SAT,
    },
  ],
  // QLD, SA, TAS and NT have NO statewide proclamation-dependent day: their whole statewide list
  // is computable. Their gazette/proclamation powers are generic ("the Minister may appoint a
  // day"), which is not a suggestion an admin can look up, and their show days are regional.
};

/* ------------------------------------------------------------- generation */

function resolve(when: When, year: number): string {
  switch (when.k) {
    case "fixed":
      return iso(year, when.month, when.day);
    case "nth":
      return nthWeekday(year, when.month, when.weekday, when.n);
    case "onOrAfter":
      return weekdayOnOrAfter(year, when.month, when.day, when.weekday);
    case "easter":
      return shift(easterSunday(year), when.delta);
  }
}

/** The next Mon–Fri after `date` that isn't already a holiday — NSW's cascade. */
function nextFreeWeekday(date: string, taken: Set<string>): string {
  let d = shift(date, 1);
  for (let guard = 0; guard < 14; guard++) {
    const wd = weekdayOf(d);
    if (wd !== SAT && wd !== SUN && !taken.has(d)) return d;
    d = shift(d, 1);
  }
  return d;
}

/** Every auto-writable holiday for a state and year: the statutory rules plus
    any gazetted one-off recorded for exactly that state and year. Sorted by
    date; a date can only appear once (an extra day that lands on a day already
    held — a Sunday Christmas in SA/WA/NT — adds nothing rather than doubling). */
export function certainHolidays(state: string, year: number): RuleHoliday[] {
  const rules = CERTAIN[state];
  if (!rules) return [];

  const out: RuleHoliday[] = [];
  const taken = new Set<string>();
  const push = (date: string, name: string) => {
    if (taken.has(date)) return;
    taken.add(date);
    out.push({ date, name });
  };

  for (const rule of rules) {
    const base = resolve(rule.when, year);
    const branch = rule.weekend?.on[weekdayOf(base)];
    if (!branch) {
      push(base, rule.name);
      continue;
    }
    const extra = branch.free
      ? nextFreeWeekday(base, taken)
      : branch.on
        ? iso(year, branch.on[0], branch.on[1])
        : nextWeekday(base, branch.next as number);
    if (rule.weekend?.style === "add") push(base, rule.name);
    push(extra, branch.name ?? rule.name);
  }

  for (const o of ONE_OFFS) {
    if (o.state === state && Number(o.date.slice(0, 4)) === year) push(o.date, o.name);
  }

  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** Proclamation-dependent days an admin should confirm from the gazette. A day
    whose date for this year IS already gazetted drops out — it is in the certain
    tier via the one-offs table, so there is nothing left to confirm. */
export function provisionalHolidays(state: string, year: number): ProvisionalHoliday[] {
  const rules = PROVISIONAL[state];
  if (!rules) return [];
  return rules
    .filter((r) => (r.years ? r.years(year) : true))
    .filter(
      (r) =>
        !ONE_OFFS.some(
          (o) => o.state === state && o.name === r.name && Number(o.date.slice(0, 4)) === year,
        ),
    )
    .map(({ name, usual }) => ({ name, usual }));
}
