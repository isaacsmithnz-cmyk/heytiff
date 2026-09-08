"use client";

import { useState } from "react";
import { Icon } from "@/components/shell/icon";
import { LicenceCard } from "@/components/cards/licence-card";
import type { StoredDocument } from "@/lib/documents/query";
import { licenceStatus } from "@/lib/staff/licence";
import { termState, type LicenceTermInput, type StaffLicenceRecord } from "@/lib/staff/licence-records";
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
  reminders = {},
  today,
  onAdd,
  onUpdate,
  onRemove,
  onRecordTerm,
  onAttachDoc,
  onRemoveTerm,
  onRemind,
}: {
  licences: StaffLicence[];
  /** Whose card this is — the scan action and every write are scoped to it. */
  staffId: string;
  /* The terms behind the cards, their paperwork, and the VIEWER's own
     reminders, all keyed by licence id and all loaded once for the wall.
     Defaulted so a caller that only wants the old add/remove behaviour need
     not supply three empty maps. */
  records?: Record<string, StaffLicenceRecord[]>;
  documents?: Record<string, StoredDocument[]>;
  reminders?: Record<string, number[]>;
  today: string;
  onAdd: (input: LicenceInput, term?: LicenceTermInput) => Promise<SaveResult>;
  onUpdate: (licenceId: string, input: LicenceInput) => Promise<SaveResult>;
  onRemove: (licenceId: string) => Promise<SaveResult>;
  onRecordTerm: (licenceId: string, input: LicenceTermInput) => Promise<SaveResult>;
  /** Files a document against the ticket; a null term means the card itself. */
  onAttachDoc: (licenceId: string, termId: string | null, documentId: string) => Promise<SaveResult>;
  onRemoveTerm: (termId: string) => Promise<SaveResult>;
  onRemind: (licenceId: string, leadDays: number, on: boolean) => Promise<SaveResult>;
}) {
  // null = closed. A row = opened on it; "new" = adding one.
  const [open, setOpen] = useState<StaffLicence | "new" | null>(null);

  const editing = open === "new" ? null : open;
  const openId = editing?.id ?? "";

  /* The one number: how many tickets are inside the warning window or already
     past it. Counted from the same rule the cards' own pills use, so the line
     can never disagree with the wall under it. */
  const attention = licences.filter((l) => {
    const state = termState(l.expiryDate, today);
    return state === "warn" || state === "bad";
  }).length;

  const ok = async () => ({ ok: true as const });

  return (
    <div className="psec-body" data-live>
      {/* The tab says "Compliance"; this says what the tab is for. See
          section-card for why the framed header went. */}
      <div className="psechd">
        <em>
          {licences.length === 0
            ? "Licences & tickets — each one tracks its number and expiry, and warns on your dashboard before it lapses"
            : attention === 0
              ? "Licences & tickets — nothing expiring"
              : attention === 1
                ? "Licences & tickets — 1 needs attention"
                : `Licences & tickets — ${attention} need attention`}
        </em>
      </div>

      <div className="liccards">
        {licences.map((l) => {
          const terms = records[l.id]?.length ?? 0;
          return (
            <LicenceCard
              key={l.id}
              typeName={l.typeName}
              licenceNumber={l.licenceNumber}
              expiry={l.expiryDate ? formatAuDate(l.expiryDate) : null}
              status={licenceStatus(l.expiryDate, today)}
              note={terms > 1 ? `${terms} terms on file` : terms === 1 ? "1 term on file" : undefined}
              onOpen={() => setOpen(l)}
            />
          );
        })}

        <button className="licadd-tile" type="button" onClick={() => setOpen("new")}>
          <span className="ci">
            <Icon name="plus" size={18} />
          </span>
          <b>Add a licence or ticket</b>
          <em>Scan the card — driver licence, ARC, white card…</em>
        </button>
      </div>

      {licences.length === 0 && (
        <div className="ro-empty" style={{ marginTop: 18 }}>
          <span className="ei">
            <Icon name="shield" size={20} />
          </span>
          <b>No licences added yet</b>
          <em>
            Anything added here tracks its expiry, keeps every renewal on file, and raises a reminder on your
            dashboard before it lapses.
          </em>
        </div>
      )}

      {open && (
        <LicenceModal
          key={openId || "new"}
          licence={editing}
          staffId={staffId}
          records={records[openId] ?? []}
          documents={documents[openId] ?? []}
          reminders={reminders[openId] ?? []}
          today={today}
          onAdd={onAdd}
          onSaveIdentity={(input) => (editing ? onUpdate(editing.id, input) : onAdd(input))}
          onDelete={() => (editing ? onRemove(editing.id) : ok())}
          onRecord={(input) => (editing ? onRecordTerm(editing.id, input) : ok())}
          onAttach={(termId, documentId) => (editing ? onAttachDoc(editing.id, termId, documentId) : ok())}
          onRemoveTerm={onRemoveTerm}
          onRemind={(lead, on) => (editing ? onRemind(editing.id, lead, on) : ok())}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}
