import { actAsPhoneUser, ok, requireMobile, type MobileCtx } from "@/lib/mobile/auth";
import { addSiteNote, changeSiteNote, readSiteNoteCount, readSiteNotes, removeSiteNote } from "@/app/actions/site-notes";
import type { SiteWrite } from "@/lib/sites/site-notes-server";

/* SITE NOTES FROM THE PHONE: the web's own actions (actions/site-notes), run
   as the person the token check verified, so the job card's gate, `workboard`,
   is theirs as on the web, and every read and write starts from a job this
   workspace's mirror holds and reaches only the building it's at (Isaac,
   15 November 2026, to Site notes on the phone: "Yes").

     GET    ?job=<uuid>            the read: the building's notes and this
                                   unit's, Other jobs here, the job's clips
     GET    ?job=<uuid>&count=1    { count }: the mark on the job's button
     POST   { job, kind, words, whole?, video? }      a new note
     PATCH  { job, id, kind, words, whole?, video? }  a changed note, the old
                                                      one kept as history
     DELETE ?job=<uuid>&id=<note>                     a removed note

   A write answers with the note's id and the read again, so the phone draws
   what was kept. Staff only: nothing here reaches a customer
   (lib/sites/__tests__/site-notes-kept-in). */

const no = (status: number, error: string) => Response.json({ error }, { status, headers: { "cache-control": "no-store" } });

const jobOf = (v: unknown): string => (typeof v === "string" ? v.trim().slice(0, 80) : "");

const GONE = "That job isn't in HeyTiff.";

async function answer(ctx: MobileCtx, job: string, r: SiteWrite) {
  if (!r.ok) return no(400, r.error);
  const site = await actAsPhoneUser(ctx, () => readSiteNotes(job));
  return ok({ id: r.id, site });
}

export async function GET(request: Request) {
  const ctx = await requireMobile(request, "workboard");
  if (ctx instanceof Response) return ctx;
  const q = new URL(request.url).searchParams;
  const job = jobOf(q.get("job"));
  if (!job) return no(400, "Which job?");
  if (q.get("count") === "1") {
    const count = await actAsPhoneUser(ctx, () => readSiteNoteCount(job));
    return count === null ? no(404, GONE) : ok({ count });
  }
  const site = await actAsPhoneUser(ctx, () => readSiteNotes(job));
  return site ? ok(site) : no(404, GONE);
}

type Body = { job?: unknown; id?: unknown; kind?: unknown; words?: unknown; whole?: unknown; video?: unknown } | null;

export async function POST(request: Request) {
  const ctx = await requireMobile(request, "workboard");
  if (ctx instanceof Response) return ctx;
  const b = (await request.json().catch(() => null)) as Body;
  const job = jobOf(b?.job);
  if (!job) return no(400, "Which job?");
  const r = await actAsPhoneUser(ctx, () => addSiteNote({ jobUuid: job, kind: b?.kind, words: b?.words, whole: b?.whole, video: b?.video }));
  return answer(ctx, job, r);
}

export async function PATCH(request: Request) {
  const ctx = await requireMobile(request, "workboard");
  if (ctx instanceof Response) return ctx;
  const b = (await request.json().catch(() => null)) as Body;
  const job = jobOf(b?.job);
  if (!job) return no(400, "Which job?");
  if (typeof b?.id !== "string" || !b.id) return no(400, "Which note?");
  const id = b.id;
  const r = await actAsPhoneUser(ctx, () => changeSiteNote({ jobUuid: job, id, kind: b.kind, words: b.words, whole: b.whole, video: b.video }));
  return answer(ctx, job, r);
}

export async function DELETE(request: Request) {
  const ctx = await requireMobile(request, "workboard");
  if (ctx instanceof Response) return ctx;
  const q = new URL(request.url).searchParams;
  const job = jobOf(q.get("job"));
  const id = (q.get("id") ?? "").trim();
  if (!job) return no(400, "Which job?");
  if (!id) return no(400, "Which note?");
  const r = await actAsPhoneUser(ctx, () => removeSiteNote({ jobUuid: job, id }));
  return answer(ctx, job, r);
}
