import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";
import { CommandPalette } from "./command-palette";
import { RecordWindowsSlot } from "@/components/records/record-host";
import { loadShell } from "@/lib/shell/data";
import { todayInAu } from "@/lib/au-dates";
import { newJobOffered } from "@/lib/workboard/new-job-offer";
import { getSm8Timezone } from "@/lib/workboard/query";

/* The three pieces of chrome that need to know who you are.

   SERVER components, each awaiting the same request-cached `loadShell()`, and
   each handed to AppShell as a slot already wrapped in its own <Suspense>.
   That is the shape the framework wants: the boundary sits in the server tree
   ABOVE the thing that awaits, so the prerenderer can emit the fallback into
   the static shell and stream the real chrome in behind it.

   The earlier attempt passed one unresolved promise into AppShell (a client
   component) and put the boundaries inside it. That still reads as blocking
   data access AT the client boundary — the promise has to resolve for the RSC
   payload to serialize — and the build says so. Three small server components
   is the version that actually prerenders.

   None of them takes a callback: opening the command palette travels through
   `CommandPaletteProvider` context instead, because a server-rendered slot
   cannot receive a client function as a prop. */

export async function ShellSidebar() {
  const { user, orgId } = await loadShell();
  /* New offers a Job where the board would: ServiceM8 takes new jobs from
     this workspace and you may run the board */
  const newJob = orgId ? await newJobOffered(orgId, user.caps.includes("workboard_manage")) : false;
  return <Sidebar user={user} newJob={newJob} />;
}

export async function ShellTopbar() {
  /* the workspace's own clock (its ServiceM8 account's zone), so the day
     and the time in the header are the yard's, wherever the yard is */
  const { orgId } = await loadShell();
  const tz = orgId ? await getSm8Timezone(orgId) : null;
  /* The AU calendar date, read once here on the server so the topbar's clock
     paints with the frame instead of blank until hydration. Synchronous, so it
     adds nothing to what this slot already awaits. */
  return <Topbar today={todayInAu(new Date(), tz)} tz={tz} />;
}

export async function ShellPalette() {
  const { user } = await loadShell();
  return <CommandPalette role={user.role} caps={user.caps} />;
}

/* The record host's windows, with the card's grants from the same
   capability read the board uses. The host itself (state, address, doors)
   is in the layout and needs none of this; only drawing a card does. */
export async function ShellRecords() {
  const { user } = await loadShell();
  return (
    <RecordWindowsSlot
      manage={user.caps.includes("workboard_manage")}
      moneyVisible={user.caps.includes("workboard_money")}
    />
  );
}
