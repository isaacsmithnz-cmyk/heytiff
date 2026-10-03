import type { VisitStage } from "./buildup";

/* LABOUR IS READ FROM THE BRIEF, NEVER MADE UP (Isaac, 2026-10-04: "any job
   should not recommend labour without data… number one source is the
   brief"). The office writes the labour into the job's own words, a dozen
   ways:

     "3 x pax for 1 day"          "Allowance 3 HRS x 1 PAX"
     "1 Pax - 8hrs"               "2 PAX - Full Day (8 hours)"
     "Allow 4 x trades men for the day"
     "Labour: 2 PAX Trade + TA for 1 day"
     "8hrs x 2men"                "3 x men x 2 days"
     "5 days for 3 x PAX"         "Dave for 4 hrs for patching following day"
     "4 guys x 3 days, plus two half day return trips"

   Each clause is read on its own and counts only when it says BOTH who and
   how long — a crew with no time, or a time with nobody, is left unread
   rather than guessed at. A patch-up, a following day or a return trip is
   a Return visit.

   A DAY IS THE BUSINESS'S OWN (Isaac, 2026-10-04: "there are to be no made
   up figures. Everything has to come from the orgs own settings"): its
   working hours, from its Rate Calculator. A clause is kept as it was said
   — days or hours — and turned into the other only by those hours; with
   none set, "3 pax for 1 day" is three person-days and no hours. Pure. */

/** A trip to site as the brief says it: in days, in hours, or both once
    the business's day turns one into the other. */
export type BriefVisit = { stage: VisitStage; people: number; days: number | null; hours: number | null };

export type BriefLabour = {
  visits: BriefVisit[];
  /** person-hours across every visit; null when one is in days and the
      business has no working day set */
  personHours: number | null;
  /** person-days, likewise */
  personDays: number | null;
  /** the clauses it was read from, as written */
  said: string[];
};

const NUMBER_WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, half: 0.5 };
const num = (w: string): number | null => {
  const n = Number(w);
  if (Number.isFinite(n)) return n;
  return NUMBER_WORDS[w.toLowerCase()] ?? null;
};

const NUM = String.raw`(\d+(?:\.\d+)?|a|an|one|two|three|four|five|six|half)`;
const PEOPLE = String.raw`(?:pax|people|persons?|guys|men|man|techs?|technicians?|tradesmen|trades?(?:\s*men)?|installers?)`;
const PEOPLE_COUNT = new RegExp(String.raw`(\d+(?:\.\d+)?)\s*(?:x|×)?\s*${PEOPLE}\b`, "i");
const TRADE_AND_TA = /\btrades?(?:man)?\s*\+\s*(?:ta|apprentice)\b/i;
const HOURS = /(\d+(?:\.\d+)?)\s*(?:hrs?|hours?)\b/i;
const DAYS = new RegExp(String.raw`\b${NUM}\s*(?:full\s+)?days?\b`, "i");
const FULL_DAY = /\b(?:full\s+day|for\s+the\s+day|the\s+day)\b/i;
const TRIPS = new RegExp(String.raw`\b${NUM}\s+half[-\s]?day\s+(?:return\s+)?(?:trips?|visits?|returns?)\b`, "i");
/* a person named for the work: "Dave for 4 hrs", "allow for Dave for 1 day" */
const NAMED = /\b([A-Z][a-z]+)\s+for\s+(?=\d|a\b|one\b|half\b|the\b)/;
const NOT_A_NAME = new Set(["Allow", "Also", "Supply", "Allowance", "Labour", "Plus", "Install", "Installation", "Return", "Stage", "Option"]);
const RETURNING = /\b(?:return|patch\w*|following\s+day|next\s+day|come\s+back|second\s+visit)\b/i;

/** The clauses of a brief: its lines, its sentences, and what "also" and
    "plus" join on. */
function clauses(text: string): string[] {
  return text
    .split(/\n|;|\.(?:\s|$)|,\s*(?=plus\b|also\b|and\b)|\bplus\b|\balso\b/i)
    .map((c) => c.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function peopleIn(c: string): number | null {
  const m = PEOPLE_COUNT.exec(c);
  if (m) return Number(m[1]);
  if (TRADE_AND_TA.test(c)) return 2;
  const n = NAMED.exec(c);
  if (n && !NOT_A_NAME.has(n[1]!)) return 1;
  return null;
}

type Time = { days: number } | { hours: number };

/** How long a clause says, as it says it. */
function timeIn(c: string): Time | null {
  const h = HOURS.exec(c);
  if (h) return { hours: Number(h[1]) };
  const d = DAYS.exec(c);
  if (d) {
    const n = num(d[1]!);
    return n == null ? null : { days: n };
  }
  if (FULL_DAY.test(c)) return { days: 1 };
  return null;
}

const round = (n: number) => Math.round(n * 100) / 100;

/** The labour a brief states, or null when it states none. `dayHours` is
    the business's working day, when it has set one. */
export function labourFromBrief(text: string | null | undefined, dayHours: number | null): BriefLabour | null {
  if (!text?.trim()) return null;
  const day = dayHours && dayHours > 0 ? dayHours : null;
  const visits: BriefVisit[] = [];
  const said: string[] = [];
  const visit = (stage: VisitStage, people: number, t: Time): BriefVisit =>
    "days" in t
      ? { stage, people, days: t.days, hours: day ? round(t.days * day) : null }
      : { stage, people, days: day ? round(t.hours / day) : null, hours: t.hours };
  for (const c of clauses(text)) {
    const stage = RETURNING.test(c) ? "Return" : "Install";
    /* "two half day return trips": a person each, half a day each */
    const trips = TRIPS.exec(c);
    if (trips) {
      const n = num(trips[1]!);
      if (n && n > 0) {
        for (let i = 0; i < n; i++) visits.push(visit("Return", 1, { days: 0.5 }));
        said.push(c);
      }
      /* the rest of the clause may hold the main crew: "4 guys x 3 days, plus two…" */
      const rest = c.replace(trips[0], " ");
      const p = peopleIn(rest);
      const t = timeIn(rest);
      if (p && t) visits.push(visit(RETURNING.test(rest) ? "Return" : "Install", p, t));
      if (p && t && !said.includes(c)) said.push(c);
      continue;
    }
    const people = peopleIn(c);
    const t = timeIn(c);
    if (!people || !t) continue;
    visits.push(visit(stage, people, t));
    said.push(c);
  }
  if (visits.length === 0) return null;
  const sum = (of: (v: BriefVisit) => number | null) =>
    visits.every((v) => of(v) != null) ? round(visits.reduce((a, v) => a + v.people * of(v)!, 0)) : null;
  return { visits, personHours: sum((v) => v.hours), personDays: sum((v) => v.days), said };
}
