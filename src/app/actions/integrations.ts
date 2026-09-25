"use server";

import { revalidatePath } from "next/cache";
import { auth0 } from "@/lib/auth0";
import { hasMinRole } from "@/lib/roles";
import { getDbRole } from "@/lib/permissions-server";
import { disconnectXero, setXeroTenant } from "@/lib/integrations/store";
import { disconnectSm8 } from "@/lib/integrations/sm8-store";
import { runSm8Sync } from "@/lib/integrations/sm8-sync";
import { sm8PressFromSession } from "@/lib/integrations/sm8-press";
import {
  readSm8WriteState,
  retryFailedSm8Writes,
  setSm8WriteMode,
  sm8WritesEnabled,
} from "@/lib/integrations/sm8-writes";
import { drainSm8WritesAfterResponse } from "@/lib/integrations/sm8-drain";
import { readWriteMode, sendRefusal } from "@/lib/integrations/sm8-write-plan";
import { sm8DisconnectNote, sm8OffNote, sm8RetryNote } from "@/lib/integrations/outcome";

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
  const names = cancelled.map((c) => c.name).filter((n): n is string => n !== null);
  return {
    ok: true,
    note: sm8DisconnectNote({ cancelled: names, unnamed: cancelled.length - names.length, inFlight }),
  };
}

/** Run one sync slice now, in the foreground — the button's whole point is
    watching the counts move, so this awaits rather than after()s. The
    engine's lease makes a press during a running sync a polite "already
    running" rather than a second walker. A press, so it drains: whatever
    is waiting to go to ServiceM8 goes behind the answer. */
export async function syncServiceM8NowAction(): Promise<IntegrationResult> {
  const startedAt = Date.now();
  const ctx = await ownerOrgId();
  if ("error" in ctx) return { ok: false, error: ctx.error };

  drainSm8WritesAfterResponse(ctx.orgId, { startedAt });
  const outcome = await runSm8Sync(ctx.orgId, "manual");
  revalidate();
  if (!outcome.ran) return { ok: false, error: outcome.note };
  return { ok: true, note: outcome.note };
}

/** The owner's switch for writing to ServiceM8: off, a trial run, paused,
    or on. The mode arrives from a browser, so it is read as a choice and
    anything that isn't one of the four is refused rather than guessed at.
    Turning it on doesn't grant anything by itself: the screen then asks for
    the reconnect that gives HeyTiff the permission. Off says what it
    cancelled. On and Trial run drain: what was waiting goes behind the
    answer. */
export async function setServiceM8WriteModeAction(mode: string): Promise<IntegrationResult> {
  const startedAt = Date.now();
  const ctx = await ownerOrgId();
  if ("error" in ctx) return { ok: false, error: ctx.error };
  if (!sm8WritesEnabled()) return { ok: false, error: "Sending to ServiceM8 isn't available yet." };

  const want = readWriteMode(mode);
  if (want !== mode) return { ok: false, error: "That isn't a setting." };
  const changed = await setSm8WriteMode(ctx.orgId, want);
  if (!changed.ok) return { ok: false, error: "Couldn't change it. Reload the page and try again." };
  if (want === "live" || want === "trial") drainSm8WritesAfterResponse(ctx.orgId, { startedAt });
  revalidate();
  const note = want === "off" ? sm8OffNote(changed.cancelled.length) : null;
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
