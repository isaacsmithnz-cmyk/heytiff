import { createClient } from "@supabase/supabase-js";

/* Anon-key browser client. Used only for signed-URL storage transfers
   (upload tokens minted server-side); it carries no session and RLS keeps
   everything else closed to it. */
export function supabaseBrowser() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } }
  );
}
