import { supabaseAdmin } from "@/lib/supabase-server";

/* THE LITTLE i ON TIFF'S ARROW, kept for the person rather than the device
   (docs/migrations/tiff_info_read.sql): pressed once anywhere, it's gone on
   the web and the phone alike. It's the person's, not the workspace's, so it
   sits on `profiles`. Null where it couldn't be told (the column not there
   yet, a failed read): the device then goes by what it remembers itself. */

export async function readInfoRead(userSub: string): Promise<boolean | null> {
  const { data, error } = await supabaseAdmin.from("profiles").select("tiff_info_read_at").eq("user_id", userSub).maybeSingle();
  if (error) return null;
  return !!(data as { tiff_info_read_at?: string | null } | null)?.tiff_info_read_at;
}

/** Marks it read, once: a later press leaves the first time standing. */
export async function markInfoRead(userSub: string): Promise<boolean> {
  const { error } = await supabaseAdmin
    .from("profiles")
    .update({ tiff_info_read_at: new Date().toISOString() })
    .eq("user_id", userSub)
    .is("tiff_info_read_at", null);
  return !error;
}
