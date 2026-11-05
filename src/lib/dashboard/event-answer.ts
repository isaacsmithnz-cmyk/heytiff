import "server-only";

import { supabaseAdmin } from "@/lib/supabase-server";
import { todayInAu } from "@/lib/au-dates";
import { isComing, rsvpAnswerFor } from "./events";

/* SAYING WHETHER YOU'RE COMING, AND WHAT YOU CAN'T EAT: the one write behind
   the board's answers and the phone's (Isaac, 6 November 2026, "Build" on the
   events mock). Intrinsic, like voting: no capability, a person answers for
   themselves alone, found by their own staff card.

   An event stays open until it's OVER, not until it expires: the expiry is
   normally the event's own date, so cutting answers off at expiry would close
   the list on the morning of the thing. Archiving still closes it.

   ALLERGIES BELONG TO AN ANSWER. Only someone coming has any; saying you
   can't make it, or taking your answer back, clears what you wrote. They are
   kept only where the event asks for them. */

export type EventAnswerResult = { ok: true } | { ok: false; error: string };

export const MAX_DIET = 300;

export async function answerEvent(
  orgId: string,
  staffId: string,
  noticeId: string,
  change: { answer?: string | null; diet?: string | null },
): Promise<EventAnswerResult> {
  const { data } = await supabaseAdmin
    .from("notices")
    .select("kind, event_date, archived_at, event_plus_one, event_ask_diet")
    .eq("org_id", orgId)
    .eq("id", noticeId)
    .maybeSingle();
  if (!data) return { ok: false, error: "That event no longer exists." };
  if (data.kind !== "event") return { ok: false, error: "That notice isn't an event." };
  if (data.archived_at) return { ok: false, error: "That event has been filed away." };
  const eventDate = data.event_date ? String(data.event_date).slice(0, 10) : null;
  if (eventDate && eventDate < todayInAu()) return { ok: false, error: "That event has already happened." };

  const plusOne = data.event_plus_one === true;
  const mine = () =>
    supabaseAdmin.from("notice_rsvps").select("answer, diet").eq("org_id", orgId).eq("notice_id", noticeId).eq("staff_profile_id", staffId).maybeSingle();

  if (change.answer === null) {
    const { error } = await supabaseAdmin.from("notice_rsvps").delete().eq("org_id", orgId).eq("notice_id", noticeId).eq("staff_profile_id", staffId);
    return error ? { ok: false, error: "Couldn't record that." } : { ok: true };
  }

  let answer: string | null = null;
  if (change.answer !== undefined) {
    answer = rsvpAnswerFor(change.answer, plusOne);
    if (!answer) return { ok: false, error: "That isn't an answer to this event." };
  } else {
    const { data: row } = await mine();
    answer = rsvpAnswerFor(row?.answer, plusOne);
    if (!answer) return { ok: false, error: "Say whether you're coming first." };
  }

  const coming = isComing(answer as never);
  const wantsDiet = change.diet !== undefined;
  if (wantsDiet && data.event_ask_diet !== true) return { ok: false, error: "This event doesn't ask about that." };
  if (wantsDiet && !coming) return { ok: false, error: "Say you're coming first." };
  const diet = wantsDiet ? (change.diet ?? "").trim().slice(0, MAX_DIET) || null : undefined;

  const { error } = await supabaseAdmin.from("notice_rsvps").upsert(
    {
      org_id: orgId,
      notice_id: noticeId,
      staff_profile_id: staffId,
      answer,
      ...(diet !== undefined ? { diet } : {}),
      /* not coming: nothing to cater for */
      ...(!coming ? { diet: null } : {}),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "notice_id,staff_profile_id" },
  );
  return error ? { ok: false, error: "Couldn't record that." } : { ok: true };
}
