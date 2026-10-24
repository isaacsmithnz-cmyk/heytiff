import { auth0 } from "@/lib/auth0";
import { NotesPage } from "@/components/notes/notes-page";
import { staffProfileIdFor } from "@/lib/fleet/query";
import { listArchivedNotes, listMyNotes } from "@/lib/notes/my-notes-query";

/* NOTES (v2): Your name › Notes. Ungated: writing yourself a note is the
   least privileged thing in the app, and gating it would mean an office
   admin who can't see the board also can't jot down a phone number. The
   scoping that matters is WHOSE, and that is enforced on every read and
   every write by the staff id — never by a capability. A missing staff card
   matches nothing, so the page shows its empty view. */
export default async function MyNotesPage() {
  const session = await auth0.getSession();
  const orgId = session?.orgId as string | undefined;
  const userId = session?.user?.sub as string | undefined;
  const staffId = orgId && userId ? await staffProfileIdFor(orgId, userId) : null;
  const [notes, archived] =
    orgId && staffId ? await Promise.all([listMyNotes(orgId, staffId), listArchivedNotes(orgId, staffId)]) : [[], []];
  return <NotesPage notes={notes} archived={archived} />;
}
