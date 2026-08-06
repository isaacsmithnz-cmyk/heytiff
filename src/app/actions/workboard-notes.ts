"use server";

import { revalidatePath } from "next/cache";
import { auth0 } from "@/lib/auth0";
import { supabaseAdmin } from "@/lib/supabase-server";
import { can } from "@/lib/permissions-server";
import { staffIdFor } from "@/lib/workboard/projects-query";
import {
  clean,
  isSeverity,
  readNote,
  type NoteProposal,
  type NoteStaff,
  type Severity,
} from "@/lib/workboard/note-brain";
import { todayInZone } from "@/lib/workboard/dates";
import { getSm8Timezone } from "@/lib/workboard/query";
import { fullNameOf } from "@/lib/staff/name";
import { NAME_COLUMNS } from "@/lib/dashboard/tasks-query";
import { fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import { publishFieldNote } from "@/lib/tiff/field-notes";

/* Smart Notes — capture, route, review, apply.

   THE SHAPE OF THE SAFETY MODEL: `routeNote` only ever WRITES THE NOTE and
   returns a proposal. `applyNote` is the single function in the app that
   turns a proposal into tasks, flags and entries, and it takes the
   CONFIRMED payload from the review card — not the model's output. A human
   edited or accepted every field in between. That is why a misheard word
   costs a dismissed card instead of work assigned to the wrong person.

   TWO TIERS, both capabilities (house doctrine, never a role check):
     `workboard`         dictate a note, confirm your own, clear a flag.
                         Capturing your own day is the whole feature.
     `workboard_manage`  nothing extra here yet — deliberately. Everything a
                         note applies (a task, a bullet, a flag) is something
                         the person on site is entitled to record. */

export type NoteTarget = {
  kind: "none" | "project" | "visit" | "agreement";
  id?: string | null;
};

export type RouteResult =
  | { ok: true; noteId: string; proposal: NoteProposal; staff: NoteStaff[] }
  | { ok: false; error: string };

export type ApplyResult = { ok: true; summary: string } | { ok: false; error: string };

const NOT_SIGNED_IN = "Not signed in.";
const NO_ACCESS = "You don't have access to the Workboard.";
const GONE = "That note is no longer here.";

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

/** Resolve a note's target inside the caller's org. An id from a browser
    names a CHOICE; this decides whether it's a real one. */
async function resolveTarget(orgId: string, target: NoteTarget): Promise<NoteTarget | null> {
  if (target.kind === "none" || !target.id) return { kind: "none", id: null };
  const table =
    target.kind === "project"
      ? "projects"
      : target.kind === "visit"
        ? "maintenance_visits"
        : "maintenance_agreements";
  const { data } = await supabaseAdmin
    .from(table)
    .select("id")
    .eq("org_id", orgId)
    .eq("id", target.id)
    .maybeSingle();
  return data ? target : null;
}

/* ---------------- capture + route ---------------- */

/** Store the note, then ask the brain what it means. The note row is written
    BEFORE the model runs and kept whatever the model says, because the words
    someone spoke are the valuable thing — routing is an enhancement on top. */
export async function routeNote(input: {
  transcript: string;
  target: NoteTarget;
  source?: "text" | "voice";
  /** A morning braindump rather than a site note — changes what the brain is
      asked for (tasks + knowledge + note lines, no job-bound buckets). */
  debrief?: boolean;
}): Promise<RouteResult> {
  const ctx = await context();
  if (!ctx) return { ok: false, error: NOT_SIGNED_IN };
  if (!(await can("workboard"))) return { ok: false, error: NO_ACCESS };

  const transcript = trim(input.transcript, 8000);
  if (!transcript) return { ok: false, error: "There was nothing in that note." };

  const target = await resolveTarget(ctx.orgId, input.target);
  if (!target) return { ok: false, error: "That isn't something in this workspace." };

  const { data, error } = await supabaseAdmin
    .from("workboard_notes")
    .insert({
      org_id: ctx.orgId,
      author_id: ctx.staffId,
      target_kind: target.kind,
      target_id: target.id ?? null,
      transcript,
      source: input.source === "voice" ? "voice" : "text",
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: "Couldn't save that note." };
  const noteId = (data as { id: string }).id;

  /* Three independent reads against a remote database, so they go together
     rather than one after another — the person is watching a spinner. */
  const [staff, label, tz] = await Promise.all([
    assignableStaff(ctx.orgId),
    targetLabel(ctx.orgId, target),
    getSm8Timezone(ctx.orgId),
  ]);
  const read = await readNote(transcript, {
    staff,
    targetLabel: label ?? undefined,
    todayISO: todayInZone(tz),
    debrief: input.debrief === true,
  });

  if (!read.ok) {
    /* The router failed, the note did not. Leave it pending with no proposal
       so the card offers to keep it as a plain note. */
    refresh(target);
    return { ok: false, error: read.error };
  }

  await supabaseAdmin
    .from("workboard_notes")
    .update({
      /* The extra `debrief` key rides in the jsonb so the MODE survives the
         clarify round-trip even when a debrief happened to produce no note
         lines — inferring it from noteLines alone misses exactly that case. */
      proposal: input.debrief ? { ...read.proposal, debrief: true } : read.proposal,
      status: read.proposal.clarify ? "clarifying" : "pending",
    })
    .eq("org_id", ctx.orgId)
    .eq("id", noteId);

  refresh(target);
  return { ok: true, noteId, proposal: read.proposal, staff };
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
  return null;
}

/** Answer the brain's clarifying question and route again with it folded in. */
export async function answerClarify(noteId: string, answer: string): Promise<RouteResult> {
  const ctx = await context();
  if (!ctx) return { ok: false, error: NOT_SIGNED_IN };
  if (!(await can("workboard"))) return { ok: false, error: NO_ACCESS };

  const note = await noteIn(ctx.orgId, noteId);
  if (!note) return { ok: false, error: GONE };

  const reply = trim(answer, 500);
  if (!reply) return { ok: false, error: "Type an answer first." };

  const proposal = note.proposal as NoteProposal | null;
  const question = proposal?.clarify?.question;
  if (!question) return { ok: false, error: "There's no question waiting on that note." };

  const [staff, label, tz] = await Promise.all([
    assignableStaff(ctx.orgId),
    targetLabel(ctx.orgId, { kind: note.target_kind, id: note.target_id }),
    getSm8Timezone(ctx.orgId),
  ]);
  const read = await readNote(
    note.transcript,
    {
      staff,
      targetLabel: label ?? undefined,
      todayISO: todayInZone(tz),
      /* The mode has to survive the clarify round-trip, or answering "which
         Luke?" would re-route the whole debrief as a site note and scatter
         its leftovers into buckets the card no longer shows. routeNote
         stamped the stored proposal for exactly this read. */
      debrief: (proposal as { debrief?: boolean } | null)?.debrief === true,
    },
    { question, answer: reply }
  );
  if (!read.ok) return { ok: false, error: read.error };

  const wasDebrief = (proposal as { debrief?: boolean } | null)?.debrief === true;
  await supabaseAdmin
    .from("workboard_notes")
    .update({
      // re-stamped, or the mode would only survive ONE clarify round
      proposal: wasDebrief ? { ...read.proposal, debrief: true } : read.proposal,
      status: read.proposal.clarify ? "clarifying" : "pending",
    })
    .eq("org_id", ctx.orgId)
    .eq("id", noteId);

  refresh({ kind: note.target_kind, id: note.target_id });
  return { ok: true, noteId, proposal: read.proposal, staff };
}

type NoteRow = {
  id: string;
  transcript: string;
  status: string;
  target_kind: NoteTarget["kind"];
  target_id: string | null;
  proposal: unknown;
};

async function noteIn(orgId: string, noteId: string): Promise<NoteRow | null> {
  const { data } = await supabaseAdmin
    .from("workboard_notes")
    .select("id, transcript, status, target_kind, target_id, proposal")
    .eq("org_id", orgId)
    .eq("id", noteId)
    .maybeSingle();
  return (data as NoteRow | null) ?? null;
}

/* ---------------- apply ---------------- */

/** What the review card confirmed. Deliberately NOT the model's proposal:
    the user may have edited a title, picked the right Luke, or unticked
    half of it, and this is that decision. */
export type ConfirmedNote = {
  tasks: { title: string; detail: string; assigneeId: string | null; dueDate: string | null }[];
  bringItems: string[];
  flags: { message: string; severity: string }[];
  progressBullets: string[];
  commissioningEntries: string[];
  issueEntries: { summary: string; equipmentRef: string }[];
  /** LEARN — ticked "Worth teaching everyone" rows, published to the KB. */
  kbEntries?: { title: string; body: string }[];
  /** Debrief leftovers — become ONE grouped note in the author's own notes,
      titled with the day. Empty outside a debrief. */
  noteLines?: string[];
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Turn a confirmed proposal into real rows. Everything is re-validated
    here, because a Server Function is reachable by direct POST and "the card
    only offered valid options" is not a control. */
export async function applyNote(
  noteId: string,
  confirmed: ConfirmedNote,
  /* Where the review card says it belongs, when the note was dictated with
     nothing in front of it. A general note's bring-items had nowhere to land
     and were dropped in silence — see the guard at the end of this function,
     which now refuses that instead of pretending. Re-validated like any other
     target: a Server Function is reachable by direct POST. */
  retarget?: NoteTarget
): Promise<ApplyResult> {
  const ctx = await context();
  if (!ctx) return { ok: false, error: NOT_SIGNED_IN };
  if (!(await can("workboard"))) return { ok: false, error: NO_ACCESS };

  const note = await noteIn(ctx.orgId, noteId);
  if (!note) return { ok: false, error: GONE };
  if (note.status === "applied") return { ok: false, error: "That note was already applied." };

  let target: NoteTarget = { kind: note.target_kind, id: note.target_id };
  if (retarget && retarget.kind !== "none" && retarget.id) {
    const resolved = await resolveTarget(ctx.orgId, retarget);
    if (!resolved || resolved.kind === "none") {
      return { ok: false, error: "That job isn't on this workspace's board any more." };
    }
    target = resolved;
    await supabaseAdmin
      .from("workboard_notes")
      .update({ target_kind: target.kind, target_id: target.id ?? null })
      .eq("org_id", ctx.orgId)
      .eq("id", noteId);
  }

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
     `blockers`, which is why "tell Luke to ring the wholesaler" — a perfectly
     good task about no job in particular — could not be saved at all.

     So the question is per bucket, not per note (Isaac, 2026-08-05: aim for
     the job, then a task, and only then My notes). A Server Function is
     reachable by direct POST, so the review card's version of this is a
     courtesy and THIS is the enforcement. */
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
        "Flags, bring-items, progress and issues all hang off a job — say which one, or untick them.",
    };
  }

  const applied: Record<string, unknown> = {};
  const counts: string[] = [];

  /** Record one group's ids and its line of the "Saved — …" summary. Six
      groups wrote these same three lines by hand; the plural is the only part
      that ever differs. */
  const record = (key: string, ids: string[], one: string, many = `${one}s`) => {
    if (!ids.length) return;
    applied[key] = ids;
    counts.push(`${ids.length} ${ids.length === 1 ? one : many}`);
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

    const rows = wanted
      .map((t) => ({
        org_id: ctx.orgId,
        title: trim(t.title, 200),
        detail: trim(t.detail, 1000) || null,
        assigned_to: t.assigneeId,
        created_by: ctx.staffId,
        due_date: typeof t.dueDate === "string" && ISO_DATE.test(t.dueDate) ? t.dueDate : null,
        status: "open",
      }));

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

  /* progress + commissioning — dated lines on a project */
  if (target.kind === "project" && target.id) {
    const rows = [
      ...(confirmed.progressBullets ?? []).map((b) => ({ kind: "progress" as const, body: trim(b, 1000) })),
      ...(confirmed.commissioningEntries ?? []).map((b) => ({ kind: "commissioning" as const, body: trim(b, 1000) })),
    ].filter((r) => r.body);

    if (rows.length) {
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
      .select("id, summary, occurrences")
      .eq("org_id", ctx.orgId)
      .eq("target_kind", target.kind)
      .eq("resolved", false)
      .in("summary", issues.map((i) => i.summary));

    const seen = new Map(
      ((priors ?? []) as { id: string; summary: string; occurrences: number }[]).map((p) => [
        p.summary,
        p,
      ])
    );

    const fresh = issues.filter((i) => !seen.has(i.summary));
    const bumps = issues.filter((i) => seen.has(i.summary));
    const issueIds = bumps.map((i) => seen.get(i.summary)!.id);

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
        const current = (data as { bring_list: string | null } | null)?.bring_list ?? "";
        const merged = [current.trim(), ...bring].filter(Boolean).join(" · ").slice(0, 2000);
        await supabaseAdmin
          .from("maintenance_agreements")
          .update({ bring_list: merged, updated_at: new Date().toISOString() })
          .eq("org_id", ctx.orgId)
          .eq("id", agreementId);
        saved = true;
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
      await supabaseAdmin.from("project_checklist_items").insert(
        bring.map((label, i) => ({
          org_id: ctx.orgId,
          project_id: target.id,
          section: "Bring next visit",
          label,
          sort: base + i,
        }))
      );
      saved = true;
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

  /* NOTHING SILENTLY VANISHES. Isaac dictated two tasks and two bring-items
     from the board header, pressed Save, and got "Saved as a note." — while
     `applied` went to the database as `{}`. Both tasks were dropped because
     neither had a person on it, and both bring-items were dropped because a
     general note has no job to hang them off. Every one of those drops was
     silent, and the summary said the reassuring thing.

     So: if the confirmation asked for work and NONE of it could be done, this
     refuses. The note keeps its words and stays reviewable rather than being
     marked applied over an empty object. The card is supposed to stop this
     ever reaching here — this is the backstop that makes "saved" mean saved. */
  /* ── LEARN — publish the ticked knowledge ──
     After the job-bound buckets (these need no job) and before the tally, so
     a note that is ONLY knowledge still counts as work done. The author's
     name is fetched here rather than threaded from the card: provenance must
     come from the session, never from a POST body. */
  const kbWanted = (confirmed.kbEntries ?? [])
    .map((k) => ({ title: trim(k.title, 200), body: trim(k.body, 4000) }))
    .filter((k) => k.title && k.body);
  if (kbWanted.length) {
    const { data: author } = ctx.staffId
      ? await supabaseAdmin
          .from("staff_profiles")
          .select(NAME_COLUMNS)
          .eq("org_id", ctx.orgId)
          .eq("id", ctx.staffId)
          .maybeSingle()
      : { data: null };
    const authorName = author ? fullNameOf(author as Record<string, unknown>) : "the crew";
    const tz = await getSm8Timezone(ctx.orgId);
    const dayLabel = fmtAuWeekdayDayMonth(todayInZone(tz));
    const jobLabel = target.kind !== "none" && target.id
      ? await targetLabel(ctx.orgId, target)
      : null;

    const kbIds: string[] = [];
    for (const entry of kbWanted) {
      const res = await publishFieldNote({
        orgId: ctx.orgId,
        authorId: ctx.staffId,
        authorName,
        title: entry.title,
        body: entry.body,
        jobLabel,
        dayLabel,
        noteId,
      });
      /* One bad entry must not eat the rest of the save — but it must not
         vanish either. Fail the whole apply so the card keeps the rows and
         the person sees why, same rule as every other refusal here. */
      if (!res.ok) return { ok: false, error: res.error };
      kbIds.push(res.documentId);
    }
    record("kbIds", kbIds, "knowledge entry", "knowledge entries");
  }

  /* ── the debrief's grouped note ──
     ONE staff_notes row titled with the day, holding every ticked line. The
     title is derived HERE from the org's own clock — a browser's idea of
     today is whatever its laptop says. */
  const lines = (confirmed.noteLines ?? []).map((l) => trim(l, 1000)).filter(Boolean);
  if (lines.length) {
    if (!ctx.staffId) {
      return { ok: false, error: "Your staff profile isn't set up yet, so there's nowhere to keep the notes." };
    }
    const tz = await getSm8Timezone(ctx.orgId);
    const body = [`Debrief — ${fmtAuWeekdayDayMonth(todayInZone(tz))}`, ...lines.map((l) => `• ${l}`)]
      .join("\n")
      .slice(0, 4000);
    const { error: dbErr } = await supabaseAdmin.from("staff_notes").insert({
      org_id: ctx.orgId,
      staff_id: ctx.staffId,
      body,
      source: "routed",
      source_note_id: noteId,
    });
    if (dbErr) return { ok: false, error: "Couldn't keep the debrief's notes." };
    record("noteLines", lines, "line kept", "lines kept");
    revalidatePath("/dashboard/my-notes");
  }

  const asked =
    (confirmed.tasks?.length ?? 0) +
    (confirmed.bringItems?.length ?? 0) +
    (confirmed.flags?.length ?? 0) +
    (confirmed.progressBullets?.length ?? 0) +
    (confirmed.commissioningEntries?.length ?? 0) +
    (confirmed.issueEntries?.length ?? 0) +
    (confirmed.kbEntries?.length ?? 0) +
    (confirmed.noteLines?.length ?? 0);
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

  await supabaseAdmin
    .from("workboard_notes")
    .update({ status: "applied", applied, applied_at: new Date().toISOString() })
    .eq("org_id", ctx.orgId)
    .eq("id", noteId);

  refresh(target);
  return {
    ok: true,
    summary: counts.length ? `Saved — ${counts.join(", ")}.` : "Saved as a note.",
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

/** Keep the words, apply none of it. */
export async function dismissNote(noteId: string): Promise<ApplyResult> {
  const ctx = await context();
  if (!ctx) return { ok: false, error: NOT_SIGNED_IN };
  if (!(await can("workboard"))) return { ok: false, error: NO_ACCESS };

  const note = await noteIn(ctx.orgId, noteId);
  if (!note) return { ok: false, error: GONE };

  await supabaseAdmin
    .from("workboard_notes")
    .update({ status: "dismissed" })
    .eq("org_id", ctx.orgId)
    .eq("id", noteId);
  refresh({ kind: note.target_kind, id: note.target_id });
  return { ok: true, summary: "Kept as a note." };
}

/* "Just keep the note" has to keep it SOMEWHERE YOU'D FIND IT.

   Isaac, 2026-08-02: "if you don't pick a job you can still just keep the
   note, but where the hell would the note go? That doesn't make sense." He's
   right — `dismissNote` files the row at status `dismissed` and NOTHING in
   the app reads workboard_notes, so the words went into a drawer nobody
   opens. Same shape of black hole as the one #253 closed on the apply side.

   So keeping a note against a job now writes it onto that job's own notes,
   where the next person to open the sheet reads it. Appended, never replacing
   — a visit's notes belong to whoever wrote them first.

   Kept SEPARATE from dismissNote on purpose: dismiss is also the abandon path
   (Esc, ×, walking away), and abandoning a note must never write anything. */
export async function keepNoteOnJob(
  noteId: string,
  retarget?: NoteTarget
): Promise<ApplyResult> {
  const ctx = await context();
  if (!ctx) return { ok: false, error: NOT_SIGNED_IN };
  if (!(await can("workboard"))) return { ok: false, error: NO_ACCESS };

  const note = await noteIn(ctx.orgId, noteId);
  if (!note) return { ok: false, error: GONE };

  let target: NoteTarget = { kind: note.target_kind, id: note.target_id };
  if (retarget && retarget.kind !== "none" && retarget.id) {
    const resolved = await resolveTarget(ctx.orgId, retarget);
    if (!resolved || resolved.kind === "none") {
      return { ok: false, error: "That job isn't on this workspace's board any more." };
    }
    target = resolved;
  }
  if (target.kind === "none" || !target.id) {
    return {
      ok: false,
      error: "Say which job this belongs to and the words go on its notes.",
    };
  }

  const table =
    target.kind === "project"
      ? "projects"
      : target.kind === "visit"
        ? "maintenance_visits"
        : "maintenance_agreements";

  const { data } = await supabaseAdmin
    .from(table)
    .select("notes")
    .eq("org_id", ctx.orgId)
    .eq("id", target.id)
    .maybeSingle();
  const current = ((data as { notes: string | null } | null)?.notes ?? "").trim();
  const merged = [current, trim(note.transcript, 2000)].filter(Boolean).join("\n\n").slice(0, 8000);

  await supabaseAdmin
    .from(table)
    .update({ notes: merged, updated_at: new Date().toISOString() })
    .eq("org_id", ctx.orgId)
    .eq("id", target.id);

  await supabaseAdmin
    .from("workboard_notes")
    .update({
      status: "dismissed",
      target_kind: target.kind,
      target_id: target.id,
    })
    .eq("org_id", ctx.orgId)
    .eq("id", noteId);

  refresh(target);
  return { ok: true, summary: "Kept on the job's notes." };
}

/* THE LAST RUNG. Keep the words for yourself, when no job and no person will
   take them.

   The cascade Isaac chose on 2026-08-05 aims at a job first and a task
   second, and only offers this when neither fits — so this is deliberately
   the hardest destination to reach, not the easiest. It exists because the
   two rungs above it genuinely don't cover everything ("ring the wholesaler
   back about pricing" belongs to nobody's job and isn't a task for anyone
   but you), and because the alternative is `dismissNote`, which files the
   row where nothing reads it.

   Unlike `keepNoteOnJob` this needs NO `workboard` capability: it writes to
   the author's own notes, which is the least privileged thing in the app.
   What it does need is a staff profile, since the row must have an owner —
   see the same rule in actions/my-notes.ts. */
export async function keepNoteForMe(noteId: string): Promise<ApplyResult> {
  const ctx = await context();
  if (!ctx) return { ok: false, error: NOT_SIGNED_IN };
  if (!ctx.staffId) return { ok: false, error: "Your staff profile isn't set up yet." };

  const note = await noteIn(ctx.orgId, noteId);
  if (!note) return { ok: false, error: GONE };

  const body = trim(note.transcript, 4000);
  if (!body) return { ok: false, error: "There are no words to keep." };

  const { error } = await supabaseAdmin.from("staff_notes").insert({
    org_id: ctx.orgId,
    staff_id: ctx.staffId,
    body,
    source: "routed",
    source_note_id: noteId,
  });
  if (error) return { ok: false, error: "Couldn't keep that note." };

  await supabaseAdmin
    .from("workboard_notes")
    .update({ status: "dismissed" })
    .eq("org_id", ctx.orgId)
    .eq("id", noteId);

  refresh({ kind: note.target_kind, id: note.target_id });
  revalidatePath("/dashboard/my-notes");
  return { ok: true, summary: "Kept in your notes." };
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
