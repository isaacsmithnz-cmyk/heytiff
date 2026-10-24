import type { Hue, Tone } from "@/components/parts/state";
import type { OrgSwmsSummary } from "@/lib/swms/query";
import type { OrgCertSummary } from "@/lib/certs/query";
import type { LetterSummary } from "@/lib/letters/query";
import type { ProjectSummary } from "@/lib/workboard/projects-query";
import { andList } from "@/lib/swms/library";
import { letterHref } from "@/lib/letters/letter";
import { jobTabLabel } from "@/lib/jobs/job-sections";

/* DOCUMENTS, THE LIST (v2, step 5; the board 5-documents). What the
   business has made, by kind: its SWMS, its certificates, its letters and
   its projects' handover sheets. Quotes are not listed: a quote lives on its
   job (Isaac's call, taken as recommended on 18 October).

   Every row is built here from what today's screens already read (the job
   card's SWMS and certificates, Admin's letters, the Projects list), so the
   words a row says are the words the job card says. Pure: the page's query
   gathers, this decides, and the list narrows in the browser. */

export const DOC_KINDS = ["swms", "certificate", "letter", "handover"] as const;
export type DocKind = (typeof DOC_KINDS)[number];
export type DocView = "all" | DocKind;

/** What a kind is called as a view and as a group. */
export const KIND_LABEL: Record<DocKind, string> = {
  swms: "SWMS",
  certificate: "Certificates",
  letter: "Letters",
  handover: "Handover sheets",
};

/** The job a document is on: "3342 Rifkin, Bellevue Hill", with the job's
    colour (rule 18) when the mirror holds it. */
export type DocJob = { label: string; hue: Hue | null };

export type DocRow = {
  key: string;
  kind: DocKind;
  name: string;
  job: DocJob | null;
  /** Where it's up to, a word in its tone (rule 17). */
  state: string;
  tone: Tone;
  /** The calendar day it last changed, yyyy-mm-dd. */
  day: string;
  /** Who it belongs to: the person in charge, who signed it, who wrote it. */
  by: string | null;
  /** Where it opens: where today's screens open it. */
  href: string;
  /** A paper outside the frame (the certificate, the handover sheet) opens
      in a browser tab of its own, as it does from the job card and the
      project today. */
  newTab: boolean;
  /** Someone still has to sign on to it. */
  waiting: boolean;
};

/* ── where each kind is up to ───────────────────────────────────────────── */

/** "2 of 3 signed on, waiting on Sam": the job card's line (job-documents-face). */
export function swmsSignedLine(s: Pick<OrgSwmsSummary, "signed" | "total" | "waitingOn">): string {
  const count = `${s.signed} of ${s.total} signed on`;
  if (s.waitingOn.length === 0) return count;
  return `${count}, waiting on ${andList(s.waitingOn)}`;
}

/** "Dan raised: no anchor on the rear ridge": the job card's line. */
export function swmsIssueLine(s: Pick<OrgSwmsSummary, "issues">): string {
  if (s.issues.length === 1) return `${s.issues[0]!.name} raised: ${s.issues[0]!.issue}`;
  return `${s.issues.length} issues raised, by ${andList(s.issues.map((i) => i.name))}`;
}

/** An issue raised at sign-on comes first, until someone records it as
    sorted; then who is still to sign on; then all signed on. Each is
    orange while it needs a look and green once it doesn't. */
export function swmsState(s: Pick<OrgSwmsSummary, "signed" | "total" | "waitingOn" | "issues">): { state: string; tone: Tone } {
  if (s.issues.length > 0) return { state: swmsIssueLine(s), tone: "look" };
  if (s.waitingOn.length > 0) return { state: swmsSignedLine(s), tone: "look" };
  if (s.total === 0) return { state: "Issued", tone: "info" };
  return { state: "All signed on", tone: "good" };
}

/** A project's handover checks: its checklist's Handover section, the
    rows the sheet itself prints. */
