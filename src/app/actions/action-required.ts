"use server";

import { loadActionRequired } from "@/lib/dashboard/page-data";
import { sortChips, type ActionChip } from "@/lib/dashboard/chips";

/* What is waiting on the person asking — the topbar bell's list AND its number.

   WHY THIS IS AN ACTION AND NOT A PROP. The bell lives in the shell, and
   `dashboard/layout.tsx` is synchronous on purpose: an await there sits in
   front of the first paint of EVERY screen, which is the page-load lag that
   was hunted down and fixed once already. So the bell renders immediately with
   no badge and asks afterwards, from the client, once per full load — the
   shell survives client navigations, so moving between screens costs nothing.

   IT RETURNS THE ROWS, NOT A TALLY. The bell used to be a link to
   /dashboard/action-required and this returned only a count: you left whatever
   you were doing to find out whether anything was worth leaving for. The bell
   now opens the list in place, so the one round trip that was already being
   made carries the items themselves. The badge is `items.length` by
   construction, which is the property the old count was written to guarantee —
   a badge cannot disagree with the list it sits on when it IS that list.

   Sorted worst-first here rather than in the panel: "yours" and "across the
   team" is a distinction the BOARD makes with headings, and a dropdown with
   one scrollable column has nowhere to put them — what it needs is the most
   urgent thing at the top, whoever it belongs to. */

export async function actionRequiredItems(): Promise<ActionChip[]> {
  const chips = await loadActionRequired();
  return sortChips([...chips.self, ...chips.team]);
}
