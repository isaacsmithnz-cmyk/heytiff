/* A QUESTION ABOUT THE CREW SAYS WHAT THE LABOUR LINES SAY (the 3465 review,
   5 November 2026; Isaac, 10 November 2026: "Keep checking off the list").

   On 3465 Tiff asked "Day 1: 5 people, 35 h; day 2: 2 people, 26 h" while
   the labour lines she'd just built held 44 h and 17 h: the figures were her
   own words, not the lines'. A question about the crew or the hours now has
   what the quote has for it written from the labour lines themselves, and
   one that names hours the lines haven't got goes back to her once, with
   the lines' own figures. Pure. */

import type { LineFields } from "../lines";
import { visitHours } from "../line-visit";
import type { Question } from "./tools";

type Labour = { name: string; people: number | null; hours: number };

const quarter = (n: number) => Math.round(n * 4) / 4;
const fig = (n: number) => String(quarter(n));

/** A question about who's on the job and for how long. */
export function isLabourAsk(q: Pick<Question, "question" | "topic">): boolean {
  return /\b(crew|labou?r|person-hours|man-hours|how many (people|hours|days))\b/i.test(`${q.topic ?? ""} ${q.question}`);
}

/** Each labour line on an option: its name, its crew, its hours. */
function labourOf(lines: Pick<LineFields, "kind" | "name" | "qty" | "visit" | "optionIndex">[], option: number): Labour[] {
  return lines
    .filter((l) => l.optionIndex === option && l.kind === "labour")
    .map((l) => {
      const people = l.visit?.people ?? Number(/(\d+)\s*(?:people|person)\b/i.exec(l.name)?.[1] ?? NaN);
      return { name: l.visit?.stage ?? l.name.split(":")[0]!.trim(), people: Number.isFinite(people) ? people : null, hours: l.visit ? visitHours(l.visit) : quarter(l.qty) };
    })
    .filter((l) => l.hours > 0);
}

const MAX_PUT = 120;

/** What the quote has for the crew now, from its labour lines: "Day 1: 5
    people, 44 h; Day 2: 2 people, 17 h (61 h in all)". Null with none. */
export function labourPut(lines: Parameters<typeof labourOf>[0]): string | null {
  const options = [...new Set(lines.filter((l) => l.kind === "labour").map((l) => l.optionIndex))].sort((a, b) => a - b);
  const each = options.map((o) => {
    const ls = labourOf(lines, o);
    if (ls.length === 0) return null;
    const total = ls.reduce((n, l) => n + l.hours, 0);
    const parts = ls.map((l) => `${l.name}: ${l.people != null ? `${l.people} ${l.people === 1 ? "person" : "people"}, ` : ""}${fig(l.hours)} h`);
    const long = `${parts.join("; ")}${ls.length > 1 ? ` (${fig(total)} h in all)` : ""}`;
    const said = long.length <= MAX_PUT ? long : `${fig(total)} h over ${ls.length} ${ls.length === 1 ? "visit" : "visits"}`;
    return options.length > 1 ? `Option ${o + 1}: ${said}` : said;
  });
  const put = each.filter(Boolean).join(". ");
  return put ? put.slice(0, MAX_PUT * 2) : null;
}

/** The hours a question gives that no labour line has: not a line's, not an
    option's total, not a person's day on a line. Hours an answer offers are
    choices, not what's on the quote, and pass. */
export function hoursNotOnLines(q: Pick<Question, "question" | "answers">, lines: Parameters<typeof labourOf>[0]): number[] {
  const options = [...new Set(lines.filter((l) => l.kind === "labour").map((l) => l.optionIndex))];
  const known = new Set<number>();
  for (const o of options) {
    const ls = labourOf(lines, o);
    known.add(quarter(ls.reduce((n, l) => n + l.hours, 0)));
    for (const l of ls) {
      known.add(l.hours);
      if (l.people) known.add(quarter(l.hours / l.people));
    }
  }
  if (known.size === 0) return [];
  const offered = q.answers.map((a) => a.label).join(" ");
  const said = [...q.question.matchAll(/(\d+(?:\.\d+)?)\s*(?:h\b|hrs?\b|hours?\b|person-hours\b)/gi)].map((m) => Number(m[1]));
  const near = (n: number) => [...known].some((k) => Math.abs(k - n) <= 0.5);
  return [...new Set(said)].filter((n) => !near(n) && !new RegExp(`\\b${String(n).replace(".", "\\.")}\\s*(h|hrs?|hours?)\\b`, "i").test(offered));
}
