import { redirect } from "next/navigation";
import { auth0 } from "@/lib/auth0";
import { staffIdFor } from "@/lib/workboard/projects-query";
import { listArchivedNotes, listMyNotes } from "@/lib/notes/my-notes-query";
import { MyNotesBoard } from "@/components/notes/my-notes-board";

/* Ungated, like the rest of Personal. Writing yourself a note is the least
   privileged thing in the app, and gating it behind `workboard` would mean an
   office admin who can't see the board also can't jot down a phone number.
   The scoping that matters is WHOSE, and that is enforced on every read and
   every write by the staff id — never by a capability. */
export default async function MyNotesPage() {
  const session = await auth0.getSession();
  const orgId = session?.orgId as string | undefined;
  const userId = session?.user?.sub as string | undefined;
  if (!orgId || !userId) redirect("/dashboard");

  const staffId = await staffIdFor(orgId, userId);
  /* No staff profile means no owner for a note, so there is nothing to show
     and nothing that could be written. Sending them to the dashboard beats
     an empty page that silently refuses every save. */
  if (!staffId) redirect("/dashboard");

  const [notes, archived] = await Promise.all([
    listMyNotes(orgId, staffId),
    listArchivedNotes(orgId, staffId),
  ]);

  /* Nothing pushed, deliberately: this page is the universal case. A note
     taken here has no board behind it, so the button offers no job picker and
     the cascade's floor IS this screen. The layout already provides the scope
     and whether this deployment can hear you. */
  return <MyNotesBoard notes={notes} archived={archived} />;
}
