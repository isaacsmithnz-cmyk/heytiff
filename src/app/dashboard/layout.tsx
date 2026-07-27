import { Suspense } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { ShellPalette, ShellSidebar, ShellTopbar } from "@/components/shell/shell-chrome";
import { SidebarSkeleton, TopbarSkeleton } from "@/components/shell/shell-skeletons";
import "./shell.css";

/* SYNCHRONOUS ON PURPOSE — do not add an `await` to this function.

   It used to await the session, the staff name and the membership before it
   returned anything, which made the layout the thing every screen in the app
   waited on: nothing painted, not even the black frame, until all of it came
   back. Under Cache Components that is also a hard build error ("uncached data
   was accessed outside of <Suspense>"), because a layout that blocks cannot be
   prerendered and neither can anything beneath it.

   So the three parts that need a session are slots, each behind its own
   boundary. The frame prerenders; the chrome streams into it.

   The auth gate is NOT lost by this. `src/proxy.ts` redirects any
   unauthenticated request to /dashboard/* before it reaches this file, so an
   anonymous visitor never renders the layout at all — and every page and
   server action re-checks capabilities for itself regardless. */
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell
      sidebar={
        <Suspense fallback={<SidebarSkeleton />}>
          <ShellSidebar />
        </Suspense>
      }
      topbar={
        <Suspense fallback={<TopbarSkeleton />}>
          <ShellTopbar />
        </Suspense>
      }
      /* No fallback: a palette that doesn't yet know your capabilities should
         be absent, not something you can open and find empty. */
      palette={
        <Suspense fallback={null}>
          <ShellPalette />
        </Suspense>
      }
    >
      {children}
    </AppShell>
  );
}
