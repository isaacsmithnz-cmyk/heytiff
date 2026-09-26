"use server";

import { revalidatePath } from "next/cache";
import { auth0 } from "@/lib/auth0";
import { supabaseAdmin } from "@/lib/supabase-server";
import { can } from "@/lib/permissions-server";
import { staffIdFor } from "@/lib/workboard/projects-query";
import {
  clean,
  isSeverity,
  namesMentioned,
  readNote,
  type NoteContext,
  type NoteFollow,
  type NoteProposal,
  type NoteStaff,
  type Severity,
} from "@/lib/workboard/note-brain";
import { todayInZone } from "@/lib/workboard/dates";
import { getSm8Timezone } from "@/lib/workboard/query";
import { fullNameOf } from "@/lib/staff/name";
import { NAME_COLUMNS } from "@/lib/dashboard/tasks-query";
import { ACTED_KINDS } from "@/lib/dashboard/task-events";
import { remindAtFrom, isRemindKind } from "@/lib/dashboard/reminders";
import { workdayHours } from "@/lib/dashboard/reminders-query";
import { jobCandidates } from "@/lib/dashboard/job-candidates";
import { fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import { publishFieldNote } from "@/lib/tiff/field-notes";
import { jobHistory } from "@/lib/brain/tools";
import { fromLines } from "@/lib/workboard/note-lines";
import { describeJob, matchedJobs } from "@/lib/workboard/note-match";
import {
  jobBound,
  planRows,
  storedProposal,
  toConfirmed,
  toDraft,
  withoutRows,
} from "@/lib/workboard/note-draft";
import {
  APPLIED_V,
  appliedOf,
  doorsOf,
  freshIssueIds,
  stillThere,
  takesBack,
  textKey,
  undoBlocked,
  undoSummary,
  type IssueBump,
  type NoteDoor,
  type NowRow,
  type TextWrite,
} from "@/lib/workboard/note-applied";
import {
  KEPT_AS_SAID,
  REPLIES_MAX,
  WHICH_JOB,
  doneLine,
  earlierTurns,
  isTiffRoom,
  repliesIn,
  roomOf,
  turn,
  turnsOf,
  withTurns,
  type EarlierTurn,
  type TiffRoom,
  type Turn,
} from "@/lib/workboard/note-turns";
import { sm8NotesAllowed } from "@/lib/integrations/sm8-kinds";
import { UNDO_HOLD_COLUMNS, undoHeldBySm8, type CreateRow } from "@/lib/integrations/sm8-note-plan";

/* Smart Notes — capture, route, file, take back.

   THE SHAPE OF THE SAFETY MODEL: `routeNote` only ever WRITES THE NOTE and
   returns a proposal. `applyConfirmed` is the single writer that turns a
   proposal into tasks, flags and entries, and it is only ever handed what
   `fileNote` builds from the proposal STORED on the note, minus the rows the
   person took off — never a payload the model or a browser shaped. Nothing
   reviews what it files (Isaac, 2026-09-25: filing live, with Undo as the
   safety net), so the questions Tiff asks when a person or a job is unclear,
   and `undoNote`, are what stand between a misheard word and work assigned
   to the wrong person.

   TWO TIERS, both capabilities (house doctrine, never a role check):
     `workboard`         dictate a note, file your own, clear a flag.
                         Capturing your own day is the whole feature.
     `workboard_manage`  nothing extra here yet — deliberately. Everything a
                         note applies (a task, a bullet, a flag) is something
                         the person on site is entitled to record.

   THE TIFF MODAL IS THE ONE DOOR. Its notes are conversations — `turns` —
   and it reaches this file through `routeNote` (a new note), `continueNote`
   (a reply routes the whole note again), `fileNote` (files the stored
   proposal the moment nothing is left to ask), `undoNote` (takes back what
   a note filed), `keepWords` (the plain Save), `publishNoteKb` (the one row
   that waits for a press) and `dismissNote` (walking away). The review
   card's door — `applyNote`, `answerClarify`, `keepNoteOnJob` and
   `keepNoteForMe` — went with the old capture UI (2026-09-27); the rows it
   filed read as they always did. */

export type NoteTarget = {
  /** `job` is a SERVICEM8 job, and it is the odd one out: the other three are
      HeyTiff rows with a `notes` column a note can be appended to, and the
      mirror is read-only by charter. So a note written on a job stays in
      `workboard_notes` and the job card's DIARY reads it back — the job's
      written record is the feed, not a column. */
  kind: "none" | "project" | "visit" | "agreement" | "job";
  id?: string | null;
};

export type RouteResult =
  | {
      ok: true;
      noteId: string;
      proposal: NoteProposal;
      staff: NoteStaff[];
      /** The conversation so far, Tiff's line last. */
      turns: Turn[];
    }
  | {
      ok: false;
      error: string;
      /** Routing failed and the words were filed as they were said, so they
          are in the diary and nothing is lost. */
      kept?: boolean;
      /** With `kept`: the note they were filed as, so the diary lands it
          lit, as it does every other note the modal filed. */
      noteId?: string;
    };

export type ApplyResult = { ok: true; summary: string } | { ok: false; error: string };

/** A question `fileNote` asks instead of filing. A job answer carries the
    job, so the modal can file it straight back; a person is a reply. */
export type FileAsk = {
  question: string;
  options: { label: string; target?: NoteTarget }[];
};

export type FileResult =
  | { ok: true; summary: string; doors: NoteDoor[]; turns: Turn[] }
  /** `turns` when it asked: the conversation with the question on the end. */
  | { ok: false; error: string; ask?: FileAsk; turns?: Turn[] };

export type UndoResult =
  | { ok: true; summary: string; turns: Turn[] }
  /** `turns` when it had been taken back already: the conversation as it
      now stands, Tiff's "taken back" line on the end. */
  | { ok: false; error: string; turns?: Turn[] };

export type KeepResult = { ok: true; noteId: string } | { ok: false; error: string };

export type PublishKbResult =
  | { ok: true; documentId: string; summary: string }
  | { ok: false; error: string };

const NOT_SIGNED_IN = "Not signed in.";
const NO_ACCESS = "You don't have access to the Workboard.";
const GONE = "That note is no longer here.";
const NOT_YOURS = "That note isn't yours.";

/** Why a note can't be answered or filed any more, by where it ended up. */
const SETTLED: Record<string, string> = {
  applied: "That note has already been filed.",
  dismissed: "That note was set aside.",
  undone: "That note was taken back.",
};

type Ctx = { orgId: string; userId: string; staffId: string | null };

async function context(): Promise<Ctx | null> {
  const session = await auth0.getSession();
  const orgId = session?.orgId as string | undefined;
  const userId = session?.user?.sub as string | undefined;
  if (!orgId || !userId) return null;
  return { orgId, userId, staffId: await staffIdFor(orgId, userId) };
}

function refresh(target?: NoteTarget) {
  revalidatePath("/dashboard/workboard");
  if (target?.kind === "project" && target.id) {
    revalidatePath(`/dashboard/workboard/projects/${target.id}`);
  }
  /* Agreement and visit notes need nothing beyond the board: an agreement now
     opens in a sheet ON the board rather than at a route of its own, so the
     path this used to revalidate no longer exists. */
}

/** The modal's writes land on Home as well — the diary, the tasks, the list —
    so Home is refreshed with the board. */
function refreshHome(target?: NoteTarget) {
  refresh(target);
  revalidatePath("/dashboard");
}

/* The shaper's own trimmer — same rule on the browser's payload as on the
   model's, which is the point of importing it rather than restating it. */
const trim = clean;

/** The people a note may assign work to — first names are how it will say
    them, so the full name is what the matcher needs.

    Resolved through `fullNameOf`, not by reading `full_name` directly:
    first/last are the source of truth and `full_name` is a DERIVED column, so
    a row whose derived copy is blank or stale would otherwise be dropped here
    and that person could never be given work by voice. */
async function assignableStaff(orgId: string): Promise<NoteStaff[]> {
  const { data } = await supabaseAdmin
    .from("staff_profiles")
    .select(NAME_COLUMNS)
    .eq("org_id", orgId)
    .limit(200);
  return ((data ?? []) as Record<string, unknown>[])
    .map((s) => ({ id: String(s.id), fullName: fullNameOf(s) }))
    .filter((s) => s.fullName);
}

/** The author of a note, as the router needs to see them, plus the working day
    a vague time resolves against.

    ONE READ FOR BOTH BECAUSE THEY ARE ONE FACT: "remind me" and "morning" are
    both statements about the person holding the phone. Every routing call makes
    it — the first pass and every clarify round — or answering "which Luke?"
    would quietly cost the note its author and turn a saved reminder back into
    the unassignable task this feature exists to fix. */
async function authorContext(
  orgId: string,
  staffId: string | null,
  staff: NoteStaff[],
): Promise<{ author?: NoteStaff; dayStart: string; dayEnd: string }> {
  const day = await workdayHours(orgId, staffId);
  /* Taken from the roster rather than read separately, so the name the model is
     told is speaking is exactly the name it can assign work to. A staff member
     with no readable name is not in `staff` and gets no author line — the
     router falls back to its old behaviour rather than to a wrong person. */
  const author = staffId ? staff.find((s) => s.id === staffId) : undefined;
  return { author, dayStart: day.start, dayEnd: day.end };
}

/** The row a target names, and the column that names it. Three call sites had
    this ternary written out by hand, which is three chances for one of them
    to disagree about where a visit lives.

    A ServiceM8 job is keyed by `uuid`, not `id` — its table is somebody
    else's, mirrored. Writing that difference down HERE is the whole reason
    this map exists: the moment a job became a target, every hand-written
    `.eq("id", …)` would have quietly matched nothing. */
const TARGETS = {
  project: { table: "projects", id: "id" },
  visit: { table: "maintenance_visits", id: "id" },
  agreement: { table: "maintenance_agreements", id: "id" },
  job: { table: "sm8_jobs", id: "uuid" },
} satisfies Record<Exclude<NoteTarget["kind"], "none">, { table: string; id: string }>;

/** The three targets that own a `notes` column a note can be appended to.
    A ServiceM8 job is NOT one of them — see the type's own note. */
function writableNotesTable(kind: NoteTarget["kind"]): string | null {
  return kind === "project" || kind === "visit" || kind === "agreement"
    ? TARGETS[kind].table
    : null;
}

/** Resolve a note's target inside the caller's org. An id from a browser
    names a CHOICE; this decides whether it's a real one. */
async function resolveTarget(orgId: string, target: NoteTarget): Promise<NoteTarget | null> {
  if (target.kind === "none" || !target.id) return { kind: "none", id: null };
  const { table, id } = TARGETS[target.kind];
  const { data } = await supabaseAdmin
    .from(table)
    .select(id)
    .eq("org_id", orgId)
    .eq(id, target.id)
    .maybeSingle();
  return data ? target : null;
}

/* ---------------- capture + route ---------------- */

/** Everything the router is told about a note besides its words: who can be
    given work, who is speaking, the job and what the workspace already knows
    about it. One function because every read of a note makes it — the first
    pass and every reply — and an answer to "which Luke?" must not cost the
    model everything it knew about the job.

    Four independent reads against a remote database, so they go together
    rather than one after another — the person is watching a spinner. The
    history read is the router's MEMORY: what this job's issues are already
    called, what's flagged, what was said last visit. Before it, "tripped
    again" reached the model with no again. */
async function routingContext(
  ctx: Ctx,
  target: NoteTarget,
  extra: Pick<NoteContext, "room" | "askWho" | "speak" | "earlier">,
): Promise<{ note: NoteContext; staff: NoteStaff[] }> {
  const [staff, label, tz, history] = await Promise.all([
    assignableStaff(ctx.orgId),
    targetLabel(ctx.orgId, target),
    getSm8Timezone(ctx.orgId),
    jobHistory(ctx.orgId, target),
  ]);
  const who = await authorContext(ctx.orgId, ctx.staffId, staff);
  return {
    staff,
    note: {
      staff,
      ...who,
      targetLabel: label ?? undefined,
      todayISO: todayInZone(tz),
      equipment: history.equipment.length ? history.equipment : undefined,
      history: {
        issues: history.issues.map((i) => ({
          summary: i.summary,
          occurrences: i.occurrences,
          lastSeen: i.lastSeen,
        })),
        flags: history.flags.map((f) => f.message),
        recentNotes: history.recentNotes,
      },
      /* What the modal's reads turn on: a task with nobody on it is asked
         about, Tiff says her line, and where it was said is a hint. */
      ...(extra.room ? { room: extra.room } : {}),
      ...(extra.askWho ? { askWho: true } : {}),
      ...(extra.speak ? { speak: true } : {}),
      ...(extra.earlier?.length ? { earlier: extra.earlier } : {}),
    },
  };
}

/** Store the note, then ask the brain what it means. The note row is written
    BEFORE the model runs and kept whatever the model says, because the words
    someone spoke are the valuable thing — routing is an enhancement on top.

    Every note is the Tiff modal's: it keeps `turns` (your words, then Tiff's
    line: `speak`), a task with nobody on it becomes a question rather than a
    row for a dropdown the modal doesn't have (`askWho`), `room` is a hint
    about what a bare instruction means, and a routing failure files the
    words as they were said instead of leaving them pending where nothing
    reads them. (The review card's door routed without any of that, and went
    with the old capture UI, 2026-09-27.)

    `before` is the modal's conversation ahead of these words, when Tiff has
    already answered or filed something in it: the router reads the new note
    by it and files nothing from it. Shaped here again (`earlierTurns`), as
    the browser sent it. */
export async function routeNote(input: {
  transcript: string;
  target: NoteTarget;
  source?: "text" | "voice";
  room?: TiffRoom;
  before?: readonly EarlierTurn[];
}): Promise<RouteResult> {
  const ctx = await context();
  if (!ctx) return { ok: false, error: NOT_SIGNED_IN };
  if (!(await can("workboard"))) return { ok: false, error: NO_ACCESS };

  const transcript = trim(input.transcript, 8000);
  if (!transcript) return { ok: false, error: "There was nothing in that note." };

  const target = await resolveTarget(ctx.orgId, input.target);
  if (!target) return { ok: false, error: "That isn't something in this workspace." };

  const room = isTiffRoom(input.room) ? input.room : undefined;
  const said: Turn = { ...turn("you", transcript), ...(room ? { room } : {}) };

  const { data, error } = await supabaseAdmin
    .from("workboard_notes")
    .insert({
      org_id: ctx.orgId,
      author_id: ctx.staffId,
      target_kind: target.kind,
      target_id: target.id ?? null,
      transcript,
      source: input.source === "voice" ? "voice" : "text",
      /* NO `is_debrief`. There is one door now (Isaac, 2026-09-24: "the
         diary, tasks and HeyTiff chat window should assist with that"), so
         there is nothing to record about which one the words came through.
         The column is gone (note_is_debrief_drop.sql, applied 2026-09-27),
         and a `debrief` key that a stale page or a direct POST still sends
         is read by nothing here. */
      turns: [said],
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: "Couldn't save that note." };
  const noteId = (data as { id: string }).id;

  const routing = await routingContext(ctx, target, {
    room,
    askWho: true,
    speak: true,
    earlier: earlierTurns(input.before),
  });
  const read = await readNote(transcript, routing.note);

  if (!read.ok) {
    /* The router failed, the note did not. Its words are filed as said —
       the same row `keepWords` writes — and Tiff says so. Only with a staff
       card: the diary reads by author, and a row with none is a diary entry
       nobody can see, so that note stays pending with no proposal. */
    if (ctx.staffId) {
      const turns = [said, turn("tiff", KEPT_AS_SAID)];
      await supabaseAdmin
        .from("workboard_notes")
        .update({ status: "applied", applied: {}, applied_at: new Date().toISOString(), turns })
        .eq("org_id", ctx.orgId)
        .eq("id", noteId);
      refreshHome(target);
      return { ok: false, error: KEPT_AS_SAID, kept: true, noteId };
    }
    refresh(target);
    return { ok: false, error: read.error };
  }

  const turns = withTurns([said], turn("tiff", read.proposal.say));
  await supabaseAdmin
    .from("workboard_notes")
    .update({
      proposal: read.proposal,
      status: read.proposal.clarify ? "clarifying" : "pending",
      turns,
    })
    .eq("org_id", ctx.orgId)
    .eq("id", noteId);

  refresh(target);
  return { ok: true, noteId, proposal: read.proposal, staff: routing.staff, turns };
}

async function targetLabel(orgId: string, target: NoteTarget): Promise<string | null> {
  if (target.kind === "project" && target.id) {
    const { data } = await supabaseAdmin
      .from("projects")
      .select("name, client_name")
      .eq("org_id", orgId)
      .eq("id", target.id)
      .maybeSingle();
    const row = data as { name: string; client_name: string | null } | null;
    return row ? [row.name, row.client_name].filter(Boolean).join(" — ") : null;
  }
  if (target.kind === "agreement" && target.id) {
    const { data } = await supabaseAdmin
      .from("maintenance_agreements")
      .select("label, client_name")
      .eq("org_id", orgId)
      .eq("id", target.id)
      .maybeSingle();
    const row = data as { label: string; client_name: string } | null;
    return row ? `${row.label} — ${row.client_name}` : null;
  }
  if (target.kind === "job" && target.id) {
    /* The job's own number is what a tradesperson calls it, so it leads.
       The client name comes off the mirror's company row, and a job with no
       readable company is still perfectly nameable by its number. */
    const { data } = await supabaseAdmin
      .from("sm8_jobs")
      .select("generated_job_id, company_uuid")
      .eq("org_id", orgId)
      .eq("uuid", target.id)
      .maybeSingle();
    const row = data as { generated_job_id: string | null; company_uuid: string | null } | null;
    if (!row) return null;
    const number = row.generated_job_id ? `#${row.generated_job_id}` : "ServiceM8 job";
    if (!row.company_uuid) return number;
    const { data: co } = await supabaseAdmin
      .from("sm8_companies")
      .select("name")
      .eq("org_id", orgId)
      .eq("uuid", row.company_uuid)
      .maybeSingle();
    const name = (co as { name: string | null } | null)?.name?.trim();
    return name ? `${number} — ${name}` : number;
  }
  return null;
}

/** Route a note again with what was said since, and store what came back:
    the reply (`continueNote`), read by the plan it has, the conversation
    since and the rows taken off (`NoteFollow`), with Tiff's line on the end
    of the turns. */
async function reread(
  ctx: Ctx,
  note: NoteRow,
  follow: NoteFollow,
  talk: { turns: Turn[]; reply: Turn },
): Promise<RouteResult> {
  const target: NoteTarget = { kind: note.target_kind, id: note.target_id };
  const routing = await routingContext(ctx, target, { room: roomOf(talk.turns), askWho: true, speak: true });
  const read = await readNote(note.transcript, routing.note, follow);
  if (!read.ok) return { ok: false, error: read.error };

  const turns = withTurns(talk.turns, talk.reply, turn("tiff", read.proposal.say));
  /* ONLY A NOTE STILL WAITING TAKES WHAT CAME BACK. A reply that crossed a
     Save or an Undo in flight must not drag a settled note back to pending,
     and a Server Function is reachable by direct POST: nor may it rewrite
     the words of a note that may be in ServiceM8 (two-way phase 2). So the
     write is held to a note still waiting, and asks whether it landed. */
  const { data } = await supabaseAdmin
    .from("workboard_notes")
    .update({
      proposal: read.proposal,
      status: read.proposal.clarify ? "clarifying" : "pending",
      turns,
    })
    .eq("org_id", ctx.orgId)
    .eq("id", note.id)
    .in("status", WAITING)
    .select("id");
  if (!((data ?? []) as unknown[]).length) return { ok: false, error: SETTLED.applied };

  refresh(target);
  return { ok: true, noteId: note.id, proposal: read.proposal, staff: routing.staff, turns };
}

/** A reply to Tiff, in the modal. It answers her question, or changes who
    does something, or drops or adds a row: the whole note is routed again
    with the plan it has, the conversation since and the rows `leftOut` took
    off (keys from `planRows` of the plan the modal is showing, which is the
    one stored last), and the new plan is stored with the turns.

    Refused on a note that is filed, set aside or taken back, on somebody
    else's note, and past six replies. The author's own, because a note is
    somebody's conversation. */
export async function continueNote(
  noteId: string,
  reply: string,
  leftOut: string[] = [],
): Promise<RouteResult> {
  const ctx = await context();
  if (!ctx) return { ok: false, error: NOT_SIGNED_IN };
  if (!(await can("workboard"))) return { ok: false, error: NO_ACCESS };

  const note = await noteIn(ctx.orgId, noteId);
  if (!note) return { ok: false, error: GONE };
  if (SETTLED[note.status]) return { ok: false, error: SETTLED[note.status] };
  if ((note.author_id ?? null) !== ctx.staffId) return { ok: false, error: NOT_YOURS };

  const words = trim(reply, 500);
  if (!words) return { ok: false, error: "Type an answer first." };

  const plan = storedProposal(note.proposal);
  if (!plan) return { ok: false, error: "There's nothing on that note to answer yet." };

  /* A note from before the modal, or one the old review card started, has
     no turns: its words, and Tiff's question if she asked one, are the
     conversation so far. */
  let turns = turnsOf(note.turns);
  if (turns.length === 0) {
    turns = [turn("you", note.transcript)];
    const asked = plan.say || plan.clarify?.question;
    if (asked) turns.push(turn("tiff", asked));
  }
  if (repliesIn(turns) >= REPLIES_MAX) {
    return { ok: false, error: "That's six replies on one note. Close it and start a new one." };
  }

  /* Keys, not words: the browser names which rows, never what they said. A
     key that names no row of the stored plan is dropped here. */
  const keys = new Set(planRows(plan).map((r) => r.key));
  const gone = (Array.isArray(leftOut) ? leftOut : []).filter(
    (k): k is string => typeof k === "string" && keys.has(k),
  );

  const said = turn("you", words);
  return reread(ctx, note, { plan, turns: [...turns, said], leftOut: gone }, { turns, reply: said });
}

type NoteRow = {
  id: string;
  transcript: string;
  status: string;
  target_kind: NoteTarget["kind"];
  target_id: string | null;
  proposal: unknown;
  author_id?: string | null;
  applied?: unknown;
  turns?: unknown;
};

const NOTE_COLUMNS = "id, transcript, status, target_kind, target_id, proposal, author_id, applied, turns";

/* ONLY A NOTE STILL WAITING CAN BE ANSWERED OR SET ASIDE. A reply and a
   walk-away update a row by id, and a Server Function is reachable by
   direct POST: pointed at an APPLIED row — a reply, a Done or a pen entry
   that may be in ServiceM8 (two-way phase 2) — they would hide it from the
   diary while its note still went, rewrite the words that go, or put it
   back to waiting. So they act only on a `pending` or `clarifying` row, and
   each update is conditional on it too, so a row applied in between is
   left alone. */
const WAITING = ["pending", "clarifying"];
const ALREADY_APPLIED = "That note was already applied.";
const waiting = (note: NoteRow) => WAITING.includes(note.status);

async function noteIn(orgId: string, noteId: string): Promise<NoteRow | null> {
  const { data } = await supabaseAdmin
    .from("workboard_notes")
    .select(NOTE_COLUMNS)
    .eq("org_id", orgId)
    .eq("id", noteId)
    .maybeSingle();
  return (data as NoteRow | null) ?? null;
}

/* ---------------- apply ---------------- */

/** What is filed: the stored proposal as `toConfirmed(toDraft(…))` reads
    it, minus the rows the person took off (`fileNote`). Deliberately NOT the
    model's proposal as it came back: this is the shape the writer checks
    field by field. A library entry is never in it: each waits for its own
    press (`publishNoteKb`), since its reach is the whole workspace. */
export type ConfirmedNote = {
  tasks: {
    title: string;
    detail: string;
    assigneeId: string | null;
    dueDate: string | null;
    /** "HH:MM" on the workspace's clock, or null for an ordinary task.

        A TIME, NOT AN INSTANT, and deliberately so: a Server Function is
        reachable by direct POST, so a timestamp arriving from a browser is a
        claim about a moment that nobody here can check. The server composes the
        instant itself from this and the due date, on the account's own zone. */
    remindTime?: string | null;
    /** "at" or "by" — be doing it then, or be finished by then. Validated on
        arrival like everything else on this shape; anything else becomes
        "at", which is also what no time at all means. */
    remindKind?: string | null;
  }[];
  bringItems: string[];
  flags: { message: string; severity: string }[];
  progressBullets: string[];
  commissioningEntries: string[];
  issueEntries: { summary: string; equipmentRef: string }[];
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const MOVED = "That job isn't on this workspace's board any more.";

/** The note's target, or the job an answer is pinning it to — re-validated
    like any other target, since a Server Function is reachable by direct
    POST. Null when the new one is not in this workspace. Written nowhere
    yet: `fileNote` moves the note only when it files, so a refused filing
    leaves the note where it was. */
async function pickTarget(
  ctx: Ctx,
  note: NoteRow,
  retarget?: NoteTarget,
): Promise<{ target: NoteTarget; moved: boolean } | null> {
  if (!retarget || retarget.kind === "none" || !retarget.id) {
    return { target: { kind: note.target_kind, id: note.target_id }, moved: false };
  }
  const resolved = await resolveTarget(ctx.orgId, retarget);
  if (!resolved || resolved.kind === "none") return null;
  return { target: resolved, moved: true };
}

type Applied =
  | { ok: true; summary: string; applied: Record<string, unknown> }
  | { ok: false; error: string };

/** THE ONE WRITER. Turns a confirmation into rows and returns the record of
    them, for `fileNote` (what the stored proposal confirms, minus what the
    person took off). Everything is re-validated here, because a Server
    Function is reachable by direct POST. It writes everything but the
    note's own status: `fileNote` settles its note.

    THE RECORD IS v2 (lib/workboard/note-applied): every row it makes, by id,
    and every append with what the column said before — what Undo needs to
    take the note back. The journal's groups go through `record` as they
    always did; what only Undo reads is set on the record beside them. */
async function applyConfirmed(
  ctx: Ctx,
  note: Pick<NoteRow, "id" | "transcript">,
  confirmed: ConfirmedNote,
  target: NoteTarget,
): Promise<Applied> {
  const noteId = note.id;

  /* WHICH ROWS ACTUALLY NEED A JOB — the cascade, re-decided server-side.

     This used to refuse EVERY targetless note (Isaac, 2026-08-02: "every note
     goes on a job"), and that rule was right about the thing it was written
     for. A flag with no job renders a row on Needs attention that names a
     problem and then refuses to open anything; a bring-item with no job has
     no visit to be brought to. Those are dead ends and they stay refused.

     But it was too broad, and the schema says so: `tasks` has NO job column
     at all — org, title, assignee, due date, status. A task from a note has
     always stood on its own and always landed on the assignee's dashboard.
     The only thing insisting otherwise was this guard and the review card's
     Save rule, which is why "tell Luke to ring the wholesaler" — a perfectly
     good task about no job in particular — could not be saved at all.

     So the question is per bucket, not per note (Isaac, 2026-08-05). A
     Server Function is reachable by direct POST, so `fileNote` asking
     "Which job is this for?" off the same buckets (`jobBound`) is the
     courtesy, and THIS is the enforcement. */
  const needsJob =
    (confirmed.bringItems ?? []).some((b) => trim(b, 1000)) ||
    (confirmed.flags ?? []).some((f) => trim(f.message, 200)) ||
    (confirmed.progressBullets ?? []).some((b) => trim(b, 1000)) ||
    (confirmed.commissioningEntries ?? []).some((b) => trim(b, 1000)) ||
    (confirmed.issueEntries ?? []).some((i) => trim(i.summary, 1000));

  if (needsJob && (target.kind === "none" || !target.id)) {
    return {
      ok: false,
      error:
        "Flags, bring-items, progress, commissioning and issues all hang off a job — say which one, or untick them.",
    };
  }

  const applied: Record<string, unknown> = {};
  const counts: string[] = [];
  applied.v = APPLIED_V;

  /** Record one group's ids and its line of the "Saved — …" summary. Six
      groups wrote these same three lines by hand; the plural is the only part
      that ever differs. */
  const record = (key: string, ids: string[], one: string, many = `${one}s`) => {
    if (!ids.length) return;
    applied[key] = ids;
    counts.push(`${ids.length} ${ids.length === 1 ? one : many}`);
  };

  /* WHAT ONLY UNDO READS, kept beside the groups and never counted: they are
     the same work the groups already say, told the way Undo needs it. */
  const textWrites: TextWrite[] = [];
  const keep = (key: "checklistIds" | "picklistIds" | "issueBumps" | "textWrites", v: unknown[]) => {
    if (v.length) applied[key] = v;
  };

  /* tasks — through the EXISTING tasks table, so assignment and the
     dashboard's own notifications come free. An assignee must be a real
     member of this org; anything else is refused rather than silently
     dropped, because an unassigned task is a task nobody does.

     "Refused" is now literal. This comment said it before and the code did
     the opposite — it FILTERED, so a task with no person on it disappeared
     without a word and the summary counted what was left. That is how two of
     Isaac's tasks evaporated between the review card and the database.

     The org check is ONE query for all assignees rather than one each: this
     runs at the end of a flow the person is waiting on, and a four-task note
     was eight sequential round trips to a remote database. */
  const namedTasks = (confirmed.tasks ?? []).filter((t) => trim(t.title, 200));
  if (namedTasks.some((t) => !t.assigneeId)) {
    return {
      ok: false,
      error: "A task needs a person on it before it can be saved. Assign it, or untick it.",
    };
  }
  const wanted = namedTasks;
  if (wanted.length) {
    const { data: people } = await supabaseAdmin
      .from("staff_profiles")
      .select("id")
      .eq("org_id", ctx.orgId)
      .in("id", [...new Set(wanted.map((t) => t.assigneeId as string))]);
    const real = new Set(((people ?? []) as { id: string }[]).map((p) => p.id));

    if (wanted.some((t) => !real.has(t.assigneeId as string))) {
      return { ok: false, error: "That person isn't on this workspace any more." };
    }

    /* The account's own clock, because "Monday 6:30" is a different instant in
       Perth than in Sydney and the server runs in neither. Read once for the
       whole batch, and only when there are tasks to write. */
    const tz = await getSm8Timezone(ctx.orgId);

    const rows = wanted.map((t) => {
      /* The nudge, composed here and nowhere else. Null unless the task
         carries BOTH a day and a time — `remindAtFrom` returns null for
         either half missing, which is exactly "this is an ordinary task". */
      const remindAt = remindAtFrom(t.dueDate, t.remindTime, tz);
      return {
        org_id: ctx.orgId,
        title: trim(t.title, 200),
        detail: trim(t.detail, 1000) || null,
        assigned_to: t.assigneeId,
        created_by: ctx.staffId,
        due_date: typeof t.dueDate === "string" && ISO_DATE.test(t.dueDate) ? t.dueDate : null,
        remind_at: remindAt,
        /* ONLY EVER "by" OR NULL, for two reasons that point the same way.
           The database refuses a kind with no moment to qualify (see
           docs/migrations/task_remind_kind.sql), and a null already reads as
           "at" everywhere through `remindKindOf` — so storing the word "at"
           would add a second way to say the identical thing, and a row that
           could one day disagree with itself. */
        remind_kind:
          remindAt !== null && isRemindKind(t.remindKind) && t.remindKind === "by" ? "by" : null,
        status: "open",
      };
    });

    if (rows.length) {
      const { data } = await supabaseAdmin.from("tasks").insert(rows).select("id");
      record("taskIds", ((data ?? []) as { id: string }[]).map((r) => r.id), "task");
    }
  }

  /* flags — what pulses on the board until someone deals with it */
  const flagRows = (confirmed.flags ?? [])
    .map((f) => ({ message: trim(f.message, 200), severity: f.severity }))
    .filter((f) => f.message)
    .map((f) => ({
      org_id: ctx.orgId,
      target_kind: target.kind,
      target_id: target.id ?? null,
      message: f.message,
      severity: isSeverity(f.severity) ? f.severity : ("warn" satisfies Severity),
      note_id: noteId,
    }));
  if (flagRows.length) {
    const { data } = await supabaseAdmin.from("workboard_flags").insert(flagRows).select("id");
    record("flagIds", ((data ?? []) as { id: string }[]).map((r) => r.id), "flag");
  }

  /* progress + commissioning — WHERE THEY LAND DEPENDS ON THE JOB.

     A project has a journal of its own: `project_entries`, dated, told apart
     by `kind`, rendered on the project sheet. Visits and agreements have no
     such table, and this block used to be written `if (target.kind ===
     "project")` and nothing else — so a note pinned to a visit with a
     reading ticked wrote its flags, said "Saved — 1 flag." and dropped the
     reading without a word. The guard above accepts ANY job for these
     buckets and the review card's Save rule said the same, so nothing
     anywhere warned; that is the exact silent drop the rest of this function
     exists to prevent, and the card's picker offered visits and agreements,
     so it was reachable from the board in two clicks.

     Refusing (the answer bring-items get) would have been honest and still
     wrong. Readings taken on a maintenance visit are the most ordinary
     commissioning there is, and maintenance work is never a project — so a
     project-only rule doesn't send anyone somewhere better, it just makes
     the maintenance half of the board unable to record what it measured.
     Refusal is for a bucket with NOWHERE to go, and this one has somewhere.

     Visits and agreements own a `notes` column (the one the old review
     card's "keep it on the job" appended to), where a LINE IS A BULLET
     (lib/workboard/note-lines) and the sheet already reads it back. So the
     lines go there — the same shape as bring-items, which have gone to
     whichever list the target owns since the day they were written.

     The kind is the one thing a text column can't carry, so commissioning
     says what it is. Progress needs no label: "what was done today" is what
     a visit note already is. */
  const progress = (confirmed.progressBullets ?? []).map((b) => trim(b, 1000)).filter(Boolean);
  const commissioning = (confirmed.commissioningEntries ?? [])
    .map((b) => trim(b, 1000))
    .filter(Boolean);

  if ((progress.length || commissioning.length) && target.kind !== "none" && target.id) {
    if (target.kind === "project") {
      const rows = [
        ...progress.map((body) => ({ kind: "progress" as const, body })),
        ...commissioning.map((body) => ({ kind: "commissioning" as const, body })),
      ];
      const { data } = await supabaseAdmin
        .from("project_entries")
        .insert(
          rows.map((r) => ({
            org_id: ctx.orgId,
            project_id: target.id,
            kind: r.kind,
            body: r.body,
            note_id: noteId,
            created_by: ctx.staffId,
          }))
        )
        .select("id");
      record("entryIds", ((data ?? []) as { id: string }[]).map((r) => r.id), "entry", "entries");
    } else if (target.kind === "job") {
      /* A JOB'S JOURNAL IS ITS DIARY, and the note is already in it.

         Every other target owns a `notes` column these lines are appended
         to; a ServiceM8 job owns nothing we may write, so the note row
         itself is the record — and the transcript these bullets were
         distilled FROM lands there whole, a few lines further down. Writing
         them anywhere as well would put the same sentence in the feed twice.

         Recorded all the same, so the journal counts the work: the words,
         not ids, exactly like bring-items and for the same reason. */
      record(
        "entryLines",
        [...progress, ...commissioning.map((b) => `Commissioning: ${b}`)],
        "entry",
        "entries"
      );
    } else {
      const lines = [...progress, ...commissioning.map((b) => `Commissioning: ${b}`)];
      const table = writableNotesTable(target.kind)!;
      const { data } = await supabaseAdmin
        .from(table)
        .select("notes")
        .eq("org_id", ctx.orgId)
        .eq("id", target.id)
        .maybeSingle();
      const before = (data as { notes: string | null } | null)?.notes ?? null;
      const current = (before ?? "").trim();
      const after = fromLines([current, ...lines]).slice(0, 8000);
      await supabaseAdmin
        .from(table)
        .update({
          notes: after,
          updated_at: new Date().toISOString(),
        })
        .eq("org_id", ctx.orgId)
        .eq("id", target.id);
      /* Words, not ids — these become text on the job's own row, so there is
         nothing to point back at. Same record as bring-items, same reason. */
      record("entryLines", lines, "entry", "entries");
      textWrites.push({ table: table as TextWrite["table"], id: target.id, column: "notes", before, after });
    }
  }

  /* issues — the "this keeps happening" memory. A repeat of something
     already logged bumps the existing row rather than making a second one,
     because two rows is exactly how a pattern stops being visible.

     One lookup covers every summary at once, and the timezone read only
     happens when there is actually an issue to date — it was being paid on
     every apply for the common case of none. */
  const issues = (confirmed.issueEntries ?? [])
    .map((i) => ({ summary: trim(i.summary, 1000), equipmentRef: trim(i.equipmentRef, 200) || null }))
    .filter((i) => i.summary);

  if (issues.length) {
    const today = todayInZone(await getSm8Timezone(ctx.orgId));
    const { data: priors } = await supabaseAdmin
      .from("workboard_issues")
      .select("id, summary, occurrences, last_seen")
      .eq("org_id", ctx.orgId)
      .eq("target_kind", target.kind)
      .eq("resolved", false)
      .in("summary", issues.map((i) => i.summary));

    const seen = new Map(
      (
        (priors ?? []) as { id: string; summary: string; occurrences: number; last_seen?: string | null }[]
      ).map((p) => [p.summary, p])
    );

    const fresh = issues.filter((i) => !seen.has(i.summary));
    const bumps = issues.filter((i) => seen.has(i.summary));
    const issueIds = bumps.map((i) => seen.get(i.summary)!.id);

    /* A BUMP IS PUT BACK, NEVER DELETED: the row was there before this note
       and is somebody else's record too. So what it said before is kept, one
       entry per row however many times the note repeated it. */
    const before = new Map<string, IssueBump>();
    for (const i of bumps) {
      const p = seen.get(i.summary)!;
      before.set(p.id, { id: p.id, occurrences: p.occurrences, lastSeen: p.last_seen ?? null });
    }
    keep("issueBumps", [...before.values()]);

    await Promise.all(
      bumps.map((i) => {
        const prior = seen.get(i.summary)!;
        return supabaseAdmin
          .from("workboard_issues")
          .update({ occurrences: prior.occurrences + 1, last_seen: today })
          .eq("org_id", ctx.orgId)
          .eq("id", prior.id);
      })
    );

    if (fresh.length) {
      const { data } = await supabaseAdmin
        .from("workboard_issues")
        .insert(
          fresh.map((i) => ({
            org_id: ctx.orgId,
            target_kind: target.kind,
            target_id: target.id ?? null,
            equipment_ref: i.equipmentRef,
            summary: i.summary,
            first_seen: today,
            last_seen: today,
          }))
        )
        .select("id");
      issueIds.push(...((data ?? []) as { id: string }[]).map((r) => r.id));
    }
    record("issueIds", issueIds, "issue");
  }

  /* bring-items — onto the agreement's bring list where there is one, so the
     next visit's prep sheet already has them */
  const bring = (confirmed.bringItems ?? []).map((b) => trim(b, 200)).filter(Boolean);
  let bringSaved = false;
  if (bring.length && target.id) {
    let saved = false;

    if (target.kind === "agreement" || target.kind === "visit") {
      const agreementId =
        target.kind === "agreement" ? target.id : await agreementOfVisit(ctx.orgId, target.id);
      if (agreementId) {
        const { data } = await supabaseAdmin
          .from("maintenance_agreements")
          .select("bring_list")
          .eq("org_id", ctx.orgId)
          .eq("id", agreementId)
          .maybeSingle();
        const before = (data as { bring_list: string | null } | null)?.bring_list ?? null;
        const current = before ?? "";
        const merged = [current.trim(), ...bring].filter(Boolean).join(", ").slice(0, 2000);
        await supabaseAdmin
          .from("maintenance_agreements")
          .update({ bring_list: merged, updated_at: new Date().toISOString() })
          .eq("org_id", ctx.orgId)
          .eq("id", agreementId);
        saved = true;
        textWrites.push({
          table: "maintenance_agreements",
          id: agreementId,
          column: "bring_list",
          before,
          after: merged,
        });
      }
    } else if (target.kind === "project") {
      const { data } = await supabaseAdmin
        .from("project_checklist_items")
        .select("sort")
        .eq("org_id", ctx.orgId)
        .eq("project_id", target.id)
        .order("sort", { ascending: false })
        .limit(1)
        .maybeSingle();
      const base = ((data as { sort: number } | null)?.sort ?? -1) + 1;
      const { data: made } = await supabaseAdmin
        .from("project_checklist_items")
        .insert(
          bring.map((label, i) => ({
            org_id: ctx.orgId,
            project_id: target.id,
            section: "Bring next visit",
            label,
            sort: base + i,
          }))
        )
        .select("id");
      saved = true;
      keep("checklistIds", ((made ?? []) as { id: string }[]).map((r) => r.id));
    } else if (target.kind === "job") {
      /* A JOB HAS ITS OWN RUNNING LIST since slice 3 — the picklist
         generalised — and "bring the 1060 grille" is a MATERIAL on it, which
         is the same thing an agreement's bring-list is. So bring-items land
         there and the card shows them the moment it opens, rather than being
         refused for want of an agreement the job may not have.

         Appended after the tail, the same law `addJobPicklistItem` follows,
         and never onto a design: these are typed, not pushed. */
      const { data: tail } = await supabaseAdmin
        .from("job_picklist_items")
        .select("position")
        .eq("org_id", ctx.orgId)
        .eq("sm8_job_uuid", target.id)
        .order("position", { ascending: false })
        .limit(1);
      const base = ((tail ?? [])[0]?.position as number | undefined) ?? -1;
      const { data: made, error: bringErr } = await supabaseAdmin
        .from("job_picklist_items")
        .insert(
          bring.map((name, i) => ({
            org_id: ctx.orgId,
            sm8_job_uuid: target.id,
            design_id: null,
            kind: "material",
            name,
            sub: "",
            qty: "",
            position: base + 1 + i,
            added_by: ctx.userId,
          }))
        )
        .select("id");
      saved = !bringErr;
      keep("picklistIds", ((made ?? []) as { id: string }[]).map((r) => r.id));
    }

    // `applied` records ids everywhere else; bring-items have none of their
    // own — they become text on somebody else's row — so the words are what
    // gets recorded.
    if (saved) record("bringItems", bring, "bring-item");
    bringSaved = saved;
  }
  /* A bring-list is text on somebody else's row — an agreement's or a
     project's. With nothing to hang it off it used to be dropped in silence
     from a note that had already said "Saved". Say it instead. */
  if (bring.length && !bringSaved) {
    return {
      ok: false,
      error:
        "A bring-list needs a job to sit on. Say what this note is against, or untick the bring items.",
    };
  }

  /* ── the words themselves, when the target is a JOB ──
     Every other target has somewhere for the transcript to go and a sheet
     that reads it back; a ServiceM8 job's written record is its DIARY, and
     the diary reads this row. So a note dictated on a job card lands there
     whatever else it did — "get Luke to order the grilles" is a task AND a
     thing that was said on this job, and the feed would be lying if it only
     showed the half that grew a row of its own.

     `jobNotes` is the group the old review card's "keep it on the job"
     wrote, and the journal still counts, which is exactly what it means
     here. */
  if (target.kind === "job") {
    const words = trim(note.transcript, 4000);
    if (words) record("jobNotes", [words], "note on the job", "notes on the job");
  }

  /* NOTHING SILENTLY VANISHES. Isaac dictated two tasks and two bring-items
     from the board header, pressed Save, and got "Saved as a note." — while
     `applied` went to the database as `{}`. Both tasks were dropped because
     neither had a person on it, and both bring-items were dropped because a
     general note has no job to hang them off. Every one of those drops was
     silent, and the summary said the reassuring thing.

     So: if the confirmation asked for work and NONE of it could be done, this
     refuses. The note keeps its words and stays waiting rather than being
     marked applied over an empty object. `fileNote`'s questions are supposed
     to stop this ever reaching here — this is the backstop that makes "saved"
     mean saved. */
  const asked =
    (confirmed.tasks?.length ?? 0) +
    (confirmed.bringItems?.length ?? 0) +
    (confirmed.flags?.length ?? 0) +
    (confirmed.progressBullets?.length ?? 0) +
    (confirmed.commissioningEntries?.length ?? 0) +
    (confirmed.issueEntries?.length ?? 0);
  /* Everything that needs a job was refused by the per-bucket guard near the
     top, and a bring-list with nowhere to sit was refused just above. So by
     the time we are here the only way to drop every row is a task with
     nobody on it — which the earlier `namedTasks` check also refuses. This
     is the net under both of them, and it stays because "Saved" writing an
     empty `applied` object is the specific bug this whole run of guards
     exists to prevent. */
  if (asked > 0 && counts.length === 0) {
    return {
      ok: false,
      error: "None of that could be saved — a task needs a person on it. Assign it or untick it.",
    };
  }

  keep("textWrites", textWrites);
  return {
    ok: true,
    summary: counts.length ? `Saved — ${counts.join(", ")}.` : "Saved as a note.",
    applied,
  };
}

async function agreementOfVisit(orgId: string, visitId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("maintenance_visits")
    .select("agreement_id")
    .eq("org_id", orgId)
    .eq("id", visitId)
    .maybeSingle();
  return (data as { agreement_id: string } | null)?.agreement_id ?? null;
}

/* ---------------- the Tiff modal: file, undo, save, publish ---------------- */

/** File a modal note — the moment nothing is left to ask (Isaac, 2026-09-25:
    filing live, with Undo as the safety net).

    FROM THE STORED PROPOSAL, NEVER THE BROWSER'S. What is filed is
    `toConfirmed(toDraft(stored))`, the rules the review card ran, minus the
    rows `leaveOut` names (keys from `planRows`) and minus every library
    entry: those wait for their own press (`publishNoteKb`). The browser names
    only rows to drop and the job; it cannot add a row, reword one or put a
    person on a task.

    WHEN SOMETHING IS STILL UNCLEAR IT ASKS INSTEAD, and files nothing: Tiff's
    own pending question, then a task with nobody on it ("Who should do this:
    …?"), then a row that needs a job and has none ("Which job is this for?",
    with up to three jobs the words match as answers that carry the job).
    A question it asks is kept on the note (`askFirst`), so the reply is read
    as the answer to it. A job the answer carries files straight past its
    own question, and the conversation keeps the pick as your turn (`answer`,
    the words the answer showed; the job's own name where none came), so
    opened again from the diary it reads as it was said: her question, your
    job, "Done. …". Only words: the job itself is `retarget`, checked here.

    CLAIMED BEFORE IT WRITES. Nothing reviews this, so two presses must not
    file twice: the note moves to `applied` only if it is still waiting, and
    goes back to where it was if the write is refused part-way. */
export async function fileNote(
  noteId: string,
  opts: { leaveOut?: string[]; retarget?: NoteTarget; answer?: string } = {},
): Promise<FileResult> {
  const ctx = await context();
  if (!ctx) return { ok: false, error: NOT_SIGNED_IN };
  if (!(await can("workboard"))) return { ok: false, error: NO_ACCESS };

  const note = await noteIn(ctx.orgId, noteId);
  if (!note) return { ok: false, error: GONE };
  if (SETTLED[note.status]) return { ok: false, error: SETTLED[note.status] };
  if ((note.author_id ?? null) !== ctx.staffId) return { ok: false, error: NOT_YOURS };

  const plan = storedProposal(note.proposal);
  if (!plan) return { ok: false, error: "There's nothing on that note to file yet." };
  /* "Which job is this for?" is the one question a pick answers rather than
     a reply, so it is asked afresh below (its answers carry their jobs, which
     a stored option cannot) and a job it was answered with files past it. */
  const jobAsked = plan.clarify?.question === WHICH_JOB;
  if (plan.clarify && !jobAsked) {
    return {
      ok: false,
      error: plan.clarify.question,
      ask: { question: plan.clarify.question, options: plan.clarify.options.map((label) => ({ label })) },
    };
  }

  const leaveOut = Array.isArray(opts.leaveOut) ? opts.leaveOut : [];
  const draft = withoutRows(toDraft({ ...plan, kbEntries: [] }), leaveOut);
  const turns = turnsOf(note.turns);
  /* EVERY WORD THEY SAID: the note, then each reply after it (the first
     "you" turn IS the note). The quick answers come off this, never off the
     note alone, or a reply that names what was missing ("it's the Meridian
     job") could never become one: the reply changes the plan, never the
     transcript, and the same question came back with the same answers. */
  const said = [note.transcript, ...turns.filter((t) => t.who === "you").slice(1).map((t) => t.text)].join("\n");

  /* Who, before which job: a person is the likelier gap, and the answer is a
     reply the router reads, where a job is a pick. */
  const nobody = draft.tasks.find((t) => t.on && t.title.trim() && !t.assigneeId);
  if (nobody) {
    const staff = await assignableStaff(ctx.orgId);
    const question = `Who should do this: ${nobody.title.trim()}?`;
    const labels = [...(ctx.staffId ? ["Me"] : []), ...namesMentioned(said, staff, ctx.staffId)];
    return askFirst(ctx, note, turns, { question, options: labels.map((label) => ({ label })) });
  }

  const picked = await pickTarget(ctx, note, opts.retarget);
  if (!picked) return { ok: false, error: MOVED };
  const { target } = picked;
  if (jobBound(draft) && (target.kind === "none" || !target.id)) {
    const jobs = matchedJobs(said, await jobCandidates(ctx.orgId), 3);
    const ask: FileAsk = {
      question: WHICH_JOB,
      options: jobs.map((j) => ({ label: describeJob(j), target: { kind: j.kind, id: j.id } })),
    };
    /* Asked once: pressed again, the question is already Tiff's last turn. */
    return jobAsked ? { ok: false, error: WHICH_JOB, ask, turns } : askFirst(ctx, note, turns, ask);
  }

  const { data: claimed } = await supabaseAdmin
    .from("workboard_notes")
    .update({ status: "applied", applied_at: new Date().toISOString() })
    .eq("org_id", ctx.orgId)
    .eq("id", noteId)
    .in("status", WAITING)
    .select("id");
  if (!((claimed ?? []) as unknown[]).length) return { ok: false, error: SETTLED.applied };

  const done = await applyConfirmed(ctx, note, toConfirmed(draft), target);
  if (!done.ok) {
    await supabaseAdmin
      .from("workboard_notes")
      .update({ status: note.status, applied_at: null })
      .eq("org_id", ctx.orgId)
      .eq("id", noteId);
    return { ok: false, error: done.error };
  }

  /* The job that answered "Which job is this for?" is your turn in the
     conversation, as the modal showed it. */
  const jobWords =
    jobAsked && picked.moved
      ? trim(opts.answer, 300) || ((await targetLabel(ctx.orgId, target)) ?? "")
      : "";
  const filed = withTurns(
    turns.length ? turns : [turn("you", note.transcript)],
    ...(jobWords ? [turn("you", jobWords)] : []),
    turn("tiff", doneLine(plan.say)),
  );
  await supabaseAdmin
    .from("workboard_notes")
    .update({
      turns: filed,
      /* The job the answer carried: the note remembers where it ended up. */
      ...(picked.moved ? { target_kind: target.kind, target_id: target.id ?? null } : {}),
      /* The question a job answered is answered: nothing is waiting on it. */
      ...(plan.clarify ? { proposal: { ...(note.proposal as Record<string, unknown>), clarify: null } } : {}),
    })
    .eq("org_id", ctx.orgId)
    .eq("id", noteId);

  /* THE RECORD IS MERGED IN THE DATABASE, NEVER WRITTEN BACK FROM A COPY.
     A Library press can land while this note is filing (the entry sits in
     the same plan), and each used to write the whole column from what it
     had read: the press's stale copy then wiped this record, or this record
     wiped the press's entry. One statement each now (tiff_modal_record.sql),
     so an entry published before or during filing stays on the record and
     Undo finds it with everything else. */
  await supabaseAdmin.rpc("workboard_note_file_record", {
    p_org: ctx.orgId,
    p_note: noteId,
    p_applied: done.applied,
  });

  refreshHome(target);
  return { ok: true, summary: done.summary, doors: doorsOf(appliedOf(done.applied)), turns: filed };
}

/** Ask instead of filing, and KEEP THE QUESTION ON THE NOTE: Tiff's turn in
    the conversation, so the diary's last line is the question and the reply
    that follows it reads as its answer, and the proposal's `clarify`, so the
    next read is told what was asked and a tapped option is a plain answer
    ("Do not ask again"). The note is `clarifying` until it is answered.

    Only onto a note still waiting: a question must not reopen one that was
    filed or taken back in the moment since. Nothing else changes, and `say`
    stays the plan's own line, which is what "Done." repeats. */
async function askFirst(
  ctx: Ctx,
  note: NoteRow,
  turns: Turn[],
  ask: FileAsk,
): Promise<FileResult> {
  const asked = withTurns(turns.length ? turns : [turn("you", note.transcript)], turn("tiff", ask.question));
  await supabaseAdmin
    .from("workboard_notes")
    .update({
      proposal: {
        ...(note.proposal as Record<string, unknown>),
        clarify: { question: ask.question, options: ask.options.map((o) => o.label) },
      },
      status: "clarifying",
      turns: asked,
    })
    .eq("org_id", ctx.orgId)
    .eq("id", note.id)
    .in("status", WAITING);
  return { ok: false, error: ask.question, ask, turns: asked };
}

/** Why Undo is refused, in the spec's words where it has them. */
const UNDO = {
  notFiled: "There's nothing filed on that note to take back.",
  undone: "That was already taken back.",
  old: "That one was filed before Undo existed, so it can't be taken back.",
  notYours: "That note isn't yours to take back.",
  text: "That job's notes have changed since, so nothing was taken back.",
  acted: "Someone has already acted on one of those, so nothing was taken back.",
  ticked: (first: string) => `${first} has already ticked off one of those, so nothing was taken back.`,
  sm8: "That note was queued for ServiceM8, so nothing was taken back. Remove it from the job's diary first.",
  gone: "Those have all been deleted since, so nothing was taken back.",
};

/* A NOTE QUEUED FOR SERVICEM8 IS TAKEN BACK FROM THE JOB'S DIARY, NOT HERE
   (two-way phase 2). A note filed on a job is its author's diary entry, and
   its author can send it to ServiceM8. Undo moves it to `undone`, which the
   job's diary never reads: while something of it can still go or may be in
   ServiceM8, HeyTiff would lose its record of it and nobody could take it
   out. The job diary's Remove takes it back whatever state it is in
   (decision 8), and once that has closed the create Undo goes as ever. The
   rule is sm8-note-plan's `undoHeldBySm8`, the one the Home's diary offers
   its Undo by (journal-query), so the two never disagree.

   Read after the claim as well as before it (decision 11): a Send reads the
   note again once it has queued, and gives its create back when the note is
   no longer `applied`, so whichever reads second sees the other. Only where
   this deployment sends notes, so production gains no read; a read that
   fails holds the Undo. */
async function heldBySm8(orgId: string, note: NoteRow): Promise<boolean> {
  if (note.target_kind !== "job" || !sm8NotesAllowed()) return false;
  const { data, error } = await supabaseAdmin
    .from("sm8_writes")
    .select(UNDO_HOLD_COLUMNS)
    .eq("org_id", orgId)
    .eq("kind", "note")
    .eq("op", "create")
    .eq("note_id", note.id)
    .maybeSingle();
  if (error) return true;
  return undoHeldBySm8(data as CreateRow | null, Date.now());
}

type Rows = Record<string, unknown>[];

/** Take back what a note filed: its tasks, flags, entries, fresh issues,
    checklist and picklist rows and library entries go; a bumped issue's
    count and day are put back; an append to a job's notes or bring list is
    restored to what the column said before.

    ALL OR NOTHING, CHECKED FIRST. Undo lasts until someone acts on a filed
    row (the spec's call): a task ticked off, given to someone else, moved to
    another day, reopened or answered "Got it", a flag cleared, an issue
    counted again, a line bought, the job's notes edited since. Any one of
    those and nothing is taken back, and the sentence says why — a
    half-undone note is worse than either. A task still open says only some
    of that on its row; the rest is its history (task_events), read with it.
    The rule is note-applied's `undoBlocked`, the one the diary draws its
    Undo by, so the two never disagree about what a press would do.

    WHAT IT SAYS IT TOOK is what was still there: a row somebody deleted
    since stops nothing and is not counted, and a note whose every row has
    gone is refused rather than said to have taken something back.

    TAKEN BACK ALREADY — the first press landed and its answer was lost, or
    somebody else pressed it — is refused with the conversation as it now
    stands, so the page that asked can say what went rather than offer Undo
    on rows that have gone.

    For the author, or anyone with `team` (deleteTask's rule), on a `v: 2`
    note that is still `applied`. The words stay, and so does `applied`: it is
    the record of what existed. The bell needs nothing — it is derived when
    it is read. */
export async function undoNote(noteId: string): Promise<UndoResult> {
  const ctx = await context();
  if (!ctx) return { ok: false, error: NOT_SIGNED_IN };

  const note = await noteIn(ctx.orgId, noteId);
  if (!note) return { ok: false, error: GONE };
  const mine = !!ctx.staffId && note.author_id === ctx.staffId;
  if (!mine && !(await can("team"))) return { ok: false, error: UNDO.notYours };
  if (note.status === "undone") return { ok: false, error: UNDO.undone, turns: turnsOf(note.turns) };
  if (note.status !== "applied") return { ok: false, error: UNDO.notFiled };

  const a = appliedOf(note.applied);
  if (a.v !== APPLIED_V) return { ok: false, error: UNDO.old };

  const fresh = freshIssueIds(a);
  const read = async (table: string, columns: string, ids: string[]): Promise<Rows> => {
    if (!ids.length) return [];
    const { data } = await supabaseAdmin
      .from(table)
      .select(columns)
      .eq("org_id", ctx.orgId)
      .in("id", ids);
    return (data ?? []) as unknown as Rows;
  };
  const byId = (rows: Rows) => new Map(rows.map((r): [string, NowRow] => [String(r.id), r]));

  /* ── every check, before a single write: the rows as they read now,
     judged by the one rule the diary's Undo is drawn by (note-applied) ── */
  const [tasks, flags, issues, checklist, picklist, entries, kb, history, text] = await Promise.all([
    read("tasks", "id, status, assigned_to, done_by, acknowledged_at", a.taskIds),
    read("workboard_flags", "id, active", a.flagIds),
    read("workboard_issues", "id, occurrences, resolved", a.issueIds),
    read("project_checklist_items", "id, done", a.checklistIds),
    read("job_picklist_items", "id, picked", a.picklistIds),
    read("project_entries", "id", a.entryIds),
    read("kb_documents", "id, category", a.kbIds),
    /* What an open task's row cannot say: it was given, moved, or ticked
       and reopened since. One is enough. */
    a.taskIds.length
      ? supabaseAdmin
          .from("task_events")
          .select("task_id")
          .eq("org_id", ctx.orgId)
          .in("task_id", a.taskIds)
          .in("kind", ACTED_KINDS)
          .limit(1)
          .then(({ data }) => (data ?? []) as unknown as Rows)
      : Promise.resolve([] as Rows),
    Promise.all(
      a.textWrites.map(async (w): Promise<[string, NowRow] | null> => {
        const { data } = await supabaseAdmin
          .from(w.table)
          .select(w.column)
          .eq("org_id", ctx.orgId)
          .eq("id", w.id)
          .maybeSingle();
        return data ? [textKey(w.table, w.id), data as unknown as NowRow] : null;
      }),
    ),
  ]);
  const found = {
    tasks: byId(tasks),
    taskHistory: new Set(history.map((e) => String(e.task_id))),
    flags: byId(flags),
    issues: byId(issues),
    checklist: byId(checklist),
    picklist: byId(picklist),
    entries: new Set(entries.map((e) => String(e.id))),
    kb: new Set(kb.filter((d) => d.category === "field").map((d) => String(d.id))),
    /* two writes to one row (its notes and its bring list) read one column
       each: merged, so each check sees its own */
    text: text.reduce((m, hit) => {
      if (hit) m.set(hit[0], { ...m.get(hit[0]), ...hit[1] });
      return m;
    }, new Map<string, NowRow>()),
  };

  const blocked = undoBlocked(a, found);
  if (blocked?.why === "ticked") {
    const t = found.tasks.get(blocked.taskId);
    const who = String(t?.done_by ?? t?.assigned_to ?? "");
    const { data: person } = who
      ? await supabaseAdmin
          .from("staff_profiles")
          .select(NAME_COLUMNS)
          .eq("org_id", ctx.orgId)
          .eq("id", who)
          .maybeSingle()
      : { data: null };
    const first = person ? fullNameOf(person as Record<string, unknown>).split(" ")[0] : "";
    return { ok: false, error: first ? UNDO.ticked(first) : UNDO.acted };
  }
  if (blocked) return { ok: false, error: blocked.why === "text" ? UNDO.text : UNDO.acted };

  /* What is still there to take back, counted: a row somebody deleted
     since is not said to have been taken back, and a note whose every row
     has gone takes nothing back at all. A note that never made a row (only
     words kept) is taken back as it always was: "Taken back." */
  const left = stillThere(a, found);
  if (takesBack(a) && !takesBack(left)) return { ok: false, error: UNDO.gone };
  if (await heldBySm8(ctx.orgId, note)) return { ok: false, error: UNDO.sm8 };

  /* ── claimed: only one Undo lands ── */
  const summary = undoSummary(left);
  const so = turnsOf(note.turns);
  const turns = withTurns(so.length ? so : [turn("you", note.transcript)], turn("tiff", summary));
  const { data: claimed } = await supabaseAdmin
    .from("workboard_notes")
    .update({ status: "undone", undone_at: new Date().toISOString(), turns })
    .eq("org_id", ctx.orgId)
    .eq("id", noteId)
    .eq("status", "applied")
    .select("id");
  if (!((claimed ?? []) as unknown[]).length) {
    /* Somebody else's press claimed it first: answered as a press on a
       note taken back already is, with the conversation as it now stands,
       so the page that pressed can show what went rather than offer Undo
       beside rows that have gone. */
    const again = await noteIn(ctx.orgId, noteId);
    return again?.status === "undone"
      ? { ok: false, error: UNDO.undone, turns: turnsOf(again.turns) }
      : { ok: false, error: UNDO.undone };
  }
  /* a Send that queued in the moment since: the note goes back as it was */
  if (await heldBySm8(ctx.orgId, note)) {
    await supabaseAdmin
      .from("workboard_notes")
      .update({ status: "applied", undone_at: null, turns: so })
      .eq("org_id", ctx.orgId)
      .eq("id", noteId)
      .eq("status", "undone");
    return { ok: false, error: UNDO.sm8 };
  }

  /* ── taken back. Each delete still names the state it checked, so a row
     acted on in the moment since is left alone rather than destroyed. ── */
  const gone = (table: string, ids: string[]) =>
    supabaseAdmin.from(table).delete().eq("org_id", ctx.orgId).in("id", ids);
  const now = new Date().toISOString();
  await Promise.all([
    a.taskIds.length ? gone("tasks", a.taskIds).eq("status", "open").is("acknowledged_at", null) : null,
    a.flagIds.length ? gone("workboard_flags", a.flagIds).eq("active", true) : null,
    a.entryIds.length ? gone("project_entries", a.entryIds) : null,
    fresh.length ? gone("workboard_issues", fresh).eq("occurrences", 1).eq("resolved", false) : null,
    a.checklistIds.length ? gone("project_checklist_items", a.checklistIds).eq("done", false) : null,
    a.picklistIds.length ? gone("job_picklist_items", a.picklistIds).eq("picked", false) : null,
    a.kbIds.length ? gone("kb_documents", a.kbIds).eq("category", "field") : null,
    ...a.issueBumps.map((b) =>
      supabaseAdmin
        .from("workboard_issues")
        .update({ occurrences: b.occurrences, ...(b.lastSeen ? { last_seen: b.lastSeen } : {}) })
        .eq("org_id", ctx.orgId)
        .eq("id", b.id)
        .eq("occurrences", b.occurrences + 1),
    ),
    ...a.textWrites.map((w) =>
      supabaseAdmin
        .from(w.table)
        .update({ [w.column]: w.before, updated_at: now })
        .eq("org_id", ctx.orgId)
        .eq("id", w.id),
    ),
  ]);

  refreshHome({ kind: note.target_kind, id: note.target_id });
  return { ok: true, summary, turns };
}

/** THE PLAIN SAVE. The words, filed as they were typed, with nothing routed
    and nothing made — the diary box's Save, and where a modal note lands
    when routing fails.

    The row the journal already reads: `applied` with an empty record, so the
    diary shows the words and says nothing about what they became, because
    they became nothing but themselves. No `workboard` capability: your own
    words in your own diary is the least privileged thing in the app. It does
    need a staff card — the diary reads by author, and a row with none is an
    entry nobody can see. */
export async function keepWords(text: string, room?: TiffRoom): Promise<KeepResult> {
  const ctx = await context();
  if (!ctx) return { ok: false, error: NOT_SIGNED_IN };
  if (!ctx.staffId) return { ok: false, error: "Your staff profile isn't set up yet." };

  const words = trim(text, 8000);
  if (!words) return { ok: false, error: "There's nothing to save." };

  const said: Turn = { ...turn("you", words), ...(isTiffRoom(room) ? { room } : {}) };
  const { data, error } = await supabaseAdmin
    .from("workboard_notes")
    .insert({
      org_id: ctx.orgId,
      author_id: ctx.staffId,
      target_kind: "none",
      target_id: null,
      transcript: words,
      source: "text",
      status: "applied",
      applied: {},
      applied_at: new Date().toISOString(),
      turns: [said],
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: "Couldn't save that." };

  refreshHome();
  return { ok: true, noteId: (data as { id: string }).id };
}

/** "Add to the Library" — the one row of a plan that waits for a press,
    because its reach is the whole workspace rather than a job or a person.

    Publishes the stored proposal's `kbEntries[index]` as a field note
    (`publishFieldNote`), and adds it to the note's record so Undo takes it
    back with the rest. Once per entry: pressing it again says
    it is already there. A note set aside or taken back publishes nothing. */
export async function publishNoteKb(noteId: string, index: number): Promise<PublishKbResult> {
  const ctx = await context();
  if (!ctx) return { ok: false, error: NOT_SIGNED_IN };
  if (!(await can("workboard"))) return { ok: false, error: NO_ACCESS };

  const note = await noteIn(ctx.orgId, noteId);
  if (!note) return { ok: false, error: GONE };
  if (note.status === "dismissed" || note.status === "undone") {
    return { ok: false, error: SETTLED[note.status] };
  }
  if ((note.author_id ?? null) !== ctx.staffId) return { ok: false, error: NOT_YOURS };

  const entry = Number.isInteger(index) ? storedProposal(note.proposal)?.kbEntries[index] : undefined;
  const title = entry ? trim(entry.title, 200) || trim(entry.body, 80) : "";
  const body = entry ? trim(entry.body, 4000) : "";
  if (!title || !body) return { ok: false, error: "There's no library entry there." };

  const before = appliedOf(note.applied);
  if (before.kbTitles.includes(title)) return { ok: false, error: "That's already in the Library." };

  const target: NoteTarget = { kind: note.target_kind, id: note.target_id };
  const [author, tz, jobLabel] = await Promise.all([
    ctx.staffId
      ? supabaseAdmin
          .from("staff_profiles")
          .select(NAME_COLUMNS)
          .eq("org_id", ctx.orgId)
          .eq("id", ctx.staffId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    getSm8Timezone(ctx.orgId),
    target.kind !== "none" && target.id ? targetLabel(ctx.orgId, target) : Promise.resolve(null),
  ]);
  const res = await publishFieldNote({
    orgId: ctx.orgId,
    authorId: ctx.staffId,
    /* Provenance from the session, never from a POST body. */
    authorName: author.data ? fullNameOf(author.data as Record<string, unknown>) : "the crew",
    title,
    body,
    jobLabel,
    dayLabel: fmtAuWeekdayDayMonth(todayInZone(tz)),
    noteId,
  });
  if (!res.ok) return { ok: false, error: res.error };

  /* ONTO THE RECORD AS IT STANDS NOW, not as it was read before the entry
     was embedded: the note may have filed in the meantime, and writing the
     column back from that copy wiped the whole record Undo needs. One
     statement in the database (tiff_modal_record.sql) appends the entry, and
     refuses a note set aside or taken back since, or a second press that
     already added this title. */
  const { data: added, error: addErr } = await supabaseAdmin.rpc("workboard_note_add_kb", {
    p_org: ctx.orgId,
    p_note: noteId,
    p_kb_id: res.documentId,
    p_title: title,
  });
  if (addErr || added !== true) {
    /* Not on the record means nothing could take it back: so it comes out
       of the Library again rather than staying there with no note behind
       it. Its chunk goes with it (kb_chunks cascades). */
    await supabaseAdmin.from("kb_documents").delete().eq("org_id", ctx.orgId).eq("id", res.documentId);
    const now = addErr ? undefined : await noteIn(ctx.orgId, noteId);
    if (now === null) return { ok: false, error: GONE };
    if (now?.status === "dismissed" || now?.status === "undone") {
      return { ok: false, error: SETTLED[now.status] };
    }
    if (now && appliedOf(now.applied).kbTitles.includes(title)) {
      return { ok: false, error: "That's already in the Library." };
    }
    return { ok: false, error: "Couldn't add that to the Library." };
  }

  refreshHome(target);
  return { ok: true, documentId: res.documentId, summary: "Added to the Library." };
}

/** Keep the words, apply none of it. */
export async function dismissNote(noteId: string): Promise<ApplyResult> {
  const ctx = await context();
  if (!ctx) return { ok: false, error: NOT_SIGNED_IN };
  if (!(await can("workboard"))) return { ok: false, error: NO_ACCESS };

  const note = await noteIn(ctx.orgId, noteId);
  if (!note) return { ok: false, error: GONE };
  if (!waiting(note)) return { ok: false, error: ALREADY_APPLIED };

  /* ONLY A NOTE STILL WAITING. Walking away sets aside what was never filed,
     and the Tiff modal cannot always know whether it was: a filing whose
     answer was lost may have landed. Setting an `applied` note aside would
     take it off the diary while its tasks and flags stay live, where Undo —
     which needs `applied` — could never reach them. Held the way every other
     write on a note here is held. */
  await supabaseAdmin
    .from("workboard_notes")
    .update({ status: "dismissed" })
    .eq("org_id", ctx.orgId)
    .eq("id", noteId)
    .in("status", WAITING);
  refresh({ kind: note.target_kind, id: note.target_id });
  /* NOT "Kept as a note." — this is the ABANDON path (Escape, ×, walking
     away), and a dismissed row is read by nothing: the journal lists `applied`
     rows, so that summary promised a note the reader could never find. It is
     never displayed either — the one caller `void`s the result. Saying what
     actually happened costs nothing and stops the next person believing the
     old sentence.

     AND IT STAYS THAT WAY. The other endings (`fileNote`, `keepWords`)
     record what they did, which is what puts them on the journal; this one
     has nothing to record, because nothing happened. Filing an abandonment
     as applied would make walking away from a half-sentence look exactly
     like filing it. */
  return { ok: true, summary: "Discarded." };
}

/** Stop a flag pulsing. Whoever dealt with it can clear it. */
export async function clearFlag(flagId: string): Promise<ApplyResult> {
  const ctx = await context();
  if (!ctx) return { ok: false, error: NOT_SIGNED_IN };
  if (!(await can("workboard"))) return { ok: false, error: NO_ACCESS };

  const { data } = await supabaseAdmin
    .from("workboard_flags")
    .select("id")
    .eq("org_id", ctx.orgId)
    .eq("id", flagId)
    .maybeSingle();
  if (!data) return { ok: false, error: "That flag is no longer here." };

  await supabaseAdmin
    .from("workboard_flags")
    .update({ active: false, cleared_by: ctx.staffId, cleared_at: new Date().toISOString() })
    .eq("org_id", ctx.orgId)
    .eq("id", flagId);
  refresh();
  return { ok: true, summary: "Cleared." };
}

/** The clear's own undo (B23: every action carries ITS inverse — a queue
    where Undo can hit the wrong thing teaches people not to trust Undo).
    Same tier as clearing: whoever swept it can put it back. */
export async function restoreFlag(flagId: string): Promise<ApplyResult> {
  const ctx = await context();
  if (!ctx) return { ok: false, error: NOT_SIGNED_IN };
  if (!(await can("workboard"))) return { ok: false, error: NO_ACCESS };

  const { data } = await supabaseAdmin
    .from("workboard_flags")
    .select("id")
    .eq("org_id", ctx.orgId)
    .eq("id", flagId)
    .maybeSingle();
  if (!data) return { ok: false, error: "That flag is no longer here." };

  await supabaseAdmin
    .from("workboard_flags")
    .update({ active: true, cleared_by: null, cleared_at: null })
    .eq("org_id", ctx.orgId)
    .eq("id", flagId);
  refresh();
  return { ok: true, summary: "Back up." };
}
