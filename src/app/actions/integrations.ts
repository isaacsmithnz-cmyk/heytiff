"use server";

import { revalidatePath } from "next/cache";
import { auth0 } from "@/lib/auth0";
import { hasMinRole } from "@/lib/roles";
import { getDbRole } from "@/lib/permissions-server";
import { disconnectXero, setXeroTenant } from "@/lib/integrations/store";
import { disconnectSm8 } from "@/lib/integrations/sm8-store";
import { runSm8Sync } from "@/lib/integrations/sm8-sync";
import { whenSm8LeaseFree } from "@/lib/integrations/sm8-lease";
import { sm8PressFromSession } from "@/lib/integrations/sm8-press";
import {
  readSm8WriteState,
  retryFailedSm8Writes,
  setSm8WriteKind,
  setSm8WriteMode,
  sm8WriteKindsEnabled,
  sm8WritesEnabled,
} from "@/lib/integrations/sm8-writes";
import { drainSm8WritesAfterResponse } from "@/lib/integrations/sm8-drain";
import { readWriteMode, sendRefusal, type Sm8WriteKind } from "@/lib/integrations/sm8-write-plan";
import { NOTE_WORDS } from "@/lib/integrations/sm8-note-words";
import { BOOKING_WORDS } from "@/lib/integrations/sm8-booking-words";
import { sm8DisconnectNote, sm8KindOffNote, sm8OffNote, sm8RetryNote } from "@/lib/integrations/outcome";

/* The two things you can do to an existing connection from the screen.

   Owner-only, the same gate the connect route carries — a Server Function is
   reachable by direct POST, so the role is re-checked here on every call
   rather than trusted from the page that rendered the button. Nothing here
   takes an org id from the client: it comes from the session, so a call can
   only ever reach the caller's own connection. */

export type IntegrationResult = { ok: true; note?: string } | { ok: false; error: string };

const NOT_OWNER = "Only an owner can change connected apps.";

async function ownerOrgId(): Promise<{ orgId: string } | { error: string }> {
  const session = await auth0.getSession();
  if (!session) throw new Error("Not authenticated");
  const orgId = session.orgId as string | undefined;
  if (!orgId) throw new Error("No active organization");
  if (!hasMinRole(await getDbRole(), "owner")) return { error: NOT_OWNER };
  return { orgId };
}

function revalidate() {
  revalidatePath("/dashboard/admin/integrations");
  revalidatePath("/dashboard/admin/integrations/xero");
  revalidatePath("/dashboard/admin/integrations/servicem8");
}

export async function disconnectXeroAction(): Promise<IntegrationResult> {
  const ctx = await ownerOrgId();
  if ("error" in ctx) return { ok: false, error: ctx.error };

  const { revoked } = await disconnectXero(ctx.orgId);
  revalidate();

  /* Local tokens are gone either way. When Xero wouldn't take the revoke, say
     so plainly and point at the one place that can finish the job — silently
     claiming a clean disconnect would leave a live authorisation sitting in
     their Xero account that nobody knows about. */
  return {
    ok: true,
    note: revoked
      ? undefined
      : "Disconnected here, but Xero didn't confirm the authorisation was revoked. Check Connected Apps in your Xero account.",
  };
}

export async function disconnectServiceM8Action(): Promise<IntegrationResult> {
  const ctx = await ownerOrgId();
  if ("error" in ctx) return { ok: false, error: ctx.error };

  const { cancelled, inFlight } = await disconnectSm8(ctx.orgId);
  revalidate();

  /* ServiceM8 documents no revocation endpoint, so unlike Xero there is no
     upstream call to attempt: our sealed tokens are gone, and finishing the
     job on their side is a one-off the owner does in ServiceM8 itself. The
     note also says which files that were waiting to go won't, and how many
     were already on their way and may still arrive. */
  /* files by name; a note's or a booking's name is only its label, so notes
     and bookings are counted */
  const notes = cancelled.filter((c) => c.kind === "note").length;
  const bookings = cancelled.filter((c) => c.kind === "booking").length;
  const files = cancelled.filter((c) => c.kind !== "note" && c.kind !== "booking");
  const names = files.map((c) => c.name).filter((n): n is string => n !== null);
  return {
    ok: true,
    note: sm8DisconnectNote({
      cancelled: names,
      unnamed: files.length - names.length,
      inFlight,
      notes,
      bookings,
    }),
  };
}

/** Run one sync slice now, in the foreground — the button's whole point is
    watching the counts move, so this awaits rather than after()s. The
    engine's lease makes a press during a running sync a polite "already
    running" rather than a second walker — after a few tries two seconds
    apart, each asking for the lease, so a press that meets a live update
    being read (which stands aside when asked) still syncs. A press, so it
    drains: whatever is waiting to go to ServiceM8 goes behind the answer. */
export async function syncServiceM8NowAction(): Promise<IntegrationResult> {
  const startedAt = Date.now();
  const ctx = await ownerOrgId();
  if ("error" in ctx) return { ok: false, error: ctx.error };

  drainSm8WritesAfterResponse(ctx.orgId, { startedAt });
  const orgId = ctx.orgId;
  const outcome = await whenSm8LeaseFree(() => runSm8Sync(orgId, "manual"), { tries: 10, waitMs: 2_000 });
  revalidate();
  if (!outcome.ran) return { ok: false, error: outcome.note };
  return { ok: true, note: outcome.note };
}

