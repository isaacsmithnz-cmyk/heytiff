import { MeScreen } from "@/components/me/me-screen";
import { loadMe } from "@/lib/me/page-data";

/* Your own expense claims. UNGATED, like the rest of this card — spending your
   own money on the job and asking for it back is intrinsic to being a member
   of the workspace, not a capability someone grants.

   Reviewing OTHER people's claims is a different screen with a different gate
   (`approvals`); this one only ever reads the caller's own rows.

   NO REDIRECT FOR A MISSING STAFF CARD any more: this route opens a card with
   four other faces on it, so an absent one has to say so rather than take them
   with it. `loadMe` returns empty and the face carries the empty state. */
export default async function MyExpensesPage() {
  return <MeScreen initialTab="expenses" data={await loadMe()} />;
}
