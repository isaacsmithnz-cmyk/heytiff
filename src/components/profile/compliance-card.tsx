"use client";

import { useState, type ReactNode } from "react";
import { LicenceCard } from "@/components/cards/licence-card";
import { Button } from "@/components/parts/button";
import { fmtDay } from "@/lib/format/day";
import { StateWord, type Tone } from "@/components/parts/state";
import type { StoredDocument } from "@/lib/documents/query";
import { licenceStatus } from "@/lib/staff/licence";
import {
  termState,
  type LicenceScanDetails,
  type LicenceTermInput,
  type StaffLicenceRecord,
} from "@/lib/staff/licence-records";
import { formatAuDate } from "@/lib/staff/profile";
import type { StaffLicence } from "@/lib/staff/types";
import { LicenceModal } from "./licence-modal";
import type { LicenceInput, SaveResult } from "./types";

/* Compliance — the licences and tickets, as a wall of cards you can open.

   WHAT CHANGED. This tab used to be an inline add-form over a wall of cards
   with a remove × on each. That made a ticket a thing you ADD and DELETE, and
   nothing else — so recording a renewal meant deleting the licence and adding
   it back, which threw the previous term away with it. There was no answer to
   "was this person ticketed on the day of that job".

   Now a card is a DOOR. Behind it: the term in force, the photo of the card it
   was read from, reminders before it lapses, a scan panel that files the next
   term, and the history underneath. Every card says how many terms it has, so
   there is a reason to open it.

   Still no read/edit cycle here — each card owns its own modal and each write
   is its own action. And still no router.refresh() after a write: every one of
   these actions revalidates the two paths that render this screen, so the RSC
   payload that comes back already carries the new list. */

