import { daysUntil, parseAuDate } from "@/lib/au-dates";
import { agoLabel, inLabel } from "@/lib/format/duration";
import { fmtDay } from "@/lib/format/day";
import type { StoredDocument } from "@/lib/documents/query";

/* One TERM of a staff licence — the pure rules.

   docs/migrations/staff_licence_records.sql has the argument for the table. In
   short: a ticket RENEWS, and until now the only way to record that was to
   delete the licence and add it again, which threw the old one away. A term is
   a row now. The licence is the IDENTITY (what kind of ticket, what colour);
   its records are what it has been.

   Deliberately the same shape as lib/org/credential-records.ts, because it is
   the same problem one level down — and where the two genuinely differ, they
   differ: a ticket has classes and an issuing state where a policy has a limit
   and an excess, and a ticket has no money on it at all.

   Pure module: no I/O, client-importable, so the modal runs the very validator
   the action runs and a bad date never leaves the browser. */

/** One term, as the screen reads it. */
export type StaffLicenceRecord = {
  id: string;
  licenceId: string;
  issuer: string | null;
  number: string | null;
  /** The classes, categories or conditions the ticket authorises, as printed. */
  classes: string | null;
  /** Which jurisdiction issued it — a driver licence is state-issued. */
  issuingState: string | null;
  startsOn: string | null;
  expiresOn: string;
  /** The document this row was read from, if it was scanned. */
  documentId: string | null;
  source: "scan" | "manual" | null;
  createdAt: string | null;
};

/** What the paper is filed as. The kind that already existed and already meant
    this — see the migration for why no new one was minted. */
export const LICENCE_DOC_KIND = "licence" as const;

/** The term in force: the LATEST EXPIRY, not the newest upload — the same rule
    the licence's cached expiry_date column follows. */
export function currentTerm(records: readonly StaffLicenceRecord[]): StaffLicenceRecord | null {
  return records.reduce<StaffLicenceRecord | null>(
    (best, r) => (!best || r.expiresOn > best.expiresOn ? r : best),
    null
  );
}

/** Every term that is NOT the one in force, newest first. */
export function previousTerms(records: readonly StaffLicenceRecord[]): StaffLicenceRecord[] {
  const current = currentTerm(records);
  return records
    .filter((r) => r.id !== current?.id)
    .sort((a, b) => b.expiresOn.localeCompare(a.expiresOn));
}

/** The paperwork filed under one term: whatever was filed against it, and the
    document it was read from. */
export function termDocuments(
  documents: readonly StoredDocument[],
  term: StaffLicenceRecord
): StoredDocument[] {
  return documents.filter(
    (d) => d.licenceRecordId === term.id || (term.documentId != null && d.id === term.documentId)
  );
}

/** Documents the licence owns that sit under no term — filed before the first
    renewal was recorded. Invisible otherwise, which a document store must
    never be. */
export function looseTermDocuments(
  documents: readonly StoredDocument[],
  records: readonly StaffLicenceRecord[]
): StoredDocument[] {
  const claimed = new Set<string>();
  for (const r of records) {
    if (r.documentId) claimed.add(r.documentId);
    for (const d of documents) if (d.licenceRecordId === r.id) claimed.add(d.id);
  }
  return documents.filter((d) => !claimed.has(d.id));
}

/* ---- status ---- */

/** The same 30-day window the licence card's pill and the dashboard chip use,
    so a ticket that reads "Expires in 2 weeks" on the wall is exactly the one
    raising a chip on Home. */

export type TermState = "ok" | "warn" | "bad" | "none";

export function licenceDays(expiry: string | null, today: string): number | null {
  return expiry ? daysUntil(expiry, today) : null;
}

/** "none" is not "ok". A ticket with no expiry recorded is not evidence that
    the person is ticketed — it is evidence that nobody has said. */
export function termState(expiry: string | null, today: string, warnDays: number): TermState {
  const days = licenceDays(expiry, today);
  if (days == null) return "none";
  return days < 0 ? "bad" : days <= warnDays ? "warn" : "ok";
}

/** "Renews in 3 weeks" · "Renews tomorrow" · "Expires today" · "Expired 4 days ago". */
export function termStatusText(days: number | null): string {
  if (days == null) return "No expiry recorded";
  if (days < 0) return `Expired ${agoLabel(days)}`;
  if (days === 0) return "Expires today";
  if (days === 1) return "Renews tomorrow";
  return `Renews ${inLabel(days)}`;
}

/** The headline on the status card. */
export function termHeadline(expiry: string | null, today: string, warnDays: number): string {
  const state = termState(expiry, today, warnDays);
  if (state === "none") return "No expiry recorded";
  if (state === "ok") return "Current";
  return termStatusText(licenceDays(expiry, today));
}

/* ---- the grid ---- */

const dash = "—";

export type TermFact = { label: string; value: string; tone?: "faint" | "warn" };

/** The term in force, as label-over-value pairs. Only what the plastic card
    actually prints and this table holds — an empty field is a quiet dash,
    never an invented value, and never a personal detail the reader was not
    asked for (see licence-readers.ts on what is deliberately NOT read). */