export function handoverState(checks: { done: number; total: number }): { state: string; tone: Tone } {
  if (checks.total === 0) return { state: "No handover checks", tone: "info" };
  if (checks.done >= checks.total) return { state: "All checks done", tone: "good" };
  return { state: `${checks.done} of ${checks.total} checks done`, tone: "look" };
}

/* ── a row of each kind ─────────────────────────────────────────────────── */

const dayOf = (iso: string | null | undefined, toDay: (iso: string) => string): string => (iso ? toDay(iso) : "");

/** "3342 Rifkin, Bellevue Hill" */
export function jobLabel(number: string | null, clientName: string | null, place: string | null): string {
  return [jobTabLabel(number, clientName), place?.trim() || null].filter(Boolean).join(", ");
}

export function swmsRow(s: OrgSwmsSummary, job: DocJob | null, toDay: (iso: string) => string): DocRow {
  const { state, tone } = swmsState(s);
  const what = s.kind === "service" ? "Service SWMS" : "Installation SWMS";
  return {
    key: `swms:${s.swmsId}`,
    kind: "swms",
    /* no version number, as on the job card: "revised" says there was one */
    name: s.version > 1 ? `${what}, revised` : what,
    job,
    state,
    tone,
    day: dayOf(s.issuedAt, toDay),
    by: s.responsible && s.responsible !== "—" ? s.responsible : null,
    /* the SWMS opens to its sign-on, where the bell lands (board note F-229) */
    href: `/dashboard/swms/${s.versionId}`,
    newTab: false,
    waiting: s.waitingOn.length > 0,
  };
}

export function certRow(c: OrgCertSummary, job: DocJob | null, toDay: (iso: string) => string): DocRow {
  return {
    key: `cert:${c.certificateId}`,
    kind: "certificate",
    name: c.title,
    job,
    /* sending one records nothing (Isaac's call, taken as recommended), so
       the row says what is known: it was issued, or issued again */
    state: c.version > 1 ? "Reissued" : "Issued",
    tone: "info",
    day: dayOf(c.issuedAt, toDay),
    by: c.issuedBy && c.issuedBy !== "Unnamed" ? c.issuedBy : null,
    href: `/certificates/${c.versionId}`,
    newTab: true,
    waiting: false,
  };
}

export function letterRow(l: LetterSummary, toDay: (iso: string) => string): DocRow {
  return {
    key: `letter:${l.id}`,
    kind: "letter",
    name: l.title,
    job: null,
    state: l.signer ? `Signed by ${l.signer}` : "Not signed",
    tone: "info",
    day: dayOf(l.updatedAt, toDay),
    by: l.writer,
    href: letterHref(l.id),
    newTab: false,
    waiting: false,
  };
}

export function handoverRow(
  p: Pick<ProjectSummary, "id" | "name" | "updatedAt">,
  checks: { done: number; total: number },
  job: DocJob | null,
  toDay: (iso: string) => string,
): DocRow {
  const { state, tone } = handoverState(checks);
  return {
    key: `handover:${p.id}`,
    kind: "handover",
    name: `Handover, ${p.name}`,
    job,
    state,
    tone,
    day: dayOf(p.updatedAt, toDay),
    by: null,
    href: `/handover/${p.id}`,
    newTab: true,
    waiting: false,
  };
}

/* ── the list's state, in the address ───────────────────────────────────── */

export const ANYONE = "anyone";
export const DOC_SORTS = [
  { key: "newest", label: "Newest first" },
  { key: "oldest", label: "Oldest first" },
  { key: "name", label: "Name" },
] as const;
export type DocSort = (typeof DOC_SORTS)[number]["key"];

export type DocsState = { view: DocView; by: string; sort: DocSort; q: string };
export const DEFAULT_DOCS_STATE: DocsState = { view: "all", by: ANYONE, sort: "newest", q: "" };

