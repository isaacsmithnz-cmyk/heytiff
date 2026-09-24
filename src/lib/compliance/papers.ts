import { daysUntil } from "@/lib/au-dates";
import { expiresIn } from "@/lib/format/duration";
import { fmtDay } from "@/lib/format/day";
import { andList } from "@/lib/swms/library";

/* COMPLIANCE ON A JOB — the pure rules.

   The business's own papers (the certificates on the Organisation screen) and
   its people's tickets (the licences on each staff card) are already in
   HeyTiff. A job needs them when a customer asks, so the job card's Documents
   face can put them under Compliance, beside the SWMS — as LINKS to the paper
   the credential or ticket already owns, never copies
   (docs/migrations/job_compliance.sql).

   And whatever is on the job can be sent: every file the Documents face holds
   carries a tick, and what is ticked can be emailed from the card's footer.

   Pure module: no I/O, client-importable, so the face, the actions and the
   tests all read the same rules. */

export type PaperKind = "company" | "staff";

/** The same four states the credential wall and the licence cards use. "none"
    is not "ok": no expiry recorded is not evidence of cover. */
export type PaperState = "ok" | "warn" | "bad" | "none";

/** One paper the business could put on a job. */
export type PaperChoice = {
  /** What "Add to job" sends back — see paperKey. */
  key: string;
  kind: PaperKind;
  /** The credential's name ("Public liability") or the ticket's type
      ("ARC licence"). The ticket's type is what the chooser groups by. */
  name: string;
  /** Whose ticket this is; null on the business's own papers. */
  person: string | null;
  issuer: string | null;
  expiresOn: string | null;
  state: PaperState;
  /** Files filed under the term that would go on the job. None means there is
      nothing to give the customer, so it can't be ticked. */
  files: number;
  /** Booked on this job in ServiceM8. Listed first: the customer is asking
      about the people who are coming. Always false on the business's own. */
  booked: boolean;
  /** Already on this job. */
  onJob: boolean;
};

/** What the chooser offers. A side is null when the viewer may not add it —
    the business's papers need `workboard_manage`, a person's need `team`. */
export type PaperChoices = {
  company: PaperChoice[] | null;
  staff: PaperChoice[] | null;
};

export type JobPaperFile = {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  /** Signed for this render. Null when the viewer may not open it — a staff
      licence opens only for `team` and for its holder. */
  url: string | null;
};

/** One paper ON the job, as its row reads. */
export type JobPaper = {
  /** job_compliance.id */
  id: string;
  kind: PaperKind;
  name: string;
  person: string | null;
  issuer: string | null;
  /** The expiry of the term that was put on the job — not the current one. */
  expiresOn: string | null;
  state: PaperState;
  /** A newer term, with paper filed under it, has come in since. */
  renewed: boolean;
  files: JobPaperFile[];
  addedBy: string | null;
  addedAt: string;
  /** The viewer may take it off the job or move it to the renewal. */
  manage: boolean;
};

export type JobPapersRead = {
  papers: JobPaper[];
  may: {
    /** Add the business's papers — `workboard_manage`. */
    company: boolean;
    /** Add a person's tickets — `team`. */
    staff: boolean;
    /** Tick files and email them — `workboard_manage`. */
    send: boolean;
  };
};

/* ── keys ─────────────────────────────────────────────────────────────── */

const ID = /^[0-9a-zA-Z-]{1,80}$/;

/** "c:<credential id>" for the business's own, "l:<licence id>" for a ticket. */
export function paperKey(kind: PaperKind, id: string): string {
  return `${kind === "company" ? "c" : "l"}:${id}`;
}

/** A key the browser handed back, or null when it isn't one. */
export function readPaperKey(key: unknown): { kind: PaperKind; id: string } | null {
  if (typeof key !== "string") return null;
  const m = /^([cl]):(.+)$/.exec(key.trim());
  if (!m || !ID.test(m[2])) return null;
  return { kind: m[1] === "c" ? "company" : "staff", id: m[2] };
}

/* WHAT A TICK NAMES. The face holds three kinds of file and each is found a
   different way on the server: a paper by its job_compliance row, one of our
   uploads by its documents row, and one of ServiceM8's by the attachment uuid
   its cached copy is filed under. The prefix keeps them from ever colliding. */
export const paperSendKey = (paperId: string) => `p:${paperId}`;
export const ourDocumentSendKey = (documentId: string) => `d:${documentId}`;
export const theirFileSendKey = (remoteId: string) => `f:${remoteId}`;

export type SendPicks = { papers: string[]; documents: string[]; files: string[] };

/** Ticks as the three lists the email action takes. Anything else is dropped. */
export function splitSendKeys(keys: Iterable<string>): SendPicks {
  const out: SendPicks = { papers: [], documents: [], files: [] };
  for (const key of keys) {
    const m = /^([pdf]):(.+)$/.exec(key);
    if (!m || !ID.test(m[2])) continue;
    const list = m[1] === "p" ? out.papers : m[1] === "d" ? out.documents : out.files;
    if (!list.includes(m[2])) list.push(m[2]);
  }
  return out;
}

