"use server";

import { revalidatePath } from "next/cache";
import { auth0 } from "@/lib/auth0";
import { supabaseAdmin } from "@/lib/supabase-server";
import { can } from "@/lib/permissions-server";
import { staffIdFor } from "@/lib/workboard/projects-query";
import {
  readNote,
  type NoteProposal,
  type NoteStaff,
  type Severity,
  SEVERITIES,
} from "@/lib/workboard/note-brain";
import { todayInZone } from "@/lib/workboard/dates";
import { getSm8Timezone } from "@/lib/workboard/query";

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
  if ((target?.kind === "visit" || target?.kind === "agreement") && target.id) {
    revalidatePath("/dashboard/workboard/maintenance");
  }
}

const trim = (v: unknown, max: number): string =>
  typeof v === "string" ? v.trim().slice(0, max) : "";

/** The people a note may assign work to — first names are how it will say
    them, so the full name is what the matcher needs. */
async function assignableStaff(orgId: string): Promise<NoteStaff[]> {
  const { data } = await supabaseAdmin
    .from("staff_profiles")
    .select("id, full_name")
    .eq("org_id", orgId)
    .limit(200);
  return ((data ?? []) as { id: string; full_name: string | null }[])
    .filter((s) => (s.full_name ?? "").trim())
    .map((s) => ({ id: s.id, fullName: (s.full_name ?? "").trim() }));
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

  const staff = await assignableStaff(ctx.orgId);
  const label = await targetLabel(ctx.orgId, target);
  const read = await readNote(transcript, {
    staff,
    targetLabel: label ?? undefined,
    todayISO: todayInZone(await getSm8Timezone(ctx.orgId)),
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
      proposal: read.proposal,
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

  const staff = await assignableStaff(ctx.orgId);
  const read = await readNote(
    note.transcript,
    {
      staff,
      targetLabel: (await targetLabel(ctx.orgId, { kind: note.target_kind, id: note.target_id })) ?? undefined,
      todayISO: todayInZone(await getSm8Timezone(ctx.orgId)),
    },
    { question, answer: reply }
  );
  if (!read.ok) return { ok: false, error: read.error };

  await supabaseAdmin
    .from("workboard_notes")
    .update({ proposal: read.proposal, status: read.proposal.clarify ? "clarifying" : "pending" })
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
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Turn a confirmed proposal into real rows. Everything is re-validated
    here, because a Server Function is reachable by direct POST and "the card
    only offered valid options" is not a control. */
export async function applyNote(noteId: string, confirmed: ConfirmedNote): Promise<ApplyResult> {
  const ctx = await context();
  if (!ctx) return { ok: false, error: NOT_SIGNED_IN };
  if (!(await can("workboard"))) return { ok: false, error: NO_ACCESS };

  const note = await noteIn(ctx.orgId, noteId);
  if (!note) return { ok: false, error: GONE };
  if (note.status === "applied") return { ok: false, error: "That note was already applied." };

  const target: NoteTarget = { kind: note.target_kind, id: note.target_id };
  const applied: Record<string, unknown> = {};
  const counts: string[] = [];

  /* tasks — through the EXISTING tasks table, so assignment and the
     dashboard's own notifications come free. An assignee must be a real
     member of this org; anything else is refused rather than silently
     dropped, because an unassigned task is a task nobody does. */
  const taskIds: string[] = [];
  for (const t of confirmed.tasks ?? []) {
    const title = trim(t.title, 200);
    if (!title || !t.assigneeId) continue;

    const { data: person } = await supabaseAdmin
      .from("staff_profiles")
      .select("id")
      .eq("org_id", ctx.orgId)
      .eq("id", t.assigneeId)
      .maybeSingle();
    if (!person) continue;

    const due = typeof t.dueDate === "string" && ISO_DATE.test(t.dueDate) ? t.dueDate : null;
    const { data, error } = await supabaseAdmin
      .from("tasks")
      .insert({
        org_id: ctx.orgId,
        title,
        detail: trim(t.detail, 1000) || null,
        assigned_to: t.assigneeId,
        created_by: ctx.staffId,
        due_date: due,
        status: "open",
      })
      .select("id")
      .single();
    if (!error && data) taskIds.push((data as { id: string }).id);
  }
  if (taskIds.length) {
    applied.taskIds = taskIds;
    counts.push(`${taskIds.length} task${taskIds.length === 1 ? "" : "s"}`);
  }

  /* flags — what pulses on the board until someone deals with it */
  const flagIds: string[] = [];
  for (const f of confirmed.flags ?? []) {
    const message = trim(f.message, 200);
    if (!message) continue;
    const severity: Severity = (SEVERITIES as readonly string[]).includes(f.severity)
      ? (f.severity as Severity)
      : "warn";
    const { data, error } = await supabaseAdmin
      .from("workboard_flags")
      .insert({
        org_id: ctx.orgId,
        target_kind: target.kind,
        target_id: target.id ?? null,
        message,
        severity,
        note_id: noteId,
      })
      .select("id")
      .single();
    if (!error && data) flagIds.push((data as { id: string }).id);
  }
  if (flagIds.length) {
    applied.flagIds = flagIds;
    counts.push(`${flagIds.length} flag${flagIds.length === 1 ? "" : "s"}`);
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
      const ids = ((data ?? []) as { id: string }[]).map((r) => r.id);
      if (ids.length) {
        applied.entryIds = ids;
        counts.push(`${ids.length} entr${ids.length === 1 ? "y" : "ies"}`);
      }
    }
  }

  /* issues — the "this keeps happening" memory. A repeat of something
     already logged bumps the existing row rather than making a second one,
     because two rows is exactly how a pattern stops being visible. */
  const issueIds: string[] = [];
  const today = todayInZone(await getSm8Timezone(ctx.orgId));
  for (const i of confirmed.issueEntries ?? []) {
    const summary = trim(i.summary, 1000);
    if (!summary) continue;
    const equipmentRef = trim(i.equipmentRef, 200) || null;

    const { data: existing } = await supabaseAdmin
      .from("workboard_issues")
      .select("id, occurrences")
      .eq("org_id", ctx.orgId)
      .eq("target_kind", target.kind)
      .eq("summary", summary)
      .eq("resolved", false)
      .maybeSingle();

    const prior = existing as { id: string; occurrences: number } | null;
    if (prior) {
      await supabaseAdmin
        .from("workboard_issues")
        .update({ occurrences: prior.occurrences + 1, last_seen: today })
        .eq("org_id", ctx.orgId)
        .eq("id", prior.id);
      issueIds.push(prior.id);
    } else {
      const { data, error } = await supabaseAdmin
        .from("workboard_issues")
        .insert({
          org_id: ctx.orgId,
          target_kind: target.kind,
          target_id: target.id ?? null,
          equipment_ref: equipmentRef,
          summary,
          first_seen: today,
          last_seen: today,
        })
        .select("id")
        .single();
      if (!error && data) issueIds.push((data as { id: string }).id);
    }
  }
  if (issueIds.length) {
    applied.issueIds = issueIds;
    counts.push(`${issueIds.length} issue${issueIds.length === 1 ? "" : "s"}`);
  }

  /* bring-items — onto the agreement's bring list where there is one, so the
     next visit's prep sheet already has them */
  const bring = (confirmed.bringItems ?? []).map((b) => trim(b, 200)).filter(Boolean);
  if (bring.length && (target.kind === "agreement" || target.kind === "visit") && target.id) {
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
      applied.bringItems = bring;
      counts.push(`${bring.length} bring-item${bring.length === 1 ? "" : "s"}`);
    }
  } else if (bring.length && target.kind === "project" && target.id) {
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
    applied.bringItems = bring;
    counts.push(`${bring.length} bring-item${bring.length === 1 ? "" : "s"}`);
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
