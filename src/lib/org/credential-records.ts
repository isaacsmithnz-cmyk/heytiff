import { daysUntil, parseAuDate } from "@/lib/au-dates";
import { agoLabel, inLabel } from "@/lib/format/duration";
import { fmtDay } from "@/lib/format/day";
import type { DocumentKind } from "@/lib/documents/files";
import type { StoredDocument } from "@/lib/documents/query";
import {
  termFieldsFor,
  termLabelFor,
  type OrgCredKind,
  type OrgCredentialInput,
  type TermField,
} from "./credentials";

/* One TERM of a business licence or insurance policy — the pure rules.

   docs/migrations/org_credential_records.sql has the argument for the table.
   In short: a renewal used to overwrite three columns on org_credentials, so
   recording this year's certificate destroyed last year's, and with it both
   "what have we paid for this since 2022" and "were we covered on the day of
   that job". A term is a row now. The credential is the IDENTITY (what it is,
   what colour it wears); its records are what it has been.

   Deliberately the same shape as the fleet's vehicle-modal/derive.ts, because
   it is the same problem: which record is in force, what its status reads as,
   which paperwork sits under it. Pure module — no I/O, client-importable — so
   the modal runs the very validator the action runs and a bad date never
   leaves the browser. */

/** One term, as the screen reads it. */
export type OrgCredentialRecord = {
  id: string;
  credentialId: string;
  issuer: string | null;
  number: string | null;
  /** The classes of work on a licence, or what the policy covers. As printed. */
  cover: string | null;
  /** Insurance: the limit of liability. Null on a licence. */
  sumInsured: number | null;
  premium: number | null;
  excess: number | null;
  /** Workers compensation: the number of workers the premium is rated on, and
      the wages declared for the period. Null on every other kind of paper —
      see termFieldsFor for which paper carries what. */
  workersCount: number | null;
  wages: number | null;
  startsOn: string | null;
  expiresOn: string;
  /** The document this row was read from, if it was scanned. */
  documentId: string | null;
  source: "scan" | "manual" | null;
  createdAt: string | null;
};

/** What the paper is filed as. Two kinds, never the staff or vehicle ones —
    see lib/documents/files.ts for why the kind is the ownership guard. */
export const CREDENTIAL_DOC_KIND: Record<OrgCredKind, DocumentKind> = {
  licence: "org_licence",
  insurance: "org_insurance",
};

/* BOTH OF THE ORG'S OWN KINDS, because the file is stamped before the card is
   named. The scan panel uploads the moment a certificate is dropped, and the
   kind it stamps is whatever the Type box said at that instant — so a person
   who drops a certificate of currency and then sets Type to Insurance has
   already filed it as `org_licence`. Adoption used to demand the one exact
   kind, found none, and left the certificate owned by nothing: it happened to
   Isaac's icare workers-compensation certificate on 2026-09-08, which reads
   "scanned from the document" above "No paperwork filed under this term yet".

   So adoption takes EITHER of the two and corrects the stamp on the way in.
   The guard that matters is untouched — a staff `licence` or a vehicle
   `insurance_policy` is still refused, and that is the boundary the kind was
   made to hold (lib/documents/files.ts). These two are the same owner. */
export const ORG_CREDENTIAL_DOC_KINDS: readonly DocumentKind[] = ["org_licence", "org_insurance"];

/** What the paper is CALLED, per kind. */
export const CREDENTIAL_PAPER: Record<OrgCredKind, string> = {
  licence: "Licence certificate",
  insurance: "Certificate of currency",
};

/** The record in force: the LATEST EXPIRY, not the newest upload — the same
    rule the credential's cached expiry_date column follows. */
export function currentRecord(records: readonly OrgCredentialRecord[]): OrgCredentialRecord | null {
  return records.reduce<OrgCredentialRecord | null>(
    (best, r) => (!best || r.expiresOn > best.expiresOn ? r : best),
    null
  );
}

/** Every term that is NOT the one in force, newest first. */
export function previousRecords(records: readonly OrgCredentialRecord[]): OrgCredentialRecord[] {
  const current = currentRecord(records);
  return records
    .filter((r) => r.id !== current?.id)
    .sort((a, b) => b.expiresOn.localeCompare(a.expiresOn));
}

