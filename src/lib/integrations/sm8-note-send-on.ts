import "server-only";

import { sm8NotesAllowed } from "@/lib/integrations/sm8-kinds";
import { offersSend } from "@/lib/integrations/sm8-write-plan";
import { sm8NoteSender } from "@/lib/integrations/links";
import type { Sm8Press } from "@/lib/integrations/sm8-press";

/** A note just filed on a job, sent on to ServiceM8 as the person who wrote
    it: only where this deployment sends notes, the workspace offers them and
    the person is linked and ready. Anywhere else it stays HeyTiff's, as a
    note that never went says, and its line on the job says why. A send that
    fails is logged and the note keeps its line; filing never waits on
    ServiceM8 longer than the send's own budget.

    One gate for every way a note lands on a job: Tiff filing it (the note
    router), and Save, which files it as written with no Tiff (Isaac, 6
    November 2026: "Save creates a raw note, tiff processes it like she does
    today"), on the web and the phone alike. The press is asked for only once
    the deployment sends notes at all; the sender is reached lazily, as the
    journal reaches it, since it brings the queue's drain with it. */
export async function sendNoteOnToSm8(
  pressOf: () => Promise<Sm8Press | null>,
  orgId: string,
  noteId: string,
  jobUuid: string
): Promise<void> {
  if (!sm8NotesAllowed()) return;
  const startedAt = Date.now();
  try {
    const [{ readSm8WriteState }, { sendEntryToSm8 }] = await Promise.all([
      import("@/lib/integrations/sm8-writes"),
      import("@/lib/integrations/sm8-note-entry"),
    ]);
    const press = await pressOf();
    if (!press || press.orgId !== orgId) return;
    const state = await readSm8WriteState(orgId);
    if (!offersSend(state, "note")) return;
    const sender = await sm8NoteSender(orgId, press.staffId, state.tenantId ?? undefined);
    if (sender.state !== "ready") return;
    const sent = await sendEntryToSm8(press, state, { jobUuid, noteId }, startedAt);
    if (!sent.ok) console.error(`[sm8] note ${noteId} on job ${jobUuid} didn't go to ServiceM8 for org ${orgId}: ${sent.error}`);
  } catch (err) {
    console.error(`[sm8] couldn't send note ${noteId} on to ServiceM8 for org ${orgId}: ${err instanceof Error ? err.message : String(err)}`);
  }
}
