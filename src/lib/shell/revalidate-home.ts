import { revalidatePath } from "next/cache";
import { navHref } from "@/components/shell/nav";

/* HOME IS THREE ADDRESSES NOW (v2, 18 October 2026): Home itself, To do's
   whole list (Show all), and the old desk (Your day, the Diary, Tasks and the
   Calendar) until its faces move into Conversations and Schedule. A write
   Home shows — a task, a reminder, a diary entry, a calendar event, a paper
   renewed — refreshes all three, so whichever one you are on updates at
   once: `revalidatePath` redraws only the address it names.

   Home by name, not by path: a revalidate aimed at a moved route fails
   silently (app/actions/kb, `refresh`), and nav-destinations.test holds
   every name to a page. The other two are Home's own pages, and
   revalidate-home.test holds them to theirs. */
const HOME = navHref("home");
export const HOME_PATHS = [HOME, `${HOME}/todo`, `${HOME}/desk`] as const;

export function revalidateHome(): void {
  for (const p of HOME_PATHS) revalidatePath(p);
}
