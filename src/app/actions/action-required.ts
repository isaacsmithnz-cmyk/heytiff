"use server";

import { loadActionRequired } from "@/lib/dashboard/page-data";
import { chipSummary } from "@/lib/dashboard/chips";

/* How many things are waiting on the person asking — the topbar bell's number.

   WHY THIS IS AN ACTION AND NOT A PROP. The bell lives in the shell, and
   `dashboard/layout.tsx` is synchronous on purpose: an await there sits in
   front of the first paint of EVERY screen, which is the page-load lag that
   was hunted down and fixed once already. So the bell renders immediately with
   no badge and asks afterwards, from the client, once per full load — the
   shell survives client navigations, so moving between screens costs nothing.

   It reads the same `loadActionRequired` the board renders from rather than
   counting rows its own way. The number on the bell is therefore, by
   construction, the number of rows on the page the bell opens — a badge that
   can disagree with its own destination is worse than no badge. */

export async function actionRequiredCount(): Promise<number> {
  const chips = await loadActionRequired();
  return chipSummary([...chips.self, ...chips.team]).total;
}
