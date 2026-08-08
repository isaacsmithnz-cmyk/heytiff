import { Suspense } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { NoteScopeProvider } from "@/components/notes/note-context";
import { isTranscriptionConfigured } from "@/lib/voice/transcribe";
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
   server action re-checks capabilities for itself regardless.

   THE NOTE SCOPE IS HERE, once, and it does not break the rule above:
   `isTranscriptionConfigured` reads an env var, so it is synchronous and this
   function stays synchronous with it. It wraps the shell because the Tiff
   button lives in the FRAME, above every screen — screens report what they
   are about UP into it (see components/notes/note-context). */
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <NoteScopeProvider voiceEnabled={isTranscriptionConfigured()}>
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
    </NoteScopeProvider>
  );
}
