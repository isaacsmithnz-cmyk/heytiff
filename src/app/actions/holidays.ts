"use server";

import { revalidatePath } from "next/cache";
import { auth0 } from "@/lib/auth0";
import { supabaseAdmin } from "@/lib/supabase-server";
import { getDbRole } from "@/lib/permissions-server";
import { hasMinRole } from "@/lib/roles";

/* Public-holiday management.

   The calendar largely maintains itself now — `lib/timepay/holiday-sync.ts`
   tops the table up from the statutory rules — so this path is for the
   exceptions: a proclaimed one-off, or a day this business treats
   differently. Anything entered here is `source='manual'`; auto rows carry
   `source='auto'` and a future accounting sync would write its own source.

   Removal depends on provenance: a manual row is simply deleted, but an
   auto/synced row would be re-created by the next top-up — so removing one
   writes a tombstone (`suppressed=true`) the sync must never resurrect.
   Staff only ever READ the calendar — on their timesheet and against leave. */

export type HolidayResult = { ok: true } | { ok: false; error: string };

const STATES = ["NSW", "VIC", "QLD", "SA", "WA", "TAS", "NT", "ACT"];

type Ctx = { orgId: string };

async function adminContext(): Promise<Ctx | null> {
  const session = await auth0.getSession();
  const orgId = session?.orgId as string | undefined;
  if (!orgId) return null;
  const role = await getDbRole();
  if (!hasMinRole(role, "admin")) return null;
  return { orgId };
}

function revalidateHolidayScreens() {
  revalidatePath("/dashboard/timepay");
  revalidatePath("/dashboard/my-timesheet");
  revalidatePath("/dashboard/my-leave");
}

export async function addHoliday(input: {
  state: string;
  date: string;
  name: string;
}): Promise<HolidayResult> {
  const ctx = await adminContext();
  if (!ctx) return { ok: false, error: "Only an admin can manage public holidays." };

  if (!STATES.includes(input.state)) return { ok: false, error: "Pick a state or territory." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) return { ok: false, error: "Check the date." };
  const name = input.name.trim();
  if (!name) return { ok: false, error: "Give the holiday a name." };

  // `suppressed: false` on conflict: re-adding a removed day un-tombstones it.
  const { error } = await supabaseAdmin.from("public_holidays").upsert(
    {
      org_id: ctx.orgId,
      state: input.state,
      holiday_date: input.date,
      name,
      source: "manual",
      suppressed: false,
    },
    { onConflict: "org_id,state,holiday_date" },
  );
  if (error) return { ok: false, error: "Couldn't add that holiday." };
  revalidateHolidayScreens();
  return { ok: true };
}

export async function removeHoliday(id: string): Promise<HolidayResult> {
  const ctx = await adminContext();
  if (!ctx) return { ok: false, error: "Only an admin can manage public holidays." };

  const { data: row } = await supabaseAdmin
    .from("public_holidays")
    .select("source")
    .eq("org_id", ctx.orgId)
    .eq("id", id)
    .maybeSingle();
  if (!row) return { ok: false, error: "That holiday is already gone." };

  const { error } =
    row.source === "manual"
      ? await supabaseAdmin
          .from("public_holidays")
          .delete()
          .eq("org_id", ctx.orgId)
          .eq("id", id)
      : await supabaseAdmin
          .from("public_holidays")
          .update({ suppressed: true })
          .eq("org_id", ctx.orgId)
          .eq("id", id);
  if (error) return { ok: false, error: "Couldn't remove that holiday." };
  revalidateHolidayScreens();
  return { ok: true };
}

/** Bring back an auto/synced day that was removed. */
export async function restoreHoliday(id: string): Promise<HolidayResult> {
  const ctx = await adminContext();
  if (!ctx) return { ok: false, error: "Only an admin can manage public holidays." };

  const { error } = await supabaseAdmin
    .from("public_holidays")
    .update({ suppressed: false })
    .eq("org_id", ctx.orgId)
    .eq("id", id);
  if (error) return { ok: false, error: "Couldn't restore that holiday." };
  revalidateHolidayScreens();
  return { ok: true };
}