/* ── state ────────────────────────────────────────────────────────────── */

export function paperState(expiresOn: string | null, today: string, warnDays: number): PaperState {
  if (!expiresOn) return "none";
  const days = daysUntil(expiresOn, today);
  return days < 0 ? "bad" : days <= warnDays ? "warn" : "ok";
}

/** Why a choice can't be ticked, in the word the row says instead of a box —
    or null when it can. An expired certificate is not something to hand a
    customer, and a card with no paper under it has nothing to hand them. */
export function choiceBlock(choice: PaperChoice): string | null {
  if (choice.onJob) return "On this job";
  if (choice.files === 0) return choice.kind === "company" ? "No certificate on file" : "No licence on file";
  if (choice.state === "bad") return "Expired";
  return null;
}

/** The state word at a choice's end, and its tone. Quiet when all is well. */
export function choiceStateWord(
  choice: PaperChoice,
  today: string
): { word: string; tone: "ok" | "warn" | "bad" | "mute" } {
  const block = choiceBlock(choice);
  if (block) return { word: block, tone: block === "Expired" ? "bad" : "mute" };
  if (choice.state === "warn" && choice.expiresOn)
    return { word: expiresIn(daysUntil(choice.expiresOn, today)), tone: "warn" };
  if (choice.state === "none") return { word: "No expiry", tone: "mute" };
  return { word: "Valid", tone: "ok" };
}

/* A LINE THAT OPENS ON DATA IS PRINTED AS ITS OWNER SPELLS IT. icare is lower
   case on its own certificate, and raising its first letter would misspell
   the insurer the customer is about to check. Only a line that opens on our
   own words ("to 30 Jun 2027") takes a capital. */
function metaLine(data: string | null, ours: readonly (string | null)[]): string {
  const tail = ours.filter(Boolean).join(", ");
  if (data?.trim()) return tail ? `${data.trim()}, ${tail}` : data.trim();
  return tail ? tail.charAt(0).toUpperCase() + tail.slice(1) : "";
}

/** "QBE, to 30 Jun 2027" — who it is with and how long it runs. */
export function choiceFacts(choice: PaperChoice): string {
  return metaLine(choice.issuer, [choice.expiresOn ? `to ${fmtDay(choice.expiresOn)}` : null]);
}

/** The line under a paper's name on the job: whose or whose-issued, how long
    it runs, and who put it there. "Dane Whitmore, to 1 Mar 2027, added by
    Isaac Smith". The name above it already says what it is. */
export function paperMeta(paper: JobPaper): string {
  return metaLine(paper.kind === "staff" ? paper.person : paper.issuer, [
    paper.expiresOn ? `to ${fmtDay(paper.expiresOn)}` : null,
    paper.addedBy ? `added by ${paper.addedBy}` : null,
  ]);
}

/** Whether a paper on the job can be ticked to send: it has a file this
    viewer may open, and the term on the job hasn't run out. An expired
    certificate is not something to hand a customer — the row says Expired,
    and Use renewal is the way on. */
export function paperSendable(paper: JobPaper): boolean {
  return paper.state !== "bad" && paper.files.some((f) => f.url);
}

/** The state a paper on the job has to say out loud, or null when it has
    nothing to say. Expired outranks renewed: an expired certificate on a job
    is the thing to fix, whether or not the renewal is in. */
export function paperStateLine(
  paper: JobPaper,
  today: string
): { word: string; tone: "warn" | "bad" } | null {
  if (paper.state === "bad") return { word: "Expired", tone: "bad" };
  if (paper.renewed) return { word: "Renewed since it was added", tone: "warn" };
  if (paper.state === "warn" && paper.expiresOn)
    return { word: expiresIn(daysUntil(paper.expiresOn, today)), tone: "warn" };
  return null;
}

/* ── the chooser's order ──────────────────────────────────────────────── */

