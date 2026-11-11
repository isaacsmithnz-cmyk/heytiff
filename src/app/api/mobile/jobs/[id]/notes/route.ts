import { after } from "next/server";
import { resolveJobCard } from "@/lib/workboard/all-jobs-query";
import { writeJobNote } from "@/lib/workboard/job-note-write";
import { ok, requireMobile } from "@/lib/mobile/auth";
import { sendNoteOnToSm8 } from "@/lib/integrations/sm8-note-send-on";
import { sm8PressFromMobile } from "@/lib/integrations/sm8-press";
import { replaceWrapupNote } from "@/lib/mobile/wrapup-replace";

/* WRITING A NOTE ON A JOB from the phone: the job sheet's pen, on the
   phone's token (lib/workboard/job-note-write, which actions/job-notes
   addJobNote shares). The same tier as the sheet, `workboard`: writing on
   the job you are standing on is the whole feature. It lands in HeyTiff's
   diary for the job, and goes on to ServiceM8 only when the box's Save asks
   (`sendOn`).

   The job is a CHOICE the phone hands in, so it is only ever written on
   inside the caller's own workspace (a clone writes on the job it claims
   against, where the phone read it), and the write itself refuses a job the
   workspace's mirror doesn't hold. The phone mints the pen's id when it
   opens the box, so a double press, or a retry after a lost answer, is one
   note.

   `replaces: { on }`, from the day's wrap-up gone back to: the note already
   in for that stretch is taken back first, so the changed words are the one
   note (lib/mobile/wrapup-replace); the same words again change nothing. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireMobile(request, "workboard");
  if (ctx instanceof Response) return ctx;
  const no = (status: number, error: string) => Response.json({ error }, { status, headers: { "cache-control": "no-store" } });

  const id = (await params).id.trim().slice(0, 80);
  const input = (await request.json().catch(() => null)) as { body?: unknown; id?: unknown; sendOn?: unknown; replaces?: unknown } | null;
  const body = typeof input?.body === "string" ? input.body : "";
  if (!id) return no(400, "Which job?");
  if (!body.trim()) return no(400, "Nothing to write.");
  if (input?.id !== undefined && typeof input.id !== "string") return no(400, "Couldn't save that note.");

  const { parentRemoteId } = await resolveJobCard(ctx.orgId, id);
  const replacesOn = (input?.replaces as { on?: unknown } | null | undefined)?.on;
  try {
    if (typeof replacesOn === "string" && (await replaceWrapupNote(ctx, parentRemoteId, body, replacesOn)) === "same") return ok({ same: true });
    const note = await writeJobNote({
      orgId: ctx.orgId,
      userId: ctx.userId,
      jobUuid: parentRemoteId,
      body,
      composeId: input?.id as string | undefined,
    });
    /* Save, from the phone's box: the words as written, and on to ServiceM8
       as any job note goes, behind the same gate Tiff's filing has. The
       day's wrap-up asks for it here too, a note the person ticked for
       ServiceM8 (8 November 2026). The send goes after the answer: Saved never waits on ServiceM8 (Isaac,
       6 November 2026: "it should be instant if it's just writing it
       straight away"). */
    if (input?.sendOn === true) after(() => sendNoteOnToSm8(() => sm8PressFromMobile(ctx), ctx.orgId, note.id, parentRemoteId));
    return ok(note);
  } catch (err) {
    return no(400, err instanceof Error ? err.message : "Couldn't save that note.");
  }
}
