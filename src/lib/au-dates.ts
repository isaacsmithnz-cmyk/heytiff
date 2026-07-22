/* dd/mm/yyyy <-> ISO — the bridge between the design's text date inputs and
   real `date` columns. Shared by the staff card and the organisation profile;
   lib/staff/profile.ts re-exports these so its existing importers are
   untouched. */

/** dd/mm/yyyy (any separator, optional spaces) -> ISO yyyy-mm-dd. */
export function parseAuDate(input: string): string | null {
  const s = input.trim();
  if (!s) return null;
  const m = s.match(/^(\d{1,2})\s*[/\-. ]\s*(\d{1,2})\s*[/\-. ]\s*(\d{4})$/);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3]);
  if (month < 1 || month > 12 || day < 1) return null;
  // reject 31 Feb etc. rather than letting Date roll it forward
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day > daysInMonth) return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** ISO yyyy-mm-dd -> dd/mm/yyyy for the design's text inputs. */
export function formatAuDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const m = String(iso).slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return "";
  return `${m[3]}/${m[2]}/${m[1]}`;
}
