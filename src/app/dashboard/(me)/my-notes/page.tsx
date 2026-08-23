import { MeScreen } from "@/components/me/me-screen";
import { loadMe } from "@/lib/me/page-data";

/* Ungated, like the rest of the card. Writing yourself a note is the least
   privileged thing in the app, and gating it behind `workboard` would mean an
   office admin who can't see the board also can't jot down a phone number.
   The scoping that matters is WHOSE, and that is enforced on every read and
   every write by the staff id — never by a capability. */
export default async function MyNotesPage() {
  return <MeScreen initialTab="notes" data={await loadMe()} />;
}
