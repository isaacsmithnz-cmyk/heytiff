"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase-server";
import { auth0 } from "@/lib/auth0";
import { hasMinRole } from "@/lib/roles";
import { getDbRole } from "@/lib/permissions-server";
import { saveOrgSection, type SaveResult } from "./org";

/* First-run company setup — finishing it, or waving it away.

   THE PROFILE WRITES GO THROUGH saveOrgSection, not a second update path.
   That action already owns the section allowlists, the ABN checksum, the GST
   Yes/No→boolean conversion and the layout revalidation; a parallel writer
   here would be the version that drifts. What this file adds is only the
   part setup owns: the completion stamp.

   Owner-only, same bar and same wording as every write in actions/org.ts —
   a Server Function is reachable by direct POST, so the role is re-checked
   here even though the welcome page never renders for anyone else. */

const NOT_OWNER = "Only an owner can change organisation settings.";

async function ownerOrgId(): Promise<{ orgId: string } | { error: string }> {
  const session = await auth0.getSession();
  if (!session) throw new Error("Not authenticated");
  const orgId = session.orgId as string | undefined;
  if (!orgId) throw new Error("No active organization");
  if (!hasMinRole(await getDbRole(), "owner")) return { error: NOT_OWNER };
  return { orgId };
}

/* The stamp preserves the FIRST completion (`is null` guard): a re-posted
   form or a second tab finishing later must not move the recorded moment the
   org was set up. Nothing else about a re-run is refused — the saves above it
   are the same idempotent settings writes the Organisation screen makes. */
async function stampSetupDone(orgId: string): Promise<SaveResult> {
  const { error } = await supabaseAdmin
    .from("organizations")
    .update({ setup_completed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", orgId)
    .is("setup_completed_at", null);
  if (error) return { ok: false, error: "Couldn't finish setup — try again." };
  // Home's gate reads the stamp per request; this clears the router cache so
  // the client-side hop to /dashboard doesn't replay a stale redirect.
  revalidatePath("/dashboard", "layout");
  revalidatePath("/welcome");
  return { ok: true };
}

export async function completeOrgSetup(
  identity: Record<string, string>,
  contact: Record<string, string>
): Promise<SaveResult> {
  const ctx = await ownerOrgId();
  if ("error" in ctx) return { ok: false, error: ctx.error };

  /* The trading name is the one required fact: it is the name the sidebar,
     the Team page and every printed document lead with, and completing setup
     without one would finish the flow in exactly the state the flow exists to
     prevent. The wizard enforces this on the first step; this is the direct-
     POST backstop. */
  if (!(identity?.trading_name ?? "").trim()) {
    return {
      ok: false,
      error: "Give the business a name — it's what your team and your documents will show.",
      fields: ["trading_name"],
    };
  }

  const identitySaved = await saveOrgSection("identity", identity);
  if (!identitySaved.ok) return identitySaved;
  const contactSaved = await saveOrgSection("contact", contact);
  if (!contactSaved.ok) return contactSaved;

  return stampSetupDone(ctx.orgId);
}

/* "Skip for now" is a real answer, recorded the same way as finishing —
   otherwise Home re-prompts on every visit and a courtesy becomes a nag.
   Nothing is written to the profile; the Organisation screen holds every
   field for whenever the owner is ready. */
export async function skipOrgSetup(): Promise<SaveResult> {
  const ctx = await ownerOrgId();
  if ("error" in ctx) return { ok: false, error: ctx.error };
  return stampSetupDone(ctx.orgId);
}
