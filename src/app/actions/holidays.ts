"use server";

import { revalidatePath } from "next/cache";
import { auth0 } from "@/lib/auth0";
import { supabaseAdmin } from "@/lib/supabase-server";
import { getDbRole } from "@/lib/permissions-server";
import { hasMinRole } from "@/lib/roles";

/* Public-holiday management — the yearly-maintenance path.

   Holidays are the org's operational calendar, so an admin maintains them
   (admin+, the same tier as the Admin section they live in). Anything entered
   here is `source='manual'`; a future accounting sync would write its own
   source and this path never touches those rows. Staff only ever READ the
   calendar — on their timesheet and against leave. */

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

  const { error } = await supabaseAdmin.from("public_holidays").upsert(
    {
      org_id: ctx.orgId,
      state: input.state,
      holiday_date: input.date,
      name,
      source: "manual",
    },
    { onConflict: "org_id,state,holiday_date" },
  );
  if (error) return { ok: false, error: "Couldn't add that holiday." };
  revalidatePath("/dashboard/admin/holidays");
  revalidatePath("/dashboard/my-timesheet");
  revalidatePath("/dashboard/my-leave");
  return { ok: true };
}

export async function removeHoliday(id: string): Promise<HolidayResult> {
  const ctx = await adminContext();
  if (!ctx) return { ok: false, error: "Only an admin can manage public holidays." };

  const { error } = await supabaseAdmin
    .from("public_holidays")
    .delete()
    .eq("org_id", ctx.orgId)
    .eq("id", id);
  if (error) return { ok: false, error: "Couldn't remove that holiday." };
  revalidatePath("/dashboard/admin/holidays");
  revalidatePath("/dashboard/my-timesheet");
  revalidatePath("/dashboard/my-leave");
  return { ok: true };
}
