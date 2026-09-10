import { daysUntil, parseAuDate } from "@/lib/au-dates";
import { agoLabel, inLabel } from "@/lib/format/duration";
import { fmtDay } from "@/lib/format/day";
import type { StoredDocument } from "@/lib/documents/query";
import { WORK_RIGHTS, isNoVisa } from "./work-rights";

/* ONE CHECK of a person's right to work — the pure rules.

   docs/migrations/staff_work_rights_records.sql has the argument for the
   table. The shape is the one the fleet, the business's papers and staff
   tickets already use, WITH ONE RULE DELIBERATELY INVERTED:

     A LICENCE'S CURRENT TERM IS THE LATEST EXPIRY. You hold the old card and
     the new one, and the one that runs longest governs.

     WORK RIGHTS' CURRENT RECORD IS THE LATEST CHECK. Status goes BACKWARDS —
     a substantive visa lapses to a bridging visa, full rights become
     conditional, a visa is cancelled — and the most recent thing the employer
     verified is what they may rely on. Sorting by expiry would let a stale
     2024 record with a longer date outrank a check made this morning saying
     the person can no longer work. That is not a nicer bug than the one the
     history was built to fix; it is a worse one.

   Pure module: no I/O, client-importable, so the modal runs the very validator
   the action runs. */

/** One check, as the screen reads it. */
export type WorkRightsRecord = {
  id: string;
  staffProfileId: string;
  /** One of WORK_RIGHTS, as it stood when checked. */
  status: string;
  /** Null for a citizen or permanent resident, who hold no visa. */
  visaType: string | null;
  /** The work limitation as printed. */
  hoursCondition: string | null;
  /** Null = does not expire. That is the citizen/PR case, not a missing value. */
  expiresOn: string | null;
  /** When the employer established this. The spine of the record. */
  checkedOn: string;
  source: "vevo" | "scan" | "manual" | null;
  documentId: string | null;
  createdAt: string | null;
};

/** What the evidence is filed as. The kind that has existed since the
    documents track was built and that, until now, nothing owned. */
export const WORK_RIGHTS_DOC_KIND = "work_rights" as const;

/** The record in force: THE LATEST CHECK, tie-broken by when it was entered.
    Not the latest expiry — see the note at the top of this file. */
export function currentCheck(records: readonly WorkRightsRecord[]): WorkRightsRecord | null {
  return records.reduce<WorkRightsRecord | null>((best, r) => {
    if (!best) return r;
    if (r.checkedOn !== best.checkedOn) return r.checkedOn > best.checkedOn ? r : best;
    return (r.createdAt ?? "") > (best.createdAt ?? "") ? r : best;
  }, null);
}

/** Every check that is NOT the one in force, newest first. */
export function previousChecks(records: readonly WorkRightsRecord[]): WorkRightsRecord[] {
  const current = currentCheck(records);
  return records
    .filter((r) => r.id !== current?.id)
    .sort((a, b) => b.checkedOn.localeCompare(a.checkedOn));
}

/** The evidence filed under one check, plus the document it was read from. */
export function checkDocuments(
  documents: readonly StoredDocument[],
  record: WorkRightsRecord
): StoredDocument[] {
  return documents.filter(
    (d) => d.workRightsRecordId === record.id || (record.documentId != null && d.id === record.documentId)
  );
}

/** Evidence the person owns that sits under no check — filed before the first
    one was recorded. Invisible otherwise, which a document store must never be. */
export function looseCheckDocuments(
  documents: readonly StoredDocument[],
  records: readonly WorkRightsRecord[]
): StoredDocument[] {
  const claimed = new Set<string>();
  for (const r of records) {
    if (r.documentId) claimed.add(r.documentId);
    for (const d of documents) if (d.workRightsRecordId === r.id) claimed.add(d.id);
  }
  return documents.filter((d) => !claimed.has(d.id));
}

/* ---- status ---- */


/** "none" is nothing recorded; "forever" is recorded and does not expire —
    a citizen. Collapsing the two would make a citizen's card read as an
    unanswered question forever, which is the exact bug work-rights.ts's
    `isNoVisa` was written to kill. */
export type CheckState = "ok" | "warn" | "bad" | "forever" | "none";

export function checkState(record: WorkRightsRecord | null, today: string, warnDays: number): CheckState {
  if (!record) return "none";
  if (!record.expiresOn) return "forever";
  const days = daysUntil(record.expiresOn, today);
  return days < 0 ? "bad" : days <= warnDays ? "warn" : "ok";
}

/** The headline on the status card. */
export function checkHeadline(record: WorkRightsRecord | null, today: string, warnDays: number): string {
  const state = checkState(record, today, warnDays);
  if (state === "none") return "Right to work not recorded";
  // a citizen or PR: the status IS the answer, and there is no date under it
  if (state === "forever") return record!.status;
  const days = daysUntil(record!.expiresOn!, today);
  if (days < 0) return `Expired ${agoLabel(days)}`;
  if (days === 0) return "Expires today";
  if (days === 1) return "Expires tomorrow";
  return `Expires ${inLabel(days)}`;
}

/** The line under the headline: what was checked, and when. */
export function checkSubline(record: WorkRightsRecord | null): string {
  if (!record) return "Record a check to start the history.";
  const bits = [
    record.visaType?.trim() || (isNoVisa(record.status) ? null : record.status),
    record.expiresOn ? `expires ${fmtDay(record.expiresOn)}` : "no expiry",
    `checked ${fmtDay(record.checkedOn)}`,
  ].filter(Boolean);
  return bits.join(" · ");
}