/** The owner's switch for writing to ServiceM8: off, paused, or on. The
    mode arrives from a browser, so it is read as a choice and anything that
    isn't one is refused rather than guessed at. Turning it on doesn't grant
    anything by itself: the screen then asks for the reconnect that gives
    HeyTiff the permission. Off says what it cancelled. On drains: what was
    waiting goes behind the answer.

    TRIAL RUN IS RETIRED (Isaac, 2026-09-28). It was the way to watch sending
    work on a live account before it touched one; notes and bookings have
    since gone for real, so it can no longer be chosen. The engine still
    understands the mode, so a row sent as a trial still reads as one. */
export async function setServiceM8WriteModeAction(mode: string): Promise<IntegrationResult> {
  const startedAt = Date.now();
  const ctx = await ownerOrgId();
  if ("error" in ctx) return { ok: false, error: ctx.error };
  if (!sm8WritesEnabled()) return { ok: false, error: "Sending to ServiceM8 isn't available yet." };

  const want = readWriteMode(mode);
  if (want !== mode) return { ok: false, error: "That isn't a setting." };
  if (want === "trial") return { ok: false, error: "Trial run has been retired. Choose Off, Paused or On." };
  const changed = await setSm8WriteMode(ctx.orgId, want);
  if (!changed.ok) return { ok: false, error: "Couldn't change it. Reload the page and try again." };
  if (want === "live") drainSm8WritesAfterResponse(ctx.orgId, { startedAt });
  revalidate();
  /* files, notes and bookings apart: with no notes and no bookings, today's
     words exactly */
  const notes = changed.cancelled.filter((c) => c.kind === "note").length;
  const bookings = changed.cancelled.filter((c) => c.kind === "booking").length;
  const note = want === "off" ? sm8OffNote(changed.cancelled.length - notes - bookings, notes, bookings) : null;
  return note ? { ok: true, note } : { ok: true };
}

/** The owner's switch for ONE KIND — Files, Notes or Bookings — under the
    one Off / Trial run / Paused / On. Only a kind this deployment allows
    (SM8_WRITES) can be switched, and only where it allows more than one:
    the card draws a row per kind only then, and a switch the card doesn't
    draw can't be switched back from it. On a deployment that sends files
    alone (SM8_WRITES=1) the one Off / On is the only switch, as before, and
    a direct POST changes nothing. Off cancels that kind's waiting rows and
    says how many; On drains, while sending is On or a Trial run, so what
    waits goes. */
export async function setServiceM8WriteKindAction(kind: string, on: boolean): Promise<IntegrationResult> {
  const startedAt = Date.now();
  const ctx = await ownerOrgId();
  if ("error" in ctx) return { ok: false, error: ctx.error };
  if (kind !== "attachment" && kind !== "note" && kind !== "booking") return { ok: false, error: NOTE_WORDS.card.notAKind };
  const allowed = sm8WriteKindsEnabled();
  if (!allowed.includes(kind)) {
    return {
      ok: false,
      error:
        kind === "note"
          ? NOTE_WORDS.card.notesUnavailable
          : kind === "booking"
            ? BOOKING_WORDS.card.bookingsUnavailable
            : "Sending to ServiceM8 isn't available yet.",
    };
  }
  if (typeof on !== "boolean") return { ok: false, error: "That isn't a setting." };
  /* the card's own test for drawing a row per kind (sm8-writes-card `more`) */
  if (allowed.length < 2) return { ok: false, error: "That isn't a setting." };
  const changed = await setSm8WriteKind(ctx.orgId, kind as Sm8WriteKind, on);
  if (!changed.ok) return { ok: false, error: "Couldn't change it. Reload the page and try again." };
  if (on) {
    const state = await readSm8WriteState(ctx.orgId);
    if (state.mode === "live" || state.mode === "trial") drainSm8WritesAfterResponse(ctx.orgId, { startedAt });
  }
  revalidate();
  const note = on ? null : sm8KindOffNote(kind, changed.cancelled.length);
  return note ? { ok: true, note } : { ok: true };
}

/** The owner's Retry failed files: every write that failed for the account
    connected now goes again, as far as the hour's cap has room, and the
    drain follows behind the answer. A person pressed it, so it is a press
    (sm8-press): the queue takes nothing else. */
export async function retryFailedServiceM8WritesAction(): Promise<IntegrationResult> {
  const startedAt = Date.now();
  const ctx = await ownerOrgId();
  if ("error" in ctx) return { ok: false, error: ctx.error };
  if (!sm8WritesEnabled()) return { ok: false, error: "Sending to ServiceM8 isn't available yet." };
  const press = await sm8PressFromSession();
  if (!press || press.orgId !== ctx.orgId) return { ok: false, error: NOT_OWNER };

  const state = await readSm8WriteState(ctx.orgId);
  const refusal = sendRefusal(state, "attachment");
  if (refusal) return { ok: false, error: refusal };

  const retried = await retryFailedSm8Writes(press, state);
  if (!retried) return { ok: false, error: "Couldn't send those again. Try again." };
  drainSm8WritesAfterResponse(ctx.orgId, { startedAt });
  revalidate();
  return { ok: true, note: sm8RetryNote(retried) };
}

export async function setXeroTenantAction(tenantId: string): Promise<IntegrationResult> {
  const ctx = await ownerOrgId();
  if ("error" in ctx) return { ok: false, error: ctx.error };

  // The id is validated against the tenants the grant actually returned, in
  // the store — it arrives from a browser, so it names a choice, not a target.
  const result = await setXeroTenant(ctx.orgId, tenantId);
  if (!result.ok) return result;

  revalidate();
  return { ok: true };
}
