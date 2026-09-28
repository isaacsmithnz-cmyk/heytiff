"use server";

/* QUEUEING LEAVE FOR THE SERVICEM8 BOARD — the one door (leave to
   ServiceM8).

   The leave actions (approve, cancel) and the day-off actions (mark, clear)
   call these after their own write has landed, and nothing else queues a
   leave row: a test holds that only this file passes `kind: "leave"` to the
   queue (sm8-press.test). Each helper takes a PRESS
   (lib/integrations/sm8-press), so a browser's copy of one is refused.

   NOTHING HERE CAN FAIL A LEAVE DECISION. The decision is HeyTiff's record
   and it has already landed; what the board gets is a copy. A helper
   answers with at most a sentence to say beside the decision, and never
   throws.

   NOTHING HAPPENS unless the deployment allows leave (SM8_WRITES names
   `leave`) — not even a read — and nothing is queued unless the owner has
   Leave switched on. Leave already approved when Leave is switched on
   stays where the office put it: switching on puts nothing on the board by
   itself, because the office has been keying leave in by hand and a
   back-fill would put it there twice.

   THE PERSON is the one the owner linked on the ServiceM8 screen
   (integration_links), read for the connected account. Leave goes FOR
   them, never AS them, so a link they haven't confirmed still carries it;
   one they said isn't them doesn't, and nor does one ServiceM8 has as
   inactive. */

import { isSm8Press, type Sm8Press } from "@/lib/integrations/sm8-press";
import { readSm8WriteState, enqueueSm8Writes, stopCreateRow } from "@/lib/integrations/sm8-writes";
import { dedupeKey, offersSend } from "@/lib/integrations/sm8-write-plan";
import { sm8LeaveAllowed } from "@/lib/integrations/sm8-kinds";
import { sm8NoteSender } from "@/lib/integrations/links";
import { drainSm8WritesAfterResponse } from "@/lib/integrations/sm8-drain";
import { undoPlan, type CreateRow } from "@/lib/integrations/sm8-note-plan";
import { fillWords } from "@/lib/integrations/sm8-note-words";
import { boardName, leaveSpan, leaveSubject, LEAVE_WORDS, type LeaveSource } from "@/lib/integrations/sm8-leave-plan";
import { supabaseAdmin } from "@/lib/supabase-server";
import { displayNameOf } from "@/lib/staff/name";

/** A HeyTiff name for a sentence, read only when one is said. */
async function nameOf(orgId: string, staffId: string): Promise<string> {
  const { data } = await supabaseAdmin
    .from("staff_profiles")
    .select("id, first_name, last_name, full_name, preferred_name")
    .eq("org_id", orgId)
    .eq("id", staffId)
    .maybeSingle();
  return (data ? displayNameOf(data as Parameters<typeof displayNameOf>[0], "") : "") || "They";
}

/** What a helper did: the queue rows it made, and a sentence to say beside
    the decision when the leave stays off the board for a reason somebody
    can fix. */
export type LeaveQueueResult = { queued: string[]; note: string | null };

const NOTHING: LeaveQueueResult = { queued: [], note: null };

export type LeaveOnBoard = {
  source: LeaveSource;
  /** leave_requests.id, or staff_unavailability.id */
  id: string;
  staffProfileId: string;
  /** The leave's kind (annual, personal, unpaid); none for a day off. */
  kind: string | null;
  /** First and last day, "YYYY-MM-DD", inclusive. */
  from: string;
  to: string;
};

const subjectOf = (source: LeaveSource, id: string) =>
  source === "leave" ? leaveSubject.leave(id) : leaveSubject.dayOff(id);

