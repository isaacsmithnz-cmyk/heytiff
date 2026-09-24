import type { StoredDocument } from "@/lib/documents/query";
import {
  currentRecord,
  looseDocuments,
  recordDocuments,
  type OrgCredentialRecord,
} from "@/lib/org/credential-records";
import {
  currentTerm,
  looseTermDocuments,
  termDocuments,
  type StaffLicenceRecord,
} from "@/lib/staff/licence-records";

/* WHICH PAPER A JOB GETS FROM A CREDENTIAL OR A TICKET — the pure rule both
   the chooser and the job's own rows read.

   A credential and a ticket are the same shape one level apart: terms, each
   with an expiry, and the paperwork filed under them. "Current" is the latest
   expiry (lib/org/credential-records, lib/staff/licence-records); what a job
   holds is the term that was PINNED when it went on (job_compliance.sql), so
   the history stays true after a renewal. */

type Term = { id: string; expiresOn: string; issuer: string | null };

export type TermPaper<T extends Term> = {
  /** The term the paper is filed under — the pinned one while it exists,
      otherwise the current one. Null for a card that has never had a term. */
  term: T | null;
  files: StoredDocument[];
  /** A newer term than the pinned one has come in, WITH paper under it — a
      renewal recorded without its certificate is nothing to move to. */
  renewed: boolean;
};

function paperOf<T extends Term>(
  terms: readonly T[],
  docs: readonly StoredDocument[],
  current: (terms: readonly T[]) => T | null,
  under: (docs: readonly StoredDocument[], term: T) => StoredDocument[],
  loose: (docs: readonly StoredDocument[], terms: readonly T[]) => StoredDocument[],
  pinned?: string | null
): TermPaper<T> {
  const now = current(terms);
  const term = (pinned ? terms.find((t) => t.id === pinned) : null) ?? now;
  /* a card with no term at all gives what is filed on the card itself; one
     WITH terms never falls back to its loose papers, which are older than
     every term by construction */
  if (!term) return { term: null, files: terms.length === 0 ? loose(docs, terms) : [], renewed: false };
  const renewed = !!now && now.id !== term.id && under(docs, now).length > 0;
  return { term, files: under(docs, term), renewed };
}

/** The business's credential: its terms, the documents it owns, the pin. */
export function credentialPaper(
  terms: readonly OrgCredentialRecord[],
  docs: readonly StoredDocument[],
  pinned?: string | null
): TermPaper<OrgCredentialRecord> {
  return paperOf(terms, docs, currentRecord, recordDocuments, looseDocuments, pinned);
}

/** A person's ticket: its terms, the documents it owns, the pin. */
export function licencePaper(
  terms: readonly StaffLicenceRecord[],
  docs: readonly StoredDocument[],
  pinned?: string | null
): TermPaper<StaffLicenceRecord> {
  return paperOf(terms, docs, currentTerm, termDocuments, looseTermDocuments, pinned);
}
