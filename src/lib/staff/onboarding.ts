import { supabaseAdmin } from "@/lib/supabase-server";
import { PROFILE_FIELDS, profileCompleteness } from "./completeness";
import { fullNameOf } from "./name";
import type { StaffProfile } from "./profile";

/* A NEW STAFF MEMBER'S FIRST RUN — whether it is still owed.

   The staff mirror of `orgSetupPending`: one nullable stamp on the member's
   own card, written by finishing the screen OR by skipping it. Skipping is a
   real answer, recorded the same way, because a first run that reappears on
   every visit to Home stops being a welcome and becomes a nag. What keeps
   reminding someone whose details are still short is the completeness model,
   through Home's attention count (lib/dashboard/chips.ts, `profileChip`) —
   a different thing from this screen, and deliberately so.

   FAILS OPEN. An error or a missing row answers "not pending", so a read that
   goes wrong — including the window before the column's migration reaches a
   database — lands the person on Home, never in a redirect loop or on an
   error page. The screen is a courtesy; Home is the product. */
export async function onboardingPending(orgId: string, userId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("staff_profiles")
    .select("onboarded_at")
    .eq("org_id", orgId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data) return false;
  return data.onboarded_at == null;
}

/* HOW SHORT YOUR OWN CARD IS — the reminder's source, for Home's attention
   count and the bell. Read off the completeness model, the same one the tabs'
   counts and Summary's record line read, so the reminder, the count and the
   button that fixes it can never disagree about what is missing.

   Only the columns the model counts (plus the name the chip is about), not the
   whole card: this runs on every Home render. Fails soft to null — no chip —
   because a reminder that errors should be silent, not a warning about
   nothing. */
export async function ownDetailsGap(
  orgId: string,
  staffProfileId: string
): Promise<{ requiredMissing: number; firstLabel: string | null; name: string } | null> {
  const columns = [...new Set<string>([...PROFILE_FIELDS.map((f) => f.key), "full_name"])].join(", ");
  const { data, error } = await supabaseAdmin
    .from("staff_profiles")
    .select(columns)
    .eq("org_id", orgId)
    .eq("id", staffProfileId)
    .maybeSingle();
  if (error || !data) return null;
  const card = data as unknown as StaffProfile;
  const c = profileCompleteness(card);
  return {
    requiredMissing: c.requiredMissing,
    firstLabel: c.missing.find((f) => f.required)?.label ?? null,
    name: fullNameOf(card),
  };
}

