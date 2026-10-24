import type { JobSheetTab } from "@/components/workboard/board/job-sheet";

/* A JOB'S SEVEN SECTIONS (docs/design.md rule 31): Overview, Quote, Visits,
   Materials, Photos, Documents, Billing. The job page (app/dashboard/jobs)
   draws each from the job card's own faces, so the card and the page never
   tell two stories about one job:

     Overview  = the summary and the diary, under the stages line (the line
                 lives on Overview only, 6-revisions, 17 October)
     Quote     = the quote
     Visits    = the visits
     Materials = the job's own list, which the card calls its checklist
                 (Isaac, 25 October 2026: every row on it is a material)
     Photos    = the photos
     Documents = the files and compliance
     Billing   = the money, only for whoever holds `workboard_money`: without
                 it the section is absent, as the card's Billing face is.

   Pure, so the page, the quote page's tabs and the tests read one list. */

export const JOB_SECTIONS = ["overview", "quote", "visits", "materials", "photos", "documents", "billing"] as const;
export type JobSection = (typeof JOB_SECTIONS)[number];

export const SECTION_LABEL: Record<JobSection, string> = {
  overview: "Overview",
  quote: "Quote",
  visits: "Visits",
  materials: "Materials",
  photos: "Photos",
  documents: "Documents",
  billing: "Billing",
};

/** The card's faces each section shows, in the order it shows them. */
export const SECTION_FACES: Record<JobSection, readonly JobSheetTab[]> = {
  overview: ["summary", "diary"],
  quote: ["quote"],
  visits: ["visits"],
  materials: ["checklist"],
  photos: ["photos"],
  documents: ["documents", "compliance"],
  billing: ["money"],
};

/** The section a face lives in: where a door into the card's face lands on the page. */
export function sectionOfFace(face: JobSheetTab): JobSection {
  for (const s of JOB_SECTIONS) if (SECTION_FACES[s].includes(face)) return s;
  return "overview";
}

/** The sections this reader has: Billing only with the money grant. */
export const sectionsFor = (moneyVisible: boolean): readonly JobSection[] =>
  moneyVisible ? JOB_SECTIONS : JOB_SECTIONS.filter((s) => s !== "billing");

/* the names a section went by, so an old link still lands on it */
const OLD_NAMES: Record<string, JobSection> = { checklist: "materials" };

/** The section an address's `?tab=` names, or Overview: an invented one, a
    repeated one, and Billing without the money grant all land on Overview.
    A section's old name lands on it (`?tab=checklist` is Materials). */
export function parseSection(raw: string | string[] | undefined | null, moneyVisible: boolean): JobSection {
  if (typeof raw !== "string") return "overview";
  const said = raw.trim().toLowerCase();
  const s = OLD_NAMES[said] ?? said;
  return (sectionsFor(moneyVisible) as readonly string[]).includes(s) ? (s as JobSection) : "overview";
}

/* a first word that names nothing alone: "St Lukes" is not "St" */
const LEAD_WORD = /^(?:the|mr|mrs|ms|dr|st|mt|[a-z]{1,2})\.?$/i;

/** What an open tab calls a job: its number and the first word of its
    client's name, "3209 Richards"; the first two when the first is a
    title or a short word, "2674 St Lukes". */
export function jobTabLabel(number: string | null | undefined, clientName: string | null | undefined): string {
  const words = (clientName ?? "").trim().split(/\s+/);
  const short = (words.length > 1 && LEAD_WORD.test(words[0]) ? words.slice(0, 2).join(" ") : words[0]) ?? "";
  const n = (number ?? "").trim();
  if (n && short) return `${n} ${short}`;
  if (short) return (clientName ?? "").trim();
  return n ? `Job ${n}` : "Job";
}
