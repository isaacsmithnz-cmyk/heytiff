/* The journal — the read side. Server only, org-scoped AND person-scoped.

   NO SESSION HERE: callers establish the right to ask and hand in an orgId,
   the same posture as every other read module in this feature.

   THE PERSON SCOPE IS NOT OPTIONAL, for the same reason `my-notes-query` says
   it isn't: this is a record of what someone said, in their own words, and the
   reader is the author and nobody else. It filters on `author_id` every time.

   READS ONLY WHAT WAS APPLIED. `pending` and `clarifying` are captures still
   mid-flight — a half-finished sentence is not a journal entry. An APPLIED
   capture that produced nothing (everything unticked) does stay: you still
   said it, and the row reads honestly with no outcomes after it.

   KNOWN GAP, and it is on the WRITE side. `dismissed` covers three different
   endings and only one of them is an abandonment:

     dismissNote     Escape or ×. Genuinely thrown away — belongs out.
     keepNoteForMe   Writes the words to `staff_notes` and returns "Kept in
                     your notes." A SUCCESS, filed as dismissed.
     keepNoteOnJob   Appends the words to the job's own notes. Also a success,
                     also filed as dismissed.

   So two of the four rungs are invisible here, and nothing on the row tells
   them apart from an abandonment — `applied` is null for all three. Closing it
   means the two keep-rungs recording what they did rather than sharing the
   discard status (`keepNoteForMe` does literally what the `noteLines` group
   does, so `status:"applied", applied:{ noteLines:[body] }` would be both
   honest and uniform). That is a change to the live capture flow, so it is
   deliberately NOT bundled with the Home rebuild. */

import { supabaseAdmin } from "@/lib/supabase-server";
import { auDayOf, fmtAuTime } from "@/lib/au-dates";
import { describeApplied, type JournalEntry } from "./journal";

const COLUMNS = "id, transcript, source, applied, created_at";

type Row = {
  id: string;
  transcript: string;
  source: string;
  applied: unknown;
  created_at: string;
};

const toEntry = (r: Row): JournalEntry => ({
  id: r.id,
  said: r.transcript,
  /* Both derived from the AU anchor, so an entry made at 7am in the yard files
     under today rather than under yesterday, which is what reading the raw
     timestamp on a UTC server would do. */
  day: auDayOf(r.created_at),
  at: fmtAuTime(new Date(r.created_at)),
  outcomes: describeApplied(r.applied),
  spoken: r.source === "voice",
});

/** Everything this person has told Tiff, newest first.

    The default reaches back further than a day on purpose — the panel groups
    by day and scrolls, so the history IS the feature; a limit of "today" would
    make the scroll a lie. */
export async function listJournal(
  orgId: string,
  staffId: string,
  limit = 60,
): Promise<JournalEntry[]> {
  const { data } = await supabaseAdmin
    .from("workboard_notes")
    .select(COLUMNS)
    .eq("org_id", orgId)
    .eq("author_id", staffId)
    .eq("status", "applied")
    .order("created_at", { ascending: false })
    .limit(limit);
  return ((data ?? []) as Row[]).map(toEntry);
}
