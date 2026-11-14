import { redirect } from "next/navigation";
import { can, requireOrg } from "@/lib/permissions-server";
import { readOldCodeNotesFor } from "@/lib/sites/site-notes-server";
import { getSm8Timezone } from "@/lib/workboard/query";
import { OldCodeNotes } from "@/components/jobs/old-code-notes";

/* OLD NOTES WITH CODES (Isaac, 14 November 2026, call 15: old ServiceM8 notes
   with codes "come in as a list you tick ... nothing filed by itself").

   Every old job note that likely holds a lockbox, gate or door code, found by
   plain text (lib/sites/site-notes.ts), so the list costs nothing to make.
   Ticked ones are filed as Access notes on their job's site; a note already
   filed leaves the list. For whoever runs the board, `workboard_manage`, as
   it files notes for every site at once. */

export default async function OldCodeNotesRoute() {
  if (!(await can("workboard_manage"))) redirect("/dashboard/jobs");
  const { orgId } = await requireOrg("workboard_manage");
  const notes = await readOldCodeNotesFor(orgId, await getSm8Timezone(orgId));
  return <OldCodeNotes initial={notes} />;
}