export function termFacts(r: StaffLicenceRecord, state: TermState): TermFact[] {
  const faint = (v: unknown): TermFact["tone"] => (v ? undefined : "faint");
  return [
    { label: "LICENCE NO.", value: r.number ?? dash, tone: faint(r.number) },
    { label: "ISSUED BY", value: r.issuer ?? dash, tone: faint(r.issuer) },
    { label: "STATE", value: r.issuingState ?? dash, tone: faint(r.issuingState) },
    { label: "CLASSES", value: r.classes ?? dash, tone: faint(r.classes) },
    { label: "ISSUED", value: r.startsOn ? fmtDay(r.startsOn) : dash, tone: faint(r.startsOn) },
    {
      label: "EXPIRY",
      value: fmtDay(r.expiresOn),
      tone: state === "ok" || state === "none" ? undefined : "warn",
    },
  ];
}

/** The one-line summary on a history row.

    The issuer LEADS rather than sitting behind a "Term ·" prefix, because a
    staff issuer is a long name ("Australian Refrigeration Council") and the
    prefix pushed the only distinguishing word off the end of the row. The
    state goes in brackets after it, the way a person would say it. */
export function termEvent(r: StaffLicenceRecord): string {
  const issuer = r.issuer?.trim();
  const state = r.issuingState?.trim();
  if (issuer) return state ? `${issuer} (${state})` : issuer;
  return state ? `${state} licence` : "Term";
}

/** "Added 4 Feb 2026 · scanned from the card". */
export function termAddedText(r: StaffLicenceRecord): string {
  const when = r.createdAt ? `Added ${fmtDay(r.createdAt)}` : "";
  const how = r.source === "scan" ? "scanned from the card" : r.source === "manual" ? "entered manually" : "";
  return [when, how].filter(Boolean).join(" · ");
}

/* ---- what goes in the table ---- */

export type LicenceTermInput = {
  issuer?: string;
  number?: string;
  classes?: string;
  issuingState?: string;
  /** dd/mm/yyyy, or the ISO a picker emits. */
  startsOn?: string;
  expiresOn?: string;
  documentId?: string | null;
  source?: string;
};

export type LicenceTermRow = {
  issuer: string | null;
  number: string | null;
  classes: string | null;
  issuing_state: string | null;
  starts_on: string | null;
  expires_on: string;
  document_id: string | null;
  source: "scan" | "manual";
};

const text = (v: string | undefined, cap: number): string | null => {
  const s = (v ?? "").trim();
  return s ? s.slice(0, cap) : null;
};

/** Validate + normalise one term for insert, or say why not. Mirrors
    buildLicenceRow — same date rule, same caps, same refusal wording. */
export function buildLicenceTermRow(
  input: LicenceTermInput
): { row: LicenceTermRow } | { error: string } {
  const rawExpiry = (input.expiresOn ?? "").trim();
  if (!rawExpiry) return { error: "An expiry date is what makes this a term — pick one." };
  const expires = parseAuDate(rawExpiry);
  if (!expires) return { error: "Check the expiry date — use dd/mm/yyyy." };

  let starts: string | null = null;
  const rawStart = (input.startsOn ?? "").trim();
  if (rawStart) {
    starts = parseAuDate(rawStart);
    if (!starts) return { error: "Check the issue date — use dd/mm/yyyy." };
    /* A term that ends before it begins is a typo, and it is worth catching
       here: saved, it would sort as the current term and silence the real one
       behind it. */
    if (starts > expires) return { error: "The issue date is after the expiry — check the dates." };
  }

  return {
    row: {
      issuer: text(input.issuer, 120),
      number: text(input.number, 80),
      classes: text(input.classes, 160),
      issuing_state: text(input.issuingState, 12),
      starts_on: starts,
      expires_on: expires,
      document_id: input.documentId ?? null,
      source: input.source === "scan" ? "scan" : "manual",
    },
  };
}

/* ---- reminders ----
   A reminder is a TASK, exactly as it is for a vehicle renewal and a business
   policy. These are the few facts a ticket adds. The leads themselves are the
   fleet's — one set of chips in the product, not three. */

/** "Renew ARC licence — Bob Smith", or just "Renew ARC licence" when it is
    your own. The name is there when it is somebody else's because a manager's
    bell carries several people's tickets and none of them say whose. */
export function licenceReminderTitle(typeName: string, subject: string | null): string {
  const what = typeName.trim() || "licence";
  const who = (subject ?? "").trim();
  return who ? `Renew ${what} — ${who}` : `Renew ${what}`;
}

/** "Expires 29 Sep 2027 · 30 days' notice" — the line under the title. */
export function licenceReminderDetail(expiresOn: string, leadDays: number): string {
  const notice = leadDays === 1 ? "1 day's notice" : leadDays > 0 ? `${leadDays} days' notice` : null;
  return [`Expires ${fmtDay(expiresOn)}`, notice].filter(Boolean).join(" · ");
}
