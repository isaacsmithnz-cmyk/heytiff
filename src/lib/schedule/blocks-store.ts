import "server-only";

import { supabaseAdmin } from "@/lib/supabase-server";
import type { Sm8Press } from "@/lib/integrations/sm8-press";
import type { ScheduleAway } from "@/lib/workboard/away";
import {
  blockSpan,
  blocksAsAway,
  blockWrong,
  boardNameOf,
  cleanWords,
  placeWrong,
  type PileBlock,
  type ScheduleBlock,
} from "./blocks";

/* BLOCK OUT TIME, kept (lib/schedule/blocks says what one is). The one place
   that reads and writes schedule_blocks, for the Schedule's actions and the
   phone's routes alike. Who may do what is the caller's to decide: these
   take the workspace and do as they're asked.

   THE SERVICEM8 BOARD GETS A COPY. A placed block goes to the person's day
   on ServiceM8 as staff leave, through the leave queue's own door
   (actions/sm8-leave-queue, subject block:<id>@<placed_at, ms>), where leave
   is switched on and the person is linked. Taken back to Jobs or taken off,
   the copy is taken off too. Nothing on the board can fail a block: the
   block is HeyTiff's record and has landed first; the queue answers at most
   a sentence, which goes back to whoever pressed. */

type Row = {
  id: string;
  what: string;
  where_text: string | null;
  minutes: number;
  sm8_staff_uuid: string | null;
  staff_profile_id: string | null;
  day: string | null;
  start_min: number | null;
  placed_at: string | null;
  removed_at: string | null;
};

const COLUMNS = "id, what, where_text, minutes, sm8_staff_uuid, staff_profile_id, day, start_min, placed_at, removed_at";

const blockOf = (r: Row): ScheduleBlock => ({
  id: r.id,
  what: r.what,
  where: r.where_text,
  minutes: r.minutes,
  staffUuid: r.sm8_staff_uuid,
  day: r.day ? String(r.day).slice(0, 10) : null,
  startMin: r.start_min,
});

export type BlockResult = { ok: true; id: string; note: string | null } | { ok: false; error: string };

/** The day's placed blocks, as the Schedule's time off; [] where they can't be read. */
export async function readDayBlocks(orgId: string, day: string): Promise<ScheduleAway[]> {
  try {
    const { data, error } = await supabaseAdmin.from("schedule_blocks").select(COLUMNS).eq("org_id", orgId).eq("day", day).is("removed_at", null);
    if (error) throw new Error(error.message);
    return blocksAsAway(((data ?? []) as Row[]).map(blockOf));
  } catch (e) {
    /* the day still reads without them */
    console.error(`[blocks] couldn't read ${day}'s blocks for org ${orgId}:`, e instanceof Error ? e.message : String(e));
    return [];
  }
}

/** The blocks waiting in the Jobs panel, the newest first. */
export async function readPileBlocks(orgId: string): Promise<PileBlock[]> {
  const { data } = await supabaseAdmin
    .from("schedule_blocks")
    .select("id, what, where_text, minutes")
    .eq("org_id", orgId)
    .is("day", null)
    .is("removed_at", null)
    .order("created_at", { ascending: false })
    .limit(40);
  return ((data ?? []) as Pick<Row, "id" | "what" | "where_text" | "minutes">[]).map((r) => ({ id: r.id, what: r.what, where: r.where_text, minutes: r.minutes }));
}

/** One block, live (not taken off). */
async function readBlock(orgId: string, id: string): Promise<Row | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data } = await supabaseAdmin.from("schedule_blocks").select(COLUMNS).eq("org_id", orgId).eq("id", id).is("removed_at", null).maybeSingle();
  return (data as Row | null) ?? null;
}

/** The HeyTiff card linked to a ServiceM8 person, in any case. */
async function profileOf(orgId: string, staffUuid: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("integration_links")
    .select("staff_profile_id, remote_id")
    .eq("org_id", orgId)
    .eq("provider", "servicem8")
    .eq("kind", "staff");
  const low = staffUuid.trim().toLowerCase();
  return ((data ?? []) as { staff_profile_id: string | null; remote_id: string | null }[]).find((l) => (l.remote_id ?? "").toLowerCase() === low)?.staff_profile_id ?? null;
}

const placing = (r: Pick<Row, "id" | "placed_at">) => `${r.id}@${Date.parse(r.placed_at ?? "")}`;

/** The copy on ServiceM8's board, put on. */
async function onBoard(press: Sm8Press | null, r: Row): Promise<string | null> {
  if (!press || !r.day || r.start_min === null || !r.staff_profile_id || !r.placed_at) return null;
  try {
    const { queueLeaveOnBoard } = await import("@/app/actions/sm8-leave-queue");
    const day = String(r.day).slice(0, 10);
    const out = await queueLeaveOnBoard(press, {
      source: "block",
      id: placing(r),
      staffProfileId: r.staff_profile_id,
      kind: null,
      from: day,
      to: day,
      block: { ...blockSpan({ day, startMin: r.start_min, minutes: r.minutes }), name: boardNameOf({ what: r.what, where: r.where_text }) },
    });
    return out.note;
  } catch (e) {
    console.error(`[blocks] couldn't queue block ${r.id} for the board:`, e instanceof Error ? e.message : String(e));
    return null;
  }
}

