import "server-only";

import { supabaseAdmin } from "@/lib/supabase-server";

/* YOUR TWO BIRTHDAY TICKS (Isaac, 6 November 2026: "Staff have to opt in,
   tick to share bday, tick to share age"). Both off until their person ticks
   them; age means nothing without the birthday, so turning the birthday off
   turns the age off with it, and the age can't be turned on alone. A person
   sets their own, found by their own staff card, and no one else's. */

export type BirthdaySharing = { shareBirthday: boolean; shareAge: boolean };

export async function readBirthdaySharing(orgId: string, staffId: string): Promise<BirthdaySharing> {
  const { data } = await supabaseAdmin.from("staff_profiles").select("share_birthday, share_age").eq("org_id", orgId).eq("id", staffId).maybeSingle();
  const birthday = data?.share_birthday === true;
  return { shareBirthday: birthday, shareAge: birthday && data?.share_age === true };
}

export async function setBirthdaySharing(orgId: string, staffId: string, change: Partial<BirthdaySharing>): Promise<BirthdaySharing | null> {
  const now = await readBirthdaySharing(orgId, staffId);
  const shareBirthday = change.shareBirthday ?? now.shareBirthday;
  const shareAge = shareBirthday && (change.shareAge ?? now.shareAge);
  const { error } = await supabaseAdmin.from("staff_profiles").update({ share_birthday: shareBirthday, share_age: shareAge }).eq("org_id", orgId).eq("id", staffId);
  return error ? null : { shareBirthday, shareAge };
}