/** Put approved leave, or a day off, on the person's day on the board. */
export async function queueLeaveOnBoard(press: Sm8Press, input: LeaveOnBoard): Promise<LeaveQueueResult> {
  if (!sm8LeaveAllowed()) return NOTHING;
  if (!isSm8Press(press)) return NOTHING;
  try {
    const state = await readSm8WriteState(press.orgId);
    if (!state.readable) return { queued: [], note: LEAVE_WORDS.press.unreadable };
    if (!offersSend(state, "leave")) return NOTHING;
    const span = leaveSpan(input.from, input.to);
    if (!span) return NOTHING;

    const who = await sm8NoteSender(press.orgId, input.staffProfileId, state.tenantId ?? undefined);
    if (who.state === "unknown") return { queued: [], note: LEAVE_WORDS.press.unreadable };
    if (who.state !== "ready" && who.state !== "confirm") {
      const name = await nameOf(press.orgId, input.staffProfileId);
      const words =
        who.state === "denied" ? LEAVE_WORDS.press.denied : who.state === "inactive" ? LEAVE_WORDS.press.inactive : LEAVE_WORDS.press.unlinked;
      return { queued: [], note: fillWords(words, { name }) };
    }

    const out = await enqueueSm8Writes(press, state, [
      {
        kind: "leave",
        jobUuid: null,
        subject: subjectOf(input.source, input.id),
        payload: { name: boardName(input.kind) },
        ref: input.id,
        op: "create",
        staffUuid: who.remoteId,
        start: span.start,
        end: span.end,
      },
    ]);
    if (!out) return { queued: [], note: LEAVE_WORDS.press.unreadable };
    if (out.capped) return { queued: [], note: LEAVE_WORDS.press.capped };
    if (out.ids.length > 0) drainSm8WritesAfterResponse(press.orgId);
    return { queued: out.ids, note: null };
  } catch (err) {
    console.error(`[sm8] couldn't queue leave ${input.id} for the board: ${err instanceof Error ? err.message : String(err)}`);
    return NOTHING;
  }
}

type LeaveCreate = CreateRow & { id: string; status: string; lease_until: string | null };

const CREATE_COLUMNS = "id, status, remote_uuid, lease_until, maybe_landed, verify_uuids, taken_back_at, kind, op, tenant_id";

/** Take leave, or a day off, back off the board: its create stopped where
    it could still go, and a DELETE queued for whatever of it may be there.
    Nothing is queued when nothing of it can be on the board. */
export async function queueLeaveOffBoard(press: Sm8Press, input: { source: LeaveSource; id: string }): Promise<LeaveQueueResult> {
  if (!sm8LeaveAllowed()) return NOTHING;
  if (!isSm8Press(press)) return NOTHING;
  try {
    const orgId = press.orgId;
    const { data, error } = await supabaseAdmin
      .from("sm8_writes")
      .select(CREATE_COLUMNS)
      .eq("org_id", orgId)
      .eq("dedupe_key", dedupeKey("leave", null, subjectOf(input.source, input.id)))
      .maybeSingle();
    if (error) {
      console.error(`[sm8] couldn't read leave ${input.id}'s board row for org ${orgId}:`, error);
      return NOTHING;
    }
    let create = data as LeaveCreate | null;
    if (!create) return NOTHING;
    const now = Date.now();
    /* taken back whatever it stands at, so no press puts it on again, and
       cancelled where it could still go */
    create = await stopCreateRow(orgId, create, now, CREATE_COLUMNS);
    if (undoPlan(create, Date.now()) === "nothing") return NOTHING;

    const state = await readSm8WriteState(orgId);
    if (!state.readable || !state.tenantId) return NOTHING;
    const out = await enqueueSm8Writes(press, state, [
      {
        kind: "leave",
        jobUuid: null,
        subject: leaveSubject.remove(create.id),
        payload: { name: LEAVE_WORDS.label.remove },
        ref: input.id,
        op: "delete",
        dependsOn: create.id,
      },
    ]);
    if (!out) return NOTHING;
    if (out.capped) return { queued: [], note: LEAVE_WORDS.press.capped };
    if (out.ids.length > 0) drainSm8WritesAfterResponse(orgId);
    return { queued: out.ids, note: null };
  } catch (err) {
    console.error(`[sm8] couldn't queue leave ${input.id} off the board: ${err instanceof Error ? err.message : String(err)}`);
    return NOTHING;
  }
}
