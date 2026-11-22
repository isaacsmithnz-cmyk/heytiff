import type { JobSheetTab } from "@/components/workboard/board/job-sheet";

/* A JOB'S SIX SECTIONS (docs/design.md rule 31): Overview, Scope, Price, On
   site, Files, Billing (Isaac, 13 November 2026: "compact the row"). The job page (app/dashboard/jobs) draws each from the
   job card's own faces, so the card and the page never tell two stories about
   one job:

     Overview  = the facts and the Activity feed (mocks C and D, 14 November
                 2026); the stages line beside the name lives on it alone
     Scope     = the job's Scope, Since the quote and Latest updates, or its
                 Summary where it has no Scope (Isaac, 13 November 2026:
                 "Give scope its own tab"; mock A, 14 November), and under
                 them the job's plans and, for whoever holds `studio`, its
                 designs (Isaac, 15 November 2026: "Plans move too")
     Price     = where what the job is charged is built (Isaac, 13 November
                 2026, who named it): every price on the job as a card, the
                 quote and, to money, each invoice, the one open in Chat,
                 Line items and Preview with its rail (build 10, 15
                 November); the quote's own page is Price now, a
                 variation's "Variation" kept inside
     On site   = the visits with their tasks, what's not on a day yet, and
                 the materials, each unit and control with its word from
                 Stock (mock F, 14 November 2026); Visits and Materials (the
                 card's checklist) were their own until then
     Files     = the photos on the left, and in a 400 column the documents
                 and compliance (Photos and Documents until 15 November
                 2026; the designs and plans went to Scope that day)
     Billing   = the money, only for whoever holds `workboard_money`: without
                 it the section is absent, as the card's Billing face is.

   Every old name still lands (OLD_NAMES). Pure, so the page, the quote
   page's tabs and the tests read one list. */

export const JOB_SECTIONS = ["overview", "scope", "price", "on-site", "files", "billing"] as const;
export type JobSection = (typeof JOB_SECTIONS)[number];

export const SECTION_LABEL: Record<JobSection, string> = {
  overview: "Overview",
  scope: "Scope",
  price: "Price",
  "on-site": "On site",
  files: "Files",
  billing: "Billing",
};

/** The card's faces each section shows, in the order it shows them. */
export const SECTION_FACES: Record<JobSection, readonly JobSheetTab[]> = {
  overview: ["summary", "diary"],
  scope: ["scope", "design"],
  price: ["quote"],
  "on-site": ["visits", "checklist"],
  files: ["photos", "documents", "compliance"],
  billing: ["money"],
};

/** The section a face lives in: where a door into the card's face lands on the page. */
export function sectionOfFace(face: JobSheetTab): JobSection {
  for (const s of JOB_SECTIONS) if (SECTION_FACES[s].includes(face)) return s;
  return "overview";
}

/** The sections this reader has: Billing only with the money grant. Scope
    has a Designs card only for whoever holds the Studio; the tab itself is
    everyone's. */
export const sectionsFor = (moneyVisible: boolean, _studio = false): readonly JobSection[] =>
  JOB_SECTIONS.filter((s) => s !== "billing" || moneyVisible);

/* the names a section went by, so an old link still lands on it */
const OLD_NAMES: Record<string, JobSection> = {
  quote: "price",
  checklist: "on-site",
  visits: "on-site",
  materials: "on-site",
  onsite: "on-site",
  photos: "files",
  documents: "files",
  design: "scope",
  designs: "scope",
  plans: "scope",
};

/** The section an address's `?tab=` names, or Overview: an invented one, a
    repeated one and Billing without the money grant all land on Overview.
    A section's old name lands on it (`?tab=checklist`, `visits` and
    `materials` are On site; `photos`, `documents` and `design` are Files;
    `quote` is Price). */
export function parseSection(raw: string | string[] | undefined | null, moneyVisible: boolean, studio = false): JobSection {
  if (typeof raw !== "string") return "overview";
  const said = raw.trim().toLowerCase();
  const s = OLD_NAMES[said] ?? said;
  return (sectionsFor(moneyVisible, studio) as readonly string[]).includes(s) ? (s as JobSection) : "overview";
}

/* a first word that names nothing alone: "St Exemplar" is not "St" */
const LEAD_WORD = /^(?:the|mr|mrs|ms|dr|st|mt|[a-z]{1,2})\.?$/i;

/** What an open tab calls a job: its number and the first word of its
    client's name, "3209 Rowland"; the first two when the first is a
    title or a short word, "2674 St Exemplar". */
export function jobTabLabel(number: string | null | undefined, clientName: string | null | undefined): string {
  const words = (clientName ?? "").trim().split(/\s+/);
  const short = (words.length > 1 && LEAD_WORD.test(words[0]) ? words.slice(0, 2).join(" ") : words[0]) ?? "";
  const n = (number ?? "").trim();
  if (n && short) return `${n} ${short}`;
  if (short) return (clientName ?? "").trim();
  return n ? `Job ${n}` : "Job";
}
