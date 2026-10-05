/* The deployment's switch for writing to ServiceM8, read from SM8_WRITES —
   in a module of its own, beside nothing heavier than the pure plan, so a
   reader (the job's notes, the journal, the connection store) can ask
   "does this deployment write notes?" without importing the sender.

   THE QUESTION THAT KEEPS PRODUCTION AS IT IS. With SM8_WRITES=1 (files
   only) nothing about notes may change: no new read on a page load, a tick
   or a card open, no new write in a run, the nightly cron, a disconnect or
   an account switch. Every new note read and write asks sm8NotesAllowed()
   first, and a test holds each of them to it (sm8-notes-prod.test).

   AND THE SAME FOR BOOKINGS (two-way phase 3). With SM8_WRITES=1, or
   attachment,note, nothing about bookings may change: every new booking
   read and write asks sm8BookingsAllowed() first (sm8-bookings-prod.test).

   AND THE SAME FOR LEAVE. With SM8_WRITES not naming `leave`, approving,
   cancelling or marking a day off changes nothing about ServiceM8: every
   leave read and write asks sm8LeaveAllowed() first (sm8-leave-prod.test).

   AND THE SAME FOR NEW JOBS. With SM8_WRITES not naming `job`, nothing
   about the New job form, the queue or the board changes: every job read
   and write asks sm8JobsAllowed() first (sm8-job-prod.test). */

import { sm8WriteKindsFrom, type Sm8WriteKind } from "./sm8-write-plan";

/** The kinds this deployment may write: the operator's switch, SM8_WRITES
    ("1" is files; or a comma list). Nothing when unset, so a preview or a
    branch never writes to a business's ServiceM8. */
export function sm8WriteKindsEnabled(): Sm8WriteKind[] {
  return sm8WriteKindsFrom(process.env.SM8_WRITES);
}

/** Whether this deployment writes notes (SM8_WRITES names `note`). */
export function sm8NotesAllowed(): boolean {
  return sm8WriteKindsEnabled().includes("note");
}

/** Whether this deployment writes bookings (SM8_WRITES names `booking`). */
export function sm8BookingsAllowed(): boolean {
  return sm8WriteKindsEnabled().includes("booking");
}

/** Whether this deployment writes leave (SM8_WRITES names `leave`). */
export function sm8LeaveAllowed(): boolean {
  return sm8WriteKindsEnabled().includes("leave");
}

/** Whether this deployment saves customer details to ServiceM8 (SM8_WRITES
    names `customer`). */
export function sm8CustomersAllowed(): boolean {
  return sm8WriteKindsEnabled().includes("customer");
}

/** Whether this deployment starts jobs in ServiceM8 (SM8_WRITES names `job`). */
export function sm8JobsAllowed(): boolean {
  return sm8WriteKindsEnabled().includes("job");
}

/** Whether this deployment sends accepted quotes to ServiceM8 (SM8_WRITES
    names `quote`). */
export function sm8QuotesAllowed(): boolean {
  return sm8WriteKindsEnabled().includes("quote");
}