/* ---- the grid ---- */

const dash = "—";

export type CheckFact = { label: string; value: string; tone?: "faint" | "warn" };

/** One check's facts. A citizen's record does NOT print empty visa rows: the
    card has unmounted the visa block for those statuses since it was built,
    and a grid reading "VISA —" for someone who has never held one answers a
    question nobody asked. */
export function checkFacts(r: WorkRightsRecord, state: CheckState): CheckFact[] {
  const faint = (v: unknown): CheckFact["tone"] => (v ? undefined : "faint");
  const facts: CheckFact[] = [{ label: "STATUS", value: r.status }];
  if (!isNoVisa(r.status)) {
    facts.push(
      { label: "VISA", value: r.visaType ?? dash, tone: faint(r.visaType) },
      { label: "WORK CONDITION", value: r.hoursCondition ?? dash, tone: faint(r.hoursCondition) },
      {
        label: "EXPIRY",
        value: r.expiresOn ? fmtDay(r.expiresOn) : "No expiry",
        tone: r.expiresOn && (state === "warn" || state === "bad") ? "warn" : faint(r.expiresOn),
      }
    );
  }
  facts.push({ label: "CHECKED", value: fmtDay(r.checkedOn) });
  return facts;
}

/** The one-line summary on a history row. */
export function checkEvent(r: WorkRightsRecord): string {
  const visa = r.visaType?.trim();
  return visa ? `${r.status} · ${visa}` : r.status;
}

/** "Added 4 Feb 2026 · VEVO check" — how this row got here. */
export function checkAddedText(r: WorkRightsRecord): string {
  const when = r.createdAt ? `Added ${fmtDay(r.createdAt)}` : "";
  const how =
    r.source === "vevo"
      ? "VEVO check"
      : r.source === "scan"
        ? "scanned from the document"
        : r.source === "manual"
          ? "entered manually"
          : "";
  return [when, how].filter(Boolean).join(" · ");
}

/* ---- what goes in the table ---- */

export type WorkRightsCheckInput = {
  status?: string;
  visaType?: string;
  hoursCondition?: string;
  /** dd/mm/yyyy or ISO; blank for an entitlement that does not expire. */
  expiresOn?: string;
  checkedOn?: string;
  documentId?: string | null;
  source?: string;
};

export type WorkRightsCheckRow = {
  status: string;
  visa_type: string | null;
  hours_condition: string | null;
  expires_on: string | null;
  checked_on: string;
  document_id: string | null;
  source: "vevo" | "scan" | "manual";
};

const text = (v: string | undefined, cap: number): string | null => {
  const s = (v ?? "").trim();
  return s ? s.slice(0, cap) : null;
};

const asSource = (v: string | undefined): WorkRightsCheckRow["source"] =>
  v === "vevo" || v === "scan" ? v : "manual";

/** Validate + normalise one check for insert, or say why not. */
export function buildWorkRightsCheckRow(
  input: WorkRightsCheckInput
): { row: WorkRightsCheckRow } | { error: string } {
  const status = (input.status ?? "").trim();
  if (!status) return { error: "Say what this person's right to work is." };
  if (!(WORK_RIGHTS as readonly string[]).includes(status)) {
    return { error: "That isn't one of the work-rights statuses." };
  }

  const rawChecked = (input.checkedOn ?? "").trim();
  if (!rawChecked) return { error: "A check needs the date it was made — pick one." };
  const checked = parseAuDate(rawChecked);
  if (!checked) return { error: "Check the date — use dd/mm/yyyy." };

  /* A CITIZEN HAS NO VISA, so their record carries none — and the fields are
     dropped here rather than merely hidden on the card, so a status flicked
     back and forth in a draft cannot leave a visa number on the record of
     somebody who has never held one. Same rule the form has always applied on
     save (buildPatch); it holds for a check too. */
  const noVisa = isNoVisa(status);

  let expires: string | null = null;
  const rawExpiry = (input.expiresOn ?? "").trim();
  if (rawExpiry && !noVisa) {
    expires = parseAuDate(rawExpiry);
    if (!expires) return { error: "Check the expiry date — use dd/mm/yyyy." };
  }

  return {
    row: {
      status: status.slice(0, 60),
      visa_type: noVisa ? null : text(input.visaType, 80),
      hours_condition: noVisa ? null : text(input.hoursCondition, 120),
      expires_on: expires,
      checked_on: checked,
      document_id: input.documentId ?? null,
      source: asSource(input.source),
    },
  };
}

/** What both section-savers say when the flat fields are refused. Here rather
    than in either action file, so the two cannot drift into two wordings for
    one rule — and so a `"use server"` module never has to import another. */
export const WORK_RIGHTS_LOCKED =
  "Right to work is recorded as checks now — open it and record a check instead.";

/* ---- reminders ---- */

/** "Right to work expires — Bob Smith", or without the name when it is your
    own. Deliberately NOT "Renew visa": the business does not renew anybody's
    visa, and a task telling a manager to do so names the wrong action. What
    falls due is a CHECK. */
export function workRightsReminderTitle(subject: string | null): string {
  const who = (subject ?? "").trim();
  return who ? `Check right to work — ${who}` : "Check your right to work";
}

/** "Expires 4 Mar 2028 · 30 days' notice". */
export function workRightsReminderDetail(expiresOn: string, leadDays: number): string {
  const notice = leadDays === 1 ? "1 day's notice" : leadDays > 0 ? `${leadDays} days' notice` : null;
  return [`Expires ${fmtDay(expiresOn)}`, notice].filter(Boolean).join(" · ");
}