/** The paperwork filed under one term: whatever was filed against it, and the
    document it was read from — which is linked from the record's side. */
export function recordDocuments(
  documents: readonly StoredDocument[],
  record: OrgCredentialRecord
): StoredDocument[] {
  return documents.filter(
    (d) => d.credentialRecordId === record.id || (record.documentId != null && d.id === record.documentId)
  );
}

/** Documents that belong to the credential but sit under no term — filed
    before any renewal was recorded, or attached to the card itself. */
export function looseDocuments(
  documents: readonly StoredDocument[],
  records: readonly OrgCredentialRecord[]
): StoredDocument[] {
  const claimed = new Set<string>();
  for (const r of records) {
    if (r.documentId) claimed.add(r.documentId);
    for (const d of documents) if (d.credentialRecordId === r.id) claimed.add(d.id);
  }
  return documents.filter((d) => !claimed.has(d.id));
}

/* ---- status ---- */

/** How many days early the wall starts warning. The staff card's number, on
    purpose: an owner reading "expires in 3 weeks" should mean the same thing
    on their own card and on the company's. */

export type CredentialState = "ok" | "warn" | "bad" | "none";

/** Days until the credential's expiry; null when nothing is recorded. */
export function credentialDays(expiry: string | null, today: string): number | null {
  return expiry ? daysUntil(expiry, today) : null;
}

/** The state a credential is in. "none" is not "ok": nothing has been recorded,
    which is not evidence the business is covered — it is evidence nobody has
    said. The card says so in words rather than counting down to a made-up date. */
export function credentialState(expiry: string | null, today: string, warnDays: number): CredentialState {
  const days = credentialDays(expiry, today);
  if (days == null) return "none";
  return days < 0 ? "bad" : days <= warnDays ? "warn" : "ok";
}

/** "Renews in 3 weeks" · "Renews tomorrow" · "Expires today" · "Expired 4 days ago". */
export function credentialStatusText(days: number | null): string {
  if (days == null) return "No expiry recorded";
  if (days < 0) return `Expired ${agoLabel(days)}`;
  if (days === 0) return "Expires today";
  if (days === 1) return "Renews tomorrow";
  return `Renews ${inLabel(days)}`;
}

/** The headline on the status card. A policy in force says so in one word;
    everything else counts. */
export function credentialHeadline(
  kind: OrgCredKind,
  expiry: string | null,
  today: string,
  warnDays: number
): string {
  const state = credentialState(expiry, today, warnDays);
  if (state === "none") return kind === "insurance" ? "No policy recorded" : "No licence term recorded";
  if (state === "ok") return kind === "insurance" ? "Covered" : "Current";
  return credentialStatusText(credentialDays(expiry, today));
}

/* ---- the grids ---- */

const dash = "—";

export type RecordFact = { label: string; value: string; tone?: "faint" | "warn" };

/** Money as the certificate prints it: whole dollars for a premium, and a
    limit of liability in the millions said the way a broker says it. */
export function fmtCredMoney(n: number): string {
  return `$${Math.round(n).toLocaleString("en-AU")}`;
}

export function fmtSumInsured(n: number): string {
  if (n >= 1_000_000 && n % 100_000 === 0) {
    const m = n / 1_000_000;
    return `$${Number.isInteger(m) ? m : m.toFixed(1)}m`;
  }
  return fmtCredMoney(n);
}

/** The record in force, as label-over-value pairs. Only what a real
    certificate prints and the table holds — an empty field reads as a dash in
    the quiet tone, never as an invented value. */
/* THE SAME NARROWING THE FORM DOES, on the read-only side.

   A cell that reads "—" says the document was silent about something it could
   have said, and on a public liability policy an em-dash under LIMIT is a real
   problem — the business cannot prove the number a head contractor asked for.
   That reading only survives if a dash is never printed for a fact the paper
   was incapable of carrying, which is exactly what LIMIT, PREMIUM and EXCESS
   did on every workers compensation policy. `name` is optional so the two
   history callers that only have a kind still work; without it the kind's full
   set is shown, which is the old behaviour. */
