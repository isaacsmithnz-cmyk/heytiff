import type { Visit } from "./buildup";

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
   a Return visit. A day is 8 hours. Pure. */

export type BriefLabour = {
  visits: Visit[];
  /** person-hours across every visit */
  personHours: number;
  /** the clauses it was read from, as written */
  said: string[];
};

const HOURS_A_DAY = 8;

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

function hoursIn(c: string): number | null {
  const h = HOURS.exec(c);
  if (h) return Number(h[1]);
  const d = DAYS.exec(c);
  if (d) {
    const n = num(d[1]!);
    return n == null ? null : n * HOURS_A_DAY;
  }
  if (FULL_DAY.test(c)) return HOURS_A_DAY;
  return null;
}

/** The labour a brief states, or null when it states none. */
export function labourFromBrief(text: string | null | undefined): BriefLabour | null {
  if (!text?.trim()) return null;
  const visits: Visit[] = [];
  const said: string[] = [];
  for (const c of clauses(text)) {
    const stage = RETURNING.test(c) ? "Return" : "Install";
    /* "two half day return trips": a person each, half a day each */
    const trips = TRIPS.exec(c);
    if (trips) {
      const n = num(trips[1]!);
      if (n && n > 0) {
        for (let i = 0; i < n; i++) visits.push({ stage: "Return", people: 1, days: 0.5 });
        said.push(c);
      }
      /* the rest of the clause may hold the main crew: "4 guys x 3 days, plus two…" */
      const rest = c.replace(trips[0], " ");
      const p = peopleIn(rest);
      const h = hoursIn(rest);
      if (p && h) visits.push({ stage: RETURNING.test(rest) ? "Return" : "Install", people: p, days: h / HOURS_A_DAY });
      if (p && h && !said.includes(c)) said.push(c);
      continue;
    }
    const people = peopleIn(c);
    const hours = hoursIn(c);
    if (!people || !hours) continue;
    visits.push({ stage, people, days: hours / HOURS_A_DAY });
    said.push(c);
  }
  if (visits.length === 0) return null;
  const personHours = visits.reduce((a, v) => a + v.people * v.days * HOURS_A_DAY, 0);
  return { visits, personHours: Math.round(personHours * 100) / 100, said };
}
