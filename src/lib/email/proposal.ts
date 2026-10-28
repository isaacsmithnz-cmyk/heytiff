/* EMAIL TO TIFF, READ (Isaac, 28 October 2026: "forward an email for a
   builder into tiff to create a job, read scope etc"; the mock he said "Build
   it in" to).

   What Tiff reads in an email one of the team forwarded: whether it asks for
   work at all; who is asking (the builder, never the business itself and
   never the person who forwarded it); their contact; the site; when the
   quote or tender is due; the scope, item by item, in their own words; and
   what they left out. Then this decides what to believe, and composes what a
   ServiceM8 job is made of. Nothing here is saved or sent.

   Pure: the schema, the prompt, the parse and the job's words are tested
   without a key. */

export const EMAIL_JOB_SCHEMA = {
  type: "object",
  properties: {
    isJob: { type: "boolean" },
    notJobWhy: { type: "string" },
    summary: { type: "string" },
    client: { type: "string" },
    contactFirst: { type: "string" },
    contactLast: { type: "string" },
    contactMobile: { type: "string" },
    contactPhone: { type: "string" },
    contactEmail: { type: "string" },
    site: { type: "string" },
    due: { type: "string" },
    scope: { type: "array", items: { type: "string" } },
    excluded: { type: "array", items: { type: "string" } },
  },
  required: ["isJob", "notJobWhy", "summary", "client", "contactFirst", "contactLast", "contactMobile", "contactPhone", "contactEmail", "site", "due", "scope", "excluded"],
  additionalProperties: false,
} as const;

/** The ask, with who "we" are and who forwarded it, so neither is taken for the client. */
export function emailJobPrompt(us: { business: string; forwarder: string | null; today: string }): string {
  return (
    `You are Tiff, the assistant at ${us.business}, an Australian air-conditioning business. ` +
    `${us.forwarder ?? "Someone on the team"} forwarded you the email below (and any files with it). ` +
    "Read it as a request for work and fill in:\n" +
    "- isJob: true when someone is asking this business for work: a quote, a tender, a price, a job or a visit. False for anything else (an invoice, a newsletter, a reply about a job already under way)\n" +
    '- notJobWhy: when isJob is false, what it is instead, in a few words; otherwise ""\n' +
    "- summary: one or two plain sentences on what is asked, where and by whom, as you would tell the person who forwarded it. No greeting\n" +
    `- client: the company (or person) asking for the work, as they name themselves. Never ${us.business}, and never the person who forwarded it\n` +
    '- contactFirst, contactLast, contactMobile, contactPhone, contactEmail: the person at the client to deal with, from their signature or their own address; "" for anything not written\n' +
    '- site: where the work is, one line, as written (street, suburb, state, postcode); "" if not given\n' +
    `- due: when the quote or tender is due, as yyyy-mm-dd; "" if no date is given. Today is ${us.today}; dates are Australian, day first\n` +
    "- scope: the work asked for, item by item, in their own words, tidied only to read as a list. Include what the attached drawings or specification add\n" +
    "- excluded: what they say is not part of the work, item by item\n\n" +
    "Never invent a name, number, address, date or item that isn't written in the email or its files."
  );
}

export type EmailJobRead = {
  isJob: boolean;
  notJobWhy: string;
  summary: string;
  client: string;
  contact: { first: string; last: string; mobile: string; phone: string; email: string };
  site: string;
  /** yyyy-mm-dd, or "" */
  due: string;
  scope: string[];
  excluded: string[];
};

const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const list = (v: unknown) => (Array.isArray(v) ? v.map((x) => str(x, 400)).filter(Boolean).slice(0, 40) : []);

/** Tiff's answer, believed only as far as it holds up: every field its own
    length, a date only when it is one, an email address only when it looks
    like one. */
export function parseEmailJobRead(raw: unknown): EmailJobRead {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const due = str(r.due, 10);
  const email = str(r.contactEmail, 200);
  return {
    isJob: r.isJob === true,
    notJobWhy: str(r.notJobWhy, 200),
    summary: str(r.summary, 600),
    client: str(r.client, 100),
    contact: {
      first: str(r.contactFirst, 60),
      last: str(r.contactLast, 60),
      mobile: str(r.contactMobile, 40),
      phone: str(r.contactPhone, 40),
      email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "",
    },
    site: str(r.site, 300),
    due: /^\d{4}-\d{2}-\d{2}$/.test(due) && !Number.isNaN(Date.parse(due)) ? due : "",
    scope: list(r.scope),
    excluded: list(r.excluded),
  };
}

export type ClientMatch = { uuid: string; name: string; builder: boolean };
export type SiteMatch = { uuid: string; name: string | null; address: string | null; parentName: string | null };
/** What Tiff proposes: her read, and what it matched here. */
export type EmailProposal = EmailJobRead & { clientMatch: ClientMatch | null; siteMatch: SiteMatch | null };

/** What Tiff says over the card, in her own words. */
export function tiffSays(p: EmailProposal | null, failed: string | null): string {
  if (failed) return `I couldn't read this one: ${failed} Forward it again, or make the job from New › Job.`;
  if (!p) return "";
  if (!p.isJob) return `This doesn't read as a request for work${p.notJobWhy ? ` (${p.notJobWhy.replace(/\.$/, "")})` : ""}, so I haven't proposed a job. Make one from New › Job if it is.`;
  const known = p.clientMatch ? `${p.clientMatch.name} is already a client${p.siteMatch ? "" : p.clientMatch.builder ? "; the site is new for them" : ""}.` : `${p.client || "They"} aren't a client yet; Create job adds them.`;
  const due = p.due ? ` It's due ${dueWords(p.due)}.` : "";
  return `${p.summary}${due} ${known} Here's the job I'd make, with the scope as they wrote it.`.replace(/\s+/g, " ").trim();
}

/** "Friday 7 November", for a due date. */
export function dueWords(due: string): string {
  if (!due) return "";
  const d = new Date(`${due}T00:00:00Z`);
  return new Intl.DateTimeFormat("en-AU", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(d);
}

/** What the ServiceM8 job's description says: the scope as written, what's
    excluded, when it's due, and where it came from. 4,000 characters is the
    most ServiceM8 takes from here; past them it is cut, and the email itself
    stays whole in the thread it came in on. */
export function jobDescriptionOf(read: EmailJobRead, from: { name: string | null; at: string }): string {
  const lines: string[] = [];
  if (read.scope.length) lines.push("Scope:", ...read.scope.map((s) => `- ${s}`));
  if (read.excluded.length) lines.push("", "Excluded:", ...read.excluded.map((s) => `- ${s}`));
  if (read.due) lines.push("", `Quote due ${dueWords(read.due)}.`);
  const who = [read.contact.first, read.contact.last].filter(Boolean).join(" ");
  lines.push("", `From ${who ? `${who}'s` : "an"} email${read.client ? ` (${read.client})` : ""}, forwarded to Tiff${from.name ? ` by ${from.name}` : ""} on ${from.at}.`);
  const out = lines.join("\n").trim();
  return out.length > 4000 ? out.slice(0, 4000).trimEnd() : out;
}

/** The thread's title: the email's subject without its Fw:/Fwd:/RE: marks. */
export function threadTitleOf(subject: string | null, read: EmailJobRead | null): string {
  const s = (subject ?? "").replace(/^\s*((fw|fwd|re)\s*:\s*)+/i, "").trim();
  return (s || (read?.site ? `New job, ${read.site}` : "An email to Tiff")).slice(0, 200);
}
