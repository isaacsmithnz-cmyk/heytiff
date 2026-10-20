import { redirect } from "next/navigation";
import { auth0 } from "@/lib/auth0";
import { can } from "@/lib/permissions-server";
import { Conversations } from "@/components/conversations/conversations";
import { kbCategoryCounts, kbDocTitles } from "@/lib/tiff/query";
import { isTranscriptionConfigured } from "@/lib/voice/transcribe";
import { listArchivedNotes, listMyNotes } from "@/lib/notes/my-notes-query";
import { staffIdFor } from "@/lib/workboard/projects-query";
import { viewOf } from "@/lib/tiff/conversations";

/* CONVERSATIONS (v2, step 5; the board v2-board-conversations). Your
   conversations with Tiff, the team's (not built yet), and your private
   notes, as three views of one list (components/conversations).

   Gated as the Library's ask is, by `tiff`: All is asking Tiff, and a
   leaf route is deep-linkable, so the route is gated, not just the row in
   the sidebar. Your notes are yours whatever you hold (Me › Notes is
   ungated), and they are read by your own staff id and nobody else's.

   The threads are not read here. They are this browser's (localStorage),
   and the server's copy, once docs/migrations/tiff_threads.sql is applied,
   is fetched by the page itself (lib/tiff/thread-sync.ts). What is read
   here is what the assistant needs to answer: how many documents are ready,
   and their current names for what she cites. */

type Params = Promise<Record<string, string | string[] | undefined>>;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;

export default async function ConversationsPage({ searchParams }: { searchParams: Params }) {
  if (!(await can("tiff"))) redirect("/dashboard");

  const session = await auth0.getSession();
  const orgId = session?.orgId as string | undefined;
  const userSub = session?.user?.sub as string | undefined;
  if (!orgId || !userSub) redirect("/dashboard");

  const staffId = await staffIdFor(orgId, userSub);
  const [counts, canManage, docTitles, notes, archived] = await Promise.all([
    kbCategoryCounts(orgId),
    can("tiff_manage"),
    kbDocTitles(orgId),
    staffId ? listMyNotes(orgId, staffId) : Promise.resolve([]),
    staffId ? listArchivedNotes(orgId, staffId) : Promise.resolve([]),
  ]);
  const readyCount = Object.values(counts).reduce((sum, n) => sum + n, 0);

  const params = await searchParams;
  const view = viewOf(one(params.view));
  const open = one(params.open)?.slice(0, 80) || null;
  const name = (session?.user?.name as string | undefined)?.trim() || "You";

  return (
    <Conversations
      counts={counts}
      readyCount={readyCount}
      canManage={canManage}
      docTitles={docTitles}
      voiceEnabled={isTranscriptionConfigured()}
      notes={notes}
      archived={archived}
      initial={{ view, open: view === "team" ? null : open }}
      you={name}
    />
  );
}
