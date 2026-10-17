"use server";

import { auth0 } from "@/lib/auth0";
import { staffProfileIdFor } from "@/lib/fleet/query";
import { todayInAu } from "@/lib/au-dates";
import { loadActionRequired } from "@/lib/dashboard/page-data";
import { dueReminders } from "@/lib/dashboard/reminders-query";
import { newAssignments } from "@/lib/dashboard/assignments-query";
import { unreadNotices } from "@/lib/dashboard/todo-query";
import { bellCount } from "@/lib/dashboard/todo";

/* THE COUNT BESIDE HOME IN THE SIDEBAR (decision 25: the bell goes, and its
   count sits on Home in the menu).

   AN ACTION, NOT A PROP, for the reason the bell's reads were: the sidebar
   is the frame, and `dashboard/layout.tsx` stays synchronous, so the frame
   paints with no number and asks afterwards. One round trip carries the
   whole number, where the bell made three.

   THE BELL'S NUMBER (lib/dashboard/todo, `bellCount`): every alert, the
   reminders due, the work given to you not already due, and the notices
   you haven't read. Null for a read that failed, so the sidebar keeps the
   last number it had rather than claiming nothing needs you. */
export async function homeCount(): Promise<number | null> {
  try {
    const session = await auth0.getSession();
    const orgId = session?.orgId as string | undefined;
    const userId = session?.user?.sub as string | undefined;
    if (!orgId || !userId) return 0;
    const staffId = await staffProfileIdFor(orgId, userId);
    const [chips, reminders, assignments, notices] = await Promise.all([
      loadActionRequired(),
      staffId ? dueReminders(orgId, staffId) : Promise.resolve([]),
      staffId ? newAssignments(orgId, staffId) : Promise.resolve([]),
      staffId ? unreadNotices(orgId, staffId, todayInAu()) : Promise.resolve([]),
    ]);
    return bellCount({ chips: [...chips.self, ...chips.team], reminders, assignments, notices });
  } catch {
    return null;
  }
}