export function ComplianceCard({
  licences,
  staffId,
  records = {},
  documents = {},
  today,
  warnDays,
  onAdd,
  onUpdate,
  onRemove,
  onRecordTerm,
  onAttachDoc,
  onRemoveTerm,
  startAdding = false,
  layout = "wall",
  lead,
}: {
  /** "rows" only: a mark before the title (the person page's section icon) */
  lead?: ReactNode;
  /** "rows" is Team's person page: a titled group, a row per ticket with
      its state in words and Renew licence on one running out, and Add a
      licence on the head. The same modal behind every door. */
  layout?: "wall" | "rows";
  licences: StaffLicence[];
  /** Whose card this is — the scan action and every write are scoped to it. */
  staffId: string;
  /* The terms behind the cards, their paperwork, and the VIEWER's own
     reminders, all keyed by licence id and all loaded once for the wall.
     Defaulted so a caller that only wants the old add/remove behaviour need
     not supply three empty maps. */
  records?: Record<string, StaffLicenceRecord[]>;
  documents?: Record<string, StoredDocument[]>;
  today: string;
  warnDays: number;
  onAdd: (input: LicenceInput, term?: LicenceTermInput) => Promise<SaveResult>;
  onUpdate: (licenceId: string, input: LicenceInput) => Promise<SaveResult>;
  onRemove: (licenceId: string) => Promise<SaveResult>;
  onRecordTerm: (licenceId: string, input: LicenceTermInput) => Promise<SaveResult>;
  /** Files a document against the ticket; a null term means the card itself. */
  onAttachDoc: (
    licenceId: string,
    termId: string | null,
    documentId: string,
    details?: LicenceScanDetails,
  ) => Promise<SaveResult>;
  onRemoveTerm: (termId: string) => Promise<SaveResult>;
  /** Open on the add modal. Summary's "Add a licence or ticket" asks for it
      the way its other Adds ask a section for its form: the screen remounts
      this tab with the flag, so it is state here, never an effect. */
  startAdding?: boolean;
}) {
  // null = closed. A row = opened on it; "new" = adding one.
  const [open, setOpen] = useState<StaffLicence | "new" | null>(() => (startAdding ? "new" : null));

  const editing = open === "new" ? null : open;
  const openId = editing?.id ?? "";

  /* The one number: how many tickets are inside the warning window or already
     past it. Counted from the same rule the cards' own pills use, so the line
     can never disagree with the wall under it. */
  const attention = licences.filter((l) => {
    const state = termState(l.expiryDate, today, warnDays);
    return state === "warn" || state === "bad";
  }).length;

  const ok = async () => ({ ok: true as const });

  const modal = open && (
    <LicenceModal
      key={openId || "new"}
      licence={editing}
      staffId={staffId}
      records={records[openId] ?? []}
      documents={documents[openId] ?? []}
      today={today}
      warnDays={warnDays}
      onAdd={onAdd}
      onSaveIdentity={(input) => (editing ? onUpdate(editing.id, input) : onAdd(input))}
      onDelete={() => (editing ? onRemove(editing.id) : ok())}
      onRecord={(input) => (editing ? onRecordTerm(editing.id, input) : ok())}
      onAttach={(termId, documentId, ...details) =>
        editing ? onAttachDoc(editing.id, termId, documentId, ...details) : ok()
      }
      onRemoveTerm={onRemoveTerm}
      onClose={() => setOpen(null)}
    />
  );

  if (layout === "rows")
    return (
      <div className="pdlcard psec-group tm2-lics" data-live>
        <div className="pdlh jump">
          <span>
            {lead}
            Licences and tickets
          </span>
          <span className="acts">
            <button className="jumpb" type="button" onClick={() => setOpen("new")}>
              Add a licence
            </button>
          </span>
        </div>
        {licences.length === 0 ? (
          <p className="tm2-none">No licences or tickets yet</p>
        ) : (
          <ul className="tm2-licrows">
            {licences.map((l) => {
              const word = licenceLine(l, today, warnDays);
              return (
                <li key={l.id} className="tm2-licrow">
                  <span className="tm2-lictext">
                    <button type="button" className="tm2-licname" onClick={() => setOpen(l)}>
                      {l.typeName}
                    </button>
                    <StateWord tone={word.tone} className="tm2-licline">
                      {word.text}
                    </StateWord>
                  </span>
                  {(word.tone === "look" || word.tone === "wrong") && (
                    <Button kind="second" size={32} onClick={() => setOpen(l)}>
                      Renew licence
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {modal}
      </div>
    );

  return (
    <div className="psec-body" data-live>
      {/* A line under the tab is a fact or nothing (docs/design.md, law 15).
          "N need attention" is the fact; "nothing expiring" was the same fact
          as reassurance, and the sentence about what the wall does was an
          explanation. The cards carry their own state. */}
      {attention > 0 && (
        <div className="psechd">
          <em>{attention === 1 ? "1 needs attention" : `${attention} need attention`}</em>
        </div>
      )}

      <div className="liccards">
        {licences.map((l) => {
          const terms = records[l.id]?.length ?? 0;
          return (
            <LicenceCard
              key={l.id}
              typeName={l.typeName}
              licenceNumber={l.licenceNumber}
              expiry={l.expiryDate ? formatAuDate(l.expiryDate) : null}
              status={licenceStatus(l.expiryDate, today, warnDays)}
              note={terms > 1 ? `${terms} terms on file` : terms === 1 ? "1 term on file" : undefined}
              onOpen={() => setOpen(l)}
            />
          );
        })}

        <button className="licadd-tile" type="button" onClick={() => setOpen("new")}>
          <b>Add a licence or ticket</b>
          <em>Scan a driver licence, an ARC, a white card or any ticket</em>
        </button>
      </div>

      {modal}
    </div>
  );
}

const STATUS_TONE: Record<string, Tone> = { ok: "good", warn: "look", bad: "wrong", mute: "info" };

/** A ticket's second line: its number, then where it stands in words. */
export function licenceLine(l: StaffLicence, today: string, warnDays: number): { tone: Tone; text: string } {
  const status = licenceStatus(l.expiryDate, today, warnDays);
  const date = l.expiryDate ? fmtDay(l.expiryDate) : null;
  const where =
    status.tone === "mute" || !date
      ? "no expiry"
      : status.tone === "bad"
        ? `expired ${date}`
        : status.tone === "warn"
          ? `runs out ${date}`
          : `current to ${date}`;
  const text = l.licenceNumber ? `${l.licenceNumber}, ${where}` : where.charAt(0).toUpperCase() + where.slice(1);
  return { tone: STATUS_TONE[status.tone] ?? "info", text };
}