/** The views this reader has: All, then each kind they may see. */
export function viewsFor(kinds: readonly DocKind[]): { key: DocView; label: string }[] {
  return [{ key: "all", label: "All" }, ...DOC_KINDS.filter((k) => kinds.includes(k)).map((k) => ({ key: k as DocView, label: KIND_LABEL[k] }))];
}

const one = (v: string | string[] | undefined): string => (typeof v === "string" ? v : "");

/** The address's `?view=`, `?by=`, `?sort=` and `?q=`; anything it doesn't
    know, or a view this reader hasn't, is the default. */
export function readDocsState(search: Record<string, string | string[] | undefined>, kinds: readonly DocKind[]): DocsState {
  const view = one(search.view);
  const sort = one(search.sort);
  return {
    view: view === "all" || (kinds as readonly string[]).includes(view) ? (view as DocView) : "all",
    by: one(search.by).trim().slice(0, 120) || ANYONE,
    sort: DOC_SORTS.some((s) => s.key === sort) ? (sort as DocSort) : "newest",
    q: one(search.q).slice(0, 120),
  };
}

/** The address with the list's state on it; a default is left off. */
export function withDocsState(href: string, s: DocsState): string {
  const url = new URL(href, "http://x");
  const put = (k: string, v: string, dflt: string) => (v && v !== dflt ? url.searchParams.set(k, v) : url.searchParams.delete(k));
  put("view", s.view, "all");
  put("by", s.by, ANYONE);
  put("sort", s.sort, "newest");
  put("q", s.q, "");
  return `${url.pathname}${url.search}${url.hash}`;
}

/* ── narrowing and ordering ─────────────────────────────────────────────── */

function matches(r: DocRow, q: string): boolean {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = [r.name, r.job?.label, r.state, r.by, KIND_LABEL[r.kind]].filter(Boolean).join(" ").toLowerCase();
  return words.every((w) => hay.includes(w));
}

/** The rows a person and a search leave, of every kind. */
export function narrowed(rows: readonly DocRow[], s: Pick<DocsState, "by" | "q">): DocRow[] {
  return rows.filter((r) => (s.by === ANYONE || r.by === s.by) && matches(r, s.q));
}

/** The rows the view, the person and the search leave. */
export function rowsFor(rows: readonly DocRow[], s: Pick<DocsState, "view" | "by" | "q">): DocRow[] {
  return narrowed(rows, s).filter((r) => s.view === "all" || r.kind === s.view);
}

export function sortRows(rows: readonly DocRow[], sort: DocSort): DocRow[] {
  const out = [...rows];
  if (sort === "name") return out.sort((a, b) => a.name.localeCompare(b.name) || b.day.localeCompare(a.day));
  if (sort === "oldest") return out.sort((a, b) => a.day.localeCompare(b.day) || a.name.localeCompare(b.name));
  return out.sort((a, b) => b.day.localeCompare(a.day) || a.name.localeCompare(b.name));
}

/** Everyone a row belongs to, by name. */
export function peopleOf(rows: readonly DocRow[]): { value: string; label: string }[] {
  const names = [...new Set(rows.map((r) => r.by).filter((b): b is string => !!b))].sort((a, b) => a.localeCompare(b));
  return names.map((n) => ({ value: n, label: n }));
}

/* ── the Updated column ─────────────────────────────────────────────────── */

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "Today", "Yesterday", "Tuesday" within the week, "9 October", and the
    year once it isn't this one. */
export function dayWord(day: string, today: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return "";
  if (day === today) return "Today";
  const d = new Date(`${day}T00:00:00Z`);
  const t = new Date(`${today}T00:00:00Z`);
  const ago = Math.round((t.getTime() - d.getTime()) / 86400000);
  if (ago === 1) return "Yesterday";
  if (ago > 1 && ago < 7) return WEEKDAYS[d.getUTCDay()]!;
  const dm = `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
  return day.slice(0, 4) === today.slice(0, 4) ? dm : `${dm} ${day.slice(0, 4)}`;
}
