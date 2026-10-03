/* How many large documents (over 50 MB, files.ts) an org has brought into
   the library this month, and so what an owner may still add.

   COUNTED FROM WHAT LANDED, not from what was asked for: a row is only a
   document once its bytes are confirmed (`uploaded_at`), so an upload that
   failed half way never uses one of the two. Months are AU months, the same
   calendar the page allowance runs on (quota.ts). Removing a document deletes
   its row, so a large one removed the same month hands its turn back: only
   an owner can do either, and the pages it was read for are spent anyway. */

import { supabaseAdmin } from "@/lib/supabase-server";
import { KB_LARGE_PER_MONTH, MAX_KB_BYTES, type KbLargeAllowance } from "./files";
import { auMonthStart, nextMonthStart } from "./quota";

/** Pure: of these confirmed large uploads, how many fall in `now`'s AU month. */
export function largeUsedThisMonth(uploadedAt: readonly string[], now: Date = new Date()): number {
  const month = auMonthStart(now);
  return uploadedAt.filter((at) => auMonthStart(new Date(at)) === month).length;
}

/** Pure: the allowance from a count. */
export function largeAllowanceFrom(used: number, now: Date = new Date()): NonNullable<KbLargeAllowance> {
  return { left: Math.max(0, KB_LARGE_PER_MONTH - used), resetsOn: nextMonthStart(auMonthStart(now)) };
}

/** What this person may bring in over 50 MB: null unless they are an owner. */
export async function kbLargeAllowance(orgId: string, isOwner: boolean, now: Date = new Date()): Promise<KbLargeAllowance> {
  if (!isOwner) return null;
  /* a generous window, then the AU month decided in TS — the same function
     that names the month everywhere else, rather than a second idea of where
     an Australian month starts written in SQL */
  const since = new Date(now.getTime() - 40 * 24 * 60 * 60 * 1000).toISOString();
  const { data } = await supabaseAdmin
    .from("kb_documents")
    .select("uploaded_at")
    .eq("org_id", orgId)
    .gt("size_bytes", MAX_KB_BYTES)
    .not("uploaded_at", "is", null)
    .gte("uploaded_at", since);
  const used = largeUsedThisMonth(
    (data ?? []).map((r) => String((r as { uploaded_at: string }).uploaded_at)),
    now
  );
  return largeAllowanceFrom(used, now);
}