/** The copy on ServiceM8's board, taken off. */
async function offBoard(press: Sm8Press | null, r: Row): Promise<void> {
  if (!press || !r.placed_at || !r.day) return;
  try {
    const { queueLeaveOffBoard } = await import("@/app/actions/sm8-leave-queue");
    await queueLeaveOffBoard(press, { source: "block", id: placing(r) });
  } catch (e) {
    console.error(`[blocks] couldn't queue block ${r.id} off the board:`, e instanceof Error ? e.message : String(e));
  }
}

export type BlockPlace = { staffUuid: string; day: string; startMin: number };

/** A new block: into the Jobs panel, or, with `place`, straight onto a person's day. */
export async function createBlock(
  orgId: string,
  createdBy: string | null,
  input: { what: unknown; where: unknown; minutes: unknown; place?: BlockPlace },
  press: Sm8Press | null,
): Promise<BlockResult> {
  const words = cleanWords(input.what, input.where);
  const minutes = Number(input.minutes);
  const wrong = blockWrong({ ...words, minutes });
  if (wrong) return { ok: false, error: wrong };
  const p = input.place;
  if (p) {
    if (!p.staffUuid?.trim()) return { ok: false, error: "Choose who." };
    const off = placeWrong({ day: p.day, startMin: p.startMin, minutes });
    if (off) return { ok: false, error: off };
  }
  const now = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from("schedule_blocks")
    .insert({
      org_id: orgId,
      what: words.what,
      where_text: words.where,
      minutes,
      created_by: createdBy,
      ...(p
        ? { sm8_staff_uuid: p.staffUuid.trim(), staff_profile_id: await profileOf(orgId, p.staffUuid), day: p.day, start_min: p.startMin, placed_at: now }
        : {}),
    })
    .select(COLUMNS)
    .maybeSingle();
  if (error || !data) return { ok: false, error: "Couldn't save that." };
  const row = data as Row;
  return { ok: true, id: row.id, note: p ? await onBoard(press, row) : null };
}

/** A block in Jobs, dropped onto a person's day. */
export async function placeBlock(orgId: string, id: string, place: BlockPlace, press: Sm8Press | null): Promise<BlockResult> {
  const r = await readBlock(orgId, id);
  if (!r) return { ok: false, error: "That block isn't there any more." };
  if (r.day) return { ok: false, error: "That block is already on someone's day." };
  if (!place.staffUuid?.trim()) return { ok: false, error: "Choose who." };
  const off = placeWrong({ day: place.day, startMin: place.startMin, minutes: r.minutes });
  if (off) return { ok: false, error: off };
  const { data, error } = await supabaseAdmin
    .from("schedule_blocks")
    .update({
      sm8_staff_uuid: place.staffUuid.trim(),
      staff_profile_id: await profileOf(orgId, place.staffUuid),
      day: place.day,
      start_min: place.startMin,
      placed_at: new Date().toISOString(),
    })
    .eq("org_id", orgId)
    .eq("id", id)
    .is("day", null)
    .is("removed_at", null)
    .select(COLUMNS)
    .maybeSingle();
  if (error || !data) return { ok: false, error: "Couldn't put that on their day." };
  return { ok: true, id, note: await onBoard(press, data as Row) };
}

/** A placed block, back into Jobs (Undo, or Back to Jobs). */
export async function unplaceBlock(orgId: string, id: string, press: Sm8Press | null): Promise<BlockResult> {
  const r = await readBlock(orgId, id);
  if (!r) return { ok: false, error: "That block isn't there any more." };
  if (!r.day) return { ok: true, id, note: null };
  const { error } = await supabaseAdmin
    .from("schedule_blocks")
    .update({ sm8_staff_uuid: null, staff_profile_id: null, day: null, start_min: null, placed_at: null })
    .eq("org_id", orgId)
    .eq("id", id);
  if (error) return { ok: false, error: "Couldn't take that back." };
  await offBoard(press, r);
  return { ok: true, id, note: null };
}

/** A block taken away altogether, from a day or from Jobs. */
export async function removeBlock(orgId: string, id: string, press: Sm8Press | null): Promise<BlockResult> {
  const r = await readBlock(orgId, id);
  if (!r) return { ok: true, id, note: null };
  const { error } = await supabaseAdmin.from("schedule_blocks").update({ removed_at: new Date().toISOString() }).eq("org_id", orgId).eq("id", id);
  if (error) return { ok: false, error: "Couldn't take that off." };
  await offBoard(press, r);
  return { ok: true, id, note: null };
}

/** Who a block is on, for a gate that lets a person move only their own. */
export async function blockOwner(orgId: string, id: string): Promise<{ staffUuid: string | null; createdBy: string | null } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data } = await supabaseAdmin.from("schedule_blocks").select("sm8_staff_uuid, created_by").eq("org_id", orgId).eq("id", id).maybeSingle();
  const r = data as { sm8_staff_uuid: string | null; created_by: string | null } | null;
  return r ? { staffUuid: r.sm8_staff_uuid, createdBy: r.created_by } : null;
}