const typeKey = (name: string) => name.trim().toLowerCase().replace(/[’']/g, "'");

/* THE TRADE TICKETS LEAD. A customer asking for compliance wants the ARC
   licence and the contractor licence of whoever is coming; a white card is
   the site's ask; a driver licence is personal ID and rarely a customer's
   business, so it comes last of the named ones. The four are the registry's
   own names (LIC_TYPES in lib/staff/licence), in the order they are asked for. */
const TYPE_ORDER = ["arc licence", "contractor licence", "white card", "driver's licence"];

/** The ticket types the team holds, in the order the chooser offers them:
    the named four in the order they are asked for, then everything custom,
    alphabetically. One name per type however it was typed ("ARC Licence",
    "arc licence"). */
export function licenceTypes(staff: readonly PaperChoice[]): string[] {
  const byKey = new Map<string, string>();
  for (const c of staff) {
    const k = typeKey(c.name);
    if (!byKey.has(k)) byKey.set(k, c.name.trim());
  }
  const rank = (k: string) => {
    const i = TYPE_ORDER.indexOf(k);
    return i < 0 ? TYPE_ORDER.length : i;
  };
  return [...byKey.entries()]
    .sort(([ak, a], [bk, b]) => rank(ak) - rank(bk) || a.localeCompare(b))
    .map(([, name]) => name);
}

/** The people holding one type: booked first, then by name. */
export function holdersOf(staff: readonly PaperChoice[], type: string): PaperChoice[] {
  const k = typeKey(type);
  return staff
    .filter((c) => typeKey(c.name) === k)
    .sort((a, b) => {
      if (a.booked !== b.booked) return a.booked ? -1 : 1;
      return (a.person ?? "").localeCompare(b.person ?? "");
    });
}

/* ── the email ────────────────────────────────────────────────────────── */

/** What one email may carry, before encoding. The provider takes 40 MB per
    email AFTER base64, which is about 30 MB of files; the rest is the letter's
    own room. A certificate is usually under 1 MB, a phone photo of a licence
    up to 5, and a job's worth of plans is where this bites. */
export const EMAIL_MAX_BYTES = 25 * 1024 * 1024;

/** Who one email may go to. A handful is a customer and their builder; more
    than this is a mailing list, which this isn't. */
export const EMAIL_MAX_TO = 10;

const EMAIL = /^[^\s@<>(),;:"[\]]+@[^\s@<>(),;:"[\]]+\.[^\s@<>(),;:"[\]]{2,}$/;

export function isEmailAddress(value: string): boolean {
  return value.length <= 254 && EMAIL.test(value);
}

/** Addresses typed into one box — commas, semicolons, spaces or new lines
    between them, the way people paste them — split into the ones that are
    addresses and the ones that aren't. */
export function readAddresses(text: string): { ok: string[]; bad: string[] } {
  const ok: string[] = [];
  const bad: string[] = [];
  for (const part of text.split(/[\s,;]+/)) {
    const v = part.trim();
    if (!v) continue;
    if (!isEmailAddress(v)) bad.push(v);
    else if (!ok.some((o) => o.toLowerCase() === v.toLowerCase())) ok.push(v);
  }
  return { ok, bad };
}

/** "Documents for job 1234, 12 Smith St Newtown" */
export function defaultSubject(job: { number: string | null; address: string | null }): string {
  const head = job.number ? `Documents for job ${job.number}` : "Documents for your job";
  return job.address ? `${head}, ${job.address}` : head;
}

/** The words above the attachments. Short, because the letter lists the
    files itself — the message is the part a person writes. */
export function defaultMessage(sender: string | null, business: string | null): string {
  const sign = [sender, business].filter(Boolean).join("\n");
  return `Hi,\n\nPlease find our documents for this job attached.${sign ? `\n\nKind regards,\n${sign}` : ""}`;
}

const MIME_EXT: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/gif": "gif",
  "image/avif": "avif",
};

/** The name a paper's file goes by in the customer's inbox: what it IS, not
    what the phone called the photo. "Public liability.pdf", "ARC licence,
    Dane Whitmore.jpg", and a number when one term holds a card's two sides. */
export function attachmentName(
  paper: { name: string; person: string | null },
  file: { fileName: string; mimeType: string },
  index: number,
  of: number
): string {
  const ext =
    MIME_EXT[file.mimeType.toLowerCase()] ?? /\.([a-z0-9]{2,5})$/i.exec(file.fileName)?.[1]?.toLowerCase() ?? "pdf";
  const base = [paper.name.trim(), paper.person?.trim()].filter(Boolean).join(", ");
  const safe = base.replace(/[\\/:*?"<>|\r\n\t]+/g, " ").replace(/\s+/g, " ").trim() || "Document";
  return `${safe}${of > 1 ? ` ${index + 1}` : ""}.${ext}`;
}

/** A file's own name with its extension on — ServiceM8 names a quote
    "Quote #2380" and the inbox needs ".pdf" to know what opens it. */
export function withExtension(fileName: string, mimeType: string): string {
  const name = fileName.replace(/[\\/:*?"<>|\r\n\t]+/g, " ").replace(/\s+/g, " ").trim() || "Document";
  if (/\.[a-z0-9]{2,5}$/i.test(name)) return name;
  return `${name}.${MIME_EXT[mimeType.toLowerCase()] ?? "pdf"}`;
}

/** A paper in a sentence: "Public liability", "ARC licence (Dane Whitmore)". */
export function paperLabel(paper: { name: string; person: string | null }): string {
  return paper.person ? `${paper.name} (${paper.person})` : paper.name;
}

/** Keeps a list of attachment names from saying the same name twice — two
    uploads both called "plan.pdf" become "plan.pdf" and "plan 2.pdf". */
export function uniqueNames(names: readonly string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((name) => {
    const k = name.toLowerCase();
    const n = (seen.get(k) ?? 0) + 1;
    seen.set(k, n);
    if (n === 1) return name;
    const dot = name.lastIndexOf(".");
    return dot > 0 ? `${name.slice(0, dot)} ${n}${name.slice(dot)}` : `${name} ${n}`;
  });
}

/** The diary's record of a send, in words: what went, to whom. */
export function sentNote(names: readonly string[], to: readonly string[]): string {
  return `Emailed ${andList([...names])} to ${andList([...to])}.`;
}
