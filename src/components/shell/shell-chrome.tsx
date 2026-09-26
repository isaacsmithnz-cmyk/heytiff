import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";
import { CommandPalette } from "./command-palette";
import { loadShell } from "@/lib/shell/data";
import { todayInAu } from "@/lib/au-dates";

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
  const { user, orgName } = await loadShell();
  return <Sidebar role={user.role} caps={user.caps} orgName={orgName} />;
}

export async function ShellTopbar() {
  const { user } = await loadShell();
  /* The AU calendar date, read once here on the server so the topbar's clock
     paints with the frame instead of blank until hydration. Synchronous, so it
     adds nothing to what this slot already awaits. */
  return <Topbar user={user} today={todayInAu()} />;
}

export async function ShellPalette() {
  const { user } = await loadShell();
  return <CommandPalette role={user.role} caps={user.caps} />;
}
