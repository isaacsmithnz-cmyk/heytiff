import { daysUntil, formatAuDate } from "@/lib/au-dates";
import { expiryClause } from "@/lib/format/duration";
import { isNoVisa } from "./work-rights";
import type { StaffProfile } from "./profile";

/* THE STANDING LINE on Summary — the one thing the screen says out loud.

   It was a tile, first in the row of tickets, and that was the mistake: a
   right to work is not a ticket. Nothing on it expires the way a White card
   does, you do not hold a copy of it in the ute, and it decides whether the
   person can be sent to a job at all. Drawn as a 220×136 box in the same grey
   as the ticket beside it, the thing that gates the work was the thing you
   could not pick out. So it left the row and became a sentence at reading
   size, above everything, and the tiles kept only what expires.

   TWO PARTS, TWO TONES. The lead is the clearance and carries the rank — is
   this person cleared, or not. The rest is the evidence, and carries its own
   state only when the evidence itself wants attention: a visa about to lapse,
   or one nobody has checked. A person on a valid visa IS cleared to work, so
   the lead says so in the OK colour and the warning sits where it belongs, on
   the visa. Colouring "Cleared to work" amber to mean "but check the visa"
   would be the sentence contradicting itself.

   The ranking is the directory's (derive.ts): a lapsed visa outranks one
   about to lapse, which outranks a visa nobody has checked. A citizen or a
   permanent resident has no visa to check, so the line says so rather than
   waiting for a check that can never come (see lib/staff/work-rights).

   Pure, so the line and its test need no DOM. */

export type StateTone = "ok" | "warn" | "bad" | "mute";

export type WorkRightsLine = {
  /** the clearance, in its colour — the rank of the whole situation */
  lead: string;
  leadTone: StateTone;
  /** the evidence under it, or null when there is none to give */
  rest: string | null;
  /** quiet, unless the evidence is what wants attention */
  restTone: StateTone;
  /** nothing recorded: there is no clearance to state, only a gap to fill */
  unset: boolean;
};

export function workRightsLine(
  p: StaffProfile | null,
  today: string,
  warnDays: number,
): WorkRightsLine {
  const status = (p?.work_rights_status ?? "").trim();
  if (!status) {
    return {
      lead: "Right to work not recorded",
      leadTone: "warn",
      rest: null,
      restTone: "mute",
      unset: true,
    };
  }
  if (status === "No working rights") {
    return {
      lead: "Not cleared to work",
      leadTone: "bad",
      rest: "No working rights on file.",
      restTone: "mute",
      unset: false,
    };
  }
  if (isNoVisa(status)) {
    return {
      lead: "Cleared to work",
      leadTone: "ok",
      rest: `${status}, no visa required.`,
      restTone: "mute",
      unset: false,
    };
  }

  const visa = (p?.visa_type ?? "").trim() || "Visa";
  const expiry = (p?.visa_expiry ?? "").slice(0, 10) || null;
  const days = expiry ? daysUntil(expiry, today) : null;

  /* A LAPSED VISA IS THE ONE CASE THE LEAD CHANGES FOR. Everything else on
     this branch is somebody who may work today; only an expired visa means
     they may not, and that outranks whether anyone has checked it. */
  if (days !== null && days < 0) {
    return {
      lead: "Not cleared to work",
      leadTone: "bad",
      rest: `${visa} ${expiryClause(days)}.`,
      restTone: "bad",
      unset: false,
    };
  }
  if (days !== null && days <= warnDays) {
    return {
      lead: "Cleared to work",
      leadTone: "ok",
      rest: `${visa} ${expiryClause(days)}.`,
      restTone: "warn",
      unset: false,
    };
  }

  const checked = (p?.vevo_checked_at ?? "").slice(0, 10);
  const held = expiry ? `${visa}, expires ${formatAuDate(expiry)}` : visa;
  if (checked) {
    return {
      lead: "Cleared to work",
      leadTone: "ok",
      rest: `${held}, checked ${formatAuDate(checked)}.`,
      restTone: "mute",
      unset: false,
    };
  }
  return {
    lead: "Cleared to work",
    leadTone: "ok",
    rest: `${held}, not checked.`,
    restTone: "warn",
    unset: false,
  };
}
