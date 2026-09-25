/* The deployment's switch for writing to ServiceM8, read from SM8_WRITES —
   in a module of its own, beside nothing heavier than the pure plan, so a
   reader (the job's notes, the journal, the connection store) can ask
   "does this deployment write notes?" without importing the sender.

   THE QUESTION THAT KEEPS PRODUCTION AS IT IS. With SM8_WRITES=1 (files
   only) nothing about notes may change: no new read on a page load, a tick
   or a card open, no new write in a run, the nightly cron, a disconnect or
   an account switch. Every new note read and write asks sm8NotesAllowed()
   first, and a test holds each of them to it (sm8-notes-prod.test). */

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
