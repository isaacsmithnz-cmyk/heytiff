import { Suspense, type ReactNode } from "react";
import { ToastProvider } from "@/components/parts/toast";
import { SettingsNav } from "@/components/settings/settings-nav";
import { settingsSectionsForViewer } from "@/lib/settings/viewer";

/* SETTINGS, the frame every section shares (v2, 25 October 2026). The side
   list on the left, the section on the right. A route group, so no address
   moves and a click between two sections re-renders only the section: the
   list stays painted and this group's loading.tsx holds the right side.

   SYNCHRONOUS, as dashboard/layout.tsx is: an await here would put the frame
   back inside the thing being waited for. The list's own reads (who may see
   which section) sit in their own Suspense, so on arrival the list fills in
   beside the page rather than holding it. A setting that saves itself says
   so in a toast with Undo (rule 51), so the frame holds the toasts. */
async function Nav() {
  return <SettingsNav sections={await settingsSectionsForViewer()} />;
}

export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="page in">
      <div className="wrap">
        <div className="st2">
          <Suspense fallback={<nav className="st2-nav" aria-label="Settings" />}>
            <Nav />
          </Suspense>
          <div className="st2-body">
            <ToastProvider>{children}</ToastProvider>
          </div>
        </div>
      </div>
    </div>
  );
}
