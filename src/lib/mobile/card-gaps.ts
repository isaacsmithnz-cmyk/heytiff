import { supabaseAdmin } from "@/lib/supabase-server";

/* WHAT YOUR CARD STILL WANTS FROM YOU, on the phone's To do (bug 101, Isaac,
   26 November 2026: the first run's steps can each be skipped, and "what was
   skipped waits in To do and leaves when it's done"). Not tasks: nothing to
   tick. Each is a row that opens Your card, and goes when the card has it.

   Only what you can put on your own card yourself, from the phone: your date
   of birth, home address, mobile, an emergency contact and its mobile, and a
   first licence. A start date, employment type or work rights are the
   business's to set, and never asked of you here. */

export type CardGap = { key: string; title: string };

const blank = (v: unknown) => !(typeof v === "string" ? v.trim() : v);

export async function cardGaps(orgId: string, staffId: string): Promise<CardGap[]> {
  const [{ data: card }, { count }] = await Promise.all([
    supabaseAdmin
      .from("staff_profiles")
      .select("birthday, address, phone, emergency_name, emergency_phone")
      .eq("org_id", orgId)
      .eq("id", staffId)
      .maybeSingle(),
    supabaseAdmin.from("staff_licences").select("id", { count: "exact", head: true }).eq("org_id", orgId).eq("staff_profile_id", staffId),
  ]);
  if (!card) return [];
  const c = card as Record<string, unknown>;
  const gaps: CardGap[] = [];
  if (blank(c.birthday)) gaps.push({ key: "birthday", title: "Add your date of birth" });
  if (blank(c.phone)) gaps.push({ key: "phone", title: "Add your mobile" });
  if (blank(c.address)) gaps.push({ key: "address", title: "Add your home address" });
  if (blank(c.emergency_name)) gaps.push({ key: "emergency", title: "Add an emergency contact" });
  else if (blank(c.emergency_phone)) gaps.push({ key: "emergency_phone", title: "Add your emergency contact's mobile" });
  if (count === 0) gaps.push({ key: "licences", title: "Add your licences" });
  return gaps;
}
