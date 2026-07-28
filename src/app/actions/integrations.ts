"use server";

import { revalidatePath } from "next/cache";
import { auth0 } from "@/lib/auth0";
import { hasMinRole } from "@/lib/roles";
import { getDbRole } from "@/lib/permissions-server";
import { disconnectXero, setXeroTenant } from "@/lib/integrations/store";
import { disconnectSm8 } from "@/lib/integrations/sm8-store";
import { runSm8Sync } from "@/lib/integrations/sm8-sync";

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

  await disconnectSm8(ctx.orgId);
  revalidate();

  /* ServiceM8 documents no revocation endpoint, so unlike Xero there is no
     upstream call to attempt: our sealed tokens are gone, and finishing the
     job on their side is a one-off the owner does in ServiceM8 itself. */
  return {
    ok: true,
    note: "Disconnected here. To fully revoke access, also remove HeyTiff from your ServiceM8 account's add-ons.",
  };
}

/** Run one sync slice now, in the foreground — the button's whole point is
    watching the counts move, so this awaits rather than after()s. The
    engine's lease makes a press during a running sync a polite "already
    running" rather than a second walker. */
export async function syncServiceM8NowAction(): Promise<IntegrationResult> {
  const ctx = await ownerOrgId();
  if ("error" in ctx) return { ok: false, error: ctx.error };

  const outcome = await runSm8Sync(ctx.orgId, "manual");
  revalidate();
  if (!outcome.ran) return { ok: false, error: outcome.note };
  return { ok: true, note: outcome.note };
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