export function recordFacts(
  kind: OrgCredKind,
  r: OrgCredentialRecord,
  state: CredentialState,
  name = ""
): RecordFact[] {
  const faint = (v: unknown): RecordFact["tone"] => (v ? undefined : "faint");
  const money = (n: number | null) => (n != null ? fmtCredMoney(n) : dash);
  const fields = termFieldsFor(kind, name);
  const has = (f: TermField) => fields.includes(f);
  const expiry: RecordFact = {
    label: "EXPIRY",
    value: fmtDay(r.expiresOn),
    tone: state === "ok" || state === "none" ? undefined : "warn",
  };

  if (kind === "insurance") {
    return [
      { label: "INSURER", value: r.issuer ?? dash, tone: faint(r.issuer) },
      { label: "POLICY NO.", value: r.number ?? dash, tone: faint(r.number) },
      has("cover") && {
        label: (termLabelFor(kind, name, "cover") ?? "Cover").toUpperCase(),
        value: r.cover ?? dash,
        tone: faint(r.cover),
      },
      has("sumInsured") && {
        label: "LIMIT",
        value: r.sumInsured != null ? fmtSumInsured(r.sumInsured) : dash,
        tone: faint(r.sumInsured),
      },
      has("workers") && {
        label: "WORKERS",
        value: r.workersCount != null ? String(r.workersCount) : dash,
        tone: faint(r.workersCount),
      },
      has("wages") && { label: "WAGES", value: money(r.wages), tone: faint(r.wages) },
      { label: "STARTS", value: r.startsOn ? fmtDay(r.startsOn) : dash, tone: faint(r.startsOn) },
      expiry,
      has("premium") && { label: "PREMIUM", value: money(r.premium), tone: faint(r.premium) },
      has("excess") && { label: "EXCESS", value: money(r.excess), tone: faint(r.excess) },
    ].filter((f): f is RecordFact => f !== false);
  }
  return [
    { label: "ISSUED BY", value: r.issuer ?? dash, tone: faint(r.issuer) },
    { label: "LICENCE NO.", value: r.number ?? dash, tone: faint(r.number) },
    has("cover") && { label: "CLASSES", value: r.cover ?? dash, tone: faint(r.cover) },
    { label: "ISSUED", value: r.startsOn ? fmtDay(r.startsOn) : dash, tone: faint(r.startsOn) },
    expiry,
    has("premium") && { label: "FEE PAID", value: money(r.premium), tone: faint(r.premium) },
  ].filter((f): f is RecordFact => f !== false);
}

/** The one-line summary on a history row. */
export function recordEvent(kind: OrgCredKind, r: OrgCredentialRecord): string {
  const who = r.issuer?.trim();
  if (kind === "insurance") return who ? `Policy · ${who}` : "Policy term";
  return who ? `Licence · ${who}` : "Licence term";
}

/** "Added 4 Feb 2026 · scanned from the document" — how this row got here. */
export function recordAddedText(r: OrgCredentialRecord): string {
  const when = r.createdAt ? `Added ${fmtDay(r.createdAt)}` : "";
  const how = r.source === "scan" ? "scanned from the document" : r.source === "manual" ? "entered manually" : "";
  return [when, how].filter(Boolean).join(" · ");
}

/* ---- what goes in the table ---- */

export type CredentialRecordInput = {
  issuer?: string;
  number?: string;
  cover?: string;
  sumInsured?: string | number | null;
  premium?: string | number | null;
  excess?: string | number | null;
  workersCount?: string | number | null;
  wages?: string | number | null;
  /** dd/mm/yyyy, or the ISO a picker emits. */
  startsOn?: string;
  expiresOn?: string;
  documentId?: string | null;
  source?: string;
};

export type CredentialRecordRow = {
  issuer: string | null;
  number: string | null;
  cover: string | null;
  sum_insured: number | null;
  premium: number | null;
  excess: number | null;
  workers_count: number | null;
  wages: number | null;
  starts_on: string | null;
  expires_on: string;
  document_id: string | null;
  source: "scan" | "manual";
};

