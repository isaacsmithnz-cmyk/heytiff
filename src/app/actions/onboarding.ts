"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireOrg } from "@/lib/permissions-server";
import { saveMyProfileSection, type SaveResult } from "./profile";

/* A new staff member's first run — finishing it, or waving it away.

   THE WRITES GO THROUGH saveMyProfileSection, not a second update path. That
   action owns the self-edit allowlist, the dd/mm/yyyy date conversion and the
   derived full_name; a parallel writer here would be the one that drifts. All
   this file adds is the part the first run owns: which fields it sends, the
   one thing it insists on, and the stamp.

   Only the member's own card, ever — requireOrg() with no capability, because
   being signed in to the workspace IS the permission for your own details,
   the same bar My profile uses. A Server Function is reachable by direct POST,
   so nothing here trusts that the screen only renders for the right person. */

/** The fields the first run collects, by section — and nothing else. Keys a
    POST adds beyond these never reach the save, so the screen cannot be used
    to set a start date or an employment type, which are the business's. */
const PERSONAL = ["first_name", "last_name", "preferred_name", "birthday", "phone", "address"] as const;
const EMERGENCY = ["emergency_name", "emergency_relationship", "emergency_phone"] as const;

function pick(from: Record<string, string> | undefined, keys: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of keys) {
    const v = from?.[k];
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

/* The stamp preserves the FIRST answer (`is null`): a second tab, or a skip
   pressed after a save, must not move the recorded moment. */
async function stampOnboarded(orgId: string, userId: string): Promise<SaveResult> {
  const { error } = await supabaseAdmin
    .from("staff_profiles")
    .update({ onboarded_at: new Date().toISOString() })
    .eq("org_id", orgId)
    .eq("user_id", userId)
    .is("onboarded_at", null);
  if (error) return { ok: false, error: "Couldn’t save — try again." };
  // Home's gate reads the stamp per request; clear the router cache so the
  // hop back to /dashboard does not replay a stale redirect.
  revalidatePath("/dashboard", "layout");
  revalidatePath("/welcome/details");
  return { ok: true };
}

export async function completeMyOnboarding(
  personal: Record<string, string>,
  emergency: Record<string, string>
): Promise<SaveResult> {
  const { orgId, userId } = await requireOrg();

  /* THE NAME IS THE ONE THING THIS SCREEN INSISTS ON, because it is the one
     thing nothing else in the flow can answer. The invitation's name box is
     optional, Auth0 never asks, and the fallback is the part of an address
     before its `@`. Everything else can be skipped, and the Skip button is
     right there — but "Save details" with no name would finish the flow in
     exactly the state it exists to fix. The screen checks first; this is the
     direct-POST backstop. */
  const missing = (["first_name", "last_name"] as const).filter((k) => !(personal?.[k] ?? "").trim());
  if (missing.length) {
    return { ok: false, error: "Add your first and last name.", fields: [...missing] };
  }

  const personalSaved = await saveMyProfileSection("personal", pick(personal, PERSONAL));
  if (!personalSaved.ok) return personalSaved;
  const emergencySaved = await saveMyProfileSection("emergency", pick(emergency, EMERGENCY));
  if (!emergencySaved.ok) return emergencySaved;

  return stampOnboarded(orgId, userId);
}

/* "Skip for now" is a real answer, recorded exactly like finishing —
   otherwise Home re-sends them here on every visit. Nothing is written to the
   card. What still says their details are short is Home's attention count,
   which lives on the completeness model and clears itself when they are in. */
export async function skipMyOnboarding(): Promise<SaveResult> {
  const { orgId, userId } = await requireOrg();
  return stampOnboarded(orgId, userId);
}
