import { normName } from "@/lib/integrations/match";
import { editDistance } from "@/lib/workboard/note-job";

/* IS THIS PERSON ALREADY A CUSTOMER? — pure, on both sides of the wire.

   Isaac, 26 November 2026, on the phone: "Client is [a name]. Can you have
   a look and see if we have her as an existing customer?" Tiff skipped the
   look and asked "Make the job in ServiceM8?". She was in the book all
   along, not as a client but as the contact on an old job of a builder's,
   and kept as "De Vane" where the words said "DeVane". So a customer is
   looked for three ways (lib/customers/find-server): a client by its name,
   a client's contact, and a job's contact; and a name fits however its
   spaces fall, either way round, and a letter or two out when it is long
   enough to bear it (a name heard, never a name guessed).

   What she says is said here too, so the note flow and the answer loop say
   the same thing about the same people. */

/** One person or client found, and where they were found. */
export type CustomerHit = {
  /** the name as the book keeps it */
  name: string;
  /** a client by its own name, a client's contact, or a contact on one job */
  via: "client" | "contact" | "job contact";
  /** the client it sits under, when that isn't the person themselves */
  client: string | null;
  /** the client's address, or the job's */
  address: string | null;
  /** the job it was found on, or the client's latest */
  job: { number: string; status: string | null; date: string | null } | null;
  /** how well it fits the name said, 0 to 1 */
  fit: number;
  /** the ServiceM8 client a new job for them goes under: the client itself,
      or the person's own client when they're its contact. Never a builder
      they were a contact on a job for: that job was the builder's. */
  clientUuid?: string | null;
};

/** The fewest a fit can be and still be said. */
export const FIT_MIN = 0.6;
/** At most this many are said. */
export const HITS_MAX = 3;

const letters = (s: string) => normName(s).replace(/[^a-z]/g, "");
const words = (s: string) => normName(s).split(" ").filter((w) => /[a-z]/.test(w));

/** How well a name in the book answers the name said: 1 the same name
    however it is spaced or ordered ("DeVane" is "De Vane", "Smith, Dan" is
    Dan Smith); 0.8 a letter or two out on a long name; 0.6 one word said and
    it is the book's last name; 0 not it. */
export function nameFits(said: string, kept: string | null | undefined): number {
  const a = letters(said);
  const b = letters(kept ?? "");
  if (a.length < 3 || b.length < 3) return 0;
  if (a === b) return 1;
  const sorted = (s: string) => words(s).map((w) => w.replace(/[^a-z]/g, "")).sort().join("");
  if (sorted(said) === sorted(kept ?? "")) return 1;
  const allowed = a.length >= 10 ? 2 : a.length >= 6 ? 1 : 0;
  if (allowed && Math.abs(a.length - b.length) <= allowed && editDistance(a, b) <= allowed) return 0.8;
  const saidWords = words(said);
  const keptWords = words(kept ?? "");
  if (saidWords.length === 1 && keptWords.length > 1) {
    const last = keptWords[keptWords.length - 1]!.replace(/[^a-z]/g, "");
    if (last.length >= 4 && last === a) return 0.6;
  }
  return 0;
}

/** The words a database looks a person up by: each word of three letters or
    more ("sam", "devane"), so a name kept "De Vane" is still reached by
    its first name. At most four. */
export function searchWords(said: string): string[] {
  const out = new Set<string>();
  for (const w of words(said)) {
    const bare = w.replace(/[^a-z]/g, "");
    if (bare.length >= 3) out.add(bare);
  }
  return [...out].slice(0, 4);
}

/** The best fits, one each per person and place, the closest and then the
    latest first. */
export function bestCustomers(hits: readonly CustomerHit[]): CustomerHit[] {
  const seen = new Set<string>();
  return hits
    .filter((h) => h.fit >= FIT_MIN)
    .sort((x, y) => y.fit - x.fit || (y.job?.date ?? "").localeCompare(x.job?.date ?? ""))
    .filter((h) => {
      const key = `${letters(h.name)}|${letters(h.address ?? "")}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, HITS_MAX);
}

/** "2/28 Hill St, Sampleton NSW 2088": ServiceM8's two lines as one. */
export const oneLine = (address: string | null | undefined): string =>
  (address ?? "")
    .split(/\n+/)
    .map((l) => l.trim().replace(/,$/, ""))
    .filter(Boolean)
    .join(", ");

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const monthOf = (date: string | null): string => {
  const m = /^(\d{4})-(\d{2})/.exec(date ?? "");
  return m ? `${MONTHS[+m[2]! - 1]} ${m[1]}` : "";
};

/** One hit, as she says it: "Sam Lee, job 2951 at 2/28 Hill St, Sampleton,
    Completed May 2024, through QX Construct". */
export function hitWords(h: CustomerHit): string {
  const where = oneLine(h.address);
  const job = h.job
    ? `job ${h.job.number}${where ? ` at ${where}` : ""}${h.job.status ? `, ${h.job.status}` : ""}${monthOf(h.job.date) ? ` ${monthOf(h.job.date)}` : ""}`
    : where
      ? `at ${where}`
      : "";
  const under = h.client && letters(h.client) !== letters(h.name) ? `through ${h.client}` : "";
  return [h.name, job, under].filter(Boolean).join(", ");
}

/** What she says she found when she looked `said` up. */
export function customerLine(said: string, hits: readonly CustomerHit[]): string {
  const name = said.trim();
  if (hits.length === 0) return `I couldn't find ${name} among your customers, so they'd be a new client.`;
  if (hits.length === 1) {
    const h = hits[0]!;
    const rest = hitWords(h).slice(h.name.length).replace(/^, /, "");
    return `${h.name} is already a customer${rest ? `: ${rest}` : ""}.`;
  }
  return `I found ${hits.length} customers like ${name}: ${hits.map(hitWords).join("; ")}.`;
}

/** The one client a new job for `said` goes under, when the book is sure:
    every close fit (a letter out at most) that has a client of its own names
    the same one. Null when there's none, or two, and the job makes a new
    client as it always did (Isaac, 26 November 2026: the person he asked
    about was in the book, and a job made then would have been a second of
    her). */
export function ownClient(hits: readonly CustomerHit[]): { uuid: string; name: string } | null {
  const close = hits.filter((h) => h.fit >= 0.8 && h.clientUuid);
  const uuids = [...new Set(close.map((h) => h.clientUuid!))];
  if (uuids.length !== 1) return null;
  const h = close[0]!;
  return { uuid: uuids[0]!, name: h.via === "client" ? h.name : (h.client ?? h.name) };
}