/** A dollar figure a person typed, or nothing. Never NaN, never negative, and
    never a zero invented out of an empty box — a certificate that doesn't
    print a premium must not gain one. */
function money(v: string | number | null | undefined): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100) / 100;
}

/** A head count. Whole, non-negative, and never invented from an empty box —
    the same posture as `money`, which is the only reason it is not `money`:
    2.5 workers is not a number a certificate can print. */
function count(v: string | number | null | undefined): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isInteger(v) && v >= 0 ? v : null;
  /* Thousands separators are forgiven; a decimal point is NOT. Stripping
     every non-digit would turn "11.5" into 115 and "-4" into 4 — a wrong
     number stored silently, which is worse than a refused one. The box only
     accepts digits, so this is the guard for a value that came another way. */
  const s = v.trim().replace(/[\s,]/g, "");
  return /^\d+$/.test(s) ? parseInt(s, 10) : null;
}

const text = (v: string | undefined, cap: number): string | null => {
  const s = (v ?? "").trim();
  return s ? s.slice(0, cap) : null;
};

/** Validate + normalise one term for insert, or say why not. Mirrors
    buildOrgCredentialRow — same date rule, same caps, same refusal wording. */
export function buildCredentialRecordRow(
  input: CredentialRecordInput
): { row: CredentialRecordRow } | { error: string } {
  const rawExpiry = (input.expiresOn ?? "").trim();
  if (!rawExpiry) return { error: "An expiry date is what makes this a term — pick one." };
  const expires = parseAuDate(rawExpiry);
  if (!expires) return { error: "Check the expiry date — use dd/mm/yyyy." };

  let starts: string | null = null;
  const rawStart = (input.startsOn ?? "").trim();
  if (rawStart) {
    starts = parseAuDate(rawStart);
    if (!starts) return { error: "Check the start date — use dd/mm/yyyy." };
    /* A term that ends before it begins is a typo, and it is worth catching
       here: saved, it would sort as the current record and silence the real
       one behind it. */
    if (starts > expires) return { error: "The start date is after the expiry — check the dates." };
  }

  return {
    row: {
      issuer: text(input.issuer, 120),
      number: text(input.number, 80),
      cover: text(input.cover, 160),
      sum_insured: money(input.sumInsured),
      premium: money(input.premium),
      excess: money(input.excess),
      workers_count: count(input.workersCount),
      wages: money(input.wages),
      starts_on: starts,
      expires_on: expires,
      document_id: input.documentId ?? null,
      source: input.source === "scan" ? "scan" : "manual",
    },
  };
}

/* ADDING A CARD FROM A SCAN IS NOT ALWAYS ADDING A TERM.

   The scan panel on Add card collects a term's fields, but a term is a period
   and `expires_on` is NOT NULL — so a licence with no renewal date cannot be
   one. The screen used to answer that by sending nothing at all, and the
   certificate it had ALREADY uploaded was left in the bucket owned by nothing,
   along with the number and issuer read off it.

   With an expiry, the scan is the card's first term and its document rides on
   the term, as before. Without one, the number and issuer go on the card —
   the one place a card with no term keeps them — and the document is filed
   against the card itself, under no record, which is the row looseDocuments
   reads back. What else a term holds has nowhere to live on a bare card, and
   the certificate still carries it. */
export function splitAddScan(
  input: OrgCredentialInput,
  scan?: CredentialRecordInput,
): { input: OrgCredentialInput; term: CredentialRecordInput | null; cardDocumentId: string | null } {
  if (!scan) return { input, term: null, cardDocumentId: null };
  if ((scan.expiresOn ?? "").trim()) return { input, term: scan, cardDocumentId: null };
  return {
    input: {
      ...input,
      number: (scan.number ?? "").trim() || input.number,
      issuer: (scan.issuer ?? "").trim() || input.issuer,
    },
    term: null,
    cardDocumentId: scan.documentId ?? null,
  };
}

/* ---- reminders ----
   A reminder is a TASK, exactly as it is for a vehicle renewal (see
   lib/fleet/reminders.ts). These are the few facts the credential adds: what
   the task is called, and what the bell says under it. The leads themselves
   are the fleet's — one set of chips in the product, not two. */

