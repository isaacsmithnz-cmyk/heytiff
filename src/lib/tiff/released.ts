/* WHEN A MANUAL CAME OUT, the year on its cover (Isaac, 30 October 2026: "can
   we have year of release to show edition?"). Read once, when it's added:

   - the date printed on it where its title, its file's name or its edition
     says one ("PUMY-SP80-140VYKMD2-A_SM_TCH094A_JUL2023.pdf", "September
     2022", "Flyer 2023-12");
   - else the date the PDF itself was made, from the file's own information.

   Never a date read out of its pages: the zone controllers' only one is the
   software licence they reprint, "Apache License Version 2.0, January 2004".
   Pure. */

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** A plausible year for a manual: none before 1990, none past next year. */
const isYear = (y: number, now: Date) => y >= 1990 && y <= now.getFullYear() + 1;

const day = (y: number, m: number) => `${y}-${String(m).padStart(2, "0")}-01`;

/** The date a piece of text prints, as the first of its month (or January for a year alone), or null. Pure. */
export function printedDate(text: string | null | undefined, now = new Date()): string | null {
  /* a file's name says its words with underscores and dots */
  const s = ` ${String(text ?? "").replace(/[_.]+/g, " ")} `;
  const month = s.match(/[^a-z](jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s?((?:19|20)\d{2})(?!\d)/i);
  if (month && isYear(Number(month[2]), now)) return day(Number(month[2]), MONTHS.indexOf(month[1]!.toLowerCase()) + 1);
  const numeric = s.match(/[^\dA-Za-z]((?:19|20)\d{2})[-/](0[1-9]|1[0-2])(?!\d)/);
  if (numeric && isYear(Number(numeric[1]), now)) return day(Number(numeric[1]), Number(numeric[2]));
  const year = s.match(/[^\dA-Za-z]((?:19|20)\d{2})(?![\dA-Za-z])/);
  if (year && isYear(Number(year[1]), now)) return day(Number(year[1]), 1);
  return null;
}

/** A PDF's own date, "D:20230713174433+10'00'", as the first of its month, or null. Pure. */
export function pdfDate(raw: unknown, now = new Date()): string | null {
  const m = String(raw ?? "").match(/^(?:D:)?((?:19|20)\d{2})(\d{2})?/);
  if (!m || !isYear(Number(m[1]), now)) return null;
  const month = Number(m[2] ?? "1");
  return day(Number(m[1]), month >= 1 && month <= 12 ? month : 1);
}

/** When the manual came out: printed on its title, file or edition, in that order, else the PDF's own date. Pure. */
export function releasedOf(doc: { title: string | null; fileName: string | null; edition: string | null }, pdfMade: unknown, now = new Date()): string | null {
  for (const text of [doc.title, doc.fileName, doc.edition]) {
    const printed = printedDate(text, now);
    if (printed) return printed;
  }
  return pdfDate(pdfMade, now);
}

/** A manual's edition where it says more than when it came out ("Si30 - 701_A", "REVISED EDITION-A"); null for
    one that's only a date ("July 2023"), which the year says already. Pure. */
export function editionWords(edition: string | null | undefined): string | null {
  const e = String(edition ?? "").trim();
  if (!e) return null;
  return /^(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*)?(?:19|20)\d{2}$/i.test(e) ? null : e;
}
